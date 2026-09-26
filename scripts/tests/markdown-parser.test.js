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
assert(tableOutput.includes('class="scrollable-table responsive-table-wrapper"'), 'Cocoon横スクロールラッパーが含まれること');
assert(tableOutput.includes('<table class="wp-block-table is-style-stripes"'), 'Gutenbergテーブルクラスが含まれること');
assert(tableOutput.includes('>ツール名</th>'), 'ヘッダーthが含まれること');
assert(tableOutput.includes('>Keepa</td>'), 'セルtdが含まれること');
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

// 9. 同一行内複数リンクの target="_blank" 属性破壊防止テスト
console.log('Test 9: 複数リンクの target="_blank" 属性保護');
const multiLinkInput = '[価格.com](https://kakaku.com/)、[マイベスト](https://my-best.com/)';
const multiLinkOutput = parseInline(multiLinkInput);
assert(multiLinkOutput.includes('target="_blank"'), 'target="_blank" が属性として保持されること');
assert(!multiLinkOutput.includes('target="<em>blank'), 'target="_blank" のアンダースコアが斜体に誤変換されないこと');
assert(!multiLinkOutput.includes('</em>blank"'), '斜体閉じタグが属性値に混入しないこと');
console.log('  ✅ 通過: 複数リンク属性保護\n');

// 10. テーブル内複数リンクの target="_blank" 属性破壊防止テスト
console.log('Test 10: テーブル内複数リンクの属性保護');
const tableMultiLinkInput = `
| ツール | URL |
| --- | --- |
| 比較サイト | [サイトA](https://example.com/a) / [サイトB](https://example.com/b) |
`.trim();
const tableMultiLinkOutput = simpleMarkdownToHtml(tableMultiLinkInput);
assert(tableMultiLinkOutput.includes('target="_blank"'), 'テーブル内のtarget="_blank"が保持されること');
assert(!tableMultiLinkOutput.includes('target="<em>blank'), 'テーブル内のtarget="_blank"が斜体に誤変換されないこと');
assert(tableMultiLinkOutput.includes('</table>'), 'テーブルが正しく閉じられていること');
console.log('  ✅ 通過: テーブル内複数リンク保護\n');

// 11. インデント付き・ネストリストの変換テスト
console.log('Test 11: インデント付き・ネストリストの変換');
const nestedListInput = `
1. まず課題をメモする
2. アイテムを検索・比較する
   * **AIへの相談も有効**: 自然な言葉で質問する
* 親項目
  * 子項目A
  * 子項目B
`.trim();
const nestedListOutput = simpleMarkdownToHtml(nestedListInput);
assert(nestedListOutput.includes('<ol><li>まず課題をメモする</li><li>アイテムを検索・比較する<ul><li><strong>AIへの相談も有効</strong>: 自然な言葉で質問する</li></ul></li></ol>'), '番号付きリスト配下のインデントリストが正しくネストされること');
assert(nestedListOutput.includes('<ul><li>親項目<ul><li>子項目A</li><li>子項目B</li></ul></li></ul>'), '箇条書き配下のインデントリストが正しくネストされること');
assert(!nestedListOutput.includes('* **AIへの相談も有効**'), '未変換のアスタリスクが残らないこと');
console.log('  ✅ 通過: インデント付き・ネストリスト\n');

// 12. GFM Alerts 内での空行なし箇条書きの分離テスト
console.log('Test 12: GFM Alerts 内での空行なし箇条書きの分離');
const alertListInput = `
> [!WARNING]
> **粗悪品・サクラレビューを見切る3つのフィルター**
>
> ネットショッピングで失敗しないための簡単なフィルターです。
> * **評価の分布をチェック**: 星5と星1を注意
> * **相場を見切る**: 半額以下は危険
`.trim();
const alertListOutput = simpleMarkdownToHtml(alertListInput);
assert(alertListOutput.includes('<p>ネットショッピングで失敗しないための簡単なフィルターです。</p>'), '説明文が独立した段落として変換されること');
assert(alertListOutput.includes('<ul><li><strong>評価の分布をチェック</strong>: 星5と星1を注意</li><li><strong>相場を見切る</strong>: 半額以下は危険</li></ul>'), '箇条書きが独立したリストタグとして変換されること');
assert(!alertListOutput.includes('* **評価の分布をチェック**'), 'アスタリスクがテキストとして剥き出しにならないこと');
console.log('  ✅ 通過: GFM Alerts 内の箇条書き分離\n');

// 13. 見出し直後に空行がない段落の太字パーステスト
console.log('Test 13: 見出し直後に空行がない段落の太字パース');
const headingTightInput = `
### 1. なぜ「おすすめ（ホーム画面）」を見てはいけないのか
YouTubeのホーム画面は**「あなたを長く引き止めるため」**に最適化されています。
`.trim();
const headingTightOutput = simpleMarkdownToHtml(headingTightInput);
assert(headingTightOutput.includes('<h3>1. なぜ「おすすめ（ホーム画面）」を見てはいけないのか</h3>'), '見出しが正しく変換されること');
assert(headingTightOutput.includes('<strong>「あなたを長く引き止めるため」</strong>'), '見出し直後の太字が確実に変換されること');
assert(headingTightOutput.includes('<p>YouTubeのホーム画面は'), '見出し直後の文章がpタグで囲まれること');
console.log('  ✅ 通過: 見出し直後の太字パース\n');

// 14. 吹き出しの洗練化（SVGアバターと構造）テスト
console.log('Test 14: 吹き出しのSVGアバターと構造');
const balloonInput = `
::: balloon reader
質問があります。
:::
::: balloon author
お答えします！
:::
`.trim();
const balloonOutput = simpleMarkdownToHtml(balloonInput);
assert(balloonOutput.includes('<figure class="speech-icon"><img src="data:image/svg+xml;utf8,'), '吹き出しにSVGアバター画像が含まれること');
assert(balloonOutput.includes('alt="読者"'), '読者のaltテキストが含まれること');
assert(balloonOutput.includes('alt="筆者"'), '筆者のaltテキストが含まれること');
assert(balloonOutput.includes('class="speech-icon-image"'), 'Cocoonのアイコンクラスが付与されること');
console.log('  ✅ 通過: 吹き出しSVGアバター\n');

// 15. テーブルのレスポンシブスタイル付与テスト
console.log('Test 15: テーブルのレスポンシブスタイル');
const tableStyleInput = `
| A | B |
| --- | --- |
| 1 | 2 |
`.trim();
const tableStyleOutput = simpleMarkdownToHtml(tableStyleInput);
assert(tableStyleOutput.includes('style="width: 100%; border-collapse: collapse; table-layout: auto; word-break: break-word;"'), 'テーブルにPC全幅表示用スタイルが含まれること');
assert(tableStyleOutput.includes('style="padding: 10px 14px; vertical-align: top;"'), 'セルに適切なパディングスタイルが含まれること');
console.log('  ✅ 通過: テーブルレスポンシブスタイル\n');

console.log('🎉 すべての単体テスト（全15件）に合格しました！');
