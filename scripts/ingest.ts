/**
 * scripts/ingest.ts
 *
 * One-time (or on-update) ingestion script.
 * Reads the Markdown corpus declared in doc/rag-corpus.json, chunks by heading + size,
 * embeds with the configured provider, and synchronizes Vectorize plus KV chunk text.
 *
 * Run:
 *   npm run rag:dry-run
 *   npm run rag:sync
 *
 * Requires:
 *   - wrangler login (or CLOUDFLARE_API_TOKEN env var set)
 *   - Vectorize index already created
 *   - KV namespace already created and id filled in wrangler.jsonc
 *
 * --replace only deletes Vectorize IDs and KV keys with the chunk: prefix that
 * are not present in the current manifest. Other KV data is preserved.
 */

import fs from "fs";
import path from "path";
import { config } from "dotenv";

// Load scripts/.env automatically
config({ path: ".env" });

// ─── Config ──────────────────────────────────────────────────────────────────

const DOCS_DIR = path.resolve("doc");
const CORPUS_MANIFEST = path.resolve(process.env.RAG_CORPUS_MANIFEST ?? "doc/rag-corpus.json");
const VECTORIZE_INDEX = process.env.VECTORIZE_INDEX ?? "zilcode-docs";
const CLOUDFLARE_EMBEDDING_MODEL = process.env.CLOUDFLARE_EMBEDDING_MODEL ?? "@cf/baai/bge-m3";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");

// Cloudflare credentials — read from env or wrangler login session
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;

// KV namespace id — copy from wrangler.jsonc after creating namespace
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID!;

const CHUNK_MAX_CHARS = 1800;
const CHUNK_OVERLAP_CHARS = 160;
const VECTOR_METADATA_EXCERPT_CHARS = 800;
const REPLACE_CORPUS = process.argv.includes("--replace");
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Types ────────────────────────────────────────────────────────────────────

type DocType = "admin" | "user" | "intro" | "dai_viet" | "logic" | "general";

interface DocProfile {
  title: string;
  doc_type: DocType;
  audience: string;
  doc_group: "guide" | "agent_logic" | "general";
  logic_area?: string;
}

interface CorpusDocument {
  path: string;
  profile?: Partial<DocProfile>;
}

interface ChunkMetadata {
  module: string;
  filename: string;
  source_path: string;
  source_dir: string;
  title: string;
  doc_type: DocType;
  doc_group: "guide" | "agent_logic" | "general";
  logic_area?: string;
  audience: string;
  heading: string;
  heading_level: number;
  section_path: string;
  chunk_index: number;
  part_index: number;
  excerpt: string;
}

interface Chunk {
  id: string;
  text: string;
  embeddingText: string;
  metadata: ChunkMetadata;
}

interface MarkdownSection {
  heading: string;
  headingLevel: number;
  sectionPath: string;
  text: string;
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Split markdown into chunks that match the current Zilcode docs:
 * - Admin docs use deep headings down to ##### for Application/Window/Tab/Field.
 * - User docs are mostly task-oriented ### sections.
 * - Each chunk carries the full section path and target audience so retrieval can
 *   distinguish "người dùng" questions from "quản trị" questions.
 */
function chunkMarkdown(text: string, filename: string, profileOverride?: Partial<DocProfile>): Chunk[] {
  const sourcePath = filename.replace(/\\/g, "/");
  const module = getModuleName(sourcePath);
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const title = getDocumentTitle(normalized, module);
  const detectedProfile = getDocProfile(sourcePath, title);
  const definedOverrides = Object.fromEntries(
    Object.entries(profileOverride ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<DocProfile>;
  const profile: DocProfile = {
    ...detectedProfile,
    ...definedOverrides,
    title: definedOverrides.title || detectedProfile.title
  };
  const sections = parseMarkdownSections(normalized);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const parts = splitSectionText(section.text);

    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const metadata: ChunkMetadata = {
        module,
        filename: path.basename(sourcePath),
        source_path: sourcePath,
        source_dir: path.dirname(sourcePath) === "." ? "" : path.dirname(sourcePath),
        title: profile.title,
        doc_type: profile.doc_type,
        doc_group: profile.doc_group,
        logic_area: profile.logic_area,
        audience: profile.audience,
        heading: section.heading,
        heading_level: section.headingLevel,
        section_path: section.sectionPath,
        chunk_index: chunkIndex,
        part_index: partIndex,
        excerpt: parts[partIndex].slice(0, VECTOR_METADATA_EXCERPT_CHARS)
      };

      chunks.push({
        id: `${module}-${chunkIndex}`,
        text: parts[partIndex],
        embeddingText: buildEmbeddingText(parts[partIndex], metadata),
        metadata
      });
      chunkIndex++;
    }
  }

  return chunks;
}

function getDocumentTitle(text: string, fallback: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

function getModuleName(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  if (!parsed.dir || parsed.dir === ".") return parsed.name;
  return `${parsed.dir.replace(/[\\/]+/g, "__")}__${parsed.name}`;
}

function getLogicArea(lowerPath: string): string {
  if (lowerPath.includes("rest-api")) return "rest_api_contract";
  if (lowerPath.includes("runtime")) return "runtime_architecture";
  if (lowerPath.includes("domain")) return "domain_model";
  if (lowerPath.includes("window-tab-field")) return "window_tab_field_config";
  if (lowerPath.includes("agent-operating")) return "agent_operating_model";
  if (lowerPath.includes("tool-safety")) return "tool_safety_rules";
  if (lowerPath.includes("editing")) return "editing_rules";
  return "zilcode_logic";
}

function getDocProfile(filename: string, title: string): DocProfile {
  const lower = filename.replace(/\\/g, "/").toLowerCase();

  if (lower.startsWith("logic/") || lower.includes("/logic/")) {
    return {
      title,
      doc_type: "logic",
      doc_group: "agent_logic",
      logic_area: getLogicArea(lower),
      audience: "agent AI, tool-calling planner, developer tích hợp Zilcode"
    };
  }

  if (lower.includes("admin")) {
    return {
      title,
      doc_type: "admin",
      doc_group: "guide",
      audience: "quản trị viên, người cấu hình hệ thống"
    };
  }

  if (lower.includes("user")) {
    return {
      title,
      doc_type: "user",
      doc_group: "guide",
      audience: "người dùng cuối"
    };
  }

  if (lower.includes("intro")) {
    return {
      title,
      doc_type: "intro",
      doc_group: "guide",
      audience: "người mới tìm hiểu Zilcode"
    };
  }

  return {
    title,
    doc_type: "general",
    doc_group: "general",
    audience: "người dùng Zilcode"
  };
}

function parseMarkdownSections(text: string): MarkdownSection[] {
  const headingMatches = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)];

  if (headingMatches.length === 0) {
    return [{
      heading: "Nội dung",
      headingLevel: 1,
      sectionPath: "Nội dung",
      text
    }];
  }

  const sections: MarkdownSection[] = [];
  let headingStack: string[] = [];

  for (let i = 0; i < headingMatches.length; i++) {
    const match = headingMatches[i];
    const level = match[1].length;
    const heading = match[2].trim();
    const start = match.index ?? 0;
    const end = headingMatches[i + 1]?.index ?? text.length;
    let sectionText = text.slice(start, end).trim();
    const bodyText = sectionText.replace(/^#{1,6}\s+.+$/m, "").trim();

    headingStack[level - 1] = heading;
    headingStack = headingStack.slice(0, level);

    if (!bodyText) {
      const overview = buildChildHeadingOverview(headingMatches, i, level, heading);
      if (!overview) continue;
      sectionText = overview;
    }

    sections.push({
      heading,
      headingLevel: level,
      sectionPath: headingStack.join(" > "),
      text: sectionText
    });
  }

  return sections;
}

function buildChildHeadingOverview(
  headingMatches: RegExpMatchArray[],
  currentIndex: number,
  parentLevel: number,
  parentHeading: string
): string | null {
  const childHeadings: string[] = [];

  for (let i = currentIndex + 1; i < headingMatches.length; i++) {
    const level = headingMatches[i][1].length;
    if (level <= parentLevel) break;
    if (level === parentLevel + 1) {
      childHeadings.push(headingMatches[i][2].trim());
    }
  }

  if (childHeadings.length === 0) return null;

  return [
    `${"#".repeat(parentLevel)} ${parentHeading}`,
    "",
    "Các mục con:",
    ...childHeadings.map(heading => `- ${heading}`)
  ].filter(Boolean).join("\n");
}

function splitSectionText(sectionText: string): string[] {
  if (sectionText.length <= CHUNK_MAX_CHARS) {
    return [sectionText];
  }

  const blocks = sectionText
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length <= CHUNK_MAX_CHARS) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (block.length > CHUNK_MAX_CHARS) {
      chunks.push(...splitLongText(block));
    } else {
      current = block;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_MAX_CHARS, text.length);

    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf(". ", end),
        text.lastIndexOf("; ", end),
        text.lastIndexOf(", ", end)
      );

      if (boundary > start + CHUNK_MAX_CHARS * 0.6) {
        end = boundary + 1;
      }
    }

    const slice = text.slice(start, end).trim();
    if (slice) chunks.push(slice);

    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
  }

  return chunks;
}

function buildEmbeddingText(text: string, metadata: ChunkMetadata): string {
  return [
    `Nguon: ${metadata.source_path}`,
    `Nhom tai lieu: ${metadata.doc_group}`,
    metadata.logic_area ? `Mang logic: ${metadata.logic_area}` : undefined,
    `Tài liệu: ${metadata.title}`,
    `Loại tài liệu: ${metadata.doc_type}`,
    `Đối tượng: ${metadata.audience}`,
    `Mục: ${metadata.section_path}`,
    "",
    text
  ].filter(Boolean).join("\n");
}

// ─── Embedding + Cloudflare API helpers ───────────────────────────────────────

async function fetchCloudflare(
  input: string,
  init: RequestInit = {},
  maxAttempts = 5
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) return res;

      await res.text();
      const retryAfterSeconds = Number(res.headers.get("retry-after") ?? "0");
      const delayMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000
        : Math.min(1_000 * 2 ** (attempt - 1), 10_000);
      console.warn(`Cloudflare API returned ${res.status}; retry ${attempt}/${maxAttempts} in ${delayMs}ms.`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 10_000);
      console.warn(`Cloudflare API request failed; retry ${attempt}/${maxAttempts} in ${delayMs}ms.`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Cloudflare API request failed after retries.");
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  return embedTextsWithCloudflare(texts);
}

async function embedTextsWithCloudflare(texts: string[]): Promise<number[][]> {
  const res = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CLOUDFLARE_EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: texts })
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error: ${err}`);
  }
  const json = await res.json() as { result: { data: number[][] } };
  return validateEmbeddings(json.result.data, texts.length);
}

function validateEmbeddings(embeddings: number[][], expectedCount: number): number[][] {
  if (embeddings.length !== expectedCount) {
    throw new Error(`Embedding count mismatch: expected ${expectedCount}, got ${embeddings.length}.`);
  }

  for (const [index, embedding] of embeddings.entries()) {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding #${index} có ${embedding.length} chiều, nhưng EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS}. ` +
        "Vectorize index phải được tạo đúng số chiều với model embedding đang dùng."
      );
    }
  }

  return embeddings;
}

async function upsertVectors(vectors: { id: string; values: number[]; metadata: object }[]) {
  const res = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/upsert`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ vectors })
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vectorize upsert error: ${err}`);
  }

  const json = await res.json() as { result?: { mutationId?: string } };
  return json.result?.mutationId ?? "";
}

async function putKVBulk(pairs: { key: string; value: string }[]) {
  // KV bulk write — max 10,000 pairs per request
  const res = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/bulk`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(pairs.map(p => ({ key: p.key, value: p.value })))
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KV bulk write error: ${err}`);
  }
}

async function listVectorIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor = "";

  do {
    const query = new URLSearchParams({ count: "1000" });
    if (cursor) query.set("cursor", cursor);
    const res = await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/list?${query}`,
      { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
    );
    if (!res.ok) {
      throw new Error(`Vectorize list error: ${await res.text()}`);
    }

    const json = await res.json() as {
      result?: {
        vectors?: Array<{ id?: string }>;
        isTruncated?: boolean;
        nextCursor?: string;
      };
    };
    const result = json.result ?? {};
    ids.push(...(result.vectors ?? []).map(vector => vector.id ?? "").filter(Boolean));
    cursor = result.isTruncated ? (result.nextCursor ?? "") : "";
    if (result.isTruncated && !cursor) {
      throw new Error("Vectorize list response is truncated but has no next cursor.");
    }
  } while (cursor);

  return ids;
}

async function waitForVectorMutation(mutationId: string): Promise<void> {
  if (!mutationId) return;
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const res = await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/info`,
      { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
    );
    if (!res.ok) {
      throw new Error(`Vectorize info error: ${await res.text()}`);
    }
    const json = await res.json() as { result?: { processedUpToMutation?: string } };
    if (json.result?.processedUpToMutation === mutationId) return;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for Vectorize mutation ${mutationId}.`);
}

async function deleteVectorsByIds(ids: string[]): Promise<void> {
  // Vectorize delete_by_ids accepts at most 100 identifiers per request.
  const batchSize = 100;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const res = await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/delete_by_ids`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ids: batch })
      }
    );
    if (!res.ok) {
      throw new Error(`Vectorize delete error: ${await res.text()}`);
    }
    const json = await res.json() as { result?: { mutationId?: string } };
    await waitForVectorMutation(json.result?.mutationId ?? "");
  }
}

async function listKVKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "";

  do {
    const query = new URLSearchParams({ limit: "1000", prefix });
    if (cursor) query.set("cursor", cursor);
    const res = await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?${query}`,
      { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
    );
    if (!res.ok) {
      throw new Error(`KV list error: ${await res.text()}`);
    }
    const json = await res.json() as {
      result?: Array<{ name?: string }>;
      result_info?: { cursor?: string };
    };
    keys.push(...(json.result ?? []).map(item => item.name ?? "").filter(Boolean));
    cursor = json.result_info?.cursor ?? "";
  } while (cursor);

  return keys;
}

async function deleteKVBulk(keys: string[]): Promise<void> {
  const batchSize = 10_000;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const res = await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/bulk/delete`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(batch)
      }
    );
    if (!res.ok) {
      throw new Error(`KV bulk delete error: ${await res.text()}`);
    }
    const json = await res.json() as { result?: { unsuccessful_keys?: string[] } };
    if ((json.result?.unsuccessful_keys ?? []).length > 0) {
      throw new Error(`KV could not delete keys: ${json.result?.unsuccessful_keys?.join(", ")}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function listCorpusDocuments(): CorpusDocument[] {
  if (!fs.existsSync(CORPUS_MANIFEST)) {
    throw new Error(`RAG corpus manifest not found: ${CORPUS_MANIFEST}`);
  }

  const parsed = JSON.parse(fs.readFileSync(CORPUS_MANIFEST, "utf-8")) as {
    documents?: unknown;
  };
  if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    throw new Error("RAG corpus manifest must contain a non-empty documents array.");
  }

  const byPath = new Map<string, CorpusDocument>();
  for (const item of parsed.documents) {
    const entry = typeof item === "string"
      ? { path: item }
      : (item && typeof item === "object" ? item as Record<string, unknown> : null);
    if (!entry) throw new Error("Each corpus document must be a path string or an object with path.");
    const file = String(entry.path ?? "").replace(/\\/g, "/").trim();
    if (!file) throw new Error("Corpus document path cannot be empty.");
    const absolutePath = path.resolve(DOCS_DIR, file);
    const relativePath = path.relative(DOCS_DIR, absolutePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`Corpus document escapes doc directory: ${file}`);
    }
    if (!file.toLowerCase().endsWith(".md") || !fs.existsSync(absolutePath)) {
      throw new Error(`Corpus document does not exist or is not Markdown: ${file}`);
    }

    const profile = typeof item === "object" && item !== null
      ? {
          title: typeof (item as Record<string, unknown>).title === "string" ? String((item as Record<string, unknown>).title) : undefined,
          doc_type: typeof (item as Record<string, unknown>).doc_type === "string" ? (String((item as Record<string, unknown>).doc_type) as DocType) : undefined,
          doc_group: typeof (item as Record<string, unknown>).doc_group === "string" ? (String((item as Record<string, unknown>).doc_group) as DocProfile["doc_group"]) : undefined,
          audience: typeof (item as Record<string, unknown>).audience === "string" ? String((item as Record<string, unknown>).audience) : undefined,
          logic_area: typeof (item as Record<string, unknown>).logic_area === "string" ? String((item as Record<string, unknown>).logic_area) : undefined
        }
      : undefined;
    byPath.set(file, { path: file, profile });
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  if (!Number.isFinite(EMBEDDING_DIMENSIONS) || EMBEDDING_DIMENSIONS <= 0) {
    console.error("EMBEDDING_DIMENSIONS phải là số dương.");
    process.exit(1);
  }

  console.log("Embedding provider: cloudflare");
  console.log(`Embedding model: ${CLOUDFLARE_EMBEDDING_MODEL}`);
  console.log(`Embedding dimensions: ${EMBEDDING_DIMENSIONS}`);
  console.log(`Vectorize index: ${VECTORIZE_INDEX}`);
  console.log(`Corpus manifest: ${CORPUS_MANIFEST}`);
  console.log(`Replace corpus: ${REPLACE_CORPUS ? "yes" : "no"}`);

  // The manifest is the source of truth. This prevents unrelated internal docs
  // under doc/ from silently entering the user-facing RAG corpus.
  const corpusDocuments = listCorpusDocuments();
  const mdFiles = corpusDocuments.map(document => document.path);

  if (mdFiles.length === 0) {
    console.error(`No .md files found in ${DOCS_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${mdFiles.length} file(s): ${mdFiles.join(", ")}`);

  // 2. Chunk all files
  const allChunks: Chunk[] = [];
  for (const document of corpusDocuments) {
    const file = document.path;
    const text = fs.readFileSync(path.join(DOCS_DIR, file), "utf-8");
    const chunks = chunkMarkdown(text, file, document.profile);
    console.log(`  ${file} → ${chunks.length} chunk(s)`);
    allChunks.push(...chunks);

    // ─── Log chi tiết từng chunk ──────────────────────────────────────────────
    console.log(`\n📄 ${file} — ${chunks.length} chunk(s):`);
    for (const chunk of chunks) {
      const chars = chunk.text.length;
      const estTokens = Math.round(chars / 3);
      console.log(
        `  [${chunk.id}] ${chunk.metadata.doc_type} | ${chunk.metadata.section_path} | ${chars} chars | ~${estTokens} tokens`
      );
      console.log(`    preview: ${chunk.text.slice(0, 80).replace(/\n/g, " ")}...`);
    }
  }

  console.log(`Total chunks: ${allChunks.length}`);

  if (DRY_RUN) {
    console.log("Dry run complete. No remote resources were changed.");
    return;
  }

  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_NAMESPACE_ID) {
    console.error(
      "Missing env vars. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID"
    );
    process.exit(1);
  }

  const expectedVectorIds = new Set(allChunks.map(chunk => chunk.id));
  const expectedKVKeys = new Set(allChunks.map(chunk => `chunk:${chunk.id}`));
  const existingVectorIds = REPLACE_CORPUS ? await listVectorIds() : [];
  const existingKVKeys = REPLACE_CORPUS ? await listKVKeys("chunk:") : [];
  if (REPLACE_CORPUS) {
    console.log(`Existing vectors: ${existingVectorIds.length}`);
    console.log(`Existing KV chunk keys: ${existingKVKeys.length}`);
  }

  // 3. Embed in batches
  const BATCH_SIZE = 50;
  const allVectors: { id: string; values: number[]; metadata: object }[] = [];

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    console.log(`Embedding batch ${i / BATCH_SIZE + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)}...`);
    const embeddings = await embedTexts(batch.map(c => c.embeddingText));
    for (let j = 0; j < batch.length; j++) {
      allVectors.push({
        id: batch[j].id,
        values: embeddings[j],
        metadata: batch[j].metadata
      });
    }
  }

  // 4. Upsert vectors into Vectorize (max 1000 per request)
  console.log("Upserting vectors into Vectorize...");
  const VEC_BATCH = 500;
  for (let i = 0; i < allVectors.length; i += VEC_BATCH) {
    const mutationId = await upsertVectors(allVectors.slice(i, i + VEC_BATCH));
    await waitForVectorMutation(mutationId);
  }

  // 5. Store chunk text in KV
  console.log("Writing chunk text to KV...");
  const kvPairs = allChunks.map(c => ({
    key: `chunk:${c.id}`,
    value: JSON.stringify({ text: c.text, ...c.metadata })
  }));
  await putKVBulk(kvPairs);

  if (REPLACE_CORPUS) {
    const staleVectorIds = existingVectorIds.filter(id => !expectedVectorIds.has(id));
    const staleKVKeys = existingKVKeys.filter(key => !expectedKVKeys.has(key));
    console.log(`Deleting stale vectors: ${staleVectorIds.length}`);
    await deleteVectorsByIds(staleVectorIds);
    console.log(`Deleting stale KV chunk keys: ${staleKVKeys.length}`);
    await deleteKVBulk(staleKVKeys);

    const finalVectorIds = new Set(await listVectorIds());
    const finalKVKeys = new Set(await listKVKeys("chunk:"));
    const missingVectors = [...expectedVectorIds].filter(id => !finalVectorIds.has(id));
    const extraVectors = [...finalVectorIds].filter(id => !expectedVectorIds.has(id));
    const missingKVKeys = [...expectedKVKeys].filter(key => !finalKVKeys.has(key));
    const extraKVKeys = [...finalKVKeys].filter(key => !expectedKVKeys.has(key));
    if (missingVectors.length || extraVectors.length || missingKVKeys.length || extraKVKeys.length) {
      throw new Error(
        `Corpus verification failed: missing_vectors=${missingVectors.length}, ` +
        `extra_vectors=${extraVectors.length}, missing_kv=${missingKVKeys.length}, extra_kv=${extraKVKeys.length}`
      );
    }
  }

  console.log("✓ Ingestion complete.");
  console.log(`  Vectors upserted: ${allVectors.length}`);
  console.log(`  KV keys written:  ${kvPairs.length}`);
}

main().catch(err => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
