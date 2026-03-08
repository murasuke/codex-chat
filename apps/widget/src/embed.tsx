import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

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

const markdownSchema = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema.attributes || {}),
    a: [...(defaultSchema.attributes?.a || []), ["target"], ["rel"]],
    img: [...(defaultSchema.attributes?.img || []), ["loading"]],
  },
  protocols: {
    ...(defaultSchema.protocols || {}),
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

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
            height: 560,
            background: "#fff",
            border: "1px solid #ccc",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "12px 12px 8px 12px", borderBottom: "1px solid #e5e7eb" }}>
            <h4 style={{ margin: 0 }}>ヘルプチャット</h4>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {response ? (
              <div>
                <div style={{ lineHeight: 1.6, fontSize: 14 }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[[rehypeSanitize, markdownSchema]]}
                    components={{
                      a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
                      img: ({ ...props }) => (
                        <img
                          {...props}
                          alt={props.alt || "inline image"}
                          loading="lazy"
                          style={{ maxWidth: "100%", height: "auto", borderRadius: 6 }}
                        />
                      ),
                      h1: ({ ...props }) => <h1 style={{ fontSize: 20, margin: "8px 0" }} {...props} />,
                      h2: ({ ...props }) => <h2 style={{ fontSize: 18, margin: "8px 0" }} {...props} />,
                      h3: ({ ...props }) => <h3 style={{ fontSize: 16, margin: "8px 0" }} {...props} />,
                      ul: ({ ...props }) => <ul style={{ paddingLeft: 20, margin: "8px 0" }} {...props} />,
                      ol: ({ ...props }) => <ol style={{ paddingLeft: 20, margin: "8px 0" }} {...props} />,
                      p: ({ ...props }) => <p style={{ margin: "8px 0" }} {...props} />,
                      code: ({ ...props }) => (
                        <code
                          style={{
                            background: "#f1f5f9",
                            padding: "2px 4px",
                            borderRadius: 4,
                            fontSize: 13,
                          }}
                          {...props}
                        />
                      ),
                    }}
                  >
                    {response.answer}
                  </ReactMarkdown>
                </div>
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
            ) : (
              <p style={{ color: "#64748b" }}>質問を入力するとここに回答が表示されます。</p>
            )}
          </div>

          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              padding: 12,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void ask();
              }}
              placeholder="質問を入力"
              style={{ flex: 1 }}
            />
            <button onClick={ask} disabled={loading}>
              {loading ? "送信中..." : "送信"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function mountHelpWidget(target: HTMLElement): void {
  createRoot(target).render(<Widget />);
}
