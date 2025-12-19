# Participantビンゴ承認フローとリーチ枠の再調整

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

このリポジトリには ExecPlan の形式要件があり、リポジトリ直下の `.agent/PLANS.md` に従ってこのファイルを維持します（形式、自己完結、進捗更新の厳守）。

## Purpose / Big Picture

参加者のBINGO演出を「本人の了承ボタンが押されるまで消えない」仕様に変更し、その了承はModの承認が無いと押せないようにします。さらに、Mod側では未承認のビンゴを一覧で承認でき、「現在未承認のBINGOだけ」を一括承認できるようにします。対象は各参加者の最初のビンゴのみです。承認必須かどうかはAdminがセッション内で切り替えられるようにします。

また、リーチ枠の虹演出を「マス全体が虹色になる」のではなく「既存マスの周囲に虹色の枠が付く」表現に修正し、回転も四角形が回るのではなく虹色だけが動く見た目に調整します。

完成後は、参加者ページでBINGO成立時に演出が消えずに残り、Mod承認後にのみ「了承」ボタンが押せて演出が消えること、Mod画面で個別/一括承認ができること、リーチ枠の虹色が枠だけに表示されることを確認できます。

## Progress

- [x] (2025-12-19 13:10 JST) 参加者/Mod/DOの現状を確認し、承認フローとデータ保持方式を決めた。
- [x] (2025-12-19 13:40 JST) DOに「初回ビンゴ承認状態」と「承認必須フラグ」を保持し、スナップショットに反映した。
- [x] (2025-12-19 13:55 JST) Mod画面に承認UI（個別/一括）を追加し、承認APIを実装した（未承認のみ一括対象）。
- [x] (2025-12-19 14:05 JST) Participant画面に承認待ちUIと「了承」ボタンを追加した（Mod承認前は無効）。
- [x] (2025-12-19 14:10 JST) Admin画面に「初回ビンゴ承認」の有効/無効切替を追加した。
- [x] (2025-12-19 14:15 JST) リーチ枠の虹色表現を枠のみ/虹色が動く方式に修正した。
- [x] (2025-12-19 14:24 JST) 型チェック/ビルド/必要な確認を行い、ExecPlanを更新する。

## Surprises & Discoveries

- Observation: 既にビンゴ済みの参加者に承認待ちを再表示しないため、起動時に既存ビンゴを「承認済み・了承済み」に初期化する必要があった。
  Evidence: DO再起動で過去ビンゴに対してもオーバーレイが出る可能性を回避するための初期化処理を追加。

## Decision Log

- Decision: 初回ビンゴ承認状態はDurable Objectのストレージに保存し、再接続/再起動で保持されるようにする。
  Rationale: 参加者がリロードしても「了承待ち」が消えないようにするため。
  Date/Author: 2025-12-19 / codex
- Decision: 承認フローは「Mod承認 → 参加者了承」の2段階にし、参加者側は承認済みになるまでボタンを無効化する。
  Rationale: 運営の確認が終わるまで参加者が勝手に閉じられないようにするため。
  Date/Author: 2025-12-19 / codex
- Decision: リーチ枠は疑似要素とマスクで枠線のみを表示し、色相回転で虹色を動かす。
  Rationale: 四角形の形は固定しつつ虹色のみが流れる表現にするため。
  Date/Author: 2025-12-19 / codex
- Decision: 承認必須の有無をAdmin側で切り替え可能にし、無効化時は未承認分を自動承認・自動了承とみなす。
  Rationale: セッション運用中に承認の必要性を柔軟に切り替えるため。
  Date/Author: 2025-12-19 / codex
- Decision: 一括承認は「未承認のBINGOのみ」を対象とする。
  Rationale: 参加者全員の承認ではなく、現在の承認待ちだけを処理する運用意図に合わせるため。
  Date/Author: 2025-12-19 / codex

## Outcomes & Retrospective

- (2025-12-19) （未記入）

## Context and Orientation

参加者画面は `apps/web/src/routes/ParticipantPage.tsx`、Mod画面は `apps/web/src/routes/ModPage.tsx` に実装されています。サーバ側のセッション状態は `apps/worker/src/session.ts` の Durable Object が保持し、スナップショットは `apps/web/src/lib/useSessionSocket.ts` の型で扱われます。

既存の参加者演出では、BINGO成立時に一時的なオーバーレイが出ますが、承認フローはありません。リーチ枠は `BingoCard` と `apps/web/src/index.css` で描画されます。

今回の変更では、初回ビンゴに対する承認状態（未承認/承認済み/了承済み）と「承認必須の有無」をDOストレージで管理し、参加者/Mod/AdminのUIに反映します。リーチ枠のCSSも再調整します。

## Plan of Work

まず `apps/worker/src/session.ts` に初回ビンゴ承認状態と承認必須フラグのデータ構造を追加し、commit時に初回ビンゴを検出して未承認として登録します。次に、Modの承認API（個別/未承認のみ一括）と参加者の了承API、Adminの承認必須切替APIを追加し、スナップショットに承認情報を載せます。

続いて `apps/web/src/lib/useSessionSocket.ts` の型を拡張し、`apps/web/src/routes/ModPage.tsx` に承認UIを追加します。ParticipantPageには承認待ち表示と「了承」ボタンを追加し、Mod承認前はボタンを無効化します。

最後に `apps/web/src/index.css` のリーチ枠表現を、枠のみ表示・虹色が動く表現に修正します。

## Concrete Steps

1) DOに承認状態を追加する（リポジトリ直下）。

    - `apps/worker/src/session.ts` に `bingoApprovals` を追加し、初回ビンゴ時に未承認として登録する。
    - `apps/worker/src/session.ts` に `handleModBingoApprove` と `handleParticipantBingoAck` を追加する。
    - `apps/worker/src/index.ts` に `/api/mod/bingo/approve`、`/api/participant/bingo/ack`、`/api/admin/bingo/setting` のルートを追加する。
    - スナップショットに承認情報（参加者向けは自身分、Mod/Admin向けは一覧）と承認必須フラグを含める。

2) フロント型とUIを更新する（リポジトリ直下）。

    - `apps/web/src/lib/useSessionSocket.ts` に承認状態の型を追加する。
    - `apps/web/src/routes/ModPage.tsx` に未承認一覧と個別/一括承認ボタンを追加する。
    - `apps/web/src/routes/ParticipantPage.tsx` に承認待ち表示と「了承」ボタンを追加する。
    - `apps/web/src/routes/AdminPage.tsx` に承認必須の切替UIを追加する。

3) リーチ枠の表現を調整する（リポジトリ直下）。

    - `apps/web/src/index.css` の `.reach-cell` を枠だけ表示する方式に変更する。

4) 検証（リポジトリ直下）。

    - `npx tsc -p apps/web/tsconfig.json --noEmit`
    - `npm -w apps/web run build`

## Validation and Acceptance

- 参加者が初回ビンゴ成立すると演出が表示され、了承ボタンはMod承認まで無効である。
- Modが承認すると参加者側の了承ボタンが有効になる。
- 参加者が了承を押すまで演出が消えない。
- Mod側で個別承認と「未承認のみ一括承認」ができる。
- Adminが承認必須の有無を切り替えられる。
- リーチ枠が「枠だけ虹色」で「虹色が動いている」見た目になっている。
- 型チェックとビルドが成功する。

## Idempotence and Recovery

- 承認状態と承認必須フラグはDOストレージに保持し、再接続しても保持される。
- 参加者の了承は一度だけ適用され、以後のビンゴでは再度要求されない。

## Artifacts and Notes

- 変更後のビルドログ（抜粋）:
  - `npm -w apps/web run build`
    - `vite v7.2.7 building client environment for production...`
    - `✓ built in 706ms`

## Interfaces and Dependencies

- 新API:
  - `POST /api/mod/bingo/approve?code=<sessionCode>`
  - `POST /api/participant/bingo/ack?code=<sessionCode>`
  - `POST /api/admin/bingo/setting?code=<sessionCode>`
- スナップショット拡張:
  - Participant: `bingoApproval`（自分の承認状態）
  - Mod/Admin: `bingoApprovals`（一覧）, `bingoApprovalRequired`（承認必須フラグ）

(更新メモ)

- 2025-12-19: 初版作成（承認フローとリーチ枠調整の計画を記述）。
- 2025-12-19: Adminの承認必須切替と「未承認のみ一括承認」の要件を反映し、進捗と決定ログを更新。
- 2025-12-19: 型チェック/ビルド結果を追記し、進捗と成果物欄を更新。
