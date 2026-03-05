# Help Chatbot Platform (PostgreSQL)

メールマーケティングツールへ組み込む前提の、汎用ヘルプチャット基盤のMVP構成です。

## Monorepo Layout

- `apps/chat-api`: Node.jsチャットAPI (OpenAI SDK + RAG)
- `apps/crawler`: マニュアルサイト向けクローラー/差分更新
- `apps/widget`: 右下フローティング表示のReact埋め込みウィジェット
- `db/schema.sql`: PostgreSQL DDL
- `docs/architecture.md`: 構成・処理フロー
- `docs/api-contract.md`: API契約

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (`pgvector` extension)
- OpenAI API key

## Setup

1. 依存インストール

```bash
npm install
```

2. スキーマ適用

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

3. 環境変数

### `apps/chat-api`

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL` (default: `gpt-4.1-mini`)
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `DATABASE_URL`
- `PORT` (default: `8080`)

### `apps/crawler`

- `OPENAI_API_KEY`
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `DATABASE_URL`
- `CRAWL_START_URL`
- `CRAWL_ALLOWED_HOST`
- `CRAWL_MAX_PAGES` (default: `200`)

### `apps/widget`

- ブラウザで `window.HELP_CHAT_CONFIG = { apiBaseUrl: "https://chat-api.example.com" }` を設定可能

## Commands

```bash
npm run build
npm run dev -w chat-api
npm run dev -w crawler
npm run build -w widget
```

## Widget Embed

`apps/widget` をビルドして生成される `help-chat-widget.iife.js` を読み込みます。

```html
<script>
  window.HELP_CHAT_CONFIG = { apiBaseUrl: "https://chat-api.example.com" };
</script>
<script src="/assets/help-chat-widget.iife.js"></script>
```

## MVP Scope

- 公開Webサイト（単一ドメイン）を週次クロール
- 差分ページのみ再取得/再インデックス
- 回答時に参照URLを1〜3件返却
- 可能な場合は参考画像を0〜3件インライン表示（元サイトURL）
