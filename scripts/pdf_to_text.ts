/**
 * scripts/pdf-to-text.ts
 *
 * Convert PDF files to text using Cloudflare Vision AI.
 * Renders each page as PNG, then describes with Vision AI.
 * Output: one .txt file per PDF saved to out/ directory.
 *
 * Run:
 *   npx tsx scripts/pdf-to-text.ts
 *
 * Requires:
 *   npm install pdf2pic sharp dotenv
 */

import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { fromPath } from "pdf2pic";

config({ path: ".env" });

// ─── Config ───────────────────────────────────────────────────────────────────

const DOCS_DIR = path.resolve("doc");
const OUT_DIR = path.resolve("out");
const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;

const PAGE_DPI = 200;
const PAGE_WIDTH = 1654;
const API_DELAY_MS = 500;

// ─── Vision API ───────────────────────────────────────────────────────────────

async function describeImage(imagePath: string, pageNum: number): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);

  const prompt = `Bạn là một trợ lý AI giúp trích xuất văn bản từ tài liệu. Đầu tiên hãy trích xuất chữ từ văn bản đúng thứ tự và y nguyên
  như trên trang. Nếu gặp ảnh hãy mô tả nội dung ảnh đó - những bức ảnh ở trong tài liệu này
  thường là ảnh chụp màn hình của một ứng dụng để giúp người đọc hiểu được ứng dụng của tôi. Đây là trang số ${pageNum}.`;
 
  // Cloudflare llava expects image as number[] (byte array)
  const imageArray = Array.from(imageBuffer);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${VISION_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image: imageArray,
      }),
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Vision API error (${res.status}): ${raw}`);
  }

  // Debug: log raw response on first page
  if (pageNum === 1) {
    console.log(`\n   [DEBUG] Raw response: ${raw.slice(0, 300)}`);
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    return raw.trim();
  }

  const text =
    json?.result?.response ||
    json?.result?.description ||
    json?.result?.text ||
    json?.response ||
    "";

  return typeof text === "string" ? text.trim() : JSON.stringify(text);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPdfPageCount(pdfPath: string): number {
  const buffer = fs.readFileSync(pdfPath);
  const text = buffer.toString("latin1");
  const match = text.match(/\/Count\s+(\d+)/g);
  if (!match) return 0;
  const counts = match.map((m) => parseInt(m.replace(/\/Count\s+/, ""), 10));
  return Math.max(...counts);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function processPdf(pdfPath: string): Promise<void> {
  const filename = path.basename(pdfPath, ".pdf");
  const tmpDir = path.join(OUT_DIR, `_tmp_${filename}`);
  const outFile = path.join(OUT_DIR, `${filename}.txt`);

  console.log(`\n📄 Processing: ${path.basename(pdfPath)}`);

  const pageCount = getPdfPageCount(pdfPath);
  console.log(`   Pages: ${pageCount}`);

  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`   Rendering pages to images...`);
  const converter = fromPath(pdfPath, {
    density: PAGE_DPI,
    saveFilename: "page",
    savePath: tmpDir,
    format: "png",
    width: PAGE_WIDTH,
  });

  const allText: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    process.stdout.write(`   Page ${pageNum}/${pageCount}: rendering... `);

    await converter(pageNum, { responseType: "image" });
    const imagePath = path.join(tmpDir, `page.${pageNum}.png`);

    if (!fs.existsSync(imagePath)) {
      console.log(`⚠️  Image not found, skipping`);
      continue;
    }

    const fileSizeKB = Math.round(fs.statSync(imagePath).size / 1024);
    process.stdout.write(`(${fileSizeKB}KB) vision AI... `);

    try {
      const text = await describeImage(imagePath, pageNum);
      allText.push(`\n\n=== PAGE ${pageNum} ===\n\n${text}`);
      console.log(`✓ (${text.length} chars)`);
    } catch (err) {
      console.log(`❌ ${err}`);
      allText.push(`\n\n=== PAGE ${pageNum} ===\n\n[Error extracting this page]`);
    }

    fs.unlinkSync(imagePath);

    if (pageNum < pageCount) await sleep(API_DELAY_MS);
  }

  const fullText = `=== ${filename.toUpperCase()} ===\nExtracted: ${new Date().toISOString()}\nPages: ${pageCount}\n${allText.join("")}`;
  fs.writeFileSync(outFile, fullText, "utf-8");
  console.log(`\n   ✓ Saved: out/${filename}.txt`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.error("Missing env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pdfFiles = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(DOCS_DIR, f));

  if (pdfFiles.length === 0) {
    console.error(`No PDF files found in ${DOCS_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${pdfFiles.length} PDF file(s): ${pdfFiles.map((f) => path.basename(f)).join(", ")}`);

  for (const pdfPath of pdfFiles) {
    await processPdf(pdfPath);
  }

  console.log(`\n✓ Done! Check the out/ folder for your text files.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});