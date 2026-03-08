import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import { ensureSession, saveMessage } from "./db.js";
import { generateAnswer } from "./llm.js";
import { retrieve } from "./retriever.js";
import { ChatResponse, Citation } from "./types.js";

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  pageUrl: z.string().url().optional(),
});

const app = express();
app.use(
  cors({
    origin: config.corsOrigins,
  }),
);
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { sessionId, message, pageUrl } = parsed.data;

  try {
    await ensureSession(sessionId);
    await saveMessage(sessionId, "user", message);

    const retrieval = await retrieve(message);
    const answer = await generateAnswer(message, retrieval.chunks);

    const citations: Citation[] = retrieval.chunks
      .map((chunk) => ({ title: chunk.title, url: chunk.url }))
      .filter((value, index, array) => array.findIndex((x) => x.url === value.url) === index)
      .slice(0, 3);

    if (citations.length === 0 && retrieval.fallbackCitation) {
      citations.push(retrieval.fallbackCitation);
    }

    if (citations.length === 0 && pageUrl) {
      citations.push({ title: "関連ページ", url: pageUrl });
    }

    if (citations.length === 0) {
      citations.push({ title: "マニュアルトップ", url: "https://docs.example.com/" });
    }

    const response: ChatResponse = {
      answer,
      citations,
      images: retrieval.images.slice(0, 3),
    };

    await saveMessage(sessionId, "assistant", response.answer, response.citations, response.images);
    return res.json(response);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return res.status(500).json({ error: "internal server error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`chat-api listening on :${config.port}`);
});
