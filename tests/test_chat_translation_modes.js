const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const els = {};
function node() { return { innerHTML:'', textContent:'', hidden:false, value:'', style:{}, scrollTop:0, scrollHeight:0, clientHeight:0, listeners:{}, classList:{toggle(){},add(){},remove(){}}, addEventListener(type,fn){this.listeners[type]=fn;}, querySelectorAll(){return[];}, getAttribute(){return'';} }; }
for (const id of ['chatFeed','jumpBottomBtn','selectionTranslatePanel','selectionEngine','selectionSource','selectionResult','composerRaw','wireInput','btnTranslateDraft','chatSubBar','btnAbortChat','chatFeedInner']) els[id]=node();
const calls=[];
const state={config:{ui:{},translation:{enabled:true,engine:'custom-offline'}},tested_translators:[],active_conversation:{turns:[]},view_kind:'lab',view_id:'lab-1',bridge_port:18080,session_state:'IDLE'};
global.document={getElementById:id=>els[id]||null};
global.window={
  ABUtils:{esc:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),api:async(path,body)=>{calls.push({path,body});return{translation:'ترجمه شد'};}},
  ABApp:{getState:()=>state}, ABMarkdown:{render:text=>`<p>${text}</p>`,renderBlocks:()=>''},
  getSelection:()=>({toString:()=> 'Selected English words'})
};
vm.runInThisContext(fs.readFileSync('frontend/pages/chat/chat.js','utf8'));
const host={innerHTML:'',querySelector:()=>null};
window.ABChatPage.render(host,state,true);
els.chatFeed.listeners.keyup();
assert.equal(els.selectionTranslatePanel.hidden,false);
for(const mode of ['builtin-online','online-google','online-google-gtx','online-mymemory','offline']) assert.match(els.selectionEngine.innerHTML,new RegExp(`value="${mode}"`));
els.selectionEngine.value='offline';
(async()=>{
  await window.ABChatPage.translateSelection();
  const req=calls.find(item=>item.path==='/api/translate');
  assert.equal(req.body.engine_mode,'offline');
  assert.equal(req.body.to,'auto');
  assert.match(host.innerHTML,/فقط پس از زدن دکمه/);
  console.log('chat selected-text translation modes smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
