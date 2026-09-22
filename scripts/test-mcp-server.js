#!/usr/bin/env node

/**
 * STK Lab - WordPress MCP サーバー疎通・機能テストスクリプト
 * stdio (JSON-RPC 2.0) 経由で scripts/wp-mcp-server.js を起動し、
 * initialize, tools/list, tools/call (wp_test_connection) を検証します。
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🤖 WordPress MCP サーバー（ローカル版）のテストを開始します...\n');

const child = spawn(process.execPath, [path.resolve(__dirname, 'wp-mcp-server.js')], {
  stdio: ['pipe', 'pipe', 'inherit']
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
      // ignore non-json
    }
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function handleMessage(msg) {
  if (msg.id === 1 && msg.result) {
    console.log('✅ [1/3] initialize 成功！ サーバー情報:', msg.result.serverInfo);
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    console.log('🔍 [2/3] tools/list 要求中...');
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  } else if (msg.id === 2 && msg.result) {
    const tools = msg.result.tools || [];
    console.log(`✅ [2/3] tools/list 成功！ 利用可能ツール: ${tools.length} 件`);
    tools.forEach(t => console.log(`   - 🔧 ${t.name}: ${t.description}`));
    console.log('\n🚀 [3/3] tools/call (wp_test_connection) 実行中...');
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'wp_test_connection', arguments: {} }
    });
  } else if (msg.id === 3) {
    if (msg.error) {
      console.error('❌ [3/3] tools/call エラー:', msg.error);
      cleanup(1);
    } else {
      console.log('✅ [3/3] tools/call 成功！ レスポンス:');
      const text = msg.result?.content?.[0]?.text;
      console.log(text);
      console.log('\n🎉 WordPress MCP サーバーの全機能疎通テストが完了しました！');
      cleanup(0);
    }
  }
}

const timer = setTimeout(() => {
  console.error('❌ タイムアウト: 応答がありませんでした。');
  cleanup(1);
}, 20000);

function cleanup(code) {
  clearTimeout(timer);
  child.kill();
  process.exit(code);
}

// 1. initialize 送信
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }
});
