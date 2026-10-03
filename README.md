# B787-9 Flight Simulator — Japan

ボーイング 787-9 で日本の実在空港を飛べる、ブラウザで動くフライトシミュレーターです。
インストール不要で、静的ファイルを配信するだけで動作します。

![構成](https://img.shields.io/badge/three.js-r170-blue) ![データ](https://img.shields.io/badge/data-GSI%20%2F%20OurAirports-green)

## 起動方法

ES モジュールを使うため、`file://` ではなく HTTP で開いてください。

```bash
# どれか
npm start                   # 本番用サーバー（http://localhost:8080）
python3 -m http.server 8000
npx http-server -p 8000
```

ブラウザで <http://localhost:8000/> を開き、メニューで出発・到着空港を選んで「フライト開始」を押します。
GitHub Pages など任意の静的ホスティングにそのまま置いても動作します。

## GitHub Pages で公開（GitHub Actions）

`.github/workflows/pages.yml` が、push のたびにテスト（ILS 自動着陸・全行程飛行）を実行し、成功すると GitHub Pages に公開します。

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする（初回のみ）
2. `main` に push（またはマージ）すると自動公開。**Actions** タブから手動実行（Run workflow）も可能
3. 公開 URL: `https://<ユーザー名>.github.io/flight-simulater/`

## Railway へのデプロイ（Web アプリとして公開）

このリポジトリは [Railway](https://railway.com/) にそのままデプロイできます（`package.json` / `server.js` / `railway.json` 同梱、依存パッケージなし）。

1. Railway にログインし **New Project → Deploy from GitHub repo** でこのリポジトリを選択
   （ブランチは `claude/b787-flight-simulator`、または main にマージ後の main）
2. 自動でビルド・起動します（`node server.js`、ヘルスチェック `/healthz`）
3. サービスの **Settings → Networking → Generate Domain** で公開 URL（`https://xxxx.up.railway.app`）を発行

CLI の場合:

```bash
npm i -g @railway/cli
railway login
railway init          # 新規プロジェクト作成
railway up            # このフォルダをデプロイ
railway domain        # 公開 URL を発行
```

ローカルで本番と同じサーバーを試す場合は `npm start`（http://localhost:8080）。

## アプリとしてインストール（PWA）

HTTPS で公開した URL を開くと、ホーム画面・デスクトップにアプリとして追加できます。

- **PC（Chrome / Edge）**: メニュー画面の「アプリとしてインストール」ボタン、またはアドレスバーのインストールアイコン
- **Android（Chrome）**: 「アプリとしてインストール」ボタン、またはメニュー → ホーム画面に追加
- **iPhone / iPad（Safari）**: 共有ボタン → ホーム画面に追加

インストール後は全画面・横向きで起動し、アプリ本体はオフラインでも起動します。
一度表示した地形・航空写真タイルは端末に最大 4,000 枚キャッシュされます（未取得の地域はオンラインが必要）。

## 再現している内容

| 分野 | 内容 |
| --- | --- |
| 飛行力学 | 6 自由度剛体モデル（240 Hz 積分）。揚力・抗力・横力と 3 軸モーメント、失速、地面効果、遷音速抗力、降着装置のオレオ（ばね・ダンパー）、タイヤ摩擦、尻もち・エンジン/翼端接地判定 |
| 機体諸元 | 787-9 の公開値（翼面積 360.5 m²、翼幅 60.12 m、MTOW 254 t、MLW 192.8 t、VMO 350 kt / MMO 0.90 など）。フラップ UP/1/5/15/17/18/20/25/30 とプラカード速度 |
| エンジン | GEnx-1B 相当。FADEC（レバー→N1）、スプール応答、推力定格 TO/TO1/TO2/CLB/CON/GA、EGT・N2・燃料流量、APU 電力による電動スタータ始動、逆推力 |
| 操縦則 (FBW) | 787 ノーマルモードの C*U 縦系（トリム基準速度による速度安定）、ロールレート指令・バンク保持、ヨーダンパー・旋回協調、TAC（推力非対称補償）、迎角・過速度・バンク角・ピッチ保護、DIRECT モード |
| 自動飛行 | A/P・F/D・A/T、TO/GA、LNAV、VNAV（SPD/PTH/ALT）、FLCH SPD、HDG SEL/HOLD、V/S、ALT/ALT*、LOC、G/S、LAND 3 オートランド（FLARE・IDLE リタード・ROLLOUT）、ゴーアラウンド、FMA 表示 |
| FMC / CDU | 経路自動生成（実在 VOR 経由）、DIRECT TO、ウェイポイント挿入/削除、高度・速度制限、T/D 計算、V1/VR/V2・VREF 計算、スタビライザートリム、推力定格選択 |
| 表示装置 | PFD（速度/高度テープ、V スピード、バーバーポール、FD、FPV、ILS 偏位、電波高度、FMA）、ND（MAP、経路、空港、VOR、風、T/D、高度到達アーク、EGPWS 地形表示）、EICAS（N1/EGT/N2/FF、警報、ギア、フラップ、燃料）、HUD |
| システム | 電源（バッテリー/APU/発電機/外部電源）、燃料タンク（中央優先消費）、油圧、外部灯火、オートブレーキ（RTO/1〜4/MAX）、スピードブレーキ自動展開、離陸・着陸形態警報、マスターワーニング/コーション |
| GPWS | Mode 1〜5（SINK RATE / PULL UP / TERRAIN / DON'T SINK / TOO LOW GEAR・FLAPS / GLIDESLOPE）、BANK ANGLE、高度コールアウト（2500〜10 ft）、MINIMUMS、V1 |
| 景観 | 国土地理院の標高タイルと全国シームレス空中写真による実地形、地球の曲率、時刻に応じた太陽位置と空の色、夜間の街明かり、雲層、視程、霧 |
| 空港 | OurAirports の実在滑走路座標・標高・方位から、滑走路標識、滑走路灯、中心線灯（終端の赤/白）、接地帯灯、進入灯（連鎖式閃光灯）、PAPI を生成 |
| 気象 | 風向風速・突風・乱気流、気温（ISA 偏差）、QNH、視程、雲量・雲底 |
| その他 | 着陸評価（降下率・接地位置・中心線ずれ）、操縦席/追従/主翼/フライバイ/タワー視点、ゲームパッド・ジョイスティック、音響（エンジン・風切り・警報音・音声コールアウト）、仮想機長による全自動デモ飛行 |

## チュートリアル（初心者向け）

メニュー上部の「チュートリアル」から 5 つのレッスンを選べます。手順が 1 つずつ表示され、該当するスイッチや計器が光ります。操作できると自動で次の手順に進みます。

| # | レッスン | 内容 |
| --- | --- | --- |
| 1 | 画面の見方 | 3D 視界・PFD・ND・EICAS・MCP・ペデスタルの役割 |
| 2 | はじめての離陸 | ブレーキ解除 → TO/GA → VR でローテーション → ギアアップ → オートパイロット → フラップ格納 |
| 3 | 自動操縦の使い方 | HDG SEL で旋回、LNAV へ復帰、V/S で降下して高度捕捉 |
| 4 | ILS 自動着陸 | LOC/G/S、LAND 3、自動着陸、逆推力、停止 |
| 5 | 手動で着陸 | フライトディレクターに沿った手動進入、フレア、接地後の操作 |

ローテーションとフレアの手順中は 0.5〜0.7 倍のスロー再生になります。完了したレッスンには ✔ が付きます（ブラウザに保存）。
`node tests/tutorial.mjs` で、全レッスンを手順どおりに完走できることを自動検証しています（GitHub Actions でも実行）。

## 操作

メニューまたはフライト中に **F1** で一覧を表示します。主なキー:

- 操縦: `↑↓←→`、ラダー `Z/X`、推力 `PageUp/PageDown`（`+/-`）、アイドル `I`、逆推力 `R` 長押し
- 形態: フラップ `F`/`Shift+F`、ギア `G`、スピードブレーキ `/`、パーキングブレーキ `P`、ブレーキ `B`
- 自動飛行: A/P `A`、A/T `Shift+A`、TO/GA `T`、HDG SEL/LNAV/VNAV/FLCH/APP `Ctrl+H/L/V/F/P`
- 表示: 視点 `1〜5` / `V`、HUD `U`、パネル非表示 `Tab`、CDU `C`、オーバーヘッド `O`、チェックリスト `K`

### スマートフォン

画面幅の小さい端末では、外部視界を全画面にしたスマホ用レイアウトに自動で切り替わります（PC で試すときは URL に `?mobile` を付けます）。横向きがおすすめです。

- 左下: 操縦桿（ドラッグ。地上ではラダー／前輪操向も兼ねる）
- 右端: 推力レバー（上下にドラッグ）、`REV` 長押しで逆推力、`BRAKE` 長押しでブレーキ
- 下段: ギア、フラップ `F−`/`F＋`、スピードブレーキ、パーキングブレーキ
- 上段: メニュー、一時停止、視点、`計器`（PFD・ND の表示切替）、`MCP`（オートパイロット操作パネル）、`…`（CDU・オーバーヘッドなど）、A/P・A/T・TO/GA（縦向きでは右列）
- 縦向きでは画面下部に PFD・ND が並びます

### はじめての離陸（滑走路上スタート）
1. `P` でパーキングブレーキ解除
2. `PageUp` で推力を 40% 程度まで上げ、`T`（TO/GA）で離陸推力
3. PFD の `VR` で `↓` を引いてピッチ 15° 付近まで起こし、FD（マゼンタのバー）に合わせる
4. 上昇を確認したら `G` でギアアップ、高度 200 ft 以上で `A` でオートパイロット
5. LNAV / VNAV がアームされているので、FMC の経路と高度で自動的に飛行します

### 着陸
到着側では CDU の APPROACH ページで VREF を確認し、`Ctrl+P`（APP）で ILS をアーム。
フラップを速度に合わせて展開、ギアダウン、スピードブレーキ ARM、オートブレーキを設定すれば
LAND 3 で自動着陸します。手動の場合は 30〜50 ft でフレアし、接地後に `R` で逆推力。

## ファイル構成

```
index.html              画面レイアウト
server.js               本番配信サーバー（Railway 用、依存なし）
railway.json            Railway 設定
manifest.webmanifest, sw.js, icons/   PWA（インストール・オフライン対応）
css/style.css
js/main.js              メインループ・UI 統合
js/sim/                 シミュレーション本体（DOM 非依存。Node.js でも実行可能）
  aircraft-787.js         機体諸元・空力係数
  fdm.js                  6 自由度飛行力学
  fbw.js                  フライ・バイ・ワイヤ操縦則
  engines.js              エンジン
  autoflight.js           AFDS（A/P・F/D・A/T）
  fmc.js / navigation.js  FMC・航法・ILS
  systems.js / gpws.js    機体システム・警報・GPWS
  elevation.js            標高（DEM＋滑走路平坦化）
  simulation.js           統合・初期配置
  copilot.js              自動操縦デモの仮想機長
js/render/              three.js による 3D 描画（地形・空港・機体・空）
js/ui/                  PFD / ND / EICAS / HUD / MCP / CDU / オーバーヘッド / メニュー
js/audio/               音響
js/data/                空港・航法施設データ（tools/build-data.mjs で生成）
tests/                  ヘッドレス飛行テスト
vendor/three.module.min.js
```

## テスト

シミュレーション部分は DOM に依存しないため、Node.js で丸ごと飛行させて検証できます。

```bash
# 羽田 34R → 関西 24L を離陸から自動着陸・停止まで（仮想機長が操縦）
node tests/full-flight.mjs RJTT 34R RJBB 24L runway
# コールド＆ダーク（APU・エンジン始動から）、風 160°/12kt
node tests/full-flight.mjs RJCC 19R RJTT 34L cold 160/12
# ILS 自動着陸のみ（風向/風速を指定可）
node tests/flare.mjs RJFF 34R 260/25
```

## データの出典

- 地形・航空写真: [国土地理院 地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（標高タイル DEM、全国最新写真（シームレス））
  — 利用時は「出典：国土地理院」を明示してください。
- 空港・滑走路・航法施設: [OurAirports](https://ourairports.com/data/)（Public Domain）。`node tools/build-data.mjs` で再生成できます。
- 3D 描画: [three.js](https://threejs.org/)（MIT License、`vendor/` に同梱）

## 実機との違い（必ずお読みください）

- 空力・エンジン・システムの数値は、公開資料と一般的な航空工学の推定に基づく近似です。
  訓練用フライトシミュレーター（FAA/JCAB Level D 等）の認定に使われるボーイング社の非公開データパッケージは含まれていません。
- ILS の周波数・SID/STAR・計器進入方式は実際の航空路誌（AIP）のデータではなく、滑走路データから模擬的に生成しています（3° グライドパス）。
- 管制・他機・誘導路（タキシー経路）はありません。
- 機体の塗装は特定の航空会社のものではない汎用カラーです。

**本ソフトウェアは娯楽・学習用です。実際の航空機の操縦訓練や運航には使用できません。**
