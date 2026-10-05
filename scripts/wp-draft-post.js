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

  // 太字 **text** or __text__
  res = res.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');

  // 斜体 *text* or _text_ (※リンクタグ生成前に実行し、target="_blank"等の属性やURLの誤変換を防止)
  res = res.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  res = res.replace(/(?<![a-zA-Z0-9_])_(?!_)(.+?)(?<!_)_(?![a-zA-Z0-9_])/g, '<em>$1</em>');

  // 打消し線 ~~text~~
  res = res.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // リンク [text](url) (※属性に target="_blank" を含むため、アンダースコア斜体処理の後に実行)
  res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // コードスパンの復元
  res = res.replace(/@@INLINECODE(\d+)@@/g, (m, idx) => {
    const escaped = codes[idx].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code>${escaped}</code>`;
  });

  return res;
}

// 吹き出し用モダンSVGアバタープリセット
const AVATAR_SVGS = {
  // 1. question: 疑問・質問・読者（サックスブルー / ?バッジ）
  question: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#EFF6FF"/><circle cx="36" cy="27" r="13" fill="#3B82F6"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#3B82F6"/><circle cx="53" cy="20" r="10" fill="#2563EB"/><text x="53" y="25.5" font-size="14" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif">?</text></svg>`,

  // 2. worry: 不安・悩み・困り（アンバーオレンジ / 汗マーク）
  worry: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#FFFBEB"/><circle cx="36" cy="27" r="13" fill="#F59E0B"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#F59E0B"/><path d="M53 14c0 4-4 8-4 8s-4-4-4-8a4 4 0 0 1 8 0z" fill="#D97706"/></svg>`,

  // 3. answer: 回答・アドバイス・筆者（エメラルドグリーン / !バッジ）
  answer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#ECFDF5"/><circle cx="36" cy="27" r="13" fill="#10B981"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#10B981"/><circle cx="53" cy="20" r="10" fill="#059669"/><text x="53" y="25.5" font-size="14" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif">!</text></svg>`,

  // 4. idea: ひらめき・コツ（イエローゴールド / 電球マーク）
  idea: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#FEF9C3"/><circle cx="36" cy="27" r="13" fill="#EAB308"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#EAB308"/><circle cx="53" cy="20" r="10" fill="#CA8A04"/><circle cx="53" cy="18" r="3.5" fill="#FFFFFF"/><rect x="51.5" y="21" width="3" height="2" rx="0.5" fill="#FFFFFF"/></svg>`,

  // 5. check: 納得・太鼓判・解決（ティールブルー / チェックマーク）
  check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#F0FDFA"/><circle cx="36" cy="27" r="13" fill="#14B8A6"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#14B8A6"/><circle cx="53" cy="20" r="10" fill="#0D9488"/><path d="M49 20.5l2.5 2.5 5.5-5.5" stroke="#FFFFFF" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // 6. smile: 笑顔・親しみ（ライムグリーン / スマイル）
  smile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#F7FEE7"/><circle cx="36" cy="27" r="13" fill="#84CC16"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#84CC16"/><circle cx="53" cy="20" r="10" fill="#65A30D"/><path d="M49 20c1 2.5 7 2.5 8 0" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,

  // 7. thinking: 熟考・思案（パープル / クエスチョンドット）
  thinking: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#FAF5FF"/><circle cx="36" cy="27" r="13" fill="#A855F7"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#A855F7"/><circle cx="53" cy="20" r="10" fill="#9333EA"/><circle cx="53" cy="18" r="2.5" fill="#FFFFFF"/><circle cx="53" cy="23" r="1.5" fill="#FFFFFF"/></svg>`,

  // 8. shock: 驚き・ハッと気付き（ローズレッド / びっくりマーク）
  shock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#FFF1F2"/><circle cx="36" cy="27" r="13" fill="#F43F5E"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#F43F5E"/><circle cx="53" cy="20" r="10" fill="#E11D48"/><circle cx="53" cy="20" r="3" fill="#FFFFFF"/></svg>`,

  // 9. robot: AI・自動化・システム（シアンブルー / アンテナロボ）
  robot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#ECFEFF"/><rect x="23" y="15" width="26" height="22" rx="5" fill="#06B6D4"/><circle cx="30" cy="24" r="3" fill="#FFFFFF"/><circle cx="42" cy="24" r="3" fill="#FFFFFF"/><rect x="28" y="30" width="16" height="2.5" rx="1" fill="#FFFFFF"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#06B6D4"/><line x1="36" y1="15" x2="36" y2="10" stroke="#0891B2" stroke-width="2.5"/><circle cx="36" cy="9" r="2.5" fill="#0891B2"/></svg>`,

  // 10. star: 注目・おすすめ・ハイライト（アンバーゴールド / 星）
  star: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#FFFBEB"/><circle cx="36" cy="27" r="13" fill="#F59E0B"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#F59E0B"/><circle cx="53" cy="20" r="10" fill="#D97706"/><path d="M53 15.5l1.4 3 3.3.4-2.4 2.3.6 3.3-2.9-1.6-2.9 1.6.6-3.3-2.4-2.3 3.3-.4z" fill="#FFFFFF"/></svg>`,

  // 11. user: 汎用ユーザー（スレートグレー）
  user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="36" fill="#F8FAFC"/><circle cx="36" cy="27" r="13" fill="#64748B"/><path d="M16 61c0-11 9-20 20-20s20 9 20 20" fill="#64748B"/></svg>`
};

// 別名エイリアス
AVATAR_SVGS.reader = AVATAR_SVGS.question;
AVATAR_SVGS.author = AVATAR_SVGS.answer;
AVATAR_SVGS.think = AVATAR_SVGS.thinking;
AVATAR_SVGS.ai = AVATAR_SVGS.robot;
AVATAR_SVGS.surprise = AVATAR_SVGS.shock;

/**
 * 文字列が絵文字かどうかを判定
 */
function isEmoji(str) {
  if (!str) return false;
  const trimmed = str.trim();
  // サロゲートペアやUnicode絵文字ブロックの検出
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])+$/u.test(trimmed);
}

/**
 * 任意の絵文字から丸型アバターSVGデータURIを自動生成
 */
function generateEmojiAvatarSvg(emoji, isRight = false) {
  const bgColor = isRight ? '#ECFDF5' : '#F0F9FF';
  const borderColor = isRight ? '#10B981' : '#3B82F6';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60"><circle cx="36" cy="36" r="34" fill="${bgColor}" stroke="${borderColor}" stroke-width="2.5"/><text x="36" y="46" font-size="32" text-anchor="middle" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Twemoji Mozilla',sans-serif">${emoji.trim()}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
}

/**
 * アバター指定（タイプ名、絵文字、画像URL）から適切なURIを解決
 */
function getAvatarUri(avatarSpec, isRight = false) {
  const spec = (avatarSpec || '').trim();
  if (!spec) {
    const defaultSvg = isRight ? AVATAR_SVGS.answer : AVATAR_SVGS.question;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(defaultSvg.replace(/\s+/g, ' ').trim());
  }

  // 1. 画像URL指定（http, https, 相対パス、画像拡張子）
  if (spec.startsWith('http://') || spec.startsWith('https://') || spec.startsWith('/') || /\.(png|jpe?g|gif|svg|webp)$/i.test(spec)) {
    return spec;
  }

  // 2. 絵文字指定（🤖, 💡, 🙋‍♂️, 🐱 など全絵文字）
  if (isEmoji(spec)) {
    return generateEmojiAvatarSvg(spec, isRight);
  }

  // 3. プリセットSVG指定
  const cleanType = spec.toLowerCase();
  const svg = AVATAR_SVGS[cleanType] || (isRight ? AVATAR_SVGS.answer : AVATAR_SVGS.question);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
}

/**
 * リスト（箇条書き・番号付きリスト）の階層対応変換
 */
function parseLists(text) {
  const rawLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (rawLines.length === 0) return '';

  const parsedLines = [];
  for (const line of rawLines) {
    const indentMatch = line.match(/^([ \t]*)(?:([-*])|(\d+)\.)\s+(.+)$/);
    if (indentMatch) {
      const indent = indentMatch[1].replace(/\t/g, '  ').length;
      const isOrdered = !!indentMatch[3];
      const content = indentMatch[4];
      parsedLines.push({ indent, isOrdered, content });
    } else {
      if (parsedLines.length > 0) {
        parsedLines[parsedLines.length - 1].content += ' ' + line.trim();
      }
    }
  }

  if (parsedLines.length === 0) return text;

  let html = '';
  const stack = []; // [{ tag: 'ul'|'ol', indent: number }]

  for (let i = 0; i < parsedLines.length; i++) {
    const item = parsedLines[i];
    const currentTag = item.isOrdered ? 'ol' : 'ul';

    if (stack.length === 0) {
      stack.push({ tag: currentTag, indent: item.indent });
      html += `<${currentTag}><li>${parseInline(item.content)}`;
    } else {
      let top = stack[stack.length - 1];
      if (item.indent > top.indent) {
        stack.push({ tag: currentTag, indent: item.indent });
        html += `<${currentTag}><li>${parseInline(item.content)}`;
      } else {
        html += `</li>`;
        while (stack.length > 1 && stack[stack.length - 1].indent > item.indent) {
          const popped = stack.pop();
          html += `</${popped.tag}></li>`;
        }
        top = stack[stack.length - 1];
        if (top.tag !== currentTag && item.indent === top.indent) {
          const popped = stack.pop();
          html += `</${popped.tag}><${currentTag}>`;
          stack.push({ tag: currentTag, indent: item.indent });
        }
        html += `<li>${parseInline(item.content)}`;
      }
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    html += `</li></${popped.tag}>`;
  }

  return html;
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

    // ① 吹き出し ::: balloon [type/emoji/url] [left|right] [name:名前]
    if (type.startsWith('balloon')) {
      const parts = argList.split(/\s+/).filter(Boolean);
      let balloonType = parts[0] || (type === 'balloon-author' ? 'answer' : 'question');

      // 旧キーワードの互換マッピング
      if (balloonType === 'reader') balloonType = 'question';
      if (balloonType === 'author' || balloonType === 'admin') balloonType = 'answer';

      // 既定の左右配置（回答・ひらめき系・星系は右、質問・悩み・ロボット・ユーザー系は左）
      const rightKeywords = ['answer', 'idea', 'check', 'star', 'right'];
      const isRightDefault = rightKeywords.includes(balloonType.toLowerCase());
      const side = parts.find(p => p === 'left' || p === 'right') || (isRightDefault ? 'right' : 'left');
      const isRight = side === 'right';
      const posClass = isRight ? 'sbp-r' : 'sbp-l';

      // 名前指定（明示的に name:〇〇 と指定された場合のみ表示）
      const namePart = parts.find(p => p.startsWith('name:'));
      let displayName = namePart ? namePart.replace(/^name:/, '') : '';

      const avatarUri = getAvatarUri(balloonType, isRight);
      const nameHtml = displayName ? `<div class="speech-name">${parseInline(displayName)}</div>` : '';

      const innerHtml = cleanContent.split(/\r?\n/).filter(l => l.trim()).map(line => `<p>${parseInline(line.trim())}</p>`).join('');
      return `\n\n<div class="speech-wrap sb-id-1 sbs-stn ${posClass}"><div class="speech-person"><figure class="speech-icon"><img src="${avatarUri}" alt="${balloonType}" class="speech-icon-image" width="60" height="60"></figure>${nameHtml}</div><div class="speech-balloon">${innerHtml}</div></div>\n\n`;
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

    // Alert内部のコンテンツのパース（リストと段落の分離）
    let innerText = contentLines.join('\n').trim();
    // リスト部分を先に変換
    innerText = innerText.replace(/(?:^[ \t]*(?:[-*]|\d+\.)\s+.+(?:\r?\n|$)(?:^[ \t]+.+(?:\r?\n|$))*)+/gm, (m) => {
      return `\n\n${parseLists(m.trim())}\n\n`;
    });
    // 段落分割
    let paragraphs = innerText.split(/\n\s*\n/).map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<div')) {
        return trimmed;
      }
      return `<p>${parseInline(trimmed.replace(/\n/g, '<br>'))}</p>`;
    }).filter(Boolean).join('');

    // 最後のブロック要素（<p>, <ul>, <ol>）に margin-bottom: 0 を付与して余白の肥大化・不自然な空行を防止
    const lastBlockMatch = paragraphs.match(/<(p|ul|ol)[^>]*>[\s\S]*?<\/\1>\s*$/);
    if (lastBlockMatch) {
      const lastBlock = lastBlockMatch[0];
      const updatedBlock = lastBlock.replace(/^<(p|ul|ol)([^>]*)>/, (m, tag, attrs) => {
        if (attrs.includes('style="')) {
          return `<${tag}${attrs.replace('style="', 'style="margin-bottom: 0 !important; ')}>`;
        }
        return `<${tag} style="margin-bottom: 0 !important;"${attrs}>`;
      });
      paragraphs = paragraphs.slice(0, paragraphs.length - lastBlock.length) + updatedBlock;
    }

    return `\n\n<div class="sp-box ${config.cssClass}"><div class="box-title"><strong>${parseInline(title)}</strong></div><div class="box-content">${paragraphs}</div></div>\n\n`;
  });

  // 6. テーブル（Markdown Tables）の変換（レスポンシブ・PCワイド表示・セル幅自動最適化）
  text = text.replace(/(?:(?:^|\n)\|[^\n]+\|\r?\n\|[-:| ]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g, (match) => {
    const rows = match.trim().split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    if (rows.length < 2) return match;

    const parseRow = (row, isTh = false) => {
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      const tag = isTh ? 'th' : 'td';
      return '<tr>' + cells.map(c => {
        // 短い英数・記号（Level 1, Lv.2, ★☆☆, Shift + >, 記号など、概ね8文字以下の短文字）は nowrap & center
        // 長い解説テキストは normal & break-word で幅を集中
        const cleanText = c.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
        const isShortLabel = cleanText.length <= 8 && (
          /^(Level\s*\d+|Lv\.?\s*\d+|No\.?\s*\d+|[★☆]+|[A-Za-z0-9\s+<>-]+|キー操作|機能|ジャンル)$/i.test(cleanText) ||
          /^[★☆\s]+$/.test(cleanText)
        );

        const alignStyle = isShortLabel ? 'white-space: nowrap !important; text-align: center; vertical-align: middle;' : 'white-space: normal !important; word-break: break-word; vertical-align: top;';
        return `<${tag} style="padding: 10px 14px; ${alignStyle}">${parseInline(c)}</${tag}>`;
      }).join('') + '</tr>';
    };

    const header = parseRow(rows[0], true);
    const bodyRows = rows.slice(2).map(r => parseRow(r, false)).join('');

    return `\n\n<div class="table-container responsive-table-wrap" style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 1.8em -24px; width: calc(100% + 48px); max-width: calc(100% + 48px);"><table class="wp-block-table is-style-stripes" style="width: 100%; border-collapse: collapse; table-layout: auto;"><thead>${header}</thead><tbody>${bodyRows}</tbody></table></div>\n\n`;
  });

  // 7. 見出し（前後に空行を確保し、後続ブロックとの癒着を防止）
  text = text.replace(/^######\s+(.+)$/gm, (m, p1) => `\n\n<h6>${parseInline(p1)}</h6>\n\n`);
  text = text.replace(/^#####\s+(.+)$/gm, (m, p1) => `\n\n<h5>${parseInline(p1)}</h5>\n\n`);
  text = text.replace(/^####\s+(.+)$/gm, (m, p1) => `\n\n<h4>${parseInline(p1)}</h4>\n\n`);
  text = text.replace(/^###\s+(.+)$/gm, (m, p1) => `\n\n<h3>${parseInline(p1)}</h3>\n\n`);
  text = text.replace(/^##\s+(.+)$/gm, (m, p1) => `\n\n<h2>${parseInline(p1)}</h2>\n\n`);
  text = text.replace(/^#\s+(.+)$/gm, (m, p1) => `\n\n<h1>${parseInline(p1)}</h1>\n\n`);

  // 8. 水平線
  text = text.replace(/^---$/gm, '\n\n<hr>\n\n');

  // 9. リスト（箇条書き・番号付きリスト）
  text = text.replace(/(?:^[ \t]*(?:[-*]|\d+\.)\s+.+(?:\r?\n|$)(?:^[ \t]+.+(?:\r?\n|$))*)+/gm, (match) => {
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
