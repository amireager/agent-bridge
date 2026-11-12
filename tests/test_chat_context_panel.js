const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const panel = {
  innerHTML: '',
  querySelector() { return null; },
};
global.document = { getElementById: id => id === 'chatContextPanel' ? panel : null };
global.window = { ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])) } };
vm.runInThisContext(fs.readFileSync('frontend/pages/chat/chat.js', 'utf8'));

const state = {
  config: { models: { default_mode: 'local' } },
  upstream: { online: true, detected_model: 'test-model' },
  session_state: 'IDLE',
};
window.ABChatPage.renderContextPanel(state, [{
  model: 'test-model',
  metrics: { uncached_in: 760, cached_in: 240, out_tok: 120, tg_tps: 18 },
  context_usage: {
    prompt_tokens: 1000, output_tokens: 120, used_tokens: 1120,
    limit_tokens: 4096, remaining_tokens: 2976,
    prompt_reported: true, output_reported: true, reported: true,
  },
}]);
assert.match(panel.innerHTML, /1,120 \/ 4,096/);
assert.match(panel.innerHTML, /27٪ مصرف/);
assert.match(panel.innerHTML, /2,976 توکن برآوردی باقی‌مانده/);
assert.match(panel.innerHTML, /ورودی cache‌شده/);
assert.match(panel.innerHTML, /تضمین ظرفیت پاسخ بعدی نیست/);

window.ABChatPage.renderContextPanel(state, [{ model: 'unknown-model', metrics: {}, context_usage: {} }]);
assert.match(panel.innerHTML, /شمارندهٔ دقیق پس از گزارش runtime نمایش داده می‌شود/);
assert.match(panel.innerHTML, /بدون تخمین ساختگی/);
assert.match(panel.innerHTML, /قابل محاسبه نیست/);
console.log('chat context meter and truthful fallback tests: OK');
