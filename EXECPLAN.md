# CloverBINGO フル要件実装（200人規模 / Cloudflare Workers + Durable Objects + D1 + Web UI）

この ExecPlan は生きたドキュメントです。作業が進むたびに `Progress` / `Surprises & Discoveries` / `Decision Log` / `Outcomes & Retrospective` を必ず更新します。

本リポジトリには ExecPlan の形式要件があり、` .agent/PLANS.md ` に従ってこのファイルを維持します（形式、自己完結、進捗更新の厳守）。

## Purpose / Big Picture

会場イベント向けに、最大200人規模で安定運用できる「電子ビンゴ」を Cloudflare 上で完結する構成（Workers / Durable Objects / D1）で実装します。参加者は `/s/:code` から表示名登録→ビンゴカード受領→抽選を閲覧し、抽選結果がリアルタイムに反映されます。会場モニターは2枚で、左は十の位リール（`/s/:code/display/ten`）、右は一の位リール（`/s/:code/display/one`）としてスロット風に「回転→停止」で数字を表現します。Admin はキーボード（`P` / `W/A/S/D`）で抽選を制御し、音響（SE）はAdmin画面から出します。Mod は複数同時接続を前提に、参加者進捗の俯瞰とスポットライト（最大6人、LWW）を操作し、会場表示に反映します。

永続化は commitログ中心（D1）とし、セッションの再接続・再描画・状態同期は Durable Objects をハブにして成立させます。招待URL（Slack/Discord配布）については GET で副作用を起こさず、入室（POST）で cookie を付与して認証します。セッション終了（end）後は招待を含む全操作を無効化し、運用事故をシステムで防ぎます。

## Progress

- [x] (2025-12-14 19:09Z) `AGENTS.md` と ` .agent/PLANS.md ` を通読し、現状リポジトリ（コード未整備・音源のみ）を確認した。
- [x] (2025-12-14 19:21Z) npm workspaces で `apps/worker` / `apps/web` / `packages/core` を作成し、`npm install` と `npm test` で雛形が動くことを確認した。
- [x] (2025-12-14 19:36Z) Session Durable Object と WebSocket（role別snapshot）を実装し、最小REST API（init/join/prepare/reel/spotlight）で状態更新→broadcast が動くことを手動検証した。
- [x] (2025-12-14 19:43Z) Web UI（Home/参加者/会場表示 ten&one/Admin/Mod）を最小動線で実装し、`vite build` が通る状態にした。
- [x] (2025-12-14 19:21Z) カード生成・判定ロジックを `packages/core` に実装し、単体テストを追加した。
- [x] (2025-12-14 19:36Z) Worker から `packages/core` を参照し、サーバ側で reach/bingo 指標を計算して配信するようにした。
- [x] (2025-12-14 19:44Z) ローカル起動手順と最低限の運用メモ（キー操作）を `README.md` に追記した。
- [x] (2025-12-15 01:14Z) 会場表示が prepare 後に `—` になり得る不具合を修正し、確定前に次番号が漏れない表示にした。
- [x] (2025-12-15 01:14Z) Admin の `W/A/S/D`（reel）で pending が無い場合は `start` を契機に自動で prepare して進行できるようにした。
- [x] (2025-12-15 01:14Z) スポットライトを揮発化し、`version` 付き LWW として配信するようにした（永続ストレージに保存しない）。
- [x] (2025-12-15 01:14Z) Admin/Mod の token を WS/通常API の query から外し、招待リンク（GET）→入室（POSTで HttpOnly cookie 付与）に変更した。
- [x] (2025-12-15 01:14Z) 参加者の playerId 不整合時に再参加導線を出し、Mod の下書き初期化をセッション切替で正しくした。
- [x] (2025-12-15 03:19Z) D1 スキーマ（sessions/invites/participants/draw_commits）とマイグレーションを追加した。
- [x] (2025-12-15 03:19Z) Drizzle を導入し、Worker/DO から D1 を参照できる最小クエリ層を作った。
- [x] (2025-12-15 03:19Z) セッション作成スクリプト（code + 招待token生成 + URL出力）を実装した（local/remote）。
- [x] (2025-12-15 03:19Z) Worker が `sessionCode -> sessionId` を D1 で引き、DO を `sessionId` でルーティングするようにした。
- [x] (2025-12-15 03:19Z) SessionDO を commitログ中心（D1）で復元し、DO再起動/再接続で同一状態に復帰できるようにした。
- [x] (2025-12-15 03:19Z) 抽選ステートマシン（idle/prepared/spinning）と安全装置（spinning中の連打無効）を実装した。
- [x] (2025-12-15 03:50Z) WebSocketプロトコル（snapshot / draw.prepared / draw.spin / draw.committed / spotlight.changed）を role ごとに配信し、Web側の型/表示と整合させた。
- [x] (2025-12-15 03:50Z) 会場表示（ten/one）にスポットライト分割（左3/右3）と統計コアを実装し、空き枠は統計詳細で埋めるようにした。
- [x] (2025-12-15 03:50Z) Admin 画面に「音を有効化」導線と SE 再生、状態表示（次に押すべきキー）と end ボタンを実装した。
- [x] (2025-12-15 03:50Z) Mod 画面に検索/ソート、参加者詳細（簡易カード）、最終更新者/時刻（相対）表示を実装した。
- [x] (2025-12-15 03:50Z) 単体テスト（commitログ復元）を追加し、WS負荷確認（擬似接続）スクリプトを追加した。
- [x] (2025-12-15 04:49Z) 仕様ズレ/運用リスク修正（`newBingoIds` の配信範囲、snapshot計算の最適化、WS再接続ジッター、`/api/dev/create-session` のローカル限定）。
- [x] (2025-12-15 08:01Z) UI/UX 改善: 画面共通の UI プリミティブ（Button/Input/Card/Badge/Kbd 等）を追加し、見た目と操作性を統一した。
- [x] (2025-12-15 08:01Z) Display: オーバーレイの自動非表示/フルスクリーン導線/リール停止時の視覚効果を改善した（遠距離視認性は維持）。
- [x] (2025-12-15 08:01Z) Mod: 「選択」と「下書き追加」を分離し、誤操作を減らした（最大6人到達時のフィードバック追加）。
- [x] (2025-12-15 08:01Z) Admin/Participant/Invite/Home: タイポグラフィ/余白/状態表示を統一し、アクセシビリティ（focus/disabled）を改善した。
- [x] (2025-12-15 11:58Z) 仕様修正対応: `W/A/S/D` を「全桁GO」（十の位/一の位を同時に回す）に統一し、各桁ランダム時間で自動停止・`P`（prepare）なしではリール開始できないように、SessionDO/API/Admin UI/README を更新した。
- [x] (2025-12-15 13:08Z) Admin 音響: 新SE/BGM仕様（prepareシーケンス/リール中7秒ループ/桁確定/ビンゴ/開放人数/複数ビンゴ演出 + BGM ducking）を実装した。
- [x] (2025-12-15 13:43Z) 参加者ページのUX改善: スマホで「名前入力後、スクロール無しでカードが見える」配置に変更し、不要な情報（スポットライト/進捗詳細等）を削減した。
- [x] (2025-12-15 13:43Z) ModページのUX改善: 全参加者のビンゴカードをグリッドで一括監視できる表示を追加し、スポットライト編集（下書き→送信）と両立させた。
- [x] (2025-12-15 14:39Z) イベント運用UX改善: Adminのキー誤動作防止（入力中は無視・無効状態はローカルで案内）、Displayの再接続/オフラインの常時表示、Modの `updatedBy` を運用名入力に対応した。あわせて WS 状態表示の文言を日本語化した（prepare必須は維持）。
- [x] (2025-12-15 14:44Z) 文字コード統一: リポジトリの主要テキストファイルが UTF-8 として妥当であることを検証し、`.editorconfig` で `charset=utf-8` を明示した。
- [x] (2025-12-16 09:43Z) P0修正: Web の `BingoCard` が core の `BingoCard`（2次元配列）と一致するように描画/型を修正し、`variant/showHeaders` の既存呼び出しと整合させた。
- [x] (2025-12-16 09:51Z) ローカル起動の安定化: `npm -w apps/worker run migrate:local` が Windows でも動くように修正し、`npm run dev` だけで D1 マイグレーションが適用されるようにした。
- [x] (2025-12-16 10:30Z) UI事故修正: Tailwind のカスタム色（`pit-*`）がCSSに生成されず黒地に黒文字になっていたため、Participant/Display を既存の neutral 系 UI に戻して視認性を回復した。

## Surprises & Discoveries

- npm workspaces では `workspace:*` プロトコルが使えなかったため、内部依存はバージョン一致（例：`0.0.0`）で解決する形にした。
- `apps/worker` の `tsconfig` を strict のまま `tsc` に通すと、依存（hono）の型定義でエラーになることがあったため、`skipLibCheck` を有効化した（型チェック対象を自分のコードに寄せる）。
- `draw.committed` の `newBingoIds` が全roleに配信され得る実装になっていたため、Mod/Admin のみに限定した。
- WebSocket 再接続が固定間隔だと瞬断/デプロイ後に同時再接続が起きやすいため、指数バックオフ + ジッターに変更した。
- `vite build` は TypeScript の型エラーを検出しないため、`npx tsc -p apps/web/tsconfig.json --noEmit` を回して HomePage の型エラーを修正した。
- React 19 + 本リポジトリの型設定では `JSX.Element` を直接参照できない箇所があったため、`ReactNode` を使うようにした。
- `wrangler d1 migrations apply` は `--yes` を受け付けず確認プロンプトが出るため、Windows の npm scripts（cmd.exe）でも動くように `echo y |` で非対話化する必要があった。
- Tailwind v4 では `tailwind.config.js` が自動適用されない構成があり、`apps/web/dist/assets/*.css` に `pit-` 系ユーティリティが生成されない状態になり得た（JSには `bg-pit-*` が残るため、結果として黒地に黒文字になる）。

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
- Decision: 永続化は D1 を正とし、抽選は commitログ（draw_commits）中心で復元できるモデルにする（DOのストレージはキャッシュ/最小限）。
  Rationale: D1 の書き込み頻度を抑えつつ、DO再起動やデプロイ切断後でも復帰できるようにするため。
  Date/Author: 2025-12-15 / codex
- Decision: `draw.committed` の `newBingoIds` は Mod/Admin のみに配信する（参加者/会場表示へは送らない）。
  Rationale: 仕様（必要ならnewBingoリストは mod/admin のみ）に合わせ、情報の露出範囲を制御するため。
  Date/Author: 2025-12-15 / codex
- Decision: `/api/dev/create-session` は localhost からのリクエストに限定する。
  Rationale: デプロイ時に残っても誰でもセッション作成できる状態を避けるため（ローカルMVP用途に限定）。
  Date/Author: 2025-12-15 / codex
- Decision: 参加者ページは「カード + 直近情報」に絞り、スポットライト/進捗詳細の表示をやめる。
  Rationale: スマホのファーストビューでカードが見えることを優先し、参加者に不要な情報で画面を混雑させないため。
  Date/Author: 2025-12-15 / codex
- Decision: Modページはカードグリッドを主表示にし、各カードの★でスポットライト下書きを編集できるようにする。
  Rationale: 参加者全体の状況を一括監視しつつ、スポットライト操作も同じ導線で行えるようにするため。
  Date/Author: 2025-12-15 / codex
- Decision: WebSocket 再接続は指数バックオフ + ジッターで行う。
  Rationale: 瞬断/デプロイ後の同時再接続による負荷スパイクを避けるため。
  Date/Author: 2025-12-15 / codex
- Decision: Web UI は TailwindCSS + 軽量な自前 UI プリミティブで統一し、重い UI ライブラリ依存を増やさない。
  Rationale: バンドル肥大を避けつつ、各ページの見た目/操作性を一貫させるため（会場運用での視認性・誤操作耐性を優先）。
  Date/Author: 2025-12-15 / codex
- Decision: Admin の `W/A/S/D` は「全桁GO」に統一し、停止は各桁がランダム時間で自動停止（Admin は停止操作しない）。また `P`（prepare）なしでは GO できない。
  Rationale: 仕様修正に追従し、運用上「押すキーが多段にならない」「停止タイミングをAdminが気にしない」状態にして誤操作を減らすため。
  Date/Author: 2025-12-15 / codex
- Decision: Admin 音響は（当面）WebAudioではなく、`HTMLAudioElement` ベースで BGM/SE/ducking/7秒区間ループを実装する。
  Rationale: 依存追加なしで実装でき、ブラウザ互換性（デコード/自動再生制限）を既存の「音を有効化」導線に揃えやすい。7秒区間ループはタイマーで制御する。
  Date/Author: 2025-12-15 / codex
- Decision: Adminのキーボード操作は、入力欄フォーカス中は反応しない（誤操作防止）。また「無効な状態でのキー」はサーバに投げず、画面上で理由を案内する。
  Rationale: イベント運用では token の貼り付け等で入力欄にフォーカスが入り得る。そこで `P/WASD` が反応すると致命的な誤操作になり得るため。
  Date/Author: 2025-12-15 / codex
- Decision: 会場表示（ten/one）は、接続状態が `Connected` 以外のときだけ、画面上に常時表示する。
  Rationale: 全画面運用ではマウス/キーボード操作が無い時間が長く、オーバーレイ自動非表示だと切断に気づきにくいため（復帰導線を早期に提供する）。
  Date/Author: 2025-12-15 / codex
- Decision: Mod の `spotlight.updatedBy` はランダムIDではなく、運用名（任意入力・端末内に保存）を基本として送る。
  Rationale: 複数Mod運用で LWW 競合が起きた時に「誰が更新したか」が即座に判別できるようにするため。
  Date/Author: 2025-12-15 / codex
- Decision: リポジトリのテキストファイルは UTF-8 に統一し、`.editorconfig` で `charset=utf-8` を明示する。
  Rationale: OS/エディタ/ターミナル差で日本語が文字化けしないようにし、レビュー/運用手順の再現性を上げるため。
  Date/Author: 2025-12-15 / codex
- Decision: Participant/Display の `pit-*` テーマ用クラスは撤回し、既存の neutral 系 UI（Tailwind標準色 + 自前UIプリミティブ）へ戻す。
  Rationale: `pit-*` がCSSに生成されない状態で視認性が壊れたため。イベント運用では「確実に読める」ことを最優先し、既存のUI設計へ統一してリスクを下げる。
  Date/Author: 2025-12-16 / codex

## Outcomes & Retrospective

- （未記入：フル要件到達時に更新）

## Context and Orientation

現状は npm workspaces のモノレポで、Worker / Web / 共通ロジック（core）が揃っている状態です。音源（スロット系SE/BGM）は `audio_ogg/` に同梱されています（`audio_ogg/soundeffect/*.ogg` と `audio_ogg/bgm/*.ogg`）。

Admin の音響仕様（このExecPlanでの合意）:

- BGM: `OstCredits.ogg` / `OstDemoTrailer.ogg` / `OstReleaseTrailer.ogg` のいずれかを常時再生（ループ）。SE 再生中のみ BGM 音量を 50% にする（ducking）。
- SE（トリガーとファイル）:
  - prepare（`P` で「次の番号を準備」）: `SoundCoinDeposit.ogg` を3回 → `SoundSlotMachineStartupJingle.ogg`
  - リール中（spinning中）: `SoundSlotMachineFanfare.ogg` を「0〜7秒」の区間ループ再生
  - 桁確定（各桁の stop。順序はランダム）: `SoundSlotMachineScored.ogg`
  - 桁確定（この draw で新規BINGOが出ることが確定している場合）: `SoundSlotMachineScoredWithJackpot.ogg`
  - リール結果の番号で「何人マス解放できたか」を表示する時: `SoundSlotMachineSpinWin.ogg`
  - ビンゴ者が出た時（新規BINGO発生）: `SoundSlotMachineJackpot.ogg`
  - 複数ビンゴ者が出た時、BINGO者のエントリーネームを順に表示し終わった時: `SoundSlotMachineLongStreakEndAnticipation.ogg`

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
- D1: Cloudflare の SQLite 互換DB。commitログ中心の永続化、参加者カードの保存に使う。
- commitログ: 抽選確定の履歴（`draw_commits`）のこと。ここから「引いた番号列」を復元して状態を再計算する。
- snapshot: 再接続時に送る「現在の完全状態」。初回接続/復帰で必ず送る。
- LWW（Last-write-wins）: 競合時に「最後に書いたものを採用」する方式。スポットライトに使う。

## Plan of Work

フル要件に向けて、永続化（D1）と運用安全策（招待URLの安全化、end、復帰同期）を先に固めます。次に SessionDO を commitログ中心で復元できるように刷新し、WebSocketプロトコル（snapshot + 必要イベント）を role ごとに配信します。その上で Web UI（参加者/Admin/Mod/会場表示）を要件に沿って強化し、最後にテスト（ロジック/復元）と負荷確認（WS 200接続）を追加します。

実装の順序（高リスクから潰す）:

1. D1 schema + migration（sessions/invites/participants/draw_commits）
2. セッション作成スクリプト（code + invite token 出力）
3. Worker routing（code→sessionId、invite enter、end）
4. SessionDO（D1から復元、state machine、WSイベント）
5. Web UI（Invite/Admin/Mod/Display/Participant のUX要件）
6. テスト/負荷/運用ドキュメント

## Concrete Steps

1) 依存のインストール（リポジトリ直下）:

    npm install

2) ローカルDB（D1）を用意してマイグレーションを適用（リポジトリ直下）:

    npm -w apps/worker run migrate:local

（ローカルDBは `apps/worker/.wrangler/state` に永続化されます）

3) セッション作成（リポジトリ直下）:

    npm -w apps/worker run create-session

標準出力に「参加者URL / 会場表示URL（ten/one） / Admin招待URL / Mod招待URL」が出るので、それぞれの画面を開く。

4) ローカル起動（リポジトリ直下）:

    npm run dev

期待する挙動（目安）:

- Worker（wrangler dev）が起動し、Web UI がブラウザで表示できる。
- 参加者URLで表示名登録→カードが表示される。
- Admin招待URLを開いて「入室」→キーボード操作で抽選が進む。
- Display（ten/one）でリールが回転→停止し、統計/スポットライトが更新される。

（※コマンドや期待出力は実装に合わせてこの節を更新する）

## Validation and Acceptance

受け入れ条件（フル要件）:

- 参加登録→カード配布→抽選反映→ビンゴ到達判定が安定して動く（最大200人規模を想定）。
- Admin の `P`（prepare）→ `W/A/S/D`（GO）で、会場モニター2枚（ten/one）が「回転→（各桁がランダム時間で自動停止）→確定」で期待通りに動く（GO は prepare 済みのみ可）。
- prepare結果（次番号/プレビュー統計）は Admin だけが閲覧でき、Mod/参加者/会場表示には漏れない。
- Mod が参加者進捗を俯瞰でき、スポットライト最大6人を会場表示へ反映できる（複数Mod同時接続でLWWが機能する）。
- 回線が揺れても復帰できる（再接続で snapshot 同期が成立する）。
- 招待URLは GET で副作用を起こさない（入室はPOSTでcookie付与）。
- end 後は全操作が無効化され、WSクライアントも「終了」を表示できる。
- UI/UX: 参加者ページはスマホのファーストビューでカードが見える前提で、表示情報を必要最小限（カード/直近/WS状態/再参加）に絞る。
- UI/UX: Modページは参加者全員のカードをグリッドで一覧監視でき、★でスポットライト下書きを編集できる。
- UI/UX: 会場表示は遠距離でも読める大きさ/コントラストを維持し、常時表示する情報（オーバーレイ）は最小限に抑える。
- Admin 音響: BGM が常時ループし、SE 再生中のみ BGM 音量が 50% になる。SE は上記のトリガーに従って鳴る（prepareシーケンス、spinning中の7秒ループ、桁stop、commit後の開放人数表示、新規BINGO、複数BINGOの名前表示完了）。

## Idempotence and Recovery

- ローカルでの再実行は `npm install` / `npm run dev` を繰り返しても安全にする。
- D1 のローカル状態を壊した場合は、`apps/worker/.wrangler`（`--persist-to`先）を消してから `wrangler d1 migrations apply --local` をやり直せるようにする。
- セッションが壊れた場合は「セッション作り直し」で復旧できる（commitログ中心で復元できるのが本筋）。

## Artifacts and Notes

（作業が進んだら、実際に使った curl / 手動手順 / 期待UIなどを短く追記）

## Interfaces and Dependencies

フル要件の最小インターフェース（実装に合わせて更新）:

- WebSocket: `GET /api/ws?code=<sessionCode>&role=<participant|display|admin|mod>&playerId=<optional>&screen=<optional>`（admin/mod は cookie で認証）
  - server→client:
    - `snapshot`（全role）
    - `draw.prepared`（adminのみ）
    - `draw.spin`（displayのみ）
    - `draw.committed`（全員。mod/adminは詳細多め）
    - `spotlight.changed`（display/mod/admin）
- 招待:
  - `GET /i/:token`（Web。説明ページのみ。副作用なし）
  - `POST /api/invite/enter`（token→cookie付与→遷移先返却）
- 参加者:
  - `POST /api/participant/join?code=<sessionCode>`（displayName→playerId+card）
- Admin:
  - `POST /api/admin/prepare?code=<sessionCode>`
  - `POST /api/admin/reel?code=<sessionCode>`（action=`go`。十の位/一の位を同時に回転開始し、各桁はサーバ側でランダム時間後に自動停止→両方停止で commit）
  - `POST /api/admin/end?code=<sessionCode>`
- Mod:
  - `POST /api/mod/spotlight?code=<sessionCode>`（spotlight ids + updatedBy）

---

（更新メモ）

- 2025-12-15 00:56Z: レビューで見つかった不具合（会場表示の `—`、reel の自動 prepare、スポットライト揮発+version、Admin/Mod 認証の cookie 化、UIの再参加導線）を修正するため、Progress/Context/Interfaces を現状に合わせて更新した。
- 2025-12-15 01:14Z: 実装が完了したため、Progress を完了状態に更新し、認証方式・スポットライト揮発化などの意思決定と、型チェック上の発見を追記した。
- 2025-12-15 02:51Z: ユーザー要求が「フル要件実装」に拡大したため、目的/進捗/手順/受け入れ条件をフル要件版に更新し、以後このExecPlanで実装を進める。
- 2025-12-15 03:50Z: D1/DO/WS の整合と Web UI（Invite/Admin/Mod/Display/Participant）を要件に追従させ、音響導線/統計表示/負荷スクリプト/テストを追加した。
- 2025-12-15 04:49Z: `newBingoIds` の秘匿、snapshot配信の計算最適化、WS再接続ジッター、`/api/dev/create-session` のローカル限定、webの型チェック修正を行った。
- 2025-12-15 08:01Z: UI/UX を見直し、共通 UI 部品化（Button/Input/Card 等）、Display のオーバーレイ自動非表示、Mod の誤操作低減（選択と下書き追加の分離）を反映した。
- 2025-12-15 11:46Z: 仕様修正（`W/A/S/D`=全桁GO、各桁ランダム自動停止、prepare必須）に合わせて、Progress/Decision/Interfaces/Acceptance を更新した。
- 2025-12-15 11:58Z: 上記仕様修正を実装に反映し、Admin 操作を `P` → `W/A/S/D`（GO）に簡略化、停止はサーバ側の自動停止（各桁ランダム）へ変更した。
- 2025-12-15 12:47Z: 音響（SE/BGM）の具体仕様（ファイル名/トリガー/ducking/7秒ループ/複数BINGO演出）を ExecPlan の Context/Acceptance/Decision に追記した。
- 2025-12-15 13:43Z: 参加者ページの情報量を削減しカードをファーストビューへ移動、Modページに全参加者カードのグリッド監視を追加した。
- 2025-12-15 14:39Z: イベント運用UXレビューに基づき、Adminのキー誤動作防止、会場表示の接続異常常時表示、Modの更新者名入力、WS状態文言の日本語化を反映した（prepare必須は維持）。
- 2025-12-15 14:44Z: 文字コードの要件に合わせ、UTF-8の妥当性チェックと `.editorconfig` を追加した。
- 2025-12-16 09:43Z: レビュー指摘（BingoCard が core 型と不整合）に対応し、Web 側のカード描画コンポーネントを修正した。
- 2025-12-16 09:51Z: `migrate:local` が Windows（cmd.exe）で `printf` 不在により失敗する問題を修正し、Worker の dev 起動時に D1 マイグレーションを自動適用するようにした。
- 2025-12-16 10:25Z: UIが黒地に黒文字になる事故を調査し、`pit-*` ユーティリティがCSSに生成されていないことを確認した。運用の安定性を優先して Participant/Display を neutral 系 UI へ戻す方針を追記した。
- 2025-12-16 10:30Z: Participant/Display の `pit-*` 依存を撤去し、既存の neutral 系 UI（日本語・共通UIプリミティブ）へ復帰させて視認性を回復した。
