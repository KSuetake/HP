#!/usr/bin/env node

/**
 * STK Lab - WordPress 標準 REST API ベースの軽量ローカル MCP サーバー
 * 
 * 【特徴】
 * - WordPress 側に専用プラグイン（mcp-adapter等）のインストール不要！
 * - 標準の WordPress REST API (Gutenberg/Cocoon対応) を直接利用。
 * - 外部 npm パッケージ依存ゼロ（Node.js 標準 API のみ）。
 * - 【安全ガードレール】status: draft（下書き）のみを許可。誤公開を物理的に防止。
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

function getAuthHeader() {
  const token = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

async function wpRequest(endpoint, options = {}) {
  const url = `${WP_SITE_URL}/wp-json/wp/v2/${endpoint.replace(/^\/+/, '')}`;
  const headers = {
    'Authorization': getAuthHeader(),
    ...options.headers
  };

  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const errText = typeof data === 'object' ? JSON.stringify(data) : String(data);
    throw new Error(`WordPress API Error [${res.status}]: ${errText}`);
  }
  return data;
}

// ツール定義一覧
const TOOLS = [
  {
    name: 'wp_test_connection',
    description: 'WordPress サイトへの接続・認証をテストし、テスト用下書き記事を作成して疎通を確認します。',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wp_post_draft',
    description: 'Markdownファイルまたはタイトル・HTML本文を受け取り、WordPress に安全に下書き（status: draft）として登録します。即時公開はできません。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '投稿するMarkdownファイルの相対パス（例: articles/shopping-guide/article.md）'
        },
        title: {
          type: 'string',
          description: '記事タイトル（省略時はファイル内の # 見出しを使用）'
        },
        slug: {
          type: 'string',
          description: 'パーマリンク（スラッグ）'
        }
      }
    }
  },
  {
    name: 'wp_upload_media',
    description: '画像を WordPress のメディアライブラリにアップロードし、メディアIDとURLを取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'アップロードする画像ファイルの相対パス'
        }
      },
      required: ['file_path']
    }
  }
];

// ツールハンドラー
async function handleToolCall(name, args) {
  if (name === 'wp_test_connection') {
    const user = await wpRequest('users/me');
    const testTitle = `[MCP Test Draft] 疎通確認テスト - ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;
    const post = await wpRequest('posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: testTitle,
        content: '<p>WordPress MCP サーバー経由で安全に作成された下書きです。</p>',
        status: 'draft',
        slug: `mcp-test-draft-${Date.now()}`
      })
    });
    return {
      content: [
        {
          type: 'text',
          text: `✅ MCP疎通テスト成功！\n- ユーザー: ${user.name} (ID: ${user.id})\n- 記事ID: ${post.id}\n- ステータス: ${post.status}\n- 編集URL: ${WP_SITE_URL}/wp-admin/post.php?post=${post.id}&action=edit\n- プレビューURL: ${post.link}&preview=true`
        }
      ]
    };
  }

  if (name === 'wp_upload_media') {
    const absPath = path.resolve(process.cwd(), args.file_path);
    if (!fs.existsSync(absPath)) throw new Error(`画像が見つかりません: ${absPath}`);
    const fileName = path.basename(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const buffer = fs.readFileSync(absPath);

    const media = await wpRequest('media', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${fileName}"`
      },
      body: buffer
    });

    return {
      content: [
        {
          type: 'text',
          text: `✅ 画像アップロード成功！\n- メディアID: ${media.id}\n- URL: ${media.source_url}`
        }
      ]
    };
  }

  if (name === 'wp_post_draft') {
    let title = args.title || '';
    let slug = args.slug || '';
    let content = '';

    if (args.file_path) {
      const absPath = path.resolve(process.cwd(), args.file_path);
      if (!fs.existsSync(absPath)) throw new Error(`ファイルが見つかりません: ${absPath}`);
      const raw = fs.readFileSync(absPath, 'utf8');
      if (!title) {
        const m = raw.match(/^#\s+(.+)$/m);
        title = m ? m[1] : path.basename(args.file_path, path.extname(args.file_path));
      }
      if (!slug) {
        slug = path.basename(path.dirname(absPath));
      }
      content = raw;
    }

    const post = await wpRequest('posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        status: 'draft', // 【絶対固定】
        slug
      })
    });

    return {
      content: [
        {
          type: 'text',
          text: `✅ 下書き登録完了！\n- 記事ID: ${post.id}\n- ステータス: ${post.status}\n- 編集URL: ${WP_SITE_URL}/wp-admin/post.php?post=${post.id}&action=edit\n- プレビューURL: ${post.link}&preview=true`
        }
      ]
    };
  }

  throw new Error(`未知のツールです: ${name}`);
}

// stdio JSON-RPC 2.0 サーバー処理
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result, error = null) {
  const res = { jsonrpc: '2.0', id };
  if (error) {
    res.error = error;
  } else {
    res.result = result;
  }
  process.stdout.write(JSON.stringify(res) + '\n');
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    return;
  }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'stk-lab-wordpress-mcp',
        version: '1.0.0'
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    try {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const result = await handleToolCall(toolName, toolArgs);
      sendResponse(id, result);
    } catch (err) {
      sendResponse(id, null, {
        code: -32603,
        message: err.message
      });
    }
    return;
  }

  if (id !== undefined) {
    sendResponse(id, null, {
      code: -32601,
      message: `Method not found: ${method}`
    });
  }
});

// エラー時も標準エラーへ出力
process.stderr.write('STK Lab WordPress MCP Server is ready.\n');
