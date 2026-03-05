import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.pgConnectionString });

export type ChunkRow = {
  chunk_id: string;
  chunk_text: string;
  score: number;
  url: string;
  title: string;
};

export async function searchChunks(vectorLiteral: string, limit: number): Promise<ChunkRow[]> {
  const sql = `
    SELECT
      c.id::text AS chunk_id,
      c.chunk_text,
      1 - (c.embedding <=> $1::vector) AS score,
      d.url,
      COALESCE(d.title, d.url) AS title
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2
  `;
  const result = await pool.query<ChunkRow>(sql, [vectorLiteral, limit]);
  return result.rows;
}

export async function searchImagesByChunkIds(chunkIds: string[], limit: number): Promise<Array<{ image_url: string; alt_text: string | null; source_url: string }>> {
  if (chunkIds.length === 0) return [];
  const sql = `
    SELECT image_url, alt_text, source_url
    FROM images
    WHERE chunk_id = ANY($1::uuid[])
    LIMIT $2
  `;
  const result = await pool.query(sql, [chunkIds, limit]);
  return result.rows;
}

export async function fallbackRecentCitation(): Promise<{ title: string; url: string } | null> {
  const sql = `
    SELECT COALESCE(title, url) AS title, url
    FROM documents
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const result = await pool.query(sql);
  return result.rows[0] || null;
}

export async function ensureSession(sessionId: string): Promise<void> {
  const sql = `
    INSERT INTO chat_sessions (id, last_seen_at)
    VALUES ($1::uuid, NOW())
    ON CONFLICT (id) DO UPDATE SET last_seen_at = NOW()
  `;
  await pool.query(sql, [sessionId]);
}

export async function saveMessage(sessionId: string, role: "user" | "assistant", message: string, citations?: unknown, images?: unknown): Promise<void> {
  const sql = `
    INSERT INTO chat_messages (session_id, role, message, citations, images)
    VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb)
  `;
  await pool.query(sql, [sessionId, role, message, citations ? JSON.stringify(citations) : null, images ? JSON.stringify(images) : null]);
}
