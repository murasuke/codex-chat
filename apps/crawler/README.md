# crawler

マニュアルサイトを巡回してデータを収集し、差分更新・チャンク化・埋め込み生成を行って検索用データを更新するバッチです。

## 役割

- 公開Webページをクロール（同一ホスト制限）
- 本文・タイトル・画像情報を抽出
- `content_hash` で差分判定
- 変更ページのみ再インデックス
- チャンク生成＋Embedding生成＋DB保存
- 実行履歴を `crawl_runs` に記録

## 主な構成

- `src/crawl.ts`:
  - 巡回（BFS）
  - HTML解析（cheerio）
  - 差分更新（documents/chunks/images）
  - レート制限対策
    - トークン基準の待機
    - バッチ分割
    - 429リトライ（バックオフ）

## 起動方法

- 単一開始URL:
  - `.env` の `CRAWL_START_URL` を利用
- 複数開始URL:
  - `--url-file` で改行区切りURLファイルを指定
  - 例: `npm run dev -w crawler -- --url-file seeds/myasp-urls.txt`

## 前提

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `CRAWL_ALLOWED_HOST`
- `CRAWL_MAX_PAGES`（任意）
- `EMBEDDING_TPM_LIMIT` などのレート制限関連設定（任意）
