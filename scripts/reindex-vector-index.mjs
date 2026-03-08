import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const indexName = process.env.REINDEX_TARGET || "idx_chunks_embedding_cosine";
const maintenanceWorkMem = process.env.REINDEX_MAINTENANCE_WORK_MEM || "256MB";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!/^[a-zA-Z0-9_]+$/.test(indexName)) {
  throw new Error(`Invalid REINDEX_TARGET: ${indexName}`);
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  console.log(`[reindex] start: ${indexName}`);
  await pool.query(`SET maintenance_work_mem = '${maintenanceWorkMem}'`);
  await pool.query(`REINDEX INDEX ${indexName}`);
  console.log(`[reindex] done: ${indexName}`);
} finally {
  await pool.end();
}
