const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = {};
const ids = ['sTheme','sFont','sSide','sThink','sThinkDefault','sBoxStyle','sThinkStyle','sToolStyle','sChatMode','sParagraphSpacing','sImageMode','sCodeWrap','sCodeTheme','sCodeLines','sToolOutputMode','uiMarkdownPreview','uiImagePreview','uiToolPreview','sTranslateThink','sTools','sTokens','sCost','sRecentLimit','sXrayLimit','uiPreviewStatus'];
for (const id of ids) elements[id] = { value:'', checked:false, textContent:'', style:{} };
const rootAttrs = {};
global.document = {
  getElementById: id => elements[id] || null,
  documentElement: { setAttribute: (key, value) => { rootAttrs[key] = value; } }
};
global.window = {
  ABUtils: { esc: String, api: async () => ({}) },
  ABMarkdown: { renderBlocks: (_b,_e,_f,mode) => `<sample mode="${mode}"></sample>`, render: text => `<p>${text}</p>` },
  ABApp: { getState: () => ({ config: { ui: { theme:'mocha-dark', font_scale:'normal', sidebar_side:'right', show_think:true, think_default_mode:'half', box_style:'outlined', think_style:'violet', tool_style:'cards', chat_mode:'interleaved', paragraph_spacing:'comfortable', image_mode:'click', code_wrap:'scroll', code_theme:'midnight', show_code_lines:false, tool_output_mode:'terminal', translate_thinking:false, show_tools:true, show_inline_tokens:true, show_shadow_cost:true, recent_requests_limit:10, xray_limit:40 } } }) }
};
vm.runInThisContext(fs.readFileSync('frontend/pages/settings/settings.js', 'utf8'));
const state = { config: { ui: { theme:'mocha-dark', font_scale:'normal', sidebar_side:'right', show_think:true, think_default_mode:'half', box_style:'outlined', think_style:'violet', tool_style:'cards', chat_mode:'interleaved', paragraph_spacing:'comfortable', image_mode:'click', code_wrap:'scroll', code_theme:'midnight', show_code_lines:false, tool_output_mode:'terminal', translate_thinking:false, show_tools:true, show_inline_tokens:true, show_shadow_cost:true, recent_requests_limit:10, xray_limit:40 }, translation:{}, tap:{} } };
const host = { innerHTML:'' };
window.ABSettingsPage.render(host, state, 'set-hud');
assert.match(host.innerHTML, /ui-theme-preview/);
assert.match(host.innerHTML, /sThinkDefault/);
assert.match(host.innerHTML, /۶ خط/);
assert.match(host.innerHTML, /uiMarkdownPreview/);
assert.match(elements.uiMarkdownPreview.innerHTML, /mode="interleaved"/);
assert.match(elements.uiToolPreview.innerHTML, /terminal-view/);
assert.equal(elements.sTheme.value, 'mocha-dark');
elements.sTheme.value = 'paper-light';
elements.sBoxStyle.value = 'soft';
elements.sThinkStyle.value = 'focus';
elements.sToolStyle.value = 'compact';
elements.sChatMode.value = 'side_by_side';
elements.sImageMode.value = 'inline';
elements.sToolOutputMode.value = 'markdown';
window.ABSettingsPage.previewUI();
assert.equal(rootAttrs['data-theme'], 'paper-light');
assert.equal(rootAttrs['data-box-style'], 'soft');
assert.equal(rootAttrs['data-think-style'], 'focus');
assert.equal(rootAttrs['data-tool-style'], 'compact');
assert.equal(rootAttrs['data-image-mode'], 'inline');
assert.match(elements.uiMarkdownPreview.innerHTML, /side_by_side/);
assert.match(elements.uiToolPreview.innerHTML, /tool-readable-content/);
window.ABSettingsPage.cancelUIPreview();
assert.equal(rootAttrs['data-theme'], 'mocha-dark');
assert.equal(rootAttrs['data-box-style'], 'outlined');
assert.equal(elements.sTheme.value, 'mocha-dark');
window.ABSettingsPage.resetUIToDefaults();
assert.equal(elements.sTheme.value, 'openwebui-dark');
assert.equal(elements.sThinkDefault.value, 'half');
console.log('user appearance settings render and preview smoke: PASS');
