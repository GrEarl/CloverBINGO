# CloverBINGO

## ローカル起動（MVP）

前提: Node.js / npm が入っていること。

1) 依存を入れる（リポジトリ直下）

    npm install

2) Worker + Web を同時起動（リポジトリ直下）

    npm run dev

3) ブラウザで開く

- Web: `http://localhost:5173`（埋まっている場合は Vite が別ポートを使います）
- Worker: `http://127.0.0.1:8787`

トップ画面の「Dev: セッション作成」から、参加者/Admin/Mod/会場表示（十の位・一の位）のURLが出ます。

※ Admin/Mod の招待リンクは URL に `?token=...` が含まれますが、GETでは副作用を起こしません。画面を開いたら「入室」を押して cookie を付与してから操作してください（入室後は token を URL から外しても動きます）。

### Admin 操作（キーボード）

- `P`: 次番号を prepare（Admin のみ見える）
- `W` / `A`: 十の位リール start / stop
- `S` / `D`: 一の位リール start / stop（両方 stop で番号確定→参加者へ反映）
- `P` を押し忘れても、`W` / `S`（start）を押すと自動で prepare されます（運用事故低減）。

## 仕様・計画

- 要件: `AGENTS.md`
- 実行計画（生きたドキュメント）: `EXECPLAN.md`（` .agent/PLANS.md ` のルールに従って更新）

## テスト

    npm test

## ローカル動作確認（手動スモーク）

1) `npm run dev` を起動
2) `http://localhost:5173` を開いて「Dev: セッション作成」
3) 参加者URLをスマホ/別タブで複数開いて、表示名を入れて参加
4) Admin画面（招待リンク）を開いて「入室」を押し、`P` → `W` → `A` → `S` → `D` を押す
5) 会場表示（ten/one）で数字が回転→停止し、参加者のカードと reach/bingo 指標が更新される

## デプロイ

Cloudflare へのデプロイは Wrangler を使います。事前に Cloudflare アカウントを用意してログインしてください。

    npx wrangler login

### 方式A: Worker 1本で Web も配信（おすすめ・同一オリジン）

この方式は Web が同一オリジンになるので、CORS 設定が不要です。

1) Web をビルド

    npm -w apps/web run build

2) Worker を `apps/web/dist` を静的アセットとして一緒にデプロイ

    npm -w apps/worker run deploy -- --assets ../web/dist

### 方式B: Web を Cloudflare Pages、API を Worker（分離）

1) Web をビルド

    npm -w apps/web run build

2) Pages プロジェクト作成（初回のみ）

    npx wrangler pages project create <project-name>

3) `apps/web/dist` を Pages にデプロイ

    npx wrangler pages deploy apps/web/dist --project-name <project-name>

この方式の場合、Web から Worker への接続（`/api` や WebSocket）の向き先をどうするかを決める必要があります。
現状のMVPは「同一オリジン前提（方式Aが簡単）」です。
