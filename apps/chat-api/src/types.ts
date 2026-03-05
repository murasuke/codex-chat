export type Citation = {
  title: string;
  url: string;
};

export type ReferenceImage = {
  url: string;
  alt?: string;
  sourceUrl: string;
};

export type ChatRequest = {
  sessionId: string;
  message: string;
  pageUrl?: string;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[]; // 1..3
  images: ReferenceImage[]; // 0..3
};

export type RetrievedChunk = {
  chunkId: string;
  text: string;
  score: number;
  url: string;
  title: string;
};
