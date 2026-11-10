const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = {};
const ids = ['sTheme','sFont','sSide','sThink','sThinkDefault','sBoxStyle','sThinkStyle','sToolStyle','sTranslationStyle','sMarkdownStyle','sImageSize','sChatMode','sParagraphSpacing','sImageMode','sCodeWrap','sCodeTheme','sCodeLines','sToolOutputMode','uiMarkdownPreview','uiImagePreview','uiToolPreview','uiThinkPreview','uiThinkTranslation','uiPreviewMeta','sTranslateThink','sTools','sTokens','sCost','sRecentLimit','sXrayLimit','uiPreviewStatus'];
for (const id of ids) elements[id] = { value:'', checked:false, textContent:'', style:{}, dataset:{}, classList:{toggle(){}}, open:false };
const rootAttrs = {};
const fakeButtons = [];
global.document = {
  getElementById: id => elements[id] || null,
  querySelectorAll: () => fakeButtons,
  documentElement: { setAttribute: (key, value) => { rootAttrs[key] = value; } }
};
global.window = {
  ABUtils: { esc: String, api: async () => ({}) },
  ABMarkdown: { renderBlocks: (_b,_e,_f,mode) => `<sample mode="${mode}"></sample>`, render: text => `<p>${text}</p>` },
  ABApp: { getState: () => ({ config: { ui: { theme:'mocha-dark', font_scale:'normal', sidebar_side:'right', show_think:true, think_default_mode:'half', box_style:'outlined', think_style:'violet', tool_style:'cards', translation_style:'accent', markdown_style:'reader', image_size:'large', chat_mode:'interleaved', paragraph_spacing:'comfortable', image_mode:'click', code_wrap:'scroll', code_theme:'midnight', show_code_lines:false, tool_output_mode:'terminal', translate_thinking:false, show_tools:true, show_inline_tokens:true, show_shadow_cost:true, recent_requests_limit:10, xray_limit:40 } } }) }
};
vm.runInThisContext(fs.readFileSync('frontend/pages/settings/settings.js', 'utf8'));
const state = { config: { ui: { theme:'mocha-dark', font_scale:'normal', sidebar_side:'right', show_think:true, think_default_mode:'half', box_style:'outlined', think_style:'violet', tool_style:'cards', translation_style:'accent', markdown_style:'reader', image_size:'large', chat_mode:'interleaved', paragraph_spacing:'comfortable', image_mode:'click', code_wrap:'scroll', code_theme:'midnight', show_code_lines:false, tool_output_mode:'terminal', translate_thinking:false, show_tools:true, show_inline_tokens:true, show_shadow_cost:true, recent_requests_limit:10, xray_limit:40 }, translation:{}, tap:{} } };
const host = { innerHTML:'' };
window.ABSettingsPage.render(host, state, 'set-hud');
assert.match(host.innerHTML, /ui-theme-preview/);
assert(host.innerHTML.indexOf('sRecentLimit') < host.innerHTML.indexOf('ui-theme-preview'), 'all appearance controls must be above the live preview');
assert.match(host.innerHTML, /شفق قطبی/);
assert.match(host.innerHTML, /sThinkDefault/);
assert.match(host.innerHTML, /۶ خط/);
assert.match(host.innerHTML, /uiMarkdownPreview/);
assert.match(elements.uiMarkdownPreview.innerHTML, /mode="interleaved"/);
assert.match(elements.uiToolPreview.innerHTML, /terminal-view/);
assert.match(host.innerHTML, /value="neon"/);
assert.match(host.innerHTML, /value="contrast"/);
for (const [id, expected] of [['sBoxStyle',5],['sThinkStyle',5],['sToolStyle',5],['sTranslationStyle',6],['sMarkdownStyle',5],['sChatMode',5],['sParagraphSpacing',5],['sImageMode',5],['sImageSize',5],['sCodeWrap',4],['sCodeTheme',5],['sToolOutputMode',4]]) {
  const match = host.innerHTML.match(new RegExp(`<select id=\"${id}\"[^>]*>(.*?)</select>`));
  assert(match, `${id} selector exists`);
  assert.equal((match[1].match(/<option/g) || []).length, expected, `${id} has ${expected} meaningful options`);
}
assert.equal(elements.sTheme.value, 'mocha-dark');
elements.sTheme.value = 'paper-light';
elements.sBoxStyle.value = 'soft';
elements.sThinkStyle.value = 'focus';
elements.sToolStyle.value = 'compact';
elements.sTranslationStyle.value = 'contrast';
elements.sMarkdownStyle.value = 'technical';
elements.sImageSize.value = 'small';
elements.sChatMode.value = 'side_by_side';
elements.sImageMode.value = 'inline';
elements.sToolOutputMode.value = 'markdown';
window.ABSettingsPage.previewUI();
assert.equal(rootAttrs['data-theme'], 'paper-light');
assert.equal(rootAttrs['data-box-style'], 'soft');
assert.equal(rootAttrs['data-think-style'], 'focus');
assert.equal(rootAttrs['data-tool-style'], 'compact');
assert.equal(rootAttrs['data-translation-style'], 'contrast');
assert.equal(rootAttrs['data-markdown-style'], 'technical');
assert.equal(rootAttrs['data-image-size'], 'small');
assert.equal(rootAttrs['data-image-mode'], 'inline');
assert.match(elements.uiMarkdownPreview.innerHTML, /side_by_side/);
assert.match(elements.uiToolPreview.innerHTML, /tool-readable-content/);
elements.sToolOutputMode.value = 'plain';
window.ABSettingsPage.previewUI();
assert.match(elements.uiToolPreview.innerHTML, /tool-plain-output/);
elements.sToolOutputMode.value = 'json';
window.ABSettingsPage.previewUI();
assert.match(elements.uiToolPreview.innerHTML, /tool-plain-body/);
window.ABSettingsPage.applyPreset('aurora');
assert.equal(elements.sTheme.value, 'forest-dark');
assert.equal(elements.sThinkStyle.value, 'focus');
window.ABSettingsPage.cancelUIPreview();
assert.equal(rootAttrs['data-theme'], 'mocha-dark');
assert.equal(rootAttrs['data-box-style'], 'outlined');
assert.equal(rootAttrs['data-translation-style'], 'accent');
assert.equal(elements.sTheme.value, 'mocha-dark');
window.ABSettingsPage.resetUIToDefaults();
assert.equal(elements.sTheme.value, 'openwebui-dark');
assert.equal(elements.sThinkDefault.value, 'half');
console.log('user appearance settings render and preview smoke: PASS');
