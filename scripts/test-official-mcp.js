#!/usr/bin/env node

/**
 * STK Lab - WordPress 公式 MCP サーバー疎通テストスクリプト
 * 
 * 公式パッケージ: @automattic/mcp-wordpress-remote
 * 前提条件: WordPress に公式プラグイン「WordPress/mcp-adapter」がインストール・有効化されていること
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. .env のロード
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

if (!WP_SITE_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
  console.error('❌ .env の設定が不足しています (WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD)');
  process.exit(1);
}

const MCP_ENDPOINT = `${WP_SITE_URL}/wp-json/mcp/mcp-adapter-default-server`;

console.log('🤖 WordPress 公式 MCP サーバー疎通テストを開始します...');
console.log(`   パッケージ: @automattic/mcp-wordpress-remote`);
console.log(`   エンドポイント: ${MCP_ENDPOINT}`);
console.log(`   ユーザー: ${WP_USERNAME}`);

const env = {
  ...process.env,
  WP_API_URL: MCP_ENDPOINT,
  WP_API_USERNAME: WP_USERNAME,
  WP_API_PASSWORD: WP_APP_PASSWORD,
  OAUTH_ENABLED: 'false'
};

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npxCmd, ['-y', '@automattic/mcp-wordpress-remote'], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: true
});

let buffer = '';

child.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg);
    } catch (e) {
      // JSON 以外のログ出力
    }
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function handleMessage(msg) {
  if (msg.id === 1 && msg.result) {
    console.log('✅ [1/2] MCP initialize 成功！ サーバー情報:', msg.result.serverInfo);
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    console.log('🔍 [2/2] 利用可能な MCP ツール一覧を要求中 (tools/list)...');
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  } else if (msg.id === 2 && msg.result) {
    const tools = msg.result.tools || [];
    console.log(`\n🎉 [2/3] 公式 MCP ツール一覧の取得に成功しました！ (計 ${tools.length} 件)`);
    tools.forEach(t => {
      console.log(`   - 🔧 ${t.name}: ${t.description ? t.description.slice(0, 80) : ''}`);
    });
    console.log('\n🚀 [3/3] tools/call (mcp-adapter-discover-abilities) を実行中...');
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'mcp-adapter-discover-abilities', arguments: {} }
    });
  } else if (msg.id === 3) {
    if (msg.error) {
      console.error('❌ tools/call エラー:', msg.error);
      cleanup(1);
    } else {
      console.log('✅ [3/3] tools/call 成功！ 利用可能な WordPress Abilities:');
      const content = msg.result?.content || [];
      content.forEach(c => {
        try {
          const parsed = JSON.parse(c.text);
          console.log(JSON.stringify(parsed, null, 2).slice(0, 800) + '...');
        } catch (e) {
          console.log(c.text.slice(0, 500));
        }
      });
      console.log('\n🎉 WordPress 公式 MCP サーバーの全機能疎通テストが完了しました！');
      cleanup(0);
    }
  } else if (msg.error) {
    console.error('❌ エラー:', msg.error);
    cleanup(1);
  }
}

// タイムアウト保護 (25秒)
const timer = setTimeout(() => {
  console.error('\n❌ タイムアウト: MCP サーバーからの応答がありませんでした。');
  console.error('💡 WordPress 側に公式プラグイン「WordPress/mcp-adapter」がインストール・有効化されているかご確認ください。');
  cleanup(1);
}, 25000);

function cleanup(code) {
  clearTimeout(timer);
  child.kill();
  process.exit(code);
}

// 初期化リクエスト送信 (MCP Protocol 2024-11-05)
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'hp-official-mcp-tester',
      version: '1.0.0'
    }
  }
});
