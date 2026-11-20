import assert from 'node:assert/strict';
import {targets,connect} from './cdp.mjs';
const target=(await targets())[0];
assert.ok(target,'Antigravity Hub window is required');
const c=await connect(target);
try {
  const result=await c.evaluate(`(async()=>{
    const fixture=document.createElement('div');
    fixture.hidden=true;
    fixture.innerHTML='<button data-testid="settings-button" title="Settings" aria-label="Settings" placeholder="Settings"><span>Settings</span><style>.fixture{color:red}</style><code>Settings</code><pre>Settings</pre><span class="monaco-editor">Settings</span><span class="xterm">Settings</span><span data-testid="user-message">Settings</span><span contenteditable>Settings</span></button>';
    const btn=fixture.firstElementChild;
    const span=btn.firstElementChild;
    document.body.append(fixture);
    const delay=()=>new Promise(resolve=>queueMicrotask(()=>queueMicrotask(resolve)));
    const overlay=document.querySelector('#guarder-antigravity-overlay');
    if(!overlay)throw Error('Missing Guarder panel');
    const shadow=overlay.shadowRoot;
    if(shadow.querySelector('section').hidden)shadow.querySelector('button').click();
    if(getComputedStyle(shadow.querySelector('.panel')).display!=='flex')throw Error('Original panel CSS not applied');
    if(shadow.querySelectorAll('.tabs button').length!==5)throw Error('Missing original tabs');
    shadow.querySelector('[data-tab=settings]').click();
    const choose=value=>{
      const select=shadow.querySelector('select');select.value=value;
      select.dispatchEvent(new Event('change'));
    };
    const initialSync=shadow.querySelector('input[type=checkbox]');
    if(!initialSync.checked){initialSync.checked=true;initialSync.dispatchEvent(new Event('change'));}
    const report=[];
    try{
      for(const lang of ['zh-CN','zh-TW','en','ja','ko','zh-CN']) {
        choose(lang);await delay();
        report.push([lang,span.textContent,btn.title,btn.getAttribute('aria-label'),btn.getAttribute('placeholder')]);
      }
      const sync=shadow.querySelector('input[type=checkbox]');
      sync.checked=false;sync.dispatchEvent(new Event('change'));await delay();
      const restored=span.textContent;
      const next=shadow.querySelector('input[type=checkbox]');
      next.checked=true;next.dispatchEvent(new Event('change'));await delay();
      const dynamic=document.createElement('span');dynamic.textContent='Settings';btn.append(dynamic);await delay();
      return {report,restored,dynamic:dynamic.textContent,protected:[...btn.children].slice(1,8).map(x=>x.textContent),summary:globalThis.guarder.snapshot()};
    }finally{fixture.remove();}
  })()`,25000);
  const translations=['设置','設定','Settings','設定','설정','设置'];
  assert.deepEqual(result.report.map(row=>row.slice(1)),translations.map(value=>Array(4).fill(value)));
  assert.equal(result.restored,'Settings');
  assert.equal(result.dynamic,'设置');
  assert.deepEqual(result.protected,['.fixture{color:red}',...Array(6).fill('Settings')]);
  assert.ok(result.summary.open);
  console.log(JSON.stringify(result,null,2));
} finally {c.close();}

