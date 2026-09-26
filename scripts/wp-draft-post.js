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
 * インライン要素（太字、斜体、インラインコード、リンク、打消し線）の変換
 */
function parseInline(text) {
  let res = text;
  // コードスパンの退避
  const codes = [];
  res = res.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return `@@INLINECODE${codes.length - 1}@@`;
  });

  // リンク [text](url)
  res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 太字 **text** or __text__
  res = res.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');

  // 斜体 *text* or _text_
  res = res.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  res = res.replace(/(?<!_)_(?!_)(.*?)(?<!_)_(?!_)/g, '<em>$1</em>');

  // 打消し線 ~~text~~
  res = res.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // コードスパンの復元
  res = res.replace(/@@INLINECODE(\d+)@@/g, (m, idx) => {
    const escaped = codes[idx].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code>${escaped}</code>`;
  });

  return res;
}

/**
 * リスト（箇条書き・番号付きリスト）の変換
 */
function parseLists(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const isOrdered = /^\d+\.\s/.test(lines[0].trim());
  const tag = isOrdered ? 'ol' : 'ul';

  const items = lines.map(line => {
    const content = line.trim().replace(/^(?:[-*]|\d+\.)\s+/, '');
    return `<li>${parseInline(content)}</li>`;
  }).join('');

  return `<${tag}>${items}</${tag}>`;
}

/**
 * 高機能Markdown -> HTML変換
 * （GFM Alerts、ミニマルコンテナ、テーブル、見出し、段落、リスト、引用、コードブロック対応）
 */
function simpleMarkdownToHtml(markdown) {
  let text = markdown;

  // 1. Frontmatter の除去
  text = text.replace(/^---[\s\S]*?---\s*/, '');

  // 2. 指示コメントの除去（WordPress本文には不要な制作指示コメントをクリーンアップ）
  text = text.replace(/<!--\s*(?:💡|🖼️)[\s\S]*?-->/g, '');

  // 3. コードブロックの退避
  const codeBlocks = [];
  text = text.replace(/```([\w-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    codeBlocks.push(`<pre class="wp-block-code"><code class="language-${lang}">${escaped}</code></pre>`);
    return `\n\n@@BLOCKCODE${codeBlocks.length - 1}@@\n\n`;
  });

  // 4. ミニマルコンテナ（::: ディレクティブ）の変換
  text = text.replace(/:::\s*([a-zA-Z0-9_-]+)(?:[ \t]+([^\r\n]+))?\r?\n([\s\S]*?)\r?\n:::/g, (match, type, args, content) => {
    const cleanContent = content.trim();
    const argList = (args || '').trim();

    // ① 吹き出し ::: balloon <reader|author|名前> [left|right]
    if (type.startsWith('balloon')) {
      const parts = argList.split(/\s+/);
      const role = parts[0] || (type === 'balloon-author' ? 'author' : 'reader');
      const side = parts[1] || (role === 'author' ? 'right' : 'left');

      let name = role;
      let posClass = side === 'right' ? 'sbp-r' : 'sbp-l';
      if (role === 'reader' || role === 'user') {
        name = '読者';
        posClass = 'sbp-l';
      } else if (role === 'author' || role === 'admin') {
        name = '筆者';
        posClass = side === 'left' ? 'sbp-l' : 'sbp-r';
      }

      const innerHtml = cleanContent.split(/\r?\n/).filter(l => l.trim()).map(line => `<p>${parseInline(line.trim())}</p>`).join('');
      return `\n\n<div class="speech-wrap sb-id-1 sbs-stn ${posClass}"><div class="speech-person"><div class="speech-name">${name}</div></div><div class="speech-balloon">${innerHtml}</div></div>\n\n`;
    }

    // ② ボタン ::: btn [url] または ::: btn-primary [url]
    if (type.startsWith('btn')) {
      const url = argList || '#';
      const label = parseInline(cleanContent);
      return `\n\n<div class="wp-block-buttons is-content-justification-center"><div class="wp-block-button is-style-fill"><a class="wp-block-button__link wp-element-button" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a></div></div>\n\n`;
    }

    // ③ 汎用ボックス ::: box <info|success|warning|danger|blank> [title]
    if (type === 'box') {
      const parts = argList.split(/\s+/);
      const style = parts[0] || 'info';
      const title = parts.slice(1).join(' ');
      const titleHtml = title ? `<div class="box-title"><strong>${parseInline(title)}</strong></div>` : '';
      const innerHtml = cleanContent.split(/\r?\n/).filter(l => l.trim()).map(line => `<p>${parseInline(line.trim())}</p>`).join('');
      return `\n\n<div class="sp-box ${style}-box">${titleHtml}<div class="box-content">${innerHtml}</div></div>\n\n`;
    }

    return match;
  });

  // 5. GFM Alerts の変換 (> [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT], > [!CAUTION])
  text = text.replace(/(?:^>[ \t]*.*(?:\r?\n|$))+/gm, (match) => {
    const lines = match.split(/\r?\n/).filter(l => l.trim().length > 0);
    const firstLine = lines[0].replace(/^>[ \t]*/, '').trim();
    const alertMatch = firstLine.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i);

    if (!alertMatch) {
      // 通常の引用（blockquote）
      const inner = lines.map(l => l.replace(/^>[ \t]?/, '')).join('\n').trim();
      const innerHtml = inner.split(/\n\s*\n/).map(p => `<p>${parseInline(p.trim().replace(/\n/g, '<br>'))}</p>`).join('');
      return `\n\n<blockquote>${innerHtml}</blockquote>\n\n`;
    }

    const alertType = alertMatch[1].toUpperCase();
    const restLines = lines.slice(1).map(l => l.replace(/^>[ \t]?/, ''));

    // スタイルとデフォルトタイトルのマッピング
    const alertConfigs = {
      'NOTE': { cssClass: 'info-box', defaultTitle: '💡 案内・補足' },
      'TIP': { cssClass: 'success-box', defaultTitle: '🍀 ポイント・おすすめ' },
      'WARNING': { cssClass: 'warning-box', defaultTitle: '⚠️ 注意事項' },
      'IMPORTANT': { cssClass: 'danger-box', defaultTitle: '🚨 重要' },
      'CAUTION': { cssClass: 'danger-box', defaultTitle: '🛑 警告' }
    };
    const config = alertConfigs[alertType] || alertConfigs['NOTE'];

    let title = config.defaultTitle;
    let contentLines = restLines;

    // もし次の行が **タイトル** または見出しならそれをタイトルとして採用
    if (contentLines.length > 0) {
      const firstContent = contentLines[0].trim();
      const boldTitleMatch = firstContent.match(/^\*\*(.+?)\*\*$/);
      const headingTitleMatch = firstContent.match(/^#+\s*(.+)$/);
      if (boldTitleMatch) {
        title = boldTitleMatch[1];
        contentLines = contentLines.slice(1);
      } else if (headingTitleMatch) {
        title = headingTitleMatch[1];
        contentLines = contentLines.slice(1);
      }
    }

    const innerContent = contentLines.join('\n').trim();
    const paragraphs = innerContent.split(/\n\s*\n/).map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
        return parseLists(trimmed);
      }
      return `<p>${parseInline(trimmed.replace(/\n/g, '<br>'))}</p>`;
    }).filter(Boolean).join('');

    return `\n\n<div class="sp-box ${config.cssClass}"><div class="box-title"><strong>${parseInline(title)}</strong></div><div class="box-content">${paragraphs}</div></div>\n\n`;
  });

  // 6. テーブル（Markdown Tables）の変換
  text = text.replace(/(?:(?:^|\n)\|[^\n]+\|\r?\n\|[-:| ]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g, (match) => {
    const rows = match.trim().split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    if (rows.length < 2) return match;

    const parseRow = (row, isTh = false) => {
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      const tag = isTh ? 'th' : 'td';
      return '<tr>' + cells.map(c => `<${tag}>${parseInline(c)}</${tag}>`).join('') + '</tr>';
    };

    const header = parseRow(rows[0], true);
    const bodyRows = rows.slice(2).map(r => parseRow(r, false)).join('');

    return `\n\n<div class="scrollable-table"><table class="wp-block-table is-style-stripes"><thead>${header}</thead><tbody>${bodyRows}</tbody></table></div>\n\n`;
  });

  // 7. 見出し
  text = text.replace(/^######\s+(.+)$/gm, (m, p1) => `<h6>${parseInline(p1)}</h6>`);
  text = text.replace(/^#####\s+(.+)$/gm, (m, p1) => `<h5>${parseInline(p1)}</h5>`);
  text = text.replace(/^####\s+(.+)$/gm, (m, p1) => `<h4>${parseInline(p1)}</h4>`);
  text = text.replace(/^###\s+(.+)$/gm, (m, p1) => `<h3>${parseInline(p1)}</h3>`);
  text = text.replace(/^##\s+(.+)$/gm, (m, p1) => `<h2>${parseInline(p1)}</h2>`);
  text = text.replace(/^#\s+(.+)$/gm, (m, p1) => `<h1>${parseInline(p1)}</h1>`);

  // 8. 水平線
  text = text.replace(/^---$/gm, '<hr>');

  // 9. リスト（箇条書き・番号付きリスト）
  text = text.replace(/(?:^(?:[-*]|\d+\.)\s+.+(?:\r?\n|$))+/gm, (match) => {
    return `\n\n${parseLists(match.trim())}\n\n`;
  });

  // 10. 段落分け（空行で分割）
  const blocks = text.split(/\n\s*\n/);
  const formattedBlocks = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') ||
        trimmed.startsWith('<pre') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('<div') ||
        trimmed.startsWith('<table') ||
        trimmed.startsWith('<figure') ||
        trimmed.startsWith('@@BLOCKCODE')) {
      return trimmed;
    }
    return `<p>${parseInline(trimmed.replace(/\n/g, '<br>'))}</p>`;
  });

  let result = formattedBlocks.filter(Boolean).join('\n\n');

  // 11. 退避したコードブロックの復元
  result = result.replace(/@@BLOCKCODE(\d+)@@/g, (m, idx) => codeBlocks[idx]);

  return result;
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
/**
 * 画像メディアのアップロード処理（内部共通関数）
 */
async function uploadMediaFile(filePath) {
  checkConfig();
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`画像ファイルが見つかりません: ${absPath}`);
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

  return media;
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

  const articleDir = path.dirname(absPath);
  let rawMarkdown = fs.readFileSync(absPath, 'utf8');

  // タイトル抽出（Frontmatter の title または 最初の # 見出し、またはオプション）
  let title = options.title || '';
  let eyecatchPath = '';
  const fmMatch = rawMarkdown.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (fmMatch) {
    if (!title) {
      const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?$/m);
      if (titleMatch) title = titleMatch[1];
    }
    const eyecatchMatch = fmMatch[1].match(/^eyecatch:\s*["']?(.+?)["']?$/m);
    if (eyecatchMatch) eyecatchPath = eyecatchMatch[1];
  }
  if (!title) {
    const h1Match = rawMarkdown.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1];
  }
  if (!title) {
    title = path.basename(filePath, path.extname(filePath));
  }

  // スラッグ抽出
  const slug = options.slug || path.basename(articleDir) || 'article-draft';

  console.log(`📄 Markdown原稿を読み込みました: ${absPath}`);
  console.log(`   タイトル: ${title}`);
  console.log(`   スラッグ: ${slug}`);

  // アイキャッチ画像の自動検出 & アップロード
  let featuredMediaId = 0;
  if (!eyecatchPath) {
    const candidateFiles = ['images/eyecatch.png', 'images/eyecatch.jpg', 'images/eyecatch.webp', 'eyecatch.png', 'eyecatch.jpg'];
    for (const c of candidateFiles) {
      const checkPath = path.resolve(articleDir, c);
      if (fs.existsSync(checkPath)) {
        eyecatchPath = checkPath;
        break;
      }
    }
  } else {
    eyecatchPath = path.resolve(articleDir, eyecatchPath);
  }

  if (eyecatchPath && fs.existsSync(eyecatchPath)) {
    try {
      console.log(`📸 アイキャッチ画像を検出しました: ${eyecatchPath}`);
      const uploadedEyecatch = await uploadMediaFile(eyecatchPath);
      featuredMediaId = uploadedEyecatch.id;
      console.log(`   ✅ アイキャッチ登録成功 (Media ID: ${featuredMediaId})`);
    } catch (err) {
      console.warn(`   ⚠️ アイキャッチ画像のアップロードに失敗しました (スキップ):`, err.message);
    }
  }

  // 本文中のローカル画像の自動検出 & アップロード
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let imgMatch;
  const imagesToUpload = [];
  while ((imgMatch = imageRegex.exec(rawMarkdown)) !== null) {
    const fullMatch = imgMatch[0];
    const alt = imgMatch[1];
    const src = imgMatch[2];
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      const resolvedImgPath = path.resolve(articleDir, src);
      if (fs.existsSync(resolvedImgPath)) {
        imagesToUpload.push({ fullMatch, alt, src, absPath: resolvedImgPath });
      }
    }
  }

  for (const img of imagesToUpload) {
    try {
      console.log(`🖼️ 本文中のローカル画像をアップロード中: ${img.src}`);
      const uploadedImg = await uploadMediaFile(img.absPath);
      const imgBlockHtml = `<!-- wp:image {"id":${uploadedImg.id},"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${uploadedImg.source_url}" alt="${img.alt}" class="wp-image-${uploadedImg.id}"/></figure>\n<!-- /wp:image -->`;
      rawMarkdown = rawMarkdown.replace(img.fullMatch, imgBlockHtml);
      console.log(`   ✅ 置換完了 (Media ID: ${uploadedImg.id})`);
    } catch (err) {
      console.warn(`   ⚠️ 画像アップロードに失敗しました (${img.src}):`, err.message);
    }
  }

  const htmlContent = simpleMarkdownToHtml(rawMarkdown);

  console.log('\n🚀 WordPress へ下書きを送信中 (status: draft)...');
  const postPayload = {
    title: title,
    content: htmlContent,
    status: 'draft', // 【安全ガードレール】常に下書き
    slug: slug
  };
  if (featuredMediaId) {
    postPayload.featured_media = featuredMediaId;
  }

  const post = await wpRequest('posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postPayload)
  });

  console.log(`\n✅ 下書き投稿が完了しました！`);
  console.log(`   - 記事 ID: ${post.id}`);
  console.log(`   - ステータス: ${post.status}`);
  if (featuredMediaId) console.log(`   - アイキャッチ Media ID: ${featuredMediaId}`);
  console.log(`   - 編集URL: ${WP_SITE_URL}/wp-admin/post.php?post=${post.id}&action=edit`);
  console.log(`   - プレビューURL: ${post.link}&preview=true`);
  console.log('\n⚠️  必ずWordPress管理画面でプレビュー確認の上、手動で公開を行ってください。');

  return post;
}

/**
 * 3. 画像メディアのアップロード (CLI用)
 */
async function runUploadMedia(filePath) {
  const media = await uploadMediaFile(filePath);
  console.log(`\n✅ アップロード成功！`);
  console.log(`   - メディア ID: ${media.id}`);
  console.log(`   - URL: ${media.source_url}`);
  console.log(`\n💡 記事のアイキャッチに設定する場合は featured_media: ${media.id} を指定してください。`);
  return media;
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
      （※status: draft 固定。絶対に即時公開されません。アイキャッチや本文画像も自動検出）

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

if (require.main === module) {
  main();
} else {
  module.exports = {
    simpleMarkdownToHtml,
    parseInline,
    parseLists,
    uploadMediaFile,
    runPostMarkdown
  };
}
