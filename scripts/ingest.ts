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

const CHUNK_MAX_CHARS = 1500; // ~512 tokens, safe for bge-m3
const CHUNK_OVERLAP_CHARS = 150;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Chunk {
  id: string;
  text: string;
  metadata: {
    module: string;   // e.g. "intro", "z-flow"
    filename: string; // e.g. "intro.md"
    heading: string;  // nearest heading above this chunk
    chunk_index: number;
  };
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Split markdown into chunks:
 * 1. Split on headings (## or ###) to preserve semantic sections
 * 2. If a section is still too long, sliding-window chunk it
 */
function chunkMarkdown(text: string, filename: string): Chunk[] {
  const module = path.basename(filename, ".md");
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // Split on lines that start with # heading
  const sections = text.split(/(?=^#{1,3} )/m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const headingLine = lines.find(l => /^#{1,3} /.test(l)) ?? "";
    const heading = headingLine.replace(/^#{1,3} /, "").trim();

    if (section.length <= CHUNK_MAX_CHARS) {
      // Section fits in one chunk
      chunks.push({
        id: `${module}-${chunkIndex}`,
        text: section.trim(),
        metadata: { module, filename, heading, chunk_index: chunkIndex }
      });
      chunkIndex++;
    } else {
      // Sliding window over long section
      let start = 0;
      while (start < section.length) {
        const end = Math.min(start + CHUNK_MAX_CHARS, section.length);
        const slice = section.slice(start, end).trim();
        if (slice) {
          chunks.push({
            id: `${module}-${chunkIndex}`,
            text: slice,
            metadata: { module, filename, heading, chunk_index: chunkIndex }
          });
          chunkIndex++;
        }
        if (end === section.length) break;
        start = end - CHUNK_OVERLAP_CHARS;
      }
    }
  }

  return chunks;
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
    .filter(f => f.endsWith(".md"));

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
  }

  console.log(`Total chunks: ${allChunks.length}`);

  // 3. Embed in batches (Cloudflare AI: max 100 texts per request)
  const BATCH_SIZE = 50;
  const allVectors: { id: string; values: number[]; metadata: object }[] = [];

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    console.log(`Embedding batch ${i / BATCH_SIZE + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)}...`);
    const embeddings = await embedTexts(batch.map(c => c.text));
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