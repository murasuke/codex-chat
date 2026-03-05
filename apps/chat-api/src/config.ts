import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 8080),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  pgConnectionString: process.env.DATABASE_URL || "",
};

if (!config.openAiApiKey) {
  throw new Error("OPENAI_API_KEY is required");
}

if (!config.pgConnectionString) {
  throw new Error("DATABASE_URL is required");
}
