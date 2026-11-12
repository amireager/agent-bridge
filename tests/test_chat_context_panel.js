const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const panel = {
  innerHTML: '', hidden: true,
  querySelector() { return null; },
};
const trigger = { attributes:{}, setAttribute(name, value) { this.attributes[name] = value; } };
global.document = { getElementById: id => id === 'chatContextPanel' ? panel : (id === 'chatContextTrigger' ? trigger : null) };
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
assert.equal(panel.hidden, true, 'context panel stays out of the way by default');
window.ABChatPage.toggleContext();
assert.equal(panel.hidden, false, 'context control opens the details popover');
assert.equal(trigger.attributes['aria-expanded'], 'true');
window.ABChatPage.toggleContext();
assert.equal(panel.hidden, true, 'context control closes the details popover');
assert.equal(trigger.attributes['aria-expanded'], 'false');
console.log('chat context meter, popover controls, and truthful fallback tests: OK');
