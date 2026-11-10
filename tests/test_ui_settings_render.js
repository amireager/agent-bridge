const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = {};
const ids = ['sTheme','sFont','sSide','sThink','sThinkDefault','sTranslateThink','sTools','sTokens','sCost','sRecentLimit','sXrayLimit','uiPreviewStatus'];
for (const id of ids) elements[id] = { value:'', checked:false, textContent:'', style:{} };
const rootAttrs = {};
global.document = {
  getElementById: id => elements[id] || null,
  documentElement: { setAttribute: (key, value) => { rootAttrs[key] = value; } }
};
global.window = {
  ABUtils: { esc: String, api: async () => ({}) },
  ABApp: { getState: () => ({ config: { ui: { theme:'mocha-dark', font_scale:'normal', sidebar_side:'right', show_think:true, think_default_mode:'half', translate_thinking:false, show_tools:true, show_inline_tokens:true, show_shadow_cost:true, recent_requests_limit:10, xray_limit:40 } } }) }
};
vm.runInThisContext(fs.readFileSync('frontend/pages/settings/settings.js', 'utf8'));
const state = { config: { ui: { theme:'mocha-dark', font_scale:'normal', sidebar_side:'right', show_think:true, think_default_mode:'half', translate_thinking:false, show_tools:true, show_inline_tokens:true, show_shadow_cost:true, recent_requests_limit:10, xray_limit:40 }, translation:{}, tap:{} } };
const host = { innerHTML:'' };
window.ABSettingsPage.render(host, state, 'set-hud');
assert.match(host.innerHTML, /ui-theme-preview/);
assert.match(host.innerHTML, /sThinkDefault/);
assert.match(host.innerHTML, /۶ خط/);
assert.equal(elements.sTheme.value, 'mocha-dark');
elements.sTheme.value = 'paper-light';
window.ABSettingsPage.previewUI();
assert.equal(rootAttrs['data-theme'], 'paper-light');
window.ABSettingsPage.cancelUIPreview();
assert.equal(rootAttrs['data-theme'], 'mocha-dark');
assert.equal(elements.sTheme.value, 'mocha-dark');
window.ABSettingsPage.resetUIToDefaults();
assert.equal(elements.sTheme.value, 'openwebui-dark');
assert.equal(elements.sThinkDefault.value, 'half');
console.log('user appearance settings render and preview smoke: PASS');
