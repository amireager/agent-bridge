const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const controls = {};
const apiCalls = [];
global.document = { getElementById:id=>controls[id]||null, documentElement:{setAttribute(){}} };
global.window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])), api: async (path, body) => { apiCalls.push({path,body}); return path === '/api/translate' ? {translation:'translated',engine:'custom-openai:local',elapsed_ms:12} : path === '/api/translate/ping' ? {ok:true,latency_ms:8,engine:'custom-rest',sample:'connected'} : {}; } },
  ABMarkdown: {render: text=>`<p>${text}</p>`},
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

// Simulate a successful-ping SSE render while the saved config is still online.
Object.assign(controls, {
  sMode:{value:'offline'}, sEnabled:{checked:true}, sEngine:{value:'online-google'},
  sProxy:{value:''}, sProtocol:{value:'rest'}, sOfflineUrl:{value:'http://127.0.0.1:18095'},
  sOfflineModel:{value:'local-translator'}, sSampleMode:{value:'offline'}, sTestResult:{textContent:'',style:{}},
  onlineFields:{hidden:false}, offlineFields:{hidden:true}
});
window.ABSettingsPage.render(host, state, 'set-translate');
assert.match(host.innerHTML, /<option value="offline" selected>آفلاین/);
assert.match(host.innerHTML, /id="sOfflineUrl" value="http:\/\/127\.0\.0\.1:18095"/);
assert.match(host.innerHTML, /id="sSampleMode"[\s\S]*?<option value="offline" selected>آفلاین/);
controls.sSampleInput={value:'متن نمونه'};
controls.sSampleTarget={value:'en'};
controls.sSampleOutput={textContent:'',innerHTML:''};
controls.sSampleMeta={textContent:''};
controls.sSampleMode.value='offline';
window.ABSettingsPage.setSampleTranslationMode();
(async()=>{
  await window.ABSettingsPage.testConnection();
  window.ABSettingsPage.render(host, state, 'set-translate'); // emulate the server state event after test success
  assert.match(controls.sTestResult.textContent,/اتصال و ترجمه موفق/);
  assert.match(host.innerHTML,/<option value="offline" selected>آفلاین/);
  await window.ABSettingsPage.translateSettingsSample();
  const ping=apiCalls.find(call=>call.path==='/api/translate/ping');
  assert.equal(ping.body.engine,'custom-offline');
  const request=apiCalls.find(call=>call.path==='/api/translate');
  assert.equal(request.body.engine_mode,'offline');
  assert.equal(request.body.engine,'custom-offline');
  assert.equal(request.body.offline_protocol,'rest');
  assert.equal(controls.sSampleMeta.textContent,'مسیر آفلاین · موتور: custom-openai:local · 12 ms');
  console.log('translator settings mode persistence and offline sample smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
