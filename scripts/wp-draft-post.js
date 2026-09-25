#!/usr/bin/env node

/**
 * STK Lab - WordPress REST API 疎通・ドラフト投稿テストスクリプト
 * 
 * 【安全運用ガードレール】
 * 本スクリプトは記事の公開（status: publish）を意図的にサポートしていません。
 * すべての新規投稿・更新は必ず「下書き（status: draft）」として登録されます。
 * 公開は必ず WordPress 管理画面で目視確認した上で行ってください。
 */

const fs = require('fs');
const path = require('path');

// 1. 環境変数のロード (.env)
function loadEnv() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '.env')
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      });
      break;
    }
  }
}

loadEnv();

const WP_SITE_URL = (process.env.WP_SITE_URL || '').replace(/\/+$/, '');
const WP_USERNAME = process.env.WP_USERNAME || '';
const WP_APP_PASSWORD = (process.env.WP_APP_PASSWORD || '').replace(/\s+/g, '');

function checkConfig() {
  const missing = [];
  if (!WP_SITE_URL) missing.push('WP_SITE_URL');
  if (!WP_USERNAME) missing.push('WP_USERNAME');
  if (!WP_APP_PASSWORD) missing.push('WP_APP_PASSWORD');

  if (missing.length > 0) {
    console.error('❌ エラー: 以下の環境変数が設定されていません:');
    missing.forEach(m => console.error(`   - ${m}`));
    console.error('\n設定方法:');
    console.error('  1. リポジトリルートに .env ファイルを作成（scripts/.env.example をコピー）');
    console.error('  2. WordPress管理画面 > ユーザー > プロフィール で「アプリケーションパスワード」を発行');
    console.error('  3. WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD を記入してください。');
    process.exit(1);
  }
}

function getAuthHeader() {
  const token = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * 共通リクエスト関数
 */
async function wpRequest(endpoint, options = {}) {
  const url = `${WP_SITE_URL}/wp-json/wp/v2/${endpoint.replace(/^\/+/, '')}`;
  const headers = {
    'Authorization': getAuthHeader(),
    ...options.headers
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      console.error(`\n❌ HTTP エラー [${res.status} ${res.statusText}]`);
      if (res.status === 401) {
        console.error('   💡 考えられる原因: ユーザー名またはアプリケーションパスワードが正しくありません。');
      } else if (res.status === 403) {
        console.error('   💡 考えられる原因: Xserverの「REST API アクセス制限」または WAF によりアクセスが遮断されています。');
        console.error('      Xserver サーバーパネル > WordPress セキュリティ設定 > REST APIアクセス制限 をご確認ください。');
      }
      if (typeof data === 'object') {
        console.error('   詳細メッセージ:', JSON.stringify(data, null, 2));
      } else {
        console.error('   レスポンス内容 (一部):', String(data).slice(0, 300));
      }
      throw new Error(`WordPress API returned ${res.status}`);
    }

    return data;
  } catch (err) {
    if (err.cause && err.cause.code === 'ENOTFOUND') {
      console.error(`❌ エラー: ホスト名に接続できませんでした (${WP_SITE_URL})`);
    } else {
      console.error(`❌ リクエスト送信エラー:`, err);
    }
    throw err;
  }
}

/**
 * 簡易Markdown -> HTML変換
 * （見出し、段落、リスト、引用、コードブロックの基本変換）
 */
function simpleMarkdownToHtml(markdown) {
  let html = markdown;

  // Frontmatter の除去
  html = html.replace(/^---[\s\S]*?---\s*/, '');

  // 内部コメント（WordPress表現指示や画像指定コメント）はHTMLコメントとして保持または整形
  // <!-- 💡 [WordPress表現指示] ... --> はそのまま残す

  // コードブロック
  html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre class="wp-block-code"><code class="language-${lang}">${escaped}</code></pre>`;
  });

  // 見出し
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 水平線
  html = html.replace(/^---$/gm, '<hr>');

  // 引用
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // リスト（簡易）
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  // 連続した </ul><ul> を結合
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // 段落分け（空行で分割）
  const blocks = html.split(/\n\s*\n/);
  const formattedBlocks = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') ||
        trimmed.startsWith('<pre') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('<!--')) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  });

  return formattedBlocks.filter(Boolean).join('\n\n');
}

/**
 * 1. 疎通テスト (Ping & Draft Test)
 */
async function runTest() {
  checkConfig();
  console.log('📡 [1/2] WordPress サイトへの接続・認証を確認中...');
  console.log(`   URL: ${WP_SITE_URL}`);
  console.log(`   User: ${WP_USERNAME}`);

  // ユーザー情報の取得（疎通確認）
  const user = await wpRequest('users/me');
  const roles = Array.isArray(user.roles) ? user.roles.join(', ') : '(非公開/標準権限)';
  console.log(`✅ 認証成功！ ログインユーザー: ${user.name} (ID: ${user.id}, Roles: ${roles})`);

  console.log('\n📝 [2/2] テスト用下書き記事を作成中 (status: draft)...');
  const testTitle = `[Test Draft] 疎通確認テスト - ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;
  const testContent = `
<h2>WordPress REST API 疎通テスト成功</h2>
<p>本記事は、Antigravity / スクリプト経由で安全に <code>status: draft</code> として自動作成された検証用下書きです。</p>
<ul>
  <li>接続先: ${WP_SITE_URL}</li>
  <li>実行日時: ${new Date().toISOString()}</li>
  <li>投稿ステータス: <strong>draft (下書き)</strong></li>
</ul>
<p>この下書き記事は確認後に管理画面から削除して問題ありません。</p>
  `.trim();

  const post = await wpRequest('posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: testTitle,
      content: testContent,
      status: 'draft', // 【安全ガードレール】常に下書き
      slug: `api-test-draft-${Date.now()}`
    })
  });

  console.log(`✅ 下書き記事の作成に成功しました！`);
  console.log(`   - 記事 ID: ${post.id}`);
  console.log(`   - ステータス: ${post.status} (※下書き)`);
  console.log(`   - タイトル: ${post.title.raw || post.title.rendered}`);
  console.log(`   - 編集URL: ${WP_SITE_URL}/wp-admin/post.php?post=${post.id}&action=edit`);
  console.log(`   - プレビューURL: ${post.link}&preview=true`);
  console.log('\n🎉 疎通テストはすべて正常に完了しました！');
}

/**
 * 2. Markdownファイルのドラフト投稿
 */
async function runPostMarkdown(filePath, options = {}) {
  checkConfig();
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`❌ ファイルが見つかりません: ${absPath}`);
    process.exit(1);
  }

  const rawMarkdown = fs.readFileSync(absPath, 'utf8');

  // タイトル抽出（Frontmatter の title または 最初の # 見出し、またはオプション）
  let title = options.title || '';
  if (!title) {
    const fmMatch = rawMarkdown.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
    if (fmMatch) {
      const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?$/m);
      if (titleMatch) title = titleMatch[1];
    }
  }
  if (!title) {
    const h1Match = rawMarkdown.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1];
  }
  if (!title) {
    title = path.basename(filePath, path.extname(filePath));
  }

  // スラッグ抽出
  const slug = options.slug || path.basename(path.dirname(absPath)) || 'article-draft';

  console.log(`📄 Markdown原稿を読み込みました: ${absPath}`);
  console.log(`   タイトル: ${title}`);
  console.log(`   スラッグ: ${slug}`);

  const htmlContent = simpleMarkdownToHtml(rawMarkdown);

  console.log('\n🚀 WordPress へ下書きを送信中 (status: draft)...');
  const post = await wpRequest('posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: title,
      content: htmlContent,
      status: 'draft', // 【安全ガードレール】常に下書き
      slug: slug
    })
  });

  console.log(`\n✅ 下書き投稿が完了しました！`);
  console.log(`   - 記事 ID: ${post.id}`);
  console.log(`   - ステータス: ${post.status}`);
  console.log(`   - 編集URL: ${WP_SITE_URL}/wp-admin/post.php?post=${post.id}&action=edit`);
  console.log(`   - プレビューURL: ${post.link}&preview=true`);
  console.log('\n⚠️  必ずWordPress管理画面でプレビュー確認の上、手動で公開を行ってください。');
}

/**
 * 3. 画像メディアのアップロード
 */
async function runUploadMedia(filePath) {
  checkConfig();
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`❌ 画像ファイルが見つかりません: ${absPath}`);
    process.exit(1);
  }

  const fileName = path.basename(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  const fileBuffer = fs.readFileSync(absPath);

  console.log(`🖼️  画像をアップロード中: ${fileName} (${fileBuffer.length} bytes)`);

  const media = await wpRequest('media', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`
    },
    body: fileBuffer
  });

  console.log(`\n✅ アップロード成功！`);
  console.log(`   - メディア ID: ${media.id}`);
  console.log(`   - URL: ${media.source_url}`);
  console.log(`\n💡 記事のアイキャッチに設定する場合は featured_media: ${media.id} を指定してください。`);
}

// コマンドライン引数パーサー
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
STK Lab - WordPress REST API 疎通・ドラフト投稿CLI

使い方:
  node scripts/wp-draft-post.js test
      認証と接続の疎通テストを行い、安全なテスト用下書き記事を作成します。

  node scripts/wp-draft-post.js post <記事ファイルパス.md> [--slug <slug>] [--title <title>]
      指定したMarkdownファイルを下書き記事としてWordPressに登録します。
      （※status: draft 固定。絶対に即時公開されません）

  node scripts/wp-draft-post.js upload-media <画像ファイルパス>
      画像をメディアライブラリにアップロードし、IDとURLを取得します。

前提:
  リポジトリルートに .env ファイルを作成し、WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD を設定してください。
    `);
    process.exit(0);
  }

  try {
    if (command === 'test') {
      await runTest();
    } else if (command === 'post') {
      const filePath = args[1];
      if (!filePath) {
        console.error('❌ Markdownファイルのパスを指定してください。');
        process.exit(1);
      }
      let slug = '';
      let title = '';
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--slug' && args[i + 1]) slug = args[++i];
        if (args[i] === '--title' && args[i + 1]) title = args[++i];
      }
      await runPostMarkdown(filePath, { slug, title });
    } else if (command === 'upload-media') {
      const filePath = args[1];
      if (!filePath) {
        console.error('❌ 画像ファイルのパスを指定してください。');
        process.exit(1);
      }
      await runUploadMedia(filePath);
    } else {
      console.error(`❌ 不明なコマンドです: ${command}`);
      console.log('ヘルプを表示するには: node scripts/wp-draft-post.js --help');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n⚠️ 処理が失敗しました。詳細:', err);
    process.exit(1);
  }
}

main();
