import dotenv from "dotenv";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import OpenAI from "openai";
import { Pool, PoolClient } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(currentDir, "../../../.env"),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

type CrawlTarget = {
  startUrls: string[];
  allowedHost: string;
  maxPages: number;
};

type ImageMeta = {
  imageUrl: string;
  altText?: string;
  caption?: string;
  nearbyText?: string;
};

type PageSnapshot = {
  url: string;
  title: string;
  content: string;
  contentHash: string;
  links: string[];
  images: ImageMeta[];
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const embeddingTpmLimit = Number(process.env.EMBEDDING_TPM_LIMIT || 800000);
const embeddingMaxBatchTokens = Number(process.env.EMBEDDING_MAX_BATCH_TOKENS || 20000);
const embeddingMaxRetries = Number(process.env.EMBEDDING_MAX_RETRIES || 6);
const embeddingRetryBaseMs = Number(process.env.EMBEDDING_RETRY_BASE_MS || 300);

type TokenUsagePoint = {
  timestampMs: number;
  tokens: number;
};

class TokenRateLimiter {
  private usage: TokenUsagePoint[] = [];

  constructor(private readonly tpmLimit: number) {}

  private prune(nowMs: number): void {
    const threshold = nowMs - 60000;
    while (this.usage.length > 0 && this.usage[0].timestampMs < threshold) {
      this.usage.shift();
    }
  }

  private usedTokens(): number {
    return this.usage.reduce((sum, point) => sum + point.tokens, 0);
  }

  private requiredWaitMs(nowMs: number, neededTokens: number): number {
    let releasable = 0;
    for (const point of this.usage) {
      releasable += point.tokens;
      if (releasable >= neededTokens) {
        return Math.max(0, point.timestampMs + 60000 - nowMs + 5);
      }
    }
    return 600;
  }

  async waitFor(tokens: number): Promise<void> {
    if (tokens <= 0) return;
    if (tokens > this.tpmLimit) {
      throw new Error(`embedding request tokens (${tokens}) exceed EMBEDDING_TPM_LIMIT (${this.tpmLimit})`);
    }

    while (true) {
      const nowMs = Date.now();
      this.prune(nowMs);
      const used = this.usedTokens();
      const nextTotal = used + tokens;

      if (nextTotal <= this.tpmLimit) {
        this.usage.push({ timestampMs: nowMs, tokens });
        return;
      }

      const needed = nextTotal - this.tpmLimit;
      const waitMs = this.requiredWaitMs(nowMs, needed);
      await sleep(waitMs);
    }
  }
}

const embeddingLimiter = new TokenRateLimiter(embeddingTpmLimit);

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isAllowedUrl(url: URL, allowedHost: string): boolean {
  return url.hostname === allowedHost && ["http:", "https:"].includes(url.protocol);
}

function toAbsoluteUrl(input: string, base: string): string | null {
  try {
    return new URL(input, base).toString();
  } catch {
    return null;
  }
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "help-chatbot-crawler/0.1" },
  });

  if (!response.ok) {
    throw new Error(`fetch failed: ${url} (${response.status})`);
  }
  return response.text();
}

function parsePage(url: string, html: string, allowedHost: string): PageSnapshot {
  const $ = load(html);
  $("script,style,noscript").remove();

  const title = normalizeWhitespace($("title").first().text()) || url;
  const content = normalizeWhitespace($("body").text());
  const contentHash = hashContent(content);

  const links = new Set<string>();
  $("a[href]").each((_index, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = toAbsoluteUrl(href, url);
    if (!resolved) return;

    const target = new URL(resolved);
    target.hash = "";
    if (isAllowedUrl(target, allowedHost)) {
      links.add(target.toString());
    }
  });

  const images: ImageMeta[] = [];
  $("img[src]").each((_index, el) => {
    const src = $(el).attr("src");
    if (!src) return;

    const imageUrl = toAbsoluteUrl(src, url);
    if (!imageUrl) return;

    const altText = normalizeWhitespace($(el).attr("alt") || "") || undefined;
    const caption = normalizeWhitespace($(el).closest("figure").find("figcaption").first().text()) || undefined;
    const nearbyText = normalizeWhitespace($(el).parent().text()) || undefined;

    images.push({ imageUrl, altText, caption, nearbyText });
  });

  return { url, title, content, contentHash, links: [...links], images };
}

function chunkText(content: string, chunkSize = 1200, overlap = 200): string[] {
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const end = Math.min(content.length, cursor + chunkSize);
    const chunk = content.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= content.length) break;
    cursor = end - overlap;
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  // Safe-side rough estimate for mixed JP/EN text.
  return Math.max(1, Math.ceil(text.length / 4));
}

function parseRetryAfterMs(error: unknown): number | null {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: string }).message || "")
      : "";
  const msMatch = message.match(/try again in\s+(\d+)ms/i);
  if (msMatch?.[1]) return Number(msMatch[1]);

  const maybeError = error as {
    response?: { headers?: { get?: (name: string) => string | null } };
  };
  const retryAfter = maybeError.response?.headers?.get?.("retry-after");
  if (!retryAfter) return null;

  const asSeconds = Number(retryAfter);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.ceil(asSeconds * 1000);
  }

  return null;
}

function isRateLimitError(error: unknown): boolean {
  const anyError = error as { status?: number; code?: string; message?: string };
  if (anyError?.status === 429) return true;
  if (anyError?.code === "rate_limit_exceeded") return true;
  return /rate limit/i.test(String(anyError?.message || ""));
}

function createEmbeddingBatches(inputs: string[], maxBatchTokens: number): Array<{ indexes: number[]; texts: string[]; tokens: number }> {
  const batches: Array<{ indexes: number[]; texts: string[]; tokens: number }> = [];
  let currentIndexes: number[] = [];
  let currentTexts: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < inputs.length; i += 1) {
    const text = inputs[i];
    const tokens = estimateTokens(text);
    if (tokens > maxBatchTokens) {
      throw new Error(`single chunk token estimate (${tokens}) exceeds EMBEDDING_MAX_BATCH_TOKENS (${maxBatchTokens})`);
    }

    if (currentTokens > 0 && currentTokens + tokens > maxBatchTokens) {
      batches.push({ indexes: currentIndexes, texts: currentTexts, tokens: currentTokens });
      currentIndexes = [];
      currentTexts = [];
      currentTokens = 0;
    }

    currentIndexes.push(i);
    currentTexts.push(text);
    currentTokens += tokens;
  }

  if (currentIndexes.length > 0) {
    batches.push({ indexes: currentIndexes, texts: currentTexts, tokens: currentTokens });
  }

  return batches;
}

async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const batches = createEmbeddingBatches(inputs, embeddingMaxBatchTokens);
  const results: number[][] = new Array(inputs.length);

  for (const batch of batches) {
    await embeddingLimiter.waitFor(batch.tokens);

    let attempt = 0;
    while (true) {
      try {
        const response = await openai.embeddings.create({
          model: embeddingModel,
          input: batch.texts,
        });

        response.data.forEach((item, offset) => {
          const index = batch.indexes[offset];
          results[index] = item.embedding;
        });
        break;
      } catch (error) {
        attempt += 1;
        if (!isRateLimitError(error) || attempt > embeddingMaxRetries) {
          throw error;
        }

        const retryAfterMs = parseRetryAfterMs(error);
        const backoffMs = Math.min(10000, embeddingRetryBaseMs * 2 ** (attempt - 1));
        const jitterMs = Math.floor(Math.random() * 200);
        await sleep(Math.max(retryAfterMs ?? 0, backoffMs + jitterMs));
      }
    }
  }

  return results;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function upsertDocument(client: PoolClient, page: PageSnapshot): Promise<{ documentId: string; changed: boolean }> {
  const current = await client.query<{ id: string; content_hash: string }>(
    "SELECT id::text, content_hash FROM documents WHERE url = $1",
    [page.url],
  );

  if (current.rowCount && current.rows[0].content_hash === page.contentHash) {
    return { documentId: current.rows[0].id, changed: false };
  }

  const upsert = await client.query<{ id: string }>(
    `
    INSERT INTO documents (url, title, content, content_hash, crawled_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      crawled_at = NOW(),
      updated_at = NOW()
    RETURNING id::text
    `,
    [page.url, page.title, page.content, page.contentHash],
  );

  const documentId = upsert.rows[0].id;
  await client.query("DELETE FROM chunks WHERE document_id = $1::uuid", [documentId]);
  await client.query("DELETE FROM images WHERE document_id = $1::uuid", [documentId]);

  return { documentId, changed: true };
}

async function insertChunks(client: PoolClient, documentId: string, title: string, chunks: string[]): Promise<string[]> {
  const embeddings = await createEmbeddings(chunks);
  const chunkIds: string[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const result = await client.query<{ id: string }>(
      `
      INSERT INTO chunks (document_id, chunk_index, heading, anchor, chunk_text, embedding, token_count)
      VALUES ($1::uuid, $2, $3, $4, $5, $6::vector, $7)
      RETURNING id::text
      `,
      [documentId, i, title, null, chunks[i], toVectorLiteral(embeddings[i]), estimateTokens(chunks[i])],
    );
    chunkIds.push(result.rows[0].id);
  }

  return chunkIds;
}

async function insertImages(client: PoolClient, documentId: string, sourceUrl: string, images: ImageMeta[], chunkIds: string[]): Promise<void> {
  for (const image of images) {
    await client.query(
      `
      INSERT INTO images (document_id, chunk_id, image_url, alt_text, caption, nearby_text, source_url)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
      ON CONFLICT (document_id, image_url) DO NOTHING
      `,
      [documentId, chunkIds[0] || null, image.imageUrl, image.altText || null, image.caption || null, image.nearbyText || null, sourceUrl],
    );
  }
}

function parseCliArgs(argv: string[]): { urlFile?: string } {
  const args = argv.slice(2);
  const result: { urlFile?: string } = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--url-file") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("--url-file requires a file path");
      }
      result.urlFile = value;
      i += 1;
    }
  }

  return result;
}

function normalizeSeedUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function loadSeedUrls(urlFilePath: string, allowedHost: string): Promise<string[]> {
  const absolutePath = path.resolve(process.cwd(), urlFilePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const rows = raw.split(/\r?\n/);
  const unique = new Set<string>();

  for (const row of rows) {
    const normalized = normalizeSeedUrl(row);
    if (!normalized) continue;
    const url = new URL(normalized);
    if (isAllowedUrl(url, allowedHost)) {
      unique.add(url.toString());
    }
  }

  if (unique.size === 0) {
    throw new Error(`No valid URLs found in file: ${absolutePath}`);
  }

  return [...unique];
}

async function crawl(target: CrawlTarget): Promise<{ scanned: number; changed: number }> {
  const queue: string[] = [...target.startUrls];
  const visited = new Set<string>();
  let scanned = 0;
  let changed = 0;

  while (queue.length > 0 && visited.size < target.maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    try {
      const html = await fetchPage(url);
      const page = parsePage(url, html, target.allowedHost);
      scanned += 1;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const upsert = await upsertDocument(client, page);

        if (upsert.changed) {
          const chunks = chunkText(page.content);
          const chunkIds = await insertChunks(client, upsert.documentId, page.title, chunks);
          await insertImages(client, upsert.documentId, page.url, page.images, chunkIds);
          changed += 1;
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      for (const link of page.links) {
        if (!visited.has(link)) queue.push(link);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`crawl error for ${url}`, error);
    }
  }

  return { scanned, changed };
}

async function runWeeklyCrawl(target: CrawlTarget): Promise<void> {
  const started = await pool.query<{ id: string }>(
    "INSERT INTO crawl_runs (status) VALUES ('running') RETURNING id::text",
  );
  const runId = started.rows[0].id;

  try {
    const result = await crawl(target);
    await pool.query(
      "UPDATE crawl_runs SET status='succeeded', finished_at=NOW(), pages_scanned=$2, pages_changed=$3 WHERE id=$1::uuid",
      [runId, result.scanned, result.changed],
    );

    // eslint-disable-next-line no-console
    console.log("crawl completed", result);
  } catch (error) {
    await pool.query(
      "UPDATE crawl_runs SET status='failed', finished_at=NOW(), error_message=$2 WHERE id=$1::uuid",
      [runId, String(error)],
    );
    throw error;
  } finally {
    await pool.end();
  }
}

const startUrl = process.env.CRAWL_START_URL;
const allowedHost = process.env.CRAWL_ALLOWED_HOST;
const args = parseCliArgs(process.argv);

if (!allowedHost || !process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
  throw new Error("CRAWL_ALLOWED_HOST, OPENAI_API_KEY, DATABASE_URL are required");
}
const crawlAllowedHost = allowedHost;

const maxPages = Number(process.env.CRAWL_MAX_PAGES || 200);

async function buildStartUrls(): Promise<string[]> {
  if (args.urlFile) {
    return loadSeedUrls(args.urlFile, crawlAllowedHost);
  }

  if (!startUrl) {
    throw new Error("CRAWL_START_URL is required when --url-file is not provided");
  }

  const normalized = normalizeSeedUrl(startUrl);
  if (!normalized) {
    throw new Error(`Invalid CRAWL_START_URL: ${startUrl}`);
  }

  const parsed = new URL(normalized);
  if (!isAllowedUrl(parsed, crawlAllowedHost)) {
    throw new Error(`CRAWL_START_URL host (${parsed.hostname}) must match CRAWL_ALLOWED_HOST (${crawlAllowedHost})`);
  }

  return [normalized];
}

const startUrls = await buildStartUrls();

void runWeeklyCrawl({
  startUrls,
  allowedHost: crawlAllowedHost,
  maxPages,
});
