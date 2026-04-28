# Shiori App

React + Vite + Supabase の読書ハイライト保存アプリです。

## Files

- `index.html` — Viteの入口HTML
- `src/main.jsx` — React起動ファイル
- `src/App.jsx` — アプリ本体
- `package.json` — 依存関係とビルド設定
- `.env.example` — Supabase環境変数の例
- `supabase_schema.sql` — Supabase SQL Editorで実行するスキーマ

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` に以下を設定してください。

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## Vercel settings

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Vercelの Environment Variables に以下を設定してください。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

設定後、Redeployしてください。
