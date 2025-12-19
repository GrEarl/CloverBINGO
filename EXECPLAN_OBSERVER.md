# オブザーバー/デバッグ画面の追加（監視ダッシュボード）

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

このリポジトリには ExecPlan の形式要件があり、リポジトリ直下の `.agent/PLANS.md` に従ってこのファイルを維持します（形式、自己完結、進捗更新の厳守）。

## Purpose / Big Picture

現地スタッフが操作せずに監視できる「オブザーバー画面」を追加し、イベント進行中の状態（参加者カードの全体タイル表示、Admin/Mod操作の監視、リーチ/ビンゴ人数、prepare後/リール中の次番号と影響、BGM/SE名、接続端末、通信状況、内部イベント/エラー）を1画面で把握できるようにします。技術情報が多くなりすぎる場合は「デバッグ画面」として分離し、オブザーバー画面からリンクで参照できるようにします。認証は Admin/Mod と同等の招待URL方式で保護し、スタッフのみが閲覧できることを担保します。

## Progress

- [x] (2025-12-19) 既存コードを調査し、オブザーバー/デバッグ画面の追加方針（新ロール/新招待トークン/WSスナップショット/監視ログ）を確定する。
- [x] (2025-12-19) Worker/DO を拡張して observer ロール、監視ログ、接続端末情報、音響ステータス、pendingプレビューを配信する。
- [x] (2025-12-19) Web に Observer/Debug 画面を追加し、カードタイル自動ページングと監視情報表示を実装する。
- [x] (2025-12-19) 招待/作成スクリプト/ホーム画面を更新して observer 招待URLと導線を追加する。
- [x] (2025-12-19) 検証（型チェック/ビルド/単体テスト）を実施し、受け入れ確認を行う。

## Surprises & Discoveries

- Observation: Debug画面の接続ラベル生成で `conn.role` のリテラル型が強すぎ、`string[]` へ型拡張が必要だった。
  Evidence: `npx tsc -p apps/web/tsconfig.json --noEmit` で `Argument of type 'screen=ten' is not assignable...` が発生。

## Decision Log

- Decision: observer ロールを admin/mod と同様に招待URLで発行し、WS/HTTP は observer cookie で認証する。
  Rationale: 観客には見せたくない情報（次番号、ログ、接続端末）を扱うため、専用ロールで分離するのが最も安全で運用しやすい。
  Date/Author: 2025-12-19 / codex
- Decision: オブザーバー画面に運営向け情報を集約し、技術的な詳細（イベントログ/エラーログ/接続一覧/送信統計）はデバッグ画面で分離する。
  Rationale: 1画面に詰め込み過ぎると可読性が落ちるため、要件が許容する範囲で分割する。
  Date/Author: 2025-12-19 / codex
- Decision: 音響の「現在再生中」表示は Admin 画面から DO に通知して共有する（DOで揮発状態を保持）。
  Rationale: 音は Admin ブラウザでのみ再生されるため、サーバ側に状態がない。最小の変更でスタッフ監視に反映するには Admin→DO の通知が適切。
  Date/Author: 2025-12-19 / codex

## Outcomes & Retrospective

- (2025-12-19) Observer/Debug 画面と監視ログ・接続情報・音響ステータスを実装し、テスト/ビルドが通ることを確認した。運用導線（招待URL/ホーム/HowToUse）の追記まで完了。

## Context and Orientation

このリポジトリは Cloudflare Workers + Durable Objects + D1 + React/Vite/Tailwind のモノレポです。主な関連ファイルは以下です。

- `apps/worker/src/index.ts`: HTTP ルーティングと DO へのフォワード、招待URL処理。
- `apps/worker/src/session.ts`: セッション単位 DO。WSのスナップショットと抽選状態を管理。
- `apps/worker/src/db/schema.ts`: D1 スキーマ（invites/participants/draw_commits）。
- `apps/worker/scripts/create-session.mjs`: セッション/招待トークン生成スクリプト。
- `apps/web/src/lib/useSessionSocket.ts`: 画面共通のWS接続とスナップショット型。
- `apps/web/src/routes/*`: 画面ルート（Admin/Mod/Display/Participantなど）。
- `apps/web/src/components/BingoCard.tsx`: ビンゴカード表示コンポーネント。

今回追加する概念:

- observer ロール: Admin/Mod と同等の招待URLで入室し、操作は行わず監視のみを行うロール。
- 監視ログ: Admin/Mod の操作、抽選進行、WS接続の増減、音響通知などを揮発的に記録するイベントログ。
- 音響ステータス: BGMの現在曲名とSFXの直近再生名を DO の揮発状態として保持し、observer に表示する。

## Plan of Work

まず Worker/DO を拡張して observer ロールと監視情報を配信できるようにします。`SessionDurableObject` に observer を追加し、WSの認証に observer cookie を使うようにします。合わせて、イベントログ/エラーログ/接続端末一覧/音響ステータスを DO の揮発状態として保持し、observer 用スナップショットで配信します。抽選の prepare 状態（pendingDraw）については observer には次番号と影響（reach/bingo増分）を表示できるようにし、Admin/Mod/Participant/Display には漏れないようにします。

次に Web 側に Observer/Debug 画面を追加します。Observer 画面では、全参加者のカードをタイル表示し、溢れる場合は一定間隔でページ切替を行います。画面上部にセッション状態、リーチ/ビンゴ人数、drawState、prepare情報、直近確定番号/新規BINGO名、音響状態を表示します。Debug 画面では、イベントログ、エラーログ、接続端末一覧、イベント送信カウント、スナップショットJSONなどの技術情報を確認できるようにします。

最後に招待URLの生成・案内を更新します。`create-session.mjs` と `/api/dev/create-session` で observer トークンを生成して表示し、Home/Invite 画面でも observer を選択できるようにします。必要に応じて `HowToUse.md` など運用ドキュメントに observer 画面の導線を追記します。

## Concrete Steps

1) ExecPlan を遵守しつつ Worker/DO を編集する（リポジトリ直下）。

    - `apps/worker/src/session.ts`: observer ロール追加、WS認証、observer スナップショット、監視ログ・音響ステータス・接続一覧の追加。
    - `apps/worker/src/index.ts`: `/api/invite/enter` の observer 対応、`/api/admin/audio` の追加、`/api/dev/create-session` の observer トークン生成。
    - `apps/worker/scripts/create-session.mjs`: observer トークンと URL の出力追加。

2) Web を編集して画面を追加する（リポジトリ直下）。

    - `apps/web/src/lib/useSessionSocket.ts`: observer スナップショット型と role の追加。
    - `apps/web/src/routes/ObserverPage.tsx`: 監視画面の新規実装。
    - `apps/web/src/routes/DebugPage.tsx`: デバッグ画面の新規実装（必要に応じて）。
    - `apps/web/src/App.tsx`: 新しいルート追加。
    - `apps/web/src/routes/InvitePage.tsx`: observer 招待対応。
    - `apps/web/src/routes/HomePage.tsx`: observer 招待リンク表示。
    - `apps/web/src/routes/AdminPage.tsx`: 音響ステータス通知（BGM/SFX名）を DO に送信。

3) 変更後の検証を行う（リポジトリ直下）。

    - `npm test`
    - `npx tsc -p apps/web/tsconfig.json --noEmit`
    - `npm -w apps/web run build`

## Validation and Acceptance

- `observer` 招待URLで入室すると `/s/:code/observer` に遷移し、WSが接続される。
- Observer 画面で以下が確認できる。
  - 参加者カードがタイル表示され、人数が多い場合は一定間隔でページ切替される。
  - リーチ人数/ビンゴ人数、drawState、直近確定番号、lastNumbers が表示される。
  - prepare 後は次番号と impact（reach/bingo増分）が表示され、リール中でも確認できる。
  - 直近の新規BINGO名が確認できる。
  - BGM/SE の現在名が表示される（Admin が音響有効化済みの場合）。
- Debug 画面で以下が確認できる。
  - Admin/Mod 操作ログ、抽選イベントログ、WS接続ログ。
  - エラーログ（commit失敗など）が表示される。
  - 接続端末一覧とロール別接続数が確認できる。
- Admin/Mod/Participant/Display には prepare の番号が漏れないこと（observerのみ）。

## Idempotence and Recovery

- observer ロールやログは揮発情報であり、再起動しても致命的な影響はない。
- 招待URLは GET で副作用がなく、`/api/invite/enter` による cookie 付与のみで入室できる。
- 実装ミス時は observer ロールを無効化しても既存機能に影響しないよう、追加コードは既存ロールの分岐を壊さない形で行う。

## Artifacts and Notes

- 2025-12-19: `npm test` / `npx tsc -p apps/web/tsconfig.json --noEmit` / `npm -w apps/web run build` がすべて成功。

## Interfaces and Dependencies

- 新ロール: `observer`。
- 新WS: `GET /api/ws?code=<sessionCode>&role=observer`（cookieで認証）。
- 新HTTP: `POST /api/admin/audio?code=<sessionCode>`（Adminのみ）。
  - body: `{ bgm?: { label: string | null; state: "playing" | "paused" | "stopped" }, sfx?: { label: string | null } }`
- observer スナップショットに含める情報（最低限）:
  - `players`（カード含む）、`drawnNumbers`、`pendingDraw`（次番号/impact）、`eventLog`、`errorLog`、`audioStatus`、`connections`、`eventCounts`。

(更新メモ)

- 2025-12-19: 初版作成（observer/debug の計画と認証方式を決定）。
- 2025-12-19: 実装完了に伴い Progress/Surprises/Outcomes を更新し、検証結果を反映。
