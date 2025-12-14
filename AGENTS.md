# ExecPlans

When work is more than a trivial typo or single-file touch-up, author or update an ExecPlan exactly as .agent/PLANS.md prescribes before changing code. ExecPlans must stay self-contained and be revised at every major discovery.

## Primary Directive
- Think in English, interact with the user in Japanese.
- 毎セッション開始時に AGENTS.md と .agent/PLANS.md を全読し、最新ルールを記憶してから作業を始めること。

# 推測禁止の原則
実体的な調査を伴わない，推測のみでの実装はすべてペナルティとなる
仮定・検証をしてから実装せよ

# AGENTS.md — 200人規模 電子ビンゴ（Cloudflare基盤）

## 定義

### 目的

会場イベント向けに **最大200人程度**まで運用できる「電子ビンゴ」システムを実装する。
演出は後から詰められるようにしつつ、まずは **確実に動くこと**、および **視認性・UX** を最優先とする。

### 前提（運用・画面構成）

* 参加者：スマホで参加URLを開き、表示名を入力してビンゴカードを受け取り、抽選を閲覧する。
* 会場モニター：**2枚**。

  * 左モニター：当選番号の **十の位リール**
  * 右モニター：当選番号の **一の位リール**
    いずれもスロットのリールのように「回転 → 停止」で数字を表現する。
* モニターはPCの外付けモニター扱い（= ブラウザで表示ページを全画面表示して運用）。
* Adminパネル：制御用ラップトップのブラウザで操作。**音響（SEなど）はすべてAdminから出す**。
* Modパネル：MC/運営が見る画面。複数Mod同時接続を前提。

  * 各参加者の進捗を見てマイクパフォーマンスしやすくする
  * **スポットライト（最大6人）**を選んで会場表示に反映する
* ビンゴの扱い：

  * 同着あり、順位なし、明確な終了/優勝は作らない
  * ビンゴ達成者も **以後も抽選に参加し続ける**
* 抽選：

  * **毎回1番号のみ**確定する
  * Adminはセッション中キーボード受付が必須

    * `P`：事前抽選（次の当選番号を決定し、到達者/統計を先に計算する “prepare”）
    * `W/A/S/D`：抽選（リール回転開始→停止→確定）
  * **prepare結果（次の当選番号）はMod/参加者に見せない**（Adminのみ）

### 認証・整合性・永続化

* 認証：AdminがUUID付きURLを発行して配布（Slack/DiscordのDMグループ想定）
* スポットライト：**Last-write-wins**、かつ **揮発**（セッション終了後に保持不要。原則永続化しない）
* 永続化：**commitログ中心**（抽選確定の履歴が主）

---

## 要点

### 最重要の成功条件（MVPの合格ライン）

1. **参加登録→カード配布→抽選反映→ビンゴ到達判定**が安定して動く
2. Adminの `P`（prepare）→ `W/A/S/D`（go）で、会場モニター2枚が期待通りに動く
3. Modが参加者進捗を俯瞰でき、スポットライト最大6人を会場表示に反映できる（複数Mod同時OK）
4. 回線が揺れても復帰できる（再接続・再描画・状態同期が成立する）
5. 視認性：会場表示の数字は遠距離でも読める（大きい、コントラスト、余計なUIなし）

### 技術基盤（Qiita記事の方向性に寄せる）

Cloudflare上で完結する構成（Workers / Durable Objects / D1中心）。
WebSocketでリアルタイム配信し、セッション単位の状態はDurable Objectsで集約する。

推奨構成：

* **Cloudflare Workers（TypeScript）**
* **Durable Objects**：セッション単位のリアルタイム状態/配信ハブ

  * WebSocketは **Hibernation API** を使う（コストと安定性の観点）
* **Cloudflare D1（SQLite）**：永続化（commitログ中心＋参加者カード）
* **Hono**：Workers上のHTTPルーティング
* **Drizzle ORM**：D1スキーマ管理/クエリ
* フロント：React + Vite + Tailwind（表示・操作・レスポンシブ最優先。コンポーネントは軽量に）

### 画面（ページ）要件

必須ページ：

* 参加者ページ：`/s/:code`（登録・カード表示）
* 会場表示（左）：`/s/:code/display/ten`
* 会場表示（右）：`/s/:code/display/one`
* Admin：`/s/:code/admin`
* Mod：`/s/:code/mod`

共通：

* WebSocket接続状態をUIに表示（Connected / Reconnecting / Offline）
* 再接続時に「スナップショット」同期（現在の抽選履歴と参加者状態の再構築）

### 会場表示（案B：左右分割 + 統計優先）

* スポットライト最大6人を **左3 / 右3**で分割表示

  * 左（十の位）：`spotlight[0..2]`
  * 右（一の位）：`spotlight[3..5]`
* 各モニターのレイアウトは「中央＝リール」「外側＝スポットライト」「内側＝統計」
* スポットライト枠が埋まらない場合（<3人）は **空きを統計（詳細）で埋める**（統計優先）
* 参加者は全員立つ想定のため、「片側しか見えない対策」は不要

---

## 比較（設計判断の固定）

### リアルタイム配信方式

* SSE/Long Polling：実装は可能だが双方向操作（prepare/go/spotlight）との整合が面倒
* WebSocket：状態配信・双方向操作が最も単純
  → **WebSocket採用**（Durable Objectsをハブにする）

### セッション状態の集約

* Worker単体：状態が持てず、同時接続の整合が難しい
* Durable Objects：セッションの単一調停点を作れる
  → **セッションごとにDOを1つ**

### 永続化モデル

* 参加者の全進捗を毎回DBに書く：D1の特性上コスト増になりがち
* commitログ中心＋再計算：抽選履歴から状態を復元できる
  → **commitログ中心**（ただし参加者の「カード配布」は復元に必要なので保存する）

### スポットライト（複数Mod）

* 排他制御：実装重い・運用も煩雑
* LWW：単純で壊れにくい
  → **Last-write-wins + 最終更新者/時刻を表示**で運用事故を低減

---

## 具体例（実装指示）

### 1) セッションとDOの対応

* `sessionCode`（短い英数字）で参加者が入る
* Workerは `sessionCode -> sessionId` を引き当て、`SessionDO(sessionId)` にルーティング
* DOは以下を担当：

  * WebSocket接続管理（参加者/Admin/Mod/Display）
  * 抽選ステートマシン（idle/prepared/spinning）
  * カード配布、進捗計算、統計算出
  * スポットライト状態（揮発）
  * 各クライアントへ差分/スナップショット配信

DOのWebSocketはHibernation APIを使うこと：

* `this.ctx.acceptWebSocket(server)` を使用
* `serializeAttachment()/deserializeAttachment()` で接続メタを復元する
* constructorは極力軽くし、重い復元は遅延ロードにする

### 2) D1スキーマ（最低限）

**sessions**

* `id TEXT PRIMARY KEY`
* `code TEXT UNIQUE NOT NULL`
* `status TEXT NOT NULL`（`active` / `ended`）
* `created_at TEXT NOT NULL`
* `ended_at TEXT`

**invites**

* `token TEXT PRIMARY KEY`
* `session_id TEXT NOT NULL`
* `role TEXT NOT NULL`（`admin` / `mod`）
* `created_at TEXT NOT NULL`
* （オプション）`label TEXT`（“MC用”“サブMC用”など）

**participants**

* `id TEXT PRIMARY KEY`
* `session_id TEXT NOT NULL`
* `display_name TEXT NOT NULL`
* `card_json TEXT NOT NULL`（25マス+FREEを含む構造をJSONで保存）
* `created_at TEXT NOT NULL`

**draw_commits**（commitログ中心）

* `session_id TEXT NOT NULL`
* `seq INTEGER NOT NULL`
* `number INTEGER NOT NULL`（1..75）
* `committed_at TEXT NOT NULL`
* PRIMARY KEY(`session_id`,`seq`)
* UNIQUE(`session_id`,`number`)（同じ番号を2回引かない）

（任意だが推奨）commit時点の統計スナップを保存：

* `reach_count INTEGER`
* `bingo_count INTEGER`
* `new_bingo_count INTEGER`

> 注：D1は単一DB内でクエリが直列化される前提で、書き込み頻度を抑える設計にする（commitと参加登録以外は原則書かない）。

### 3) ビンゴカード生成（75-ball）

* 5x5（中央FREE）
* 列ごとのレンジ（標準的な75-ball）

  * B：1–15
  * I：16–30
  * N：31–45（中央FREE）
  * G：46–60
  * O：61–75
* 各列は重複なしで5つ抽出（N列はFREE分を考慮して4つ+FREE）

カード表現（例）：

```ts
type BingoCell =
  | { kind: "num"; value: number }
  | { kind: "free" };

type BingoCard = {
  // 5x5 row-major
  cells: BingoCell[]; // length 25
  // 1..75 → bit index (or -1 if not present)
  numToBit: Record<number, number | null>;
};
```

### 4) ライン判定（到達/リーチ）

* 対象ライン：横5 + 縦5 + 斜め2 = **12ライン**
* 1ラインが揃ったら「ビンゴ達成」扱い

  * 達成者も抽選参加は継続（以後のライン増加は無視しても良いが、表示に使うならカウントしてOK）
* リーチ：あと1マスで揃うラインが1本以上ある状態

参加者メトリクス（Mod/統計用）：

* `bingoLines`：揃っているライン数
* `reachLines`：あと1で揃うライン数
* `minMissingToLine`：どのラインでも良いので揃えるのに必要な最小未達数（0=既にビンゴ）

### 5) 抽選ステートマシン（Admin操作）

状態：

* `idle`：次が未準備
* `prepared`：次番号と、その番号を引いた場合の統計プレビューが計算済み（Adminのみ閲覧可能）
* `spinning`：表示が回っている最中（確定前）

キー操作：

* `P`（prepare）

  * 未出の番号から1つ選ぶ（ランダム/任意の両対応。まずはランダムでOK）
  * その番号を仮適用した場合の統計（reach/bingo/newBingo等）を計算
  * Admin画面に「次番号」「プレビュー統計」を表示
  * **Mod/参加者/会場表示には次番号を送らない**
* `W/A/S/D`（go）

  * `prepared` があればそれを採用して演出開始
  * `idle` なら内部で `prepare` して即 `go`（運用事故を減らす）
  * DOは Displayへ「回転開始」→「停止（確定数字）」を送る
  * 停止タイミングで commit を確定し、D1へ `draw_commits` を追記
  * commit後、全クライアントへ状態更新を配信

安全装置（必須）：

* 連打や二重送信を防ぐ：`spinning` 中は `prepare/go` を無効化
* Admin UIに「現在状態（idle/prepared/spinning）」と「次に押すべきキー」を表示

### 6) WebSocketプロトコル（最小）

接続種別（client -> server hello）：

* `participant`：`{ type:"hello", role:"participant", participantId?:string, displayName?:string }`
* `admin`：`{ type:"hello", role:"admin" }`（Cookieにrole token）
* `mod`：`{ type:"hello", role:"mod" }`
* `display`：`{ type:"hello", role:"display", which:"ten"|"one" }`

サーバー→クライアント（必須）：

* `snapshot`：現在の完全状態（draw履歴、統計、スポットライト、参加者メタ（mod/adminのみ）、表示に必要なもの）
* `draw.prepared`：Adminのみに送る（次番号とプレビュー統計）
* `draw.spin`：displayに送る（回転開始、停止までのms、停止数字の各桁）
* `draw.committed`：全員に送る（確定番号、seq、更新統計、必要ならnewBingoリスト（mod/adminのみ））
* `spotlight.changed`：display/mod/admin（LWWのversion付き）

クライアント→サーバー（必須）：

* `admin.prepare`（P相当）
* `admin.go`（WASD相当）
* `mod.setSpotlight`（最大6人）
* （任意）`ping`（クライアントkeepalive。DO側はauto-responseで処理し、極力wakeさせない）

### 7) スポットライト（揮発・6人・左右分割）

* DOメモリ内に保持（永続化しない）
* `players: Array<{ participantId, displayName, metricsSummary }>` 最大6
* 表示分割（固定）：

  * 左（ten）：先頭3
  * 右（one）：後半3
* 空き枠：統計詳細で埋める（統計優先）
* 競合：LWW

  * `spotlightVersion` を単調増加し、クライアントは最新versionのみ採用

### 8) 会場表示（UX最優先で最低限）

* “リール”はまず **安定して止まる**ことを最優先

  * 例：回転中は0-9を高速切替 → stopタイミングで確定数字を固定表示
* 大フォント + 高コントラスト + 余計なUI排除
* 全画面化のボタンを用意（ブラウザ制約によりユーザー操作で全画面に入る必要があるため）
* 内側（モニター間側）に統計コア、外側にスポットライト3枠（不足時は統計詳細）

統計（最低限コア）：

* `drawCount`（何回引いたか / 75）
* `reachPlayers`（リーチ者数）
* `bingoPlayers`（ビンゴ達成者数）
* `lastNumbers`（直近N件）

統計（詳細：空きに出す候補）：

* `minMissingHistogram`（0/1/2/3+）
* `nextNumberImpactTop`（次に引くとビンゴが増える候補上位）※“予測”として扱い、確率ではなく影響人数を出す

### 9) Mod画面（複数人・司会補助）

* 参加者一覧（ソート/検索）

  * ソート初期：`minMissingToLine asc`, `reachLines desc`, `displayName`
* 参加者詳細（簡易カード）

  * 名前
  * `BINGO済` バッジ
  * `minMissingToLine`, `reachLines`
  * （任意）“刺さり候補番号”（その人が次に伸びる候補を数個）
* スポットライト編集（最大6）

  * “下書き → 送信”の2段階（触った瞬間反映しない）
  * 送信時に `mod.setSpotlight`
* 競合が分かるように「最終更新者・時刻（相対）」を常時表示

### 10) Admin画面（全情報所管 + 音響）

* すべての情報（全参加者、統計、commitログ、内部状態）を閲覧できる
* prepare結果（次番号）はAdminのみ閲覧可
* 音響（SE）はAdminのみ

  * ブラウザの自動再生制限があるため、**最初に “音を有効化” ボタンを押す導線**を必ず用意
* 入力：

  * キーボード（P / WASD）を最優先
  * 予備として画面上にもボタン（Prepare / Go）を置く
* セッション終了（end）ボタン：

  * end後は招待トークンも含め全操作無効化（「セッションが終わったら関係ない」をシステムで担保）

### 11) 招待URL（Slack/Discord配布前提の安全策）

Slack/DiscordはリンクプレビューのためにURLへ事前アクセスし得る。
そのため、招待URLは **GETで副作用を起こさない**こと。

推奨フロー：

* 招待URL（GET）：説明ページを表示するだけ（Cookie付与しない）
* “入室” ボタン（POST）：ここでCookie付与して `/admin` or `/mod` に遷移

### 12) 開発・テスト（必須）

* 単体テスト：

  * カード生成がレンジ・重複なしを満たす
  * ライン判定（12ライン）と reach/bingo の計算
  * “引いた番号列”から状態を復元できること（commitログ中心の要）
* 負荷確認（最低限）：

  * ローカルで疑似クライアント（WS接続）を増やして broadcast が破綻しないこと（200程度）
* 重要な運用注意：

  * デプロイ更新はWS切断になり得るので、イベント中は原則デプロイしない（やむを得ない場合は再接続で復帰できること）

### 13) 実装順（推奨）

1. D1 schema + migration
2. Session作成スクリプト（session code + 初期admin/mod token出力）
3. Worker routing（静的アセット配信 + API + WS upgrade → DO）
4. SessionDO（WS管理 + snapshot + commitログから復元）
5. 参加者ページ（登録→カード表示→WSで更新）
6. Display（ten/one）ページ（リール最小実装 + 統計コア + スポットライト3枠 + 全画面ボタン）
7. Adminページ（P/GO/音響有効化）
8. Modページ（参加者一覧 + スポットライト編集 + LWW表示）
9. テスト/負荷確認/運用ドキュメント（当日手順）

---

## 検証済みの技術前提（本AGENTSの根拠）

* Durable ObjectsはWebSocketサーバーとして利用でき、**1インスタンスで多数クライアント接続**が想定されており、さらに **Hibernation API（`acceptWebSocket`）が推奨**される。
* D1は各DBが **単一スレッドでクエリを直列処理**するため、書き込み頻度を抑えた設計が望ましい。
* Workersのアカウントプランで **Workerサイズ上限（Free 3MB / Paid 10MB）**があるため、フロント資産・依存を肥大化させない。
* 75-ballビンゴカードの列レンジ（B:1–15, I:16–30, N:31–45, G:46–60, O:61–75、中央FREE）は一般的な仕様として確認済み。
* Slackはリンクプレビューのためにリンクをクロールし得るため、招待URLのGETで副作用を起こさない設計が安全。
* ブラウザは音声自動再生を制限するため、Adminで音を出すにはユーザー操作で“音を有効化”する導線が必要。
