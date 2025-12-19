# CloverBINGO HowToUse

このドキュメントは、CloverBINGO のデプロイ・セッション作成・当日運用をまとめた手順書です。

## 1. ローカル起動（開発/動作確認）

1) 依存をインストール

    npm install

2) ローカル D1 を初期化

    npm -w apps/worker run migrate:local

3) Worker + Web を起動

    npm run dev

4) ブラウザで `http://localhost:5173/` を開き、「Dev: セッション作成」を押す

- 参加者/会場表示/Admin/Mod/Observer のリンクが表示されます
- Dev セッション作成はローカル限定です（`/api/dev/create-session`）

## 2. デプロイ（Cloudflare）

### 前提

- `wrangler` が使えること（ログイン済み）
- Cloudflare アカウントに D1 データベースを作成済みであること

### 手順

1) `wrangler.local.toml` を用意

    cp apps/worker/wrangler.local.toml.example apps/worker/wrangler.local.toml

2) `apps/worker/wrangler.local.toml` に `account_id` と `database_id` を設定

- `database_id` は `wrangler d1 create cloverbingo` で取得できます

3) リモート D1 へマイグレーションを適用

    npx wrangler -c apps/worker/wrangler.local.toml d1 migrations apply DB --remote

4) Web をビルド

    npm -w apps/web run build

5) Worker をデプロイ（Web 静的アセットも同梱）

    npm -w apps/worker run deploy

6) デプロイ先で疎通確認

- `https://<your-domain>/api/healthz` が `{ ok: true }` を返す

## 3. セッション作成

### 3.1 ローカル（Home から作成）

- `http://localhost:5173/` で「Dev: セッション作成」
- 参加者/会場表示/Admin/Mod のリンクが生成されます

### 3.2 スクリプトで作成（ローカル/本番）

ローカル（D1 local）:

    npm -w apps/worker run create-session

リモート（D1 remote）:

    npm -w apps/worker run create-session -- --remote

必要に応じて出力の URL を本番ドメインに合わせる場合:

    CLOVERBINGO_ORIGIN=https://<your-domain> npm -w apps/worker run create-session -- --remote

`wrangler.local.toml` の場所を明示したい場合:

    CLOVERBINGO_WRANGLER_CONFIG=wrangler.local.toml npm -w apps/worker run create-session -- --remote

出力には以下が含まれます:

- 参加者 URL
- 会場表示（十の位 / 一の位）
- Admin 招待 URL（`/i/:token`）
- Mod 招待 URL（`/i/:token`）
- Observer 招待 URL（`/i/:token`）

## 4. 当日運用マニュアル

### 4.1 画面構成

- 参加者: `/s/:code`
- 会場表示（左・十の位）: `/s/:code/display/ten`
- 会場表示（右・一の位）: `/s/:code/display/one`
- Admin: `/s/:code/admin`
- Mod: `/s/:code/mod`
- Observer: `/s/:code/observer`
- Debug: `/s/:code/debug`

### 4.2 会場表示（ten / one）

- それぞれのモニターで全画面表示してください
- 画面右上の `FULLSCREEN` ボタンを使用
- 演出を落としたい場合:
  - `?safe=1`（安全モード）
  - `?fx=0`（演出ほぼOFF）

例:

- `/s/ABC123/display/ten?safe=1`
- `/s/ABC123/display/one?fx=0`

### 4.3 Admin（進行・音響）

1) Admin 招待リンク（`/i/:token`）を開き「入室」
2) 音を出すために「音を有効化」をクリック（ブラウザ制約対策）
3) 抽選操作

- `P`: 次番号 prepare（Admin のみ見える）
- `W / A / S / D`: GO（十の位・一の位を同時回転→各桁自動停止→確定）
- **GO は prepare 済みのみ可能**（未prepareの場合は案内が出ます）

4) セッション終了

- 「セッション終了」を押すと以後の操作は無効になります

### 4.4 Mod（進行補助）

- 招待リンクで入室
- 参加者一覧を検索/ソートして状況把握
- スポットライトは「下書き → 送信」で反映（最大6人）
- 不正/重複の参加者は「無効化」で判定/統計から除外（復帰も可能）

### 4.5 参加者

- `/s/:code` を開き表示名を入力
- 同一端末で再参加するとカードは引き継がれます（表示名だけ更新）
- 参加者数が目安 200 人を超えると警告を表示します（参加は許可されます）

## 5. トラブルシュート

- 音が出ない: Admin 画面で「音を有効化」を必ず押す
- 画面が固まる/点滅が辛い: `?safe=1` または `?fx=0` を付ける
- 再接続が続く: 回線が不安定な可能性。数秒で自動復帰します
