# widget

既存Webアプリ（非SPA含む）に `<script>` で埋め込めるReact製ヘルプチャットウィジェットです。

## 役割

- 画面右下にフローティングボタンを表示
- クリックでチャットパネルを開閉
- 質問を `chat-api` に送信
- 回答本文・参照URL・参考画像を表示
- `sessionStorage` で会話セッションIDを保持

## 主な構成

- `src/embed.tsx`:
  - ウィジェット本体UI
  - API呼び出し処理
- `src/auto-mount.tsx`:
  - ルート要素を自動生成してマウント
- `vite.config.ts`:
  - IIFE形式でビルド（埋め込み向け）

## 利用方法

- ビルド成果物:
  - `dist/help-chat-widget.iife.js`
- 埋め込み前に `window.HELP_CHAT_CONFIG.apiBaseUrl` でAPI URLを指定可能

## 想定用途

- PHP等のサーバーサイドレンダリングサイト
- ページ遷移ごとに再読み込みされる環境
