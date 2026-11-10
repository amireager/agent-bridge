const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const elements = {};
const ids = ['historyResults','historyResultCount','historyStatus','cleanupDays','cleanupStatus','cleanupPreview','cleanupConfirmDialog','cleanupConfirmSummary','cleanupConfirmButton','retentionDays','retentionAuto','retentionStatus','historyDeleteDialog','historyDeleteMessage','confirmHistoryDeleteButton'];
for (const id of ids) elements[id] = { value:'', checked:false, textContent:'', innerHTML:'', style:{}, hidden:true, disabled:false, dataset:{}, classList:{toggle(){}} };
const apiCalls = [];
global.document = {
  getElementById: id => elements[id] || null,
  querySelectorAll: () => [],
  documentElement: { setAttribute(){} }
};
global.window = {
  ABUtils: { esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])), api: async (path, body) => {
    apiCalls.push({path, body});
    if (path === '/api/cleanup/preview') return { days:body.days, scopes:body.scopes, telemetry_requests:1, xray_frames:1, file_count:1, bytes:1024, files:[{scope:'lab',id:'lab-1',title:'جلسه قدیمی',path:'sessions/lab/lab-1.json',bytes:1024}] };
    if (path === '/api/cleanup/run') return {deleted_requests:1,deleted_xray_frames:1,deleted_files:1,deleted_lab_sessions:1,freed_bytes:1024};
    return {ok:true};
  } },
  ABApp: { getState: () => state, selectLab(){}, selectMirror(){} }
};
vm.runInThisContext(fs.readFileSync('frontend/pages/settings/settings.js', 'utf8'));
const state = { config:{ui:{},translation:{},tap:{},retention:{days:14,auto_prune_on_boot:true}}, storage:{total_kib:2048,file_count:8}, lab_sessions:[{id:'lab-1',title:'Lab session',turn_count:3,updated_at:1,bytes:1024}], lab_history:[{id:'lab-old',title:'Archived Lab',turn_count:4,updated_at:0,bytes:800,archived:true}], mirror_history:[{agent_id:'offline-1',title:'Offline history',turn_count:2,updated_at:2,bytes:700,pty_live:false}], mirrors:[{agent_id:'live-1',title:'Live PTY',turn_count:1,updated_at:3,bytes:500,pty_live:true}] };
const hostListeners = {};
const host = { innerHTML:'', dataset:{}, addEventListener(type, callback){hostListeners[type]=callback;}, contains(){return true;}, querySelectorAll: () => [] };
window.ABSettingsPage.render(host, state, 'set-retention');
assert.match(host.innerHTML, /data-cleanup-tab="history"/);
assert.match(host.innerHTML, /data-cleanup-tab="cleanup"/);
assert.match(host.innerHTML, /جست‌وجو بر اساس عنوان یا شناسه/);
assert.match(elements.historyResults.innerHTML, /زنده · محافظت‌شده/);
assert.match(elements.historyResults.innerHTML, /Archived Lab/);
assert.match(elements.historyResults.innerHTML, /بازگردانی/);
assert.doesNotMatch(elements.historyResults.innerHTML, /data-history-action="delete" data-kind="mirror" data-id="live-1"/);
assert.match(host.innerHTML, /retentionAuto/);
assert.match(host.innerHTML, /data-cleanup-days="90"/);
window.ABSettingsPage.setCleanupRange(0);
window.ABSettingsPage.setCleanupScope('xray', true);
(async () => {
  assert.match(elements.historyResults.innerHTML, /data-history-action="archive" data-kind="lab" data-id="lab-1"/);
  await hostListeners.click({ target:{ closest:()=>({ dataset:{historyAction:'archive',kind:'lab',id:'lab-1'}, disabled:false }) } });
  assert.equal(state.lab_sessions.length, 0);
  assert.equal(state.lab_history.length, 2);
  assert(apiCalls.some(call => call.path === '/api/lab/archive'));
  const preview = await window.ABSettingsPage.previewCleanup();
  assert.equal(preview.days, 0);
  const previewCall = apiCalls.find(call => call.path === '/api/cleanup/preview');
  assert.deepEqual(previewCall.body.scopes.sort(), ['lab','mirrors','telemetry','xray']);
  assert.match(elements.cleanupPreview.innerHTML, /پیش‌نمایش آماده است/);
  await window.ABSettingsPage.runSelectedCleanup();
  assert.equal(elements.cleanupConfirmDialog.hidden, false);
  await window.ABSettingsPage.confirmCleanupRun();
  assert.match(elements.cleanupStatus.textContent, /پاکسازی انجام شد/);
  elements.retentionDays.value = '30';
  elements.retentionAuto.checked = true;
  await window.ABSettingsPage.saveRetention();
  const save = apiCalls.find(call => call.path === '/api/config');
  assert.deepEqual(save.body.retention, {days:30,auto_prune_on_boot:true});
  const previewsBeforeInvalid = apiCalls.filter(call => call.path === '/api/cleanup/preview').length;
  elements.cleanupDays.value = '';
  window.ABSettingsPage.setCleanupDays('');
  assert.equal(await window.ABSettingsPage.previewCleanup(), null);
  assert.equal(apiCalls.filter(call => call.path === '/api/cleanup/preview').length, previewsBeforeInvalid);
  console.log('history and cleanup settings render/preview smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
