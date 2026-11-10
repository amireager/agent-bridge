const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const attrs = { 'data-image-mode': 'click' };
global.document = { documentElement: { getAttribute: key => attrs[key] || null } };
global.window = { ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])) } };
vm.runInThisContext(fs.readFileSync('frontend/core/markdown.js', 'utf8'));
let html = window.ABMarkdown.render('![mountain](https://example.test/mountain.png)');
assert.match(html, /md-image-reveal/);
assert.doesNotMatch(html, /<img src=/);
attrs['data-image-mode'] = 'off';
html = window.ABMarkdown.render('![mountain](https://example.test/mountain.png)');
assert.match(html, /md-image-blocked/);
assert.doesNotMatch(html, /<img src=/);
attrs['data-image-mode'] = 'inline';
html = window.ABMarkdown.render('![mountain](https://example.test/mountain.png)');
assert.match(html, /<img src="https:\/\/example\.test\/mountain\.png"/);
assert.doesNotMatch(window.ABMarkdown.render('![x](javascript:alert(1))'), /<img src=/);
const blocks = [
  {type:'prose', en:'Original text.', fa:'متن اصلی.'},
  {type:'code', raw:'```js\nconst x = 1;\n```'}
];
const side = window.ABMarkdown.renderBlocks(blocks, '', '', 'side_by_side');
assert.match(side, /side-by-side/);
assert.equal((side.match(/class="md-code"/g) || []).length, 1);
const below = window.ABMarkdown.renderBlocks(blocks, '', '', 'fa_after');
assert.match(below, /translation-review-flow/);
assert.equal((below.match(/class="md-code"/g) || []).length, 1);
console.log('markdown media and translation layout smoke: PASS');
