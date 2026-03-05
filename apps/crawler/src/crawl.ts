import dotenv from "dotenv";
import { createHash } from "crypto";
import { load } from "cheerio";
import OpenAI from "openai";
import { Pool, PoolClient } from "pg";

dotenv.config();

type CrawlTarget = {
  startUrl: string;
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

async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const response = await openai.embeddings.create({
    model: embeddingModel,
    input: inputs,
  });

  return response.data.map((v) => v.embedding);
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
      [documentId, i, title, null, chunks[i], toVectorLiteral(embeddings[i]), null],
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

async function crawl(target: CrawlTarget): Promise<{ scanned: number; changed: number }> {
  const queue: string[] = [target.startUrl];
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

if (!startUrl || !allowedHost || !process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
  throw new Error("CRAWL_START_URL, CRAWL_ALLOWED_HOST, OPENAI_API_KEY, DATABASE_URL are required");
}

void runWeeklyCrawl({
  startUrl,
  allowedHost,
  maxPages: Number(process.env.CRAWL_MAX_PAGES || 200),
});
