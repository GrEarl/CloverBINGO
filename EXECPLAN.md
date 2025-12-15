# CloverBINGO MVP（Cloudflare Workers + Durable Objects + Web UI）

この ExecPlan は生きたドキュメントです。作業が進むたびに `Progress` / `Surprises & Discoveries` / `Decision Log` / `Outcomes & Retrospective` を必ず更新します。

本リポジトリには ExecPlan の形式要件があり、` .agent/PLANS.md ` に従ってこのファイルを維持します（形式、自己完結、進捗更新の厳守）。

## Purpose / Big Picture

会場イベント向けの電子ビンゴを、まず「確実に動く」MVPとして実装します。参加者はスマホで参加URLを開いて表示名を入力し、ビンゴカードを受け取り、抽選結果がリアルタイムに反映されます。運営は Admin 画面から抽選を制御し（`P` で prepare、`W/A/S/D` で回転・停止→確定）、会場モニター2枚（十の位 / 一の位）がスロット風リール表示で数字を大きく表示します。Mod 画面は参加者の進捗俯瞰とスポットライト（最大6人）を管理し、会場表示に反映します。

MVPの合格ラインは「参加登録→カード配布→抽選反映→リーチ/ビンゴ判定」「Adminキー操作で会場表示が動く」「復帰・再接続で状態同期が成立する」を満たすことです。

## Progress

- [x] (2025-12-14 19:09Z) `AGENTS.md` と ` .agent/PLANS.md ` を通読し、現状リポジトリ（コード未整備・音源のみ）を確認した。
- [x] (2025-12-14 19:21Z) npm workspaces で `apps/worker` / `apps/web` / `packages/core` を作成し、`npm install` と `npm test` で雛形が動くことを確認した。
- [x] (2025-12-14 19:36Z) Session Durable Object と WebSocket（role別snapshot）を実装し、最小REST API（init/join/prepare/reel/spotlight）で状態更新→broadcast が動くことを手動検証した。
- [x] (2025-12-14 19:43Z) Web UI（Home/参加者/会場表示 ten&one/Admin/Mod）を最小動線で実装し、`vite build` が通る状態にした。
- [x] (2025-12-14 19:21Z) カード生成・判定ロジックを `packages/core` に実装し、単体テストを追加した。
- [x] (2025-12-14 19:36Z) Worker から `packages/core` を参照し、サーバ側で reach/bingo 指標を計算して配信するようにした。
- [ ] Web から `packages/core` を参照し、クライアント側でも表示用の補助計算（例：マーク表示）を共通化する（必要なら）。
- [x] (2025-12-14 19:44Z) ローカル起動手順と最低限の運用メモ（キー操作）を `README.md` に追記した。
- [x] (2025-12-15 01:14Z) 会場表示が prepare 後に `—` になり得る不具合を修正し、確定前に次番号が漏れない表示にした。
- [x] (2025-12-15 01:14Z) Admin の `W/A/S/D`（reel）で pending が無い場合は `start` を契機に自動で prepare して進行できるようにした。
- [x] (2025-12-15 01:14Z) スポットライトを揮発化し、`version` 付き LWW として配信するようにした（永続ストレージに保存しない）。
- [x] (2025-12-15 01:14Z) Admin/Mod の token を WS/通常API の query から外し、招待リンク（GET）→入室（POSTで HttpOnly cookie 付与）に変更した。
- [x] (2025-12-15 01:14Z) 参加者の playerId 不整合時に再参加導線を出し、Mod の下書き初期化をセッション切替で正しくした。

## Surprises & Discoveries

- npm workspaces では `workspace:*` プロトコルが使えなかったため、内部依存はバージョン一致（例：`0.0.0`）で解決する形にした。
- `apps/worker` の `tsconfig` を strict のまま `tsc` に通すと、依存（hono）の型定義でエラーになることがあったため、`skipLibCheck` を有効化した（型チェック対象を自分のコードに寄せる）。

## Decision Log

- Decision: モノレポ構成を npm workspaces で作る（`apps/*`, `packages/*`）。
  Rationale: Worker と Web が並走し、共通ロジック（カード生成/判定）を共有しやすい。ツールの導入コストが低い。
  Date/Author: 2025-12-14 / codex
- Decision: Worker の HTTP ルーティングは Hono、リアルタイム状態は Durable Objects + WebSocket で実装する。
  Rationale: AGENTS.md の推奨構成に一致し、Session単位の状態とブロードキャストを自然に表現できる。
  Date/Author: 2025-12-14 / codex
- Decision: workspace間依存は `workspace:*` ではなく、同一 version（`0.0.0`）指定で npm の workspace 解決に任せる。
  Rationale: 現環境の npm では `workspace:` プロトコルが `EUNSUPPORTEDPROTOCOL` になったため。
  Date/Author: 2025-12-14 / codex
- Decision: Admin/Mod は token を URL（GET）で配るが、認証は「入室（POST）で HttpOnly cookie を付与」し、WS/通常API は cookie で通す。
  Rationale: Slack/Discord のリンクプレビュー等で GET が先に叩かれても副作用を起こさないため。token を WS/通常API の query に載せないことで漏えい面を減らす。
  Date/Author: 2025-12-15 / codex
- Decision: スポットライトは揮発（DOメモリ）で管理し、`version` を単調増加して LWW とする。
  Rationale: 永続化が不要で、複数Modの競合もシンプルに扱えるため。
  Date/Author: 2025-12-15 / codex

## Outcomes & Retrospective

- （未記入：MVP到達時に更新）

## Context and Orientation

現状は npm workspaces のモノレポで、Worker / Web / 共通ロジック（core）が揃っている状態です。音源（スロット系SE/BGM）は `audio_ogg/` に同梱されています。

主要なコードの場所:

- `apps/worker/src/index.ts`: Worker の HTTP ルーティング（`/api/*`）と Durable Object へのフォワード。
- `apps/worker/src/session.ts`: セッション単位の Durable Object（参加者、抽選、スポットライト、WSスナップショット配信）。
- `apps/web/src/routes/*`: 画面（Home/参加者/会場表示/Admin/Mod）。
- `apps/web/src/lib/useSessionSocket.ts`: 画面共通の WebSocket 接続（スナップショット受信、再接続）。
- `packages/core/src/bingo.ts`: 75-ballカード生成、ライン判定（reach/bingo/minMissingToLine）。

この ExecPlan で使う用語（最小定義）:

- Cloudflare Worker: HTTP リクエストを受けてレスポンスを返すサーバレス実行環境（TypeScript/JavaScript）。
- Durable Object: Worker から参照できる「1セッション=1インスタンス」に近い状態保持の単位。WebSocket 接続のハブとして使う。
- WebSocket: クライアントとサーバが常時接続して双方向にメッセージを流す仕組み。抽選結果・参加者状態の即時反映に使う。
- D1: Cloudflare の SQLite 互換DB。MVPでは後段で commit log 永続化に使う（最初は DO の永続ストレージで代替し、あとで D1 に移行してもよい）。

## Plan of Work

最初にプロジェクト雛形を作り、ローカルで「Worker + DO + Web UI」が同時に動く状態を作ります。その上で、Session Durable Object に「参加者」「抽選番号」「スポットライト」などの状態を集約し、WebSocket で全クライアントへスナップショットを配信します。

API と UI は MVP に必要な最短動線のみ実装します:

- 参加者: `/s/:code` で表示名登録→カード表示→抽選の反映とリーチ/ビンゴ表示。
- 会場表示: `/s/:code/display/ten` と `/s/:code/display/one` で 0-9 のリール表示（十の位/一の位）。抽選確定で止まる。
- Admin: `/admin/:code` で prepare と go（キーボード優先）。招待リンク（`/admin/:code?token=...`）は「入室」（POST）で cookie を付与してから操作する。prepare の結果（次番号）は Admin のみに表示。
- Mod: `/mod/:code` で参加者俯瞰、スポットライト下書き→送信（即時反映しない2段階）を行う。招待リンク（`/mod/:code?token=...`）は「入室」（POST）で cookie を付与してから操作する。スポットライトは `version` 付き LWW として扱う。

状態同期は「再接続で復帰できる」ことを最優先にし、各画面は初回接続でスナップショットを受け取り、以後は差分/イベントを適用する設計にします（最初はスナップショット頻繁送付でも可。200人規模を見据えて後で最適化）。

## Concrete Steps

1) 依存のインストール（リポジトリ直下）:

    npm install

2) ローカル起動（同上）:

    npm run dev

期待する挙動（目安）:

- Worker（wrangler dev）が起動し、Web UI がブラウザで表示できる。
- `/s/demo` を開くと参加UIが表示され、WS接続で状態が更新される。

（※コマンドや期待出力は実装に合わせてこの節を更新する）

## Validation and Acceptance

受け入れ条件（MVP）:

- 参加者: 参加ページで表示名入力→カードが表示される。抽選が進むとマークが増え、リーチ/ビンゴ判定が更新される。
- Admin: `P` で「次の当選番号」が prepare され、`W/A/S/D` 操作で会場表示（ten/one）が回転→停止→確定する。
- Mod: 参加者の並び替え（minMissingToLine asc 等）とスポットライト最大6人の編集→送信で会場表示に反映される。
- 復帰: ブラウザ更新/ネットワーク断→復帰後、状態が正しく同期される。

## Idempotence and Recovery

- ローカルでの再実行は `npm install` / `npm run dev` を繰り返しても安全にします。
- 状態が壊れた場合に備えて、Session の状態初期化（開発用）手段を用意し、手順を `README.md` に記載します。

## Artifacts and Notes

（作業が進んだら、実際に使った curl / 手動手順 / 期待UIなどを短く追記）

## Interfaces and Dependencies

このMVPで最低限揃えるインターフェース（案。実装に合わせて更新）:

- WebSocket: `GET /api/ws?code=<sessionCode>&role=<participant|display|admin|mod>` → 接続後に `snapshot` を受信（admin/mod は cookie で認証する。participant は `playerId`、display は `screen` を query に持つ）。
- Admin enter: `POST /api/admin/enter?code=<sessionCode>`（bodyにtoken）→ HttpOnly cookie を付与する（GETは副作用なし）。
- Mod enter: `POST /api/mod/enter?code=<sessionCode>`（bodyにtoken）→ HttpOnly cookie を付与する（GETは副作用なし）。
- Admin prepare: `POST /api/admin/prepare?code=<sessionCode>` → 次番号の予約（Admin のみ参照可能）。
- Admin reel: `POST /api/admin/reel?code=<sessionCode>` → `digit` と `action`（start/stop）で回転・停止を制御し、両方停止で確定する。
- Participant join: `POST /api/participant/join?code=<sessionCode>` → playerId 発行、カード配布。
- Mod spotlight: `POST /api/mod/spotlight?code=<sessionCode>` → spotlight 更新（揮発、version 付き LWW）。

---

（更新メモ）

- 2025-12-15 00:56Z: レビューで見つかった不具合（会場表示の `—`、reel の自動 prepare、スポットライト揮発+version、Admin/Mod 認証の cookie 化、UIの再参加導線）を修正するため、Progress/Context/Interfaces を現状に合わせて更新した。
- 2025-12-15 01:14Z: 実装が完了したため、Progress を完了状態に更新し、認証方式・スポットライト揮発化などの意思決定と、型チェック上の発見を追記した。
