# Participantビンゴ演出とリーチ枠の追加

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

このリポジトリには ExecPlan の形式要件があり、リポジトリ直下の `.agent/PLANS.md` に従ってこのファイルを維持します（形式、自己完結、進捗更新の厳守）。

## Purpose / Big Picture

参加者画面で「自分がビンゴした瞬間の演出」が見え、また「リーチで当たればビンゴになるマス」が虹色の回転枠で強調表示されるようにします。これにより参加者が自分の進捗を直感的に把握でき、当選時の盛り上がりがスマホ画面でも伝わります。完成後は、参加者ページでビンゴ成立時に演出が発火し、カード上のリーチ対象マスに虹色の回転枠が表示されることを目視で確認できます。

## Progress

- [x] (2025-12-19) 参加者ページとBingoCardの現状を確認し、演出とリーチ枠の実装方針を決める。
- [x] (2025-12-19) BingoCardにリーチ枠用のハイライトを追加し、虹色回転枠のCSSを実装する。
- [x] (2025-12-19) ParticipantPageにビンゴ演出（自分が当たった場合のみ）を追加する。
- [x] (2025-12-19) 型チェックとビルドで動作確認し、ExecPlanを更新する。

## Surprises & Discoveries

- Observation: 目立った予期せぬ挙動は確認されなかった。
  Evidence: `npx tsc -p apps/web/tsconfig.json --noEmit` と `npm -w apps/web run build` が成功。

## Decision Log

- Decision: リーチ枠は「12ライン中、未達が1マスのライン」に含まれる未達マスをハイライトする。
  Rationale: リーチ状態を最も直感的に示せるため。
  Date/Author: 2025-12-19 / codex
- Decision: ビンゴ演出はParticipantPageで「isBingoがfalse→trueに変化した瞬間」にのみ発火する。
  Rationale: 自分が当たった時だけ演出を出すため。
  Date/Author: 2025-12-19 / codex

## Outcomes & Retrospective

- (2025-12-19) 参加者カードにリーチ枠（虹色回転）を追加し、ビンゴ成立時のオーバーレイ演出を実装した。ビルドと型チェックが成功した。

## Context and Orientation

参加者画面は `apps/web/src/routes/ParticipantPage.tsx` に実装されています。カード表示は `apps/web/src/components/BingoCard.tsx` が担当し、`card: number[][]` と `drawnNumbers: number[]` を受け取って描画しています。現在はリーチ枠や参加者向け演出はありません。

今回の変更で、BingoCardは「特定のセルを強調するためのハイライト情報」を受け取り、CSSで虹色回転枠を描画します。ParticipantPageはカードのリーチ対象セルを計算し、ビンゴ成立時の一時的な演出を画面全体に表示します。

## Plan of Work

まず `apps/web/src/components/BingoCard.tsx` にハイライト用のオプションプロパティを追加し、該当セルに特別なクラスを付与します。次に `apps/web/src/index.css` に虹色回転枠のアニメーションを追加します。続いて `apps/web/src/routes/ParticipantPage.tsx` にリーチセル計算ロジックを追加し、BingoCardへハイライトを渡します。併せて、ビンゴ成立時に一時的な演出を表示するための状態とオーバーレイ描画を追加します。最後に型チェックとビルドを実行して確認します。

## Concrete Steps

1) BingoCardにハイライト入力を追加する（リポジトリ直下）。

    - `apps/web/src/components/BingoCard.tsx` に `reachHighlights?: boolean[][]` を追加し、未達セルに `reach-cell` クラスを付与する。

2) 虹色回転枠のCSSを追加する（リポジトリ直下）。

    - `apps/web/src/index.css` に `.reach-cell` と `@keyframes` を追加し、回転する虹色の枠を描画する。

3) ParticipantPageでリーチセルを計算し、ビンゴ演出を追加する（リポジトリ直下）。

    - `apps/web/src/routes/ParticipantPage.tsx` に「12ライン中の未達が1マスのライン」を計算する関数を追加し、BingoCardに `reachHighlights` を渡す。
    - `isBingo` が false から true になったタイミングで発火するビンゴ演出（オーバーレイ + パーティクル）を追加する。

4) 検証（リポジトリ直下）。

    - `npx tsc -p apps/web/tsconfig.json --noEmit`
    - `npm -w apps/web run build`

## Validation and Acceptance

- 参加者画面でリーチ状態のマスが虹色回転枠で強調される。
- 参加者がビンゴ成立した瞬間にのみ演出が表示される。
- 型チェックとビルドが成功する。

## Idempotence and Recovery

- ハイライトと演出は揮発的なUIであり、再読み込みしても状態はスナップショットから再構成される。
- 実装は参加者画面とBingoCardに限定され、他画面への影響を最小化できる。

## Artifacts and Notes

- 2025-12-19: `npx tsc -p apps/web/tsconfig.json --noEmit` を実行し成功。
- 2025-12-19: `npm -w apps/web run build` を実行し成功。

## Interfaces and Dependencies

- `BingoCard` に `reachHighlights?: boolean[][]` を追加する。
- ParticipantPageでリーチ判定ロジックを実装し、UIに反映する。

(更新メモ)

- 2025-12-19: 初版作成（参加者向け演出とリーチ枠の計画を記述）。
- 2025-12-19: 実装と検証結果を反映し、進捗/成果を更新。
