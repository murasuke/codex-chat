# Help Chatbot Platform (PostgreSQL)

Webアプリへ組み込む前提の、汎用ヘルプチャット基盤のMVP構成です。

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

2. `.env` 作成

```bash
cp .env.example .env
```

3. スキーマ適用

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

4. 環境変数

### `apps/chat-api`

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL` (default: `gpt-4.1-mini`)
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `DATABASE_URL`
- `PORT` (default: `8080`)

`apps/chat-api` は以下の順で `.env` を読み込みます。
- 実行時カレントディレクトリの `.env`
- リポジトリルートの `.env`

### `apps/crawler`

- `OPENAI_API_KEY`
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `DATABASE_URL`
- `CRAWL_START_URL` (`--url-file` 未指定時のみ必須)
- `CRAWL_ALLOWED_HOST`
- `CRAWL_MAX_PAGES` (default: `200`)
- `EMBEDDING_TPM_LIMIT` (default: `800000`)
- `EMBEDDING_MAX_BATCH_TOKENS` (default: `20000`)
- `EMBEDDING_MAX_RETRIES` (default: `6`)
- `EMBEDDING_RETRY_BASE_MS` (default: `300`)

`apps/crawler` も同様に `.env` を読み込みます。

### Crawler URL seed file (`--url-file`)

`CRAWL_START_URL` の代わりに、改行区切りのURLファイルを指定してクロール開始URLを複数渡せます。

URLファイル例 (`seeds/myasp-urls.txt`):

```txt
https://docs.myasp.jp/?p=32744
https://docs.myasp.jp/?p=38080
# コメント行は無視されます
https://docs.myasp.jp/?p=35348
```

実行例:

```bash
npm run dev -w crawler -- --url-file seeds/myasp-urls.txt
```

仕様:
- `--url-file` 指定時は `CRAWL_START_URL` は不要
- 空行と `#` で始まる行は無視
- `CRAWL_ALLOWED_HOST` と一致するURLのみ有効

### `apps/widget`

- ブラウザで `window.HELP_CHAT_CONFIG = { apiBaseUrl: "https://chat-api.example.com" }` を設定可能

## Commands

```bash
npm run build
npm run dev -w chat-api
npm run dev -w crawler
npm run build -w widget
npm run preview:widget
npm run db:reindex:vector
```

## Widget Embed

`apps/widget` をビルドして生成される `help-chat-widget.iife.js` を読み込みます。

```html
<script>
  window.HELP_CHAT_CONFIG = { apiBaseUrl: "https://chat-api.example.com" };
</script>
<script src="/assets/help-chat-widget.iife.js"></script>
```

## Widget Smoke Test (static HTML)

`http-server` で静的配信して簡易確認できます。

```bash
npm run preview:widget
```

起動後に [http://localhost:8088/preview/widget-smoke-test.html](http://localhost:8088/preview/widget-smoke-test.html) を開いてください。

## Vector Index Reindex (manual recovery)

ベクトル検索の結果が極端に減る/0件になる場合、手動で `ivfflat` インデックスを再構築できます。

```bash
npm run db:reindex:vector
```

オプション:
- `REINDEX_TARGET` (default: `idx_chunks_embedding_cosine`)
- `REINDEX_MAINTENANCE_WORK_MEM` (default: `256MB`)

## MVP Scope

- 公開Webサイト（単一ドメイン）を週次クロール
- 差分ページのみ再取得/再インデックス
- 回答時に参照URLを1〜3件返却
- 可能な場合は参考画像を0〜3件インライン表示（元サイトURL）
