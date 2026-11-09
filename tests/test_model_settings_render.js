const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = {};
for (const id of ['sAccountBaseUrl','sAccountModelsUrl','sProvider','sOnlineAccount','modelProviderDocs']) elements[id] = { value: '', href: '', hidden: false, innerHTML: '' };
global.document = { getElementById: id => elements[id] || null };
global.ABApp = { getState: () => ({ config: {} }) };
global.window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])), api: async () => ({providers:{},accounts:[],locked:false,encryption_enabled:false}) },
  ABApp: { getState: () => ({ config: {} }) }
};
vm.runInThisContext(fs.readFileSync('frontend/pages/settings/settings.js', 'utf8'));
const host = { innerHTML: '' };
const state = {
  config: {
    tap: { upstream_url: 'http://127.0.0.1:8080', lab_enable_tools: true, lab_system_prompt: '' },
    models: { default_mode: 'local', default_model: '', active_account_id: '', online_fallback: false },
    ui: {}, translation: {}
  },
  model_vault: { locked: false, encryption_enabled: false, accounts: [] },
  model_providers: {
    'opencode-zen': { name:'OpenCode Zen', base_url:'https://opencode.ai/zen/v1', models_url:'https://opencode.ai/zen/v1/models', docs:'https://opencode.ai/docs/zen/' }
  }
};
window.ABSettingsPage.render(host, state, 'set-tap');
assert.match(host.innerHTML, /اتصال مدل و پیش‌فرض Agent/);
assert.match(host.innerHTML, /مدل لوکال · مسیر اصلی/);
assert.match(host.innerHTML, /OpenCode Zen/);
assert.match(host.innerHTML, /رمزگذاری کلیدهای حساب‌ها/);
assert.match(host.innerHTML, /اگر مدل لوکال در دسترس نبود/);
console.log('model settings render smoke: PASS');
