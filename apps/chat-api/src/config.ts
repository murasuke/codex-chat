import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(currentDir, "../../../.env"),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

export const config = {
  port: Number(process.env.PORT || 8080),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  pgConnectionString: process.env.DATABASE_URL || "",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:8088")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

if (!config.openAiApiKey) {
  throw new Error("OPENAI_API_KEY is required");
}

if (!config.pgConnectionString) {
  throw new Error("DATABASE_URL is required");
}
