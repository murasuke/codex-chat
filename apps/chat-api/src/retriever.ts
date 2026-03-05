import { fallbackRecentCitation, searchChunks, searchImagesByChunkIds } from "./db.js";
import { embed, toVectorLiteral } from "./llm.js";
import { Citation, ReferenceImage, RetrievedChunk } from "./types.js";

export type RetrievalResult = {
  chunks: RetrievedChunk[];
  images: ReferenceImage[];
  fallbackCitation?: Citation;
};

export async function retrieve(question: string): Promise<RetrievalResult> {
  const embedding = await embed(question);
  const vectorLiteral = toVectorLiteral(embedding);

  const chunkRows = await searchChunks(vectorLiteral, 6);
  const chunks: RetrievedChunk[] = chunkRows.map((row) => ({
    chunkId: row.chunk_id,
    text: row.chunk_text,
    score: Number(row.score),
    url: row.url,
    title: row.title,
  }));

  const imageRows = await searchImagesByChunkIds(
    chunks.map((chunk) => chunk.chunkId),
    3,
  );

  const images: ReferenceImage[] = imageRows.map((image) => ({
    url: image.image_url,
    alt: image.alt_text || undefined,
    sourceUrl: image.source_url,
  }));

  const fallbackCitation = chunks.length === 0 ? await fallbackRecentCitation() : undefined;

  return { chunks, images, fallbackCitation: fallbackCitation || undefined };
}
