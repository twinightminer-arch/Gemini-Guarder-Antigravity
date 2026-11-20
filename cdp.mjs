import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function targets() {
  const [port]= (await readFile(join(process.env.APPDATA,'Antigravity','DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);
  if(!/^\d{1,5}$/.test(port)) throw Error('Invalid Antigravity debug port');
  const response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2500),redirect:'error'});
  if(!response.ok) throw Error('Cannot list Antigravity windows');
  return (await response.json()).filter(target=>{
    if(target.type!=='page'||!URL.canParse(target.url)||!URL.canParse(target.webSocketDebuggerUrl))return false;
    const url=new URL(target.url);
    if(url.protocol!=='https:'||url.hostname!=='127.0.0.1')return false;
    const ws=new URL(target.webSocketDebuggerUrl);
    return ws.protocol==='ws:'&&ws.hostname==='127.0.0.1'&&ws.port===port&&ws.pathname==='/devtools/page/'+target.id;
  });
}
export async function connect(target,onDockGeometry,onPreview,onCaption) {
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let id=0;
  const pending=new Map();
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.close();reject(Error('Debugger connection timed out'));},2500);
    ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Cannot connect to Antigravity'));},{once:true});
  });
  let executionContextId;
  ws.addEventListener('message',({data})=>{
    const reply=JSON.parse(data);
    pending.get(reply.id)?.(reply);
    if(reply.method==='Runtime.bindingCalled' && ['guarderDockChanged','guarderPreviewRequested','guarderCaptionChanged'].includes(reply.params.name) &&
       reply.params.executionContextId===executionContextId){
      let geometry;
      try{geometry=JSON.parse(reply.params.payload);}catch{return;}
      if(reply.params.name==='guarderDockChanged')onDockGeometry?.(geometry);
      else if(reply.params.name==='guarderPreviewRequested')onPreview?.(geometry);
      else onCaption?.(geometry);
    }
  });
  function call(method,params={},timeoutMs=4000) {
    return new Promise((resolve,reject)=>{
      const key=++id;
      const timeout=setTimeout(()=>{pending.delete(key);reject(Error(method+' timed out'));},timeoutMs);
      pending.set(key,reply=>{
        clearTimeout(timeout); pending.delete(key);
        if(reply.error) reject(Error(method+': '+reply.error.message)); else resolve(reply.result);
      });
      try {ws.send(JSON.stringify({id:key,method,params}));}
      catch(error){clearTimeout(timeout);pending.delete(key);reject(error);}
    });
  }
  try {
    const {frameTree}=await call('Page.getFrameTree');
    if(frameTree.frame.url!==target.url) throw Error('Antigravity window navigated');
    ({executionContextId}=await call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'guarder-antigravity'}));
    if(onDockGeometry){
      await call('Runtime.enable');
      await call('Runtime.addBinding',{name:'guarderDockChanged',executionContextId});
    }
    if(onPreview)await call('Runtime.addBinding',{name:'guarderPreviewRequested',executionContextId});
    if(onCaption)await call('Runtime.addBinding',{name:'guarderCaptionChanged',executionContextId});
    async function setCaption(options){
      if(options!==null&&(!options||!['color','symbolColor'].every(key=>/^#[0-9a-f]{6}$/i.test(options[key]||''))))return false;
      const desired=options&&{color:options.color,symbolColor:options.symbolColor};
      const expression=`(async()=>{
        if(location.origin!==${JSON.stringify(new URL(target.url).origin)}||typeof window.electronNative?.setTitleBarOverlay!=='function')return false;
        const bar=document.querySelector('[data-testid="title-menu-bar"]');
        if(!bar)return false;
        const style=getComputedStyle(bar);
        const canvas=document.createElement('canvas').getContext('2d');
        const parse=(token,fallback)=>{
          canvas.fillStyle=fallback;
          canvas.fillStyle=style.getPropertyValue(token).trim();
          return canvas.fillStyle;
        };
        await window.electronNative.setTitleBarOverlay(${JSON.stringify(desired)}??{
          color:parse('--background','#181528'),
          symbolColor:parse('--foreground','#ffffff')
        });
        return true;
      })()`;
      const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      return value.result.value===true;
    }
    return {setCaption,close:()=>ws.close(),evaluate:async (expression,timeoutMs)=>{
      const output=await call('Runtime.evaluate',{contextId:executionContextId,expression,returnByValue:true,awaitPromise:true},timeoutMs);
      if(output.exceptionDetails) throw Error(output.exceptionDetails.exception?.description || 'Renderer evaluation failed');
      return output.result.value;
    }};
  } catch(error){ws.close();throw error;}
}
