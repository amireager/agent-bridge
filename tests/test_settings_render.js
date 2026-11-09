const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

global.window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])), api: async () => ({}) },
  ABApp: { getState: () => ({ config: {} }) }
};
vm.runInThisContext(fs.readFileSync('frontend/pages/settings/settings.js', 'utf8'));
const host = { innerHTML: '' };
const state = {
  config: {
    translation: { enabled: true, engine: 'online-google', proxy: '', offline_protocol: 'openai', offline_url: 'http://127.0.0.1:18095', offline_model: 'local-translator' },
    ui: {}, tap: {}
  },
  glossary: [{ fa: 'حافظه نهان', en: 'cache' }]
};
window.ABSettingsPage.render(host, state, 'set-translate');
assert.match(host.innerHTML, /value="online"/);
assert.match(host.innerHTML, /value="offline"/);
assert.match(host.innerHTML, /online-google-gtx/);
assert.match(host.innerHTML, /translator-pair/);
assert.match(host.innerHTML, /راهنمای اتصال و نمونهٔ اجرا/);
assert.match(host.innerHTML, /حافظه نهان/);
assert.match(host.innerHTML, /افزودن واژه/);
console.log('translator settings render smoke: PASS');
