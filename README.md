# CloverBINGO

## ローカル起動（MVP）

前提: Node.js / npm が入っていること。

1) 依存を入れる（リポジトリ直下）

    npm install

2) ローカルDB（D1）へマイグレーション適用（初回/スキーマ更新時）

    npm -w apps/worker run migrate:local

3) Worker + Web を同時起動（リポジトリ直下）

    npm run dev

4) ブラウザで開く

- Web: `http://localhost:5173`（埋まっている場合は Vite が別ポートを使います）
- Worker: `http://127.0.0.1:8787`

トップ画面の「Dev: セッション作成」から、参加者/Admin/Mod/会場表示（十の位・一の位）のURLが出ます。

※ Admin/Mod の招待リンクは `/i/:token` です（GETでは副作用を起こしません）。画面を開いたら「入室」を押して cookie を付与してから操作してください（入室後は token を URL から外しても動きます）。

### Admin 操作（キーボード）

- `P`: 次番号を prepare（Admin のみ見える）
- `W` / `A` / `S` / `D`: GO（十の位・一の位を同時に回転開始。各桁はランダム時間で自動停止→両方止まったら確定→参加者へ反映）
- GO は prepare 済み（`P`）のみ可能です。
- 音（SE）を出すには Admin 画面で「音を有効化」を押してください（ブラウザの自動再生制限対策）。

## 仕様・計画

- 要件: `AGENTS.md`
- 実行計画（生きたドキュメント）: `EXECPLAN.md`（` .agent/PLANS.md ` のルールに従って更新）

## テスト

    npm test

## WS 負荷確認（擬似接続）

事前に Worker を起動しておきます（別ターミナルで `npm -w apps/worker run dev`）。

    npm -w apps/worker run ws:load -- --code <SESSION_CODE> --count 200 --origin http://127.0.0.1:8787

## ローカル動作確認（手動スモーク）

1) `npm run dev` を起動
2) `http://localhost:5173` を開いて「Dev: セッション作成」
3) 参加者URLをスマホ/別タブで複数開いて、表示名を入れて参加
4) Admin招待リンク（`/i/:token`）を開いて「入室」を押し、`P` → `W/A/S/D`（どれか）を押す（必要なら `P` → `W/A/S/D` を繰り返す）
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
