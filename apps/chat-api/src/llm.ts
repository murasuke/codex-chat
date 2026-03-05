import OpenAI from "openai";
import { config } from "./config.js";
import { RetrievedChunk } from "./types.js";

const client = new OpenAI({ apiKey: config.openAiApiKey });

export async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: config.embeddingModel,
    input: text,
  });
  return response.data[0]?.embedding || [];
}

export async function generateAnswer(question: string, chunks: RetrievedChunk[]): Promise<string> {
  const context = chunks
    .map((chunk, index) => `#${index + 1} (${chunk.title} - ${chunk.url})\n${chunk.text}`)
    .join("\n\n");

  const prompt = [
    "あなたはWebアプリ内ヘルプチャットです。",
    "提供されたマニュアル抜粋のみを根拠に回答してください。",
    "不明な場合は不明と明示し、推測で断定しないでください。",
    "日本語で簡潔に回答してください。",
    "",
    `質問: ${question}`,
    "",
    "参考情報:",
    context || "(該当情報なし)",
  ].join("\n");

  const response = await client.responses.create({
    model: config.openAiModel,
    input: prompt,
  });

  return response.output_text || "回答を生成できませんでした。";
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
