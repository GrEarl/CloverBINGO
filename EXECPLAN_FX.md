# Display演出（Particle/FX統合）の強化

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

このリポジトリには ExecPlan の形式要件があり、リポジトリ直下の `.agent/PLANS.md` に従ってこのファイルを維持します（形式、自己完結、進捗更新の厳守）。

## Purpose / Big Picture

会場ディスプレイの演出を強化し、既存の画面演出（シェイク/グリッチ/ストロボ/ジャックポット）とパーティクル表現が連動するようにします。具体的には、抽選開始・確定・ビンゴ時のイベントとパーティクルの発生が一貫したルールで結びつき、背景演出（常時）とイベント演出（バースト）が視覚的に統合される状態を作ります。完成後は、Displayページで抽選開始/停止/確定に合わせて粒子演出が強く反応することを目視で確認できます。

## Progress

- [x] (2025-12-19) 既存のDisplay/Particle構成を整理し、統合強化の方針（背景パーティクル + バースト演出）を決定する。
- [x] (2025-12-19) ParticleSystemにバースト（単発大量発生）を追加し、Display側でイベントに紐付ける。
- [x] (2025-12-19) DisplayPageの演出ルールを更新し、tension/commit/bingoと粒子演出が整合するように調整する。
- [x] (2025-12-19) 変更後の表示を確認し、ビルドが通ることを確認する。

## Surprises & Discoveries

- Observation: 目立った予期せぬ挙動は確認されなかった。
  Evidence: `npx tsc -p apps/web/tsconfig.json --noEmit` と `npm -w apps/web run build` が成功。

## Decision Log

- Decision: 背景パーティクルとイベントバーストを同じParticleSystem内で扱い、バーストは別モードを指定できる仕組みを追加する。
  Rationale: 1画面の描画コストを抑えつつ、抽選開始/確定/ビンゴ時に強い視覚的変化を出せるため。
  Date/Author: 2025-12-19 / codex

## Outcomes & Retrospective

- (2025-12-19) ParticleSystemにバースト機構を追加し、Display側で抽選開始/確定/ビンゴに連動したバースト演出を実装した。背景パーティクルの強度はgo/confirm/bingoの状態でブーストされ、演出の一貫性が向上した。

## Context and Orientation

このリポジトリのDisplay演出は `apps/web/src/routes/DisplayPage.tsx` に集約され、`apps/web/src/components/ParticleSystem.tsx` がCanvasベースの粒子描画を担当します。DisplayPageはWebSocketのイベント（抽選開始/停止/確定、ビンゴ発生）を受け、shake/glitch/strobeなどのCSS演出とParticleSystemのモード/強度を切り替えています。現在は常時表示のParticleSystemが1つで、ビンゴ時にはCSSのclover粒子が追加されます。

今回の変更で、ParticleSystemは「バースト（単発大量発生）」という概念を追加し、DisplayPageのイベント（goPulse/confirmedPulse/bingoFx）と連動させます。背景演出（matrix/rain/sparklesなど）とバースト演出（confetti/sparkles）を統合し、演出の一貫性を高めます。

## Plan of Work

まず `apps/web/src/components/ParticleSystem.tsx` にバースト用の入力を追加します。バーストは「keyが変わるたびに指定モードの粒子を一定数生成する」方式にし、`active=false`でもバーストのみ発生できるようにします。次に `apps/web/src/routes/DisplayPage.tsx` でバーストをトリガーする関数を作り、抽選開始・確定・ビンゴでバーストを発生させます。既存のtensionベースの背景パーティクルは維持しつつ、イベントで強度を上げるロジックを追加します。最後にビルドを実行し、Display画面の動作を確認します。

## Concrete Steps

1) ParticleSystemにバースト入力を追加する（リポジトリ直下）。

    - `apps/web/src/components/ParticleSystem.tsx` に `burst?: { key: number; mode?: ParticleMode; count?: number; intensity?: number; origin?: { x: number; y: number } }` を追加し、`burst.key` が更新された時に粒子を一括生成する。

2) DisplayPageからバーストを発火する（リポジトリ直下）。

    - `apps/web/src/routes/DisplayPage.tsx` に `triggerParticleBurst` を追加し、以下のタイミングで発火する。
      - 抽選開始（draw.spin start）: sparklesバースト
      - 抽選確定（draw.committed）: sparklesバースト
      - ビンゴ発生（bingoFx発火時）: confettiバースト
    - 既存の `particleMode` / `particleIntensity` を、go/confirm/bingo状態で短時間ブーストする。

3) 検証（リポジトリ直下）。

    - `npx tsc -p apps/web/tsconfig.json --noEmit`
    - `npm -w apps/web run build`

## Validation and Acceptance

- Display画面で抽選開始時に明確な粒子バーストが発生する。
- 抽選確定時に短い強いバーストが発生し、背景粒子が状態に合わせて変化する。
- ビンゴ発生時にconfettiバーストが表示され、既存のBINGO演出と同時に視覚効果が強化される。
- ビルドが成功する。

## Idempotence and Recovery

- バーストは揮発的な演出のため、失敗しても状態復旧に影響しない。
- ParticleSystemの変更はDisplayページのみで完結するため、他画面への影響がない。
- もし演出が重い場合は `safe` パラメータで演出を抑制できる。

## Artifacts and Notes

- 2025-12-19: `npx tsc -p apps/web/tsconfig.json --noEmit` を実行し成功。
- 2025-12-19: `npm -w apps/web run build` を実行し成功。

## Interfaces and Dependencies

- 追加プロパティ: `ParticleSystem` に `burst` を追加。
- DisplayPageは `ParticleSystem` に `burst` と `intensity` を渡し、演出状態を統合する。

(更新メモ)

- 2025-12-19: 初版作成（演出統合の計画を記述）。
- 2025-12-19: 実装と検証結果を反映し、進捗/成果を更新。
