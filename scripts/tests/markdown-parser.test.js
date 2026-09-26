const assert = require('assert');
const { simpleMarkdownToHtml, parseInline } = require('../wp-draft-post.js');

console.log('🧪 Markdownパーサー単体テスト開始...\n');

// 1. インライン要素テスト
console.log('Test 1: インライン要素（太字、斜体、インラインコード、リンク）');
const inlineInput = '**太字テキスト** と _斜体テキスト_ と `inline code` と [Google](https://google.com)';
const inlineOutput = parseInline(inlineInput);
assert(inlineOutput.includes('<strong>太字テキスト</strong>'), '太字が正しく変換されること');
assert(inlineOutput.includes('<em>斜体テキスト</em>'), '斜体が正しく変換されること');
assert(inlineOutput.includes('<code>inline code</code>'), 'インラインコードが正しく変換されること');
assert(inlineOutput.includes('<a href="https://google.com" target="_blank" rel="noopener noreferrer">Google</a>'), 'リンクが正しく変換されること');
console.log('  ✅ 通過: インライン要素\n');

// 2. GFM Alerts テスト
console.log('Test 2: GFM Alerts（NOTE, TIP, WARNING, IMPORTANT）');
const gfmInput = `
> [!NOTE]
> これは補足情報です。

> [!TIP]
> **重要なコツ**
> 1日1歩ずつ進めましょう。

> [!WARNING]
> 注意してください！

> [!IMPORTANT]
> 絶対に忘れないでください。
`.trim();

const gfmOutput = simpleMarkdownToHtml(gfmInput);
assert(gfmOutput.includes('info-box'), 'NOTE が info-box に変換されること');
assert(gfmOutput.includes('success-box'), 'TIP が success-box に変換されること');
assert(gfmOutput.includes('重要なコツ'), 'TIP のカスタムタイトルが反映されること');
assert(gfmOutput.includes('warning-box'), 'WARNING が warning-box に変換されること');
assert(gfmOutput.includes('danger-box'), 'IMPORTANT が danger-box に変換されること');
console.log('  ✅ 通過: GFM Alerts\n');

// 3. ミニマルコンテナ（吹き出し、ボタン）テスト
console.log('Test 3: ミニマルコンテナ（吹き出し、ボタン）');
const containerInput = `
::: balloon reader
どうやって始めればいいですか？
:::

::: balloon author
まずはメモを取ることから始めましょう！
:::

::: btn https://stk-lab.org
公式サイトを見る
:::
`.trim();

const containerOutput = simpleMarkdownToHtml(containerInput);
assert(containerOutput.includes('speech-wrap'), '吹き出しクラスが含まれること');
assert(containerOutput.includes('読者'), 'reader が 読者 に変換されること');
assert(containerOutput.includes('sbp-l'), '読者の吹き出しが左配置(sbp-l)になること');
assert(containerOutput.includes('筆者'), 'author が 筆者 に変換されること');
assert(containerOutput.includes('sbp-r'), '筆者の吹き出しが右配置(sbp-r)になること');
assert(containerOutput.includes('wp-block-button'), 'ボタンブロックが含まれること');
assert(containerOutput.includes('href="https://stk-lab.org"'), 'ボタンリンクが反映されること');
console.log('  ✅ 通過: ミニマルコンテナ\n');

// 4. Markdown テーブルテスト
console.log('Test 4: Markdown テーブル');
const tableInput = `
| ツール名 | 用途 | 評価 |
| --- | --- | --- |
| Keepa | 価格追跡 | ★★★★★ |
| サクラチェッカー | レビュー検証 | ★★★★☆ |
`.trim();

const tableOutput = simpleMarkdownToHtml(tableInput);
assert(tableOutput.includes('<div class="scrollable-table">'), 'Cocoon横スクロールラッパーが含まれること');
assert(tableOutput.includes('<table class="wp-block-table is-style-stripes">'), 'Gutenbergテーブルクラスが含まれること');
assert(tableOutput.includes('<th>ツール名</th>'), 'ヘッダーthが含まれること');
assert(tableOutput.includes('<td>Keepa</td>'), 'セルtdが含まれること');
console.log('  ✅ 通過: Markdown テーブル\n');

// 5. コードブロック保護テスト
console.log('Test 5: コードブロックの保護');
const codeInput = `
\`\`\`js
const x = 10;
// **ここは太字にならないべき**
\`\`\`
`.trim();
const codeOutput = simpleMarkdownToHtml(codeInput);
assert(codeOutput.includes('<pre class="wp-block-code"><code class="language-js">'), 'コードブロックタグが含まれること');
assert(codeOutput.includes('// **ここは太字にならないべき**'), 'コード内のMarkdown記法がそのまま保護されること');
console.log('  ✅ 通過: コードブロック保護\n');

// 6. 指示コメント除去テスト
console.log('Test 6: 制作指示コメントの自動除去');
const commentInput = `
<!-- 💡 [WordPress表現指示: 吹き出し] -->
<!-- 🖼️ [挿入画像指示: 図解] -->
本文です。
`.trim();
const commentOutput = simpleMarkdownToHtml(commentInput);
assert(!commentOutput.includes('[WordPress表現指示'), '指示コメントが除去されること');
assert(!commentOutput.includes('[挿入画像指示'), '画像指示コメントが除去されること');
assert(commentOutput.includes('<p>本文です。</p>'), '本文が正しく出力されること');
console.log('  ✅ 通過: 指示コメント除去\n');

// 7. GFM Alerts 内のリストと複数段落テスト
console.log('Test 7: GFM Alerts 内のリストと複数段落');
const complexAlertInput = `
> [!TIP]
> **実践ステップ**
>
> * 最初のステップを試す
> * 次のステップに進む
>
> これで準備完了です。
`.trim();
const complexAlertOutput = simpleMarkdownToHtml(complexAlertInput);
assert(complexAlertOutput.includes('実践ステップ'), 'カスタムタイトルが含まれること');
assert(complexAlertOutput.includes('<ul><li>最初のステップを試す</li><li>次のステップに進む</li></ul>'), 'リストがHTMLリストとして含まれること');
assert(complexAlertOutput.includes('<p>これで準備完了です。</p>'), '段落が含まれること');
console.log('  ✅ 通過: GFM Alerts 内のリストと段落\n');

// 8. テーブル内のインライン要素テスト
console.log('Test 8: テーブル内のリンクと太字');
const tableInlineInput = `
| 項目 | 詳細 |
| --- | --- |
| **重要** | [リンク](https://example.com) |
`.trim();
const tableInlineOutput = simpleMarkdownToHtml(tableInlineInput);
assert(tableInlineOutput.includes('<strong>重要</strong>'), 'テーブルセル内にstrongタグが含まれること');
assert(tableInlineOutput.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">リンク</a>'), 'テーブルセル内にaタグが含まれること');
console.log('  ✅ 通過: テーブル内インライン要素\n');

console.log('🎉 すべての単体テストに合格しました！');
