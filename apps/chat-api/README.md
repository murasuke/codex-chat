# chat-api

Webアプリ埋め込みチャットウィジェットからの問い合わせを受け付け、RAG（検索拡張生成）で回答を返すAPIです。

## 役割

- `POST /api/chat` で質問を受信
- OpenAI Embeddingsで質問ベクトルを生成
- PostgreSQL（pgvector）から関連チャンクを検索
- 検索結果を根拠にOpenAIで回答文を生成
- 参照URL（1〜3件）と参考画像（0〜3件）を返却
- 会話ログを `chat_sessions` / `chat_messages` に保存

## 主な構成

- `src/server.ts`:
  - APIエンドポイント
  - バリデーション
  - CORS設定
- `src/retriever.ts`:
  - ベクトル検索と画像候補取得
- `src/llm.ts`:
  - OpenAI Embeddings / 回答生成
- `src/db.ts`:
  - PostgreSQLクエリ
- `src/config.ts`:
  - `.env` 読み込みと設定管理

## 前提

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `OPENAI_CHAT_MODEL`（任意）
- `OPENAI_EMBEDDING_MODEL`（任意）
- `CORS_ORIGIN`（任意）
