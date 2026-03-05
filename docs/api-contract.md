# API Contract (MVP)

## POST /api/chat

Request:

```json
{
  "sessionId": "uuid",
  "message": "配信リストの作り方は？",
  "pageUrl": "https://app.internal.example/campaign/new"
}
```

Response:

```json
{
  "answer": "...",
  "citations": [
    { "title": "配信リストの作成", "url": "https://docs.example.com/list/create" }
  ],
  "images": [
    {
      "url": "https://docs.example.com/assets/list-create.png",
      "alt": "配信リスト作成画面",
      "sourceUrl": "https://docs.example.com/list/create"
    }
  ]
}
```

Rules:
- `citations` は 1..3 件
- `images` は 0..3 件

## POST /api/crawl/run

- 手動クロール起動

## GET /api/crawl/status

- 最終実行状態と進捗

## POST /api/reindex

- 指定URLまたは差分対象の再インデックス
