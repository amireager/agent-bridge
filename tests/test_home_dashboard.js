const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/pages/home/home.js', 'utf8');
const window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]) },
  ABApp: { navigate() {}, toggleProxyMode() {}, selectMirror() {}, selectLab() {} },
};
vm.runInNewContext(source, { window, navigator: {}, setTimeout });

function render(state) {
  const host = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  window.ABHomePage.render(host, state);
  return host.innerHTML;
}

const common = {
  bridge_port: 18080,
  config: {
    translation: { enabled: true, engine: 'online-google-gtx' },
    models: { default_mode: 'local', default_model: 'local-model' },
  },
  model_status: { mode: 'local', local_online: true, alert: false },
  model_providers: { openrouter: { name: 'OpenRouter' } },
  model_vault: { locked: false, accounts: [{ id: 'acct-1', provider: 'openrouter', label: 'Personal', enabled: true }] },
  upstream: { online: true, detected_model: 'local-model', available_models: ['local-model', 'local-second-model'], server_ctx: 65536 },
  translator_online: true,
  mirrors: [],
  lab_sessions: [],
  active_routes: [],
  usage: { recent: [] },
};

const empty = render(common);
assert.match(empty, /کنسول مسیر درخواست/);
assert.match(empty, /local-model/);
assert.match(empty, /local-second-model/);
assert.match(empty, /Google Translate · GTX/);
assert.match(empty, /Inference محلی/);
assert.match(empty, /source-empty/);
assert.match(empty, /route-wires/);
assert.match(empty, /در حال حاضر درخواست فعالی در مسیر نیست/);
assert.match(empty, /درخواست‌های اخیر/);
assert.match(empty, /Lab داخلی/);

const connected = render({
  ...common,
  mirrors: [
    { agent_id: 'pi-1', pty_live: true, activity: 'IDLE' },
    { agent_id: 'omp-2', pty_live: true, activity: 'GENERATING' },
    { agent_id: 'old-offline', pty_live: false, activity: 'IDLE' },
  ],
  lab_sessions: [{ id: 'lab-session-01', title: 'نمونه Lab', turn_count: 4, archived: false }],
  active_routes: [{ agent_id: 'omp-2', route_mode: 'local', provider: 'local', model: 'local-model', status: 'IN_FLIGHT' }],
});
assert.match(connected, /data-agent="pi-1"/);
assert.match(connected, /data-agent="omp-2"/);
assert.doesNotMatch(connected, /data-agent="old-offline"/);
assert.match(connected, /PTYهای زنده/);
assert.match(connected, /data-lab="lab-session-01"/);
assert.match(connected, /has-traffic/);
assert.match(connected, /1 درخواست در پرواز/);
assert.match(connected, /omp-2/);
assert.match(connected, /local-model/);
assert.match(connected, /در حال اجرا/);

const recent = render({
  ...common,
  usage: { recent: [{ id: 34, time: '12:05:06', agent: 'hermes-2', model: 'Qwen-Test', provider: 'OpenRouter', route_mode: 'online', total_in: 1234, out_tok: 250 }] },
});
assert.match(recent, /hermes-2/);
assert.match(recent, /Qwen-Test/);
assert.match(recent, /OpenRouter · مسیر آنلاین/);
assert.match(recent, /1,234 in/);

const online = render({
  ...common,
  config: {
    translation: { enabled: false, engine: 'custom-offline', offline_model: 'translator-v2', offline_protocol: 'rest' },
    models: { default_mode: 'online', active_account_id: 'acct-1', online_model: 'cloud-model-x' },
  },
  model_status: { mode: 'online', alert: false },
});
assert.match(online, /cloud-model-x/);
assert.match(online, /OpenRouter/);
assert.match(online, /translator-v2/);
assert.match(online, /BYPASS/);
assert.match(online, /ONLINE/);

const offline = render({
  ...common,
  upstream: { online: false, detected_model: 'listening...', available_models: [], server_ctx: 0 },
  model_status: { mode: 'local', local_online: false, alert: true },
});
assert.match(offline, /سرور مدل قطع است/);
assert.match(offline, /target-primary offline/);
assert.doesNotMatch(offline, /target-primary ready/);

console.log('home dashboard route console tests: OK');
