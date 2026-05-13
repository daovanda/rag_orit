/**
 * scripts/ingest.ts
 *
 * One-time (or on-update) ingestion script.
 * Reads doc/*.md, chunks by heading + size, embeds with bge-m3,
 * upserts vectors into Vectorize and chunk text into KV.
 *
 * Run:
 *   npx tsx scripts/ingest.ts
 *
 * Requires:
 *   - wrangler login (or CLOUDFLARE_API_TOKEN env var set)
 *   - Vectorize index already created
 *   - KV namespace already created and id filled in wrangler.jsonc
 */

import fs from "fs";
import path from "path";
import { config } from "dotenv";

// Load scripts/.env automatically
config({ path: ".env" });

// ─── Config ──────────────────────────────────────────────────────────────────

const DOCS_DIR = path.resolve("doc");
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const VECTORIZE_INDEX = "zilcode-docs";

// Cloudflare credentials — read from env or wrangler login session
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;

// KV namespace id — copy from wrangler.jsonc after creating namespace
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID!;

const CHUNK_MAX_CHARS = 1800;
const CHUNK_OVERLAP_CHARS = 160;

// ─── Types ────────────────────────────────────────────────────────────────────

type DocType = "admin" | "user" | "intro" | "general";

interface DocProfile {
  title: string;
  doc_type: DocType;
  audience: string;
}

interface ChunkMetadata {
  module: string;
  filename: string;
  title: string;
  doc_type: DocType;
  audience: string;
  heading: string;
  heading_level: number;
  section_path: string;
  chunk_index: number;
  part_index: number;
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
function chunkMarkdown(text: string, filename: string): Chunk[] {
  const module = path.basename(filename, ".md");
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const title = getDocumentTitle(normalized, module);
  const profile = getDocProfile(filename, title);
  const sections = parseMarkdownSections(normalized);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const parts = splitSectionText(section.text);

    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const metadata: ChunkMetadata = {
        module,
        filename,
        title: profile.title,
        doc_type: profile.doc_type,
        audience: profile.audience,
        heading: section.heading,
        heading_level: section.headingLevel,
        section_path: section.sectionPath,
        chunk_index: chunkIndex,
        part_index: partIndex
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

function getDocProfile(filename: string, title: string): DocProfile {
  const lower = filename.toLowerCase();

  if (lower.includes("admin")) {
    return {
      title,
      doc_type: "admin",
      audience: "quản trị viên, người cấu hình hệ thống"
    };
  }

  if (lower.includes("user")) {
    return {
      title,
      doc_type: "user",
      audience: "người dùng cuối"
    };
  }

  if (lower.includes("intro")) {
    return {
      title,
      doc_type: "intro",
      audience: "người mới tìm hiểu Zilcode"
    };
  }

  return {
    title,
    doc_type: "general",
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
  ].join("\n");
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
    `Tài liệu: ${metadata.title}`,
    `Loại tài liệu: ${metadata.doc_type}`,
    `Đối tượng: ${metadata.audience}`,
    `Mục: ${metadata.section_path}`,
    "",
    text
  ].join("\n");
}

// ─── Cloudflare API helpers ───────────────────────────────────────────────────

async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
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
  return json.result.data;
}

async function upsertVectors(vectors: { id: string; values: number[]; metadata: object }[]) {
  const res = await fetch(
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
}

async function putKVBulk(pairs: { key: string; value: string }[]) {
  // KV bulk write — max 10,000 pairs per request
  const res = await fetch(
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_NAMESPACE_ID) {
    console.error(
      "Missing env vars. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID"
    );
    process.exit(1);
  }

  // 1. Read all .md files
  const mdFiles = fs
    .readdirSync(DOCS_DIR)
    .filter(f => f.endsWith(".md"))
    .sort();

  if (mdFiles.length === 0) {
    console.error(`No .md files found in ${DOCS_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${mdFiles.length} file(s): ${mdFiles.join(", ")}`);

  // 2. Chunk all files
  const allChunks: Chunk[] = [];
  for (const file of mdFiles) {
    const text = fs.readFileSync(path.join(DOCS_DIR, file), "utf-8");
    const chunks = chunkMarkdown(text, file);
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

  // 3. Embed in batches (Cloudflare AI: max 100 texts per request)
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
    await upsertVectors(allVectors.slice(i, i + VEC_BATCH));
  }

  // 5. Store chunk text in KV
  console.log("Writing chunk text to KV...");
  const kvPairs = allChunks.map(c => ({
    key: `chunk:${c.id}`,
    value: JSON.stringify({ text: c.text, ...c.metadata })
  }));
  await putKVBulk(kvPairs);

  console.log("✓ Ingestion complete.");
  console.log(`  Vectors upserted: ${allVectors.length}`);
  console.log(`  KV keys written:  ${kvPairs.length}`);
}

main().catch(err => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
