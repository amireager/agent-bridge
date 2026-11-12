const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: value => values.add(value), remove: value => values.delete(value),
    contains: value => values.has(value),
    toggle(value, force) {
      const shouldAdd = force === undefined ? !values.has(value) : !!force;
      shouldAdd ? values.add(value) : values.delete(value);
      return shouldAdd;
    }
  };
}
function makeNode(value = '') {
  return {
    value, textContent:'', innerHTML:'', hidden:false, disabled:false, title:'',
    style:{}, classList:makeClassList(), listeners:{}, scrollHeight:0,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(name, value) { this[name] = value; },
    focus() {}, scrollTo() {},
  };
}

async function scenario(sourceAllowed) {
  const ids = [
    'composerRaw','wireInput','trChatBubble','sendErrBanner','trMetaTag','chatTranslationEngine',
    'staleNotice','trSavingsBadge','allowPersianCheck','persianGuard','persianGuardMsg',
    'btnSendFinal','btnSendLabel','wireMdPreview','chatFeed','jumpBottomBtn','btnAbortChat'
  ];
  const els = Object.fromEntries(ids.map(id => [id, makeNode()]));
  els.composerRaw.value = 'لطفاً این متن را ترجمه کن';
  els.allowPersianCheck.checked = sourceAllowed;
  els.chatTranslationEngine.value = 'online-google';
  const calls = [];
  const state = {config:{translation:{enabled:true}}, active_agent:'lab', active_conversation:{turns:[]}};
  const context = {
    window:{
      ABUtils:{
        esc:value=>String(value ?? ''),
        api:async(path, body) => {
          calls.push({path, body});
          if (path === '/api/translate') return {translation:'Please translate this text', engine:'Google', elapsed_ms:12};
          return {ok:true};
        }
      },
      ABApp:{getState:()=>state},
      ABMarkdown:{render:text=>String(text), renderBlocks:()=>''}
    },
    document:{getElementById:id=>els[id] || null},
    navigator:{clipboard:{writeText(){}}},
    console, setTimeout
  };
  vm.runInNewContext(fs.readFileSync('frontend/pages/chat/chat.js','utf8'), context);
  await context.window.ABChatPage.sendFinal();
  assert.equal(calls.filter(call=>call.path==='/api/prompt').length, 0, 'first click prepares/reviews; it does not send');
  const translationCall = calls.find(call=>call.path==='/api/translate');
  if (sourceAllowed) {
    assert.equal(translationCall, undefined, 'explicit source-language permission skips translation');
    assert.equal(els.wireInput.value, els.composerRaw.value);
  } else {
    assert.equal(translationCall.body.engine_mode, 'online-google', 'selected engine is passed to translation');
    assert.equal(els.wireInput.value, 'Please translate this text');
  }
  assert.equal(els.btnSendFinal.classList.contains('is-ready'), true, 'prepared preview turns send button ready/green');
  await context.window.ABChatPage.sendFinal();
  const prompt = calls.find(call=>call.path==='/api/prompt');
  assert.ok(prompt, 'second click sends the prepared message');
  assert.equal(prompt.body.translation_used, !sourceAllowed);
  assert.equal(prompt.body.allow_persian, sourceAllowed);
}

(async()=>{
  await scenario(false);
  await scenario(true);
  console.log('chat Persian two-click translation and explicit source-language flows: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
