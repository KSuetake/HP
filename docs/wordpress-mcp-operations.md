# STK Lab - WordPress MCP / REST API 運用ガイド (`docs/wordpress-mcp-operations.md`)

> **知恵と技術で記事運用を加速する：Markdown原稿から安全・迅速なドラフト下書き登録基盤へ**

本ドキュメントは、STK Lab (`https://stk-lab.org/`) における記事執筆・更新運用の効率化を目的とし、WordPress REST API および MCP (Model Context Protocol) を活用した**「安全なドラフト（下書き）運用基盤」**の利用手順、機能スコープ、安全ガードレール、およびトラブルシューティングを定義する運用ガイドラインである。

---

## 1. 背景と目的 (Background & Purpose)

従来、STK Lab の記事執筆は、リポジトリ内（`articles/`）で作成した Markdown 原稿から WordPress 管理画面へ手作業でコピペ・ブロック整形を行っていた。
この運用には以下の課題が存在していた：
1. **手作業工数の増大**: 本文の貼り付け、見出しタグの再設定、Cocoon装飾の適用、画像アップロード・アイキャッチ設定など、手作業ステップが多い。
2. **誤公開リスク**: 管理画面での操作ミスにより、推敲中の記事や未完成の原稿が意図せず本番公開されてしまうリスク。

これらを解消するため、**「API経由では常に下書き（Draft）としてのみ登録し、公開は人間が管理画面で最終確認して手動で行う」**という絶対原則のもと、安全かつ迅速なドラフト登録基盤を導入する。

---

## 2. 安全運用ポリシー・ガードレール (Safety Guardrails)

運用の安全性とサイトの信頼性を確保するため、以下のガードレールを厳格に適用する。

> [!CAUTION]
> ### 🛡️ ドラフト強制ルール (Draft-Only Principle)
> - **API/MCP経由での即時公開（`status: publish`）を固く禁ずる。**
> - すべての自動登録・スクリプト・AIエージェントによる記事作成・更新は、**必ず `status: "draft"`（下書き）** として送信しなければならない。
> - 最終的な公開（Publish）は、人間が WordPress 管理画面上でプレビュー（PC／スマホ表示、Cocoon装飾、アイキャッチ、リンク等）を目視確認した上で、手動で公開ボタンを押下する運用とする。

### 🔑 認証情報の保護方針 (Credential Protection)
- **Git管理外の徹底**:
  - WordPress アプリケーションパスワードやユーザー名は、いかなる場合も Git リポジトリへコミットしてはならない。
  - リポジトリルートの `.env` ファイルに記述し、`.gitignore` で確実に除外する。
  - リポジトリ内には設定テンプレートとして `scripts/.env.example` のみを配置する。
- **最小権限の原則**:
  - アプリケーションパスワードを発行するユーザーアカウントは、運用に必要な権限（「投稿者（Contributor）」または「編集者（Editor）」）に留め、不必要な管理者権限の外部利用は控える。

---

## 3. 前提条件と初期セットアップ手順 (Onboarding Guide)

### Step 1: WordPress 管理画面でのアプリケーションパスワード発行
1. WordPress 管理画面にログインする。
2. 左メニュー「**ユーザー**」 > 「**プロフィール**」を開く。
3. ページ下部の「**アプリケーションパスワード**」セクションへスクロールする。
4. 「新しいアプリケーションパスワード名」に用途が識別できる名称（例: `antigravity-mcp` や `hp-draft-poster`）を入力する。
5. 「**新しいアプリケーションパスワードを追加**」ボタンをクリックする。
6. 発行されたパスワード（例: `xxxx xxxx xxxx xxxx xxxx xxxx`）をコピーし、安全なパスワードマネージャー等に一時保管する（画面を離れると二度と表示されません）。

### Step 2: Xserver 側セキュリティ設定の確認・対処
STK Lab が稼働する Xserver では、初期状態でセキュリティ制限が有効になっている場合がある。
API 接続時に `403 Forbidden` が発生した場合は、以下の手順で設定を確認する：
1. **Xserver サーバーパネル** にログインする。
2. 「**WordPress セキュリティ設定**」を開く。
3. 対象ドメイン（`stk-lab.org`）を選択する。
4. 「**REST API アクセス制限**」の設定を確認する：
   - 「ON（制限中）」になっている場合、外部からの REST API 呼び出しが拒否される。
   - API連携を行う期間は「**OFF（無効）**」にするか、アクセス元IPの許可設定を検討する。
5. 「**WAF設定**」を確認する：
   - POST リクエスト本文に含まれる HTML タグやスクリプトが WAF のシグネチャ（XSS / SQLインジェクション誤検知）に抵触して遮断されていないか、アクセスログを確認する。

### Step 3: ローカル環境での設定 (`.env`)
リポジトリルートに `.env` を作成し、接続情報を設定する：

```bash
# テンプレートからコピー
cp scripts/.env.example .env
```

`.env` の内容を編集：
```ini
WP_SITE_URL=https://stk-lab.org
WP_USERNAME=<your_wordpress_username>
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

### Step 4: WordPress 公式プラグイン「WordPress MCP Adapter」のインストール・有効化
公式 MCP サーバーを利用するためには、WordPress サイト側に公式プラグイン「[WordPress/mcp-adapter](https://github.com/WordPress/mcp-adapter)」をインストール・有効化する必要があります。

1. **プラグイン ZIP の入手**:
   - [WordPress/mcp-adapter GitHub Releases](https://github.com/WordPress/mcp-adapter/releases/latest) より最新の `mcp-adapter.zip` をダウンロードします。
2. **WordPress 管理画面からアップロード・有効化**:
   - WordPress 管理画面にログインし、左メニュー「**プラグイン**」 > 「**新規プラグインを追加**」を開く。
   - 画面上部の「**プラグインのアップロード**」ボタンをクリック。
   - ダウンロードした `mcp-adapter.zip` を選択し、「**今すぐインストール**」をクリック。
   - インストール完了後、「**プラグインを有効化**」をクリック。
3. **エンドポイントの確認**:
   - プラグインが有効化されると、自動的に `/wp-json/mcp/mcp-adapter-default-server` エンドポイントが公開され、AI アシスタントからの MCP 接続が可能になります。

### Step 5: MCP クライアント（Claude / Antigravity / Cursor 等）の公式 MCP 設定
AI アシスタント（Claude Desktop、Antigravity、Cursor 等）の設定ファイル（例: `claude_desktop_config.json` や `mcp_config.json`）に以下を登録します。

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://stk-lab.org/wp-json/mcp/mcp-adapter-default-server",
        "WP_API_USERNAME": "<your_wordpress_username>",
        "WP_API_PASSWORD": "<your_application_password>",
        "OAUTH_ENABLED": "false"
      }
    }
  }
}
```

> [!NOTE]
> Windows 環境で `npx` コマンドが PowerShell 実行ポリシーによりブロックされる場合は、`"command": "npx.cmd"` と指定してください。

---

## 4. 機能スコープ（できること・できないこと一覧）

WordPress REST API / MCP 連携における対応可能範囲と制約を以下のマトリクスに整理する。

| 操作カテゴリ | 具体的な操作内容 | API / MCP 対応可否 | 運用手段・推奨アプローチ |
| :--- | :--- | :---: | :--- |
| **記事基本情報** | タイトル、パーマリンク（スラッグ）設定 | ✅ **可能** | API経由で自動設定 |
| | 抜粋（Excerpt）の設定 | ✅ **可能** | API経由で自動設定 |
| | 投稿ステータス（下書き / draft） | ✅ **可能** | **常に `draft` で登録** |
| | 投稿ステータス（即時公開 / publish） | ❌ **運用禁止** | **管理画面での手動公開に限定** |
| **分類・タクソノミー** | カテゴリーの設定（ID指定） | ✅ **可能** | API経由で設定（事前定義IDを使用） |
| | タグの設定（タグ名またはID） | ✅ **可能** | API経由で自動紐付け |
| **本文・コンテンツ** | 見出し（h2, h3, h4）、段落、引用、リスト | ✅ **可能** | Markdown → HTML 変換で登録 |
| | コードブロック、テーブル（表） | ✅ **可能** | 横スクロール＋ストライプ表として自動変換 |
| | Cocoon 特有装飾（吹き出し、案内ボックス、ボタン） | ✅ **可能** | **ハイブリッド記法（GFM Alerts + ミニマルコンテナ）** で完全自動変換 |
| **メディア** | アイキャッチ画像（Featured Image）の登録 | ✅ **可能** | メディアAPIで画像アップロード → 取得IDを記事へ紐付け |
| | 本文中への挿入画像 | ✅ **可能** | メディアAPIでアップロード → 本文HTMLの `<img>` にURLを埋め込み |
| **Cocoon 専用GUI** | 投稿個別設定（サイドバー非表示、目次非表示など） | ❌ **不可 / 困難** | テーマ独自メタフィールド。管理画面で手動設定 |
| | アフィリエイトタグ・ブログカード等の専用GUI操作 | ⚠️ **部分対応** | 汎用ショートコードまたはHTMLリンクで代替し、管理画面で微調整 |
| **サイト全体管理** | テーマ設定（Cocoon設定・スキン変更） | ❌ **不可** | 管理画面 > Cocoon設定から手動変更 |
| | 子テーマ CSS (`style.css`) の編集 | ❌ **不可** | 外観 > テーマファイルエディター、または SSH / SFTP を利用 |
| | プラグインのインストール・有効化 | ⚠️ **非推奨** | サイト破壊防止のため管理画面から手動実施 |


---

## 4.1 ハイブリッド記法（GFM Alerts + ミニマルコンテナ）仕様

Markdown原稿の可読性・レビュー体験（GitHub / VSCodeでの美しいプレビュー）と、WordPress（Cocoon）への完全自動装飾を両立する標準構文仕様です。

### 1. ボックス装飾（GitHub Flavored Markdown Alerts）
原稿執筆・PRレビュー時にGitHub上で自然なカラー枠として表示され、API投稿時にCocoon専用ボックスへ自動置換されます。

```markdown
> [!NOTE]
> **任意の太字タイトル**
> 補足・案内テキスト（Cocoon青ボックス: info-box）

> [!TIP]
> **今日からできるステップ**
> おすすめ・ヒントテキスト（Cocoon緑ボックス: success-box）

> [!WARNING]
> **注意点**
> 注意喚起テキスト（Cocoon黄ボックス: warning-box）

> [!IMPORTANT]
> **重要な計算式**
> 重要・必須テキスト（Cocoon赤ボックス: danger-box）
```

### 2. 吹き出し・ボタン（ミニマルコンテナ `:::`）
Markdownの地の文を邪魔せず、1行で装飾意図を宣言します。

```markdown
::: balloon reader
「情報が多すぎて選べない……どうすればいい？」
:::

::: balloon author
まずは4つのモノサシで優先順位を決めてみましょう！
:::

::: btn https://stk-lab.org
公式サイトで詳細をチェックする
:::
```

* **吹き出し**: `reader`（左配置・読者）、`author`（右配置・筆者）、または任意の名前を指定可能。Cocoonの吹き出し（`speech-wrap`）へ自動変換。
* **ボタン**: 中央揃えのWordPress標準ボタンブロックへ自動変換。

### 3. 画像＆アイキャッチの自動連携
* **アイキャッチ**: 記事Frontmatter（`eyecatch: images/eyecatch.png`）または同ディレクトリ内の `images/eyecatch.png` を自動検出し、WordPressメディアライブラリへ自動アップロードしてアイキャッチ（`featured_media`）に紐付けます。
* **本文画像**: `![alt](images/sample.png)` と書くだけで、ローカル画像を自動アップロードしてWordPress内URLとメディアIDに差し替えます。

---

## 5. 日常の記事投稿ワークフロー (Daily Workflow)

記事作成から公開までの標準フローは以下の通り進行する。

```
[Phase 1: 執筆・推敲]
  articles/<slug>/article.md を執筆
  画像アセットを articles/<slug>/images/ に配置
         ▼
[Phase 2: 独立監査]
  blog-assistant の二重監査（アウトライン整合性・ファクトチェック）をパス
         ▼
[Phase 3: ドラフト下書き登録]
  スクリプトまたは MCP を実行し、WordPress に下書き記事を送信
         ▼
[Phase 4: 管理画面での最終確認]
  ブラウザで WordPress 管理画面のプレビューを開き、以下を目視点検：
  - タイトル・パーマリンク・カテゴリーが正しいか
  - アイキャッチ画像が綺麗に設定されているか
  - Cocoon 装飾（吹き出し・ボックス・リスト）が崩れていないか
  - スマホ表示（レスポンシブ）で崩れがないか
         ▼
[Phase 5: 手動公開 & 記録]
  管理画面で「公開」ボタンを押下
  リポジトリ側のコミット・PR作成（または完了記録）
```

---

## 6. 疎通テスト・下書き登録コマンド (`scripts/wp-draft-post.js`)

リポジトリ内に用意された軽量CLIスクリプト（外部依存ライブラリ不要）を使用して、安全に疎通テストおよび下書き登録を実行できる。

### 1. 接続・認証の疎通テスト (Ping & Test Draft)
```bash
node scripts/wp-draft-post.js test
```
* **動作**:
  * 認証情報を検証し、ログインユーザー名と権限を表示する。
  * テスト用下書き記事（`status: draft`）を1件自動作成し、編集URLとプレビューURLを表示する。
  * ※確認後、テスト記事はWordPress管理画面の「ゴミ箱」へ移動して削除して構いません。

### 2. Markdown 原稿のドラフト登録
```bash
node scripts/wp-draft-post.js post articles/shopping-guide/article.md --slug shopping-guide
```
* **動作**:
  * Markdown 本文を解析・HTML変換し、下書き記事として登録する。
  * 登録された記事の ID とプレビュー確認用URLを出力する。
  * **常に `status: draft` が強制され、誤公開されることはありません。**

### 3. 画像のメディアライブラリ登録
```bash
node scripts/wp-draft-post.js upload-media articles/shopping-guide/images/eyecatch.png
```
* **動作**:
  * 指定した画像を WordPress メディアライブラリへ直接アップロードする。
  * アップロードされたメディアの「ID」および「URL」を出力する。
  * 記事のアイキャッチ画像として設定する際にこの ID を利用する。

---

## 7. トラブルシューティング (Troubleshooting)

### Q1: `401 Unauthorized` が返される
* **原因**: ユーザー名、またはアプリケーションパスワードに誤りがある。
* **対処法**:
  1. WordPress 管理画面 > ユーザー > プロフィール で、新しいアプリケーションパスワードを再発行する。
  2. `.env` の `WP_USERNAME` および `WP_APP_PASSWORD` を正確に転記する（スペースの有無はスクリプトが自動処理）。

### Q2: `403 Forbidden` が返される
* **原因**: Xserver のセキュリティ機能（REST API アクセス制限、または WAF）によって外部からのアクセスが遮断されている。
* **対処法**:
  1. Xserver サーバーパネルにログイン。
  2. 「WordPress セキュリティ設定」 > 「REST API アクセス制限」を「OFF」に変更する。
  3. 「WAF設定」の監査ログを確認し、ブロックされている場合は該当シグネチャの除外または一時無効化を検討する。

### Q3: 画像アップロードで `413 Request Entity Too Large` が返る
* **原因**: アップロードする画像ファイルの容量がサーバーまたはPHPの上限を超えている。
* **対処法**:
  1. 画像を圧縮（WebP 形式への変換や解像度リサイズ）して容量を 2MB 未満に抑過する。
  2. Xserver の `php.ini` 設定（`upload_max_filesize`, `post_max_size`）を確認する。

### Q4: Cocoon の吹き出しやアイコンボックスがプレビューで反映されない
* **原因**: Cocoon 固有のブロック構造やクラス名（例: `class="sp-balloon"` 等）と異なるプレーンな HTML が送信されている。
* **対処法**:
  1. WordPress 管理画面のエディタ上で、該当箇所をブロックエディタの「Cocoon ブロック」に変換する。
  2. 通常の案内ボックス等は Cocoon のショートコード（例: `[box01 title="..."]...[/box01]`）を活用する。
