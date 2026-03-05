import React, { useState } from "react";
import { createRoot } from "react-dom/client";

type Citation = { title: string; url: string };
type RefImage = { url: string; alt?: string; sourceUrl: string };

type ChatApiResponse = {
  answer: string;
  citations: Citation[];
  images: RefImage[];
};

type WidgetConfig = {
  apiBaseUrl?: string;
};

declare global {
  interface Window {
    HELP_CHAT_CONFIG?: WidgetConfig;
  }
}

function getApiBaseUrl(): string {
  return window.HELP_CHAT_CONFIG?.apiBaseUrl || "";
}

function Widget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<ChatApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    const trimmed = message.trim();
    if (!trimmed) return;

    const sessionId = sessionStorage.getItem("help_chat_session_id") || crypto.randomUUID();
    sessionStorage.setItem("help_chat_session_id", sessionId);

    setLoading(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: trimmed,
          pageUrl: window.location.href,
        }),
      });

      if (!r.ok) return;
      const data = (await r.json()) as ChatApiResponse;
      setResponse(data);
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          width: 56,
          height: 56,
          borderRadius: "50%",
          zIndex: 9999,
          border: "none",
          background: "#0f172a",
          color: "#fff",
          cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
        aria-label="help chat"
      >
        ?
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 84,
            width: 360,
            maxHeight: 560,
            overflow: "auto",
            background: "#fff",
            border: "1px solid #ccc",
            padding: 12,
            zIndex: 9999,
          }}
        >
          <h4 style={{ marginTop: 0 }}>ヘルプチャット</h4>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="質問を入力"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <button onClick={ask} disabled={loading}>
            {loading ? "送信中..." : "送信"}
          </button>

          {response && (
            <div style={{ marginTop: 10 }}>
              <p>{response.answer}</p>
              <p>参照URL:</p>
              <ul>
                {response.citations.map((c) => (
                  <li key={c.url}>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.title}
                    </a>
                  </li>
                ))}
              </ul>
              {response.images.map((img) => (
                <a key={img.url} href={img.sourceUrl} target="_blank" rel="noreferrer">
                  <img
                    src={img.url}
                    alt={img.alt || "reference"}
                    style={{ width: "100%", marginBottom: 8 }}
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function mountHelpWidget(target: HTMLElement): void {
  createRoot(target).render(<Widget />);
}
