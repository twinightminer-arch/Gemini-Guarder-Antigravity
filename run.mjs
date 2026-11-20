import {allowMediaOrigin} from './media-server.mjs';
import {readFile,writeFile,mkdir,rename,access,unlink} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir} from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {createInterface} from 'node:readline';
import {preview,poster,backgroundMedia,stopMediaJobs} from './media-preview.mjs';
import {targets,connect} from './cdp.mjs';
import {dictionary} from './dictionary.mjs';
import {LocalWallpaperStore} from './local-imports.mjs';
import {VocabularyStore} from './store.mjs';
import i18n from './panel-i18n.cjs';

const stateRoot=join(process.env.LOCALAPPDATA,'Guarder-Antigravity');
const legacy=process.env.GPTDADDY_DATA_ROOT || join(process.env.LOCALAPPDATA,'GPTDaddy');
const vocabulary=new VocabularyStore(join(homedir(),'Documents','GPT Salad Vocabulary'));
const runFile=promisify(execFile);
const dockScript=fileURLToPath(new URL('./gemini-native.ps1',import.meta.url));
const localImports=new LocalWallpaperStore(stateRoot,{generatePreviews:false});
let dockWatcher;
function ensureDockWatcher(){
  if(dockWatcher)return;
  const watcher=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',dockScript,'-Action','watch','-ControllerPid',String(process.pid)],
    {windowsHide:true,stdio:['pipe','pipe','inherit']});
  const output=createInterface({input:watcher.stdout});
  const closed=new Promise(resolve=>watcher.once('close',()=>{
    output.close();
    if(dockWatcher?.watcher===watcher)dockWatcher=undefined;
    resolve(false);
  }));
  dockWatcher={watcher,output,closed};
  watcher.once('error',error=>console.error('Gemini watcher:',error.message));
  watcher.stdin.on('error',error=>console.error('Gemini watcher input:',error.message));
}
const hostDock=async rect=>{
  const args=['-NoProfile','-File',dockScript,'-Action',rect?'show':'hide'];
  if(rect)for(const key of ['Viewport','X','Y','Width','Height']){const value=rect[key];if(!Number.isInteger(value)||Math.abs(value)>12000)throw Error('Invalid Gemini geometry');args.push('-'+key,String(value));}
  await new Promise((resolve,reject)=>{
    // Chrome can outlive PowerShell. Wait for the script process, not its inherited pipes.
    const child=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','ignore','inherit']});
    const timer=setTimeout(()=>{
      child.kill();
      reject(Error('Gemini window operation timed out'));
    },40000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{
      clearTimeout(timer);
      if(code===0)resolve();
      else reject(Error('Gemini window script exited with code '+code));
    });
  });
};
async function sendDockCommand(command){
  if(!dockWatcher)return false;
  const {watcher,output,closed}=dockWatcher;
  let timer,onReply;
  const reply=new Promise(resolve=>{
    onReply=line=>resolve(line);
    output.once('line',onReply);
    timer=setTimeout(()=>{watcher.kill();resolve(false);},2000);
    watcher.stdin.write(command+'\n',error=>{if(error){watcher.kill();resolve(false);}});
  });
  const result=await Promise.race([reply,closed]);
  clearTimeout(timer);
  output.off('line',onReply);
  if(result)return result;
  // Retire the watcher before falling back so a delayed command cannot override the fallback.
  watcher.kill();
  await closed;
  return false;
}
async function hideDock(){
  if(await sendDockCommand('hide')!=='hidden')await hostDock(null);
}
async function showDock(geometry){
  if(await sendDockCommand('show '+JSON.stringify(geometry))!=='shown')await hostDock(geometry);
}
const statePath=join(stateRoot,'settings.json');
const readyPath=join(stateRoot,'status.json');
const stopPath=join(stateRoot,'stop');
const runOnce=process.argv.includes('--verify');
const cleanup=process.argv.includes('--detach');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const locale=i18n.LANGS;
const renderer=(await readFile(new URL('./renderer.js',import.meta.url),'utf8')).trim();
const css=await readFile(new URL('./panel.css',import.meta.url),'utf8');
const png=async file=>'data:image/png;base64,'+(await readFile(new URL(file,import.meta.url))).toString('base64');
const [icon,vocabIcon]=await Promise.all([png('./gemini.png'),png('./vocabulary.png')]);
const panelKeys=['语言设置','壁纸库','生词本','刷新词条','尚无词条','openGemini','previewError','取消收藏','收藏','编辑笔记','归档','pastePrompt','壁纸 · 划词翻译 · 本地生词本','关闭面板','主题','设置','Wallpaper Engine 与本地壁纸库','搜索标题或标签','应用','没有符合条件的壁纸。','我的生词本','搜索词条','播放状态','画面与可读性','Guarder 面板颜色','恢复默认','继续播放','暂停','恢复原界面','导入本地壁纸','字体颜色','输入框背景颜色','内容背板不透明度','侧边栏不透明度','背景遮罩','背景模糊','画面缩放','壁纸音量','拖动时立即预览，设置自动保存。','Notion 生词本地址','Obsidian 生词本地址','OneNote 生词本地址','打开 Notion 生词本','打开 Obsidian 生词本','打开 OneNote 生词本','正在连接真实 Gemini 网页窗口…','真实 Gemini 网页已连接','控制通道未连接','全部','可应用视频','本地导入','其他','仅收藏','按名称','按大小','使用宿主原色','自动跟随宿主','预览视频','导入大小限制','外观','Guarder 面板颜色 HEX','划词翻译','加入生词本','复制选中文本','Google 搜索','已加入生词本','已复制','操作失败','正在准备壁纸','正在导入壁纸','壁纸导入完成','无预览','暂不可应用','顶栏颜色','跟随系统背景','智能识别','自定义选择','地址已配置','未配置地址','地址格式无效'];
const panel=Object.fromEntries(locale.map(lang=>[lang,Object.fromEntries(panelKeys.map(key=>[key,i18n.translate(lang,key)]))]));
const source=await dictionary();

async function readJson(file) {
  try{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}
  catch(error){if(error.code==='ENOENT')return {};throw error;}
}
async function exists(file){try{await access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function saveJson(file,data) {
  const temporary=file+'.'+process.pid+'.tmp';
  await writeFile(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o600});
  try { await rename(temporary,file); }
  catch(error) {
    if(error.code!=='EXDEV') throw error;
    await writeFile(file,await readFile(temporary),{mode:0o600});
    await unlink(temporary);
  }
}
let pendingConfigWrite=Promise.resolve();
function saveConfig(){
  const snapshot=JSON.parse(JSON.stringify(config));
  const job=pendingConfigWrite.then(()=>saveJson(statePath,snapshot));
  pendingConfigWrite=job.catch(()=>{});
  return job;
}
const raw=await readJson(statePath);
const destinations=await readJson(join(stateRoot,'legacy-destinations.json'));
const limits={opacity:[0,1],sidebarOpacity:[0,1],scrimOpacity:[0,1],blurPx:[0,100],zoom:[0,100],volume:[0,1]};
const cleanTheme=values=>{
  const result={};
  for(const [key,[min,max]] of Object.entries(limits)){
    const value=values?.[key];
    if(Number.isFinite(value))result[key]=Math.max(min,Math.min(max,value));
  }
  for(const key of ['fontColor','composerBackgroundColor']){
    const value=values?.[key];
    if(value===null||/^#[a-f0-9]{6}$/i.test(value||''))result[key]=value;
  }
  if(['system','smart','custom'].includes(values?.titlebarMode))result.titlebarMode=values.titlebarMode;
  if(/^#[a-f0-9]{6}$/i.test(values?.titlebarColor||''))result.titlebarColor=values.titlebarColor;
  return result;
};
function destination(name,value){
  if(!['notion','obsidian','onenote'].includes(name)||typeof value!=='string'||value.length>2048||/[\r\n]/.test(value))return;
  if(!value)return '';
  try{
    const url=new URL(value);
    if(url.protocol==='https:'&&!url.username&&!url.password||
      name==='obsidian'&&url.protocol==='obsidian:'||name==='onenote'&&url.protocol==='onenote:')return url.href;
  }catch{}
}
const openUrl=url=>spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();
let previewCatalog=new Map();
const posters=new Map();
const posterQueue=[];
let posterWorkers=0;
function startPosterWorkers(){
  while(!stopping&&posterWorkers<3&&posterQueue.length){
    const {item,resolve}=posterQueue.shift();
    posterWorkers++;
    void poster(item,join(stateRoot,'poster-cache')).catch(()=>undefined).then(resolve).finally(()=>{
      posterWorkers--;startPosterWorkers();
    });
  }
}
function requestPoster(item){
  if(!item)return Promise.resolve();
  let job=posters.get(item.id);
  if(!job){
    job=new Promise(resolve=>posterQueue.push({item,resolve}));
    posters.set(item.id,job);
    startPosterWorkers();
  }
  return job;
}
let stateRevision=0;
let background={};
function requestMedia(cache,item,prepare,folder){
  if(cache.id===item?.id)return cache;
  const next={id:item?.id,pending:Boolean(item)};
  if(!item)return next;
  void prepare(item,join(stateRoot,folder)).then(asset=>{
    next.asset=asset;
  }).catch(error=>{
    console.error('Wallpaper preparation:',error.code||error.name);
  }).finally(()=>{
    next.pending=false;
    if(next===background)stateRevision++;
  });
  return next;
}
let dockOwner;
let dockQueue=Promise.resolve();
function updateDock(session,geometry){
  const key=JSON.stringify(geometry);
  if(key===session.dockKey)return dockQueue;
  session.dockKey=key;
  const revision=++session.dockRevision;
  dockQueue=dockQueue.then(async()=>{
    if(revision!==session.dockRevision)return;
    if(!geometry){
      if(dockOwner===session){
        await hideDock();
        dockOwner=undefined;
      }
      return;
    }
    if(stopping)return;
    dockOwner=session;
    ensureDockWatcher();
    try{
      await showDock(geometry);
    }catch(error){
      console.error('Gemini:',error.message);
      if(revision===session.dockRevision){
        void session.connection.evaluate('globalThis.guarder?.dockStatus(false)').catch(()=>{});
      }
    }
  }).catch(error=>{
    if(revision===session.dockRevision)session.dockKey=undefined;
    console.error('Gemini docking:',error.message);
  });
  return dockQueue;
}
function closeSession(id,session){
  if(!runOnce)void updateDock(session,null);
  session.connection.close();
  connections.delete(id);
}
let config={language:locale.includes(raw.language)?raw.language:'zh-CN',sync:raw.sync!==false};
if(raw.pageColor===null||/^#[a-f0-9]{6}$/i.test(raw.pageColor||'')) config.pageColor=raw.pageColor;
const savedTheme={...raw.theme};
if(raw.zoomModel!==2 && Number.isFinite(savedTheme.zoom))savedTheme.zoom=35+savedTheme.zoom-100;
config.theme=cleanTheme(savedTheme);
config.zoomModel=2;
config.favorites=Array.isArray(raw.favorites)?raw.favorites.filter(id=>typeof id==='string'):[];
config.destinations=Object.fromEntries(Object.entries(raw.destinations||{}).filter(([name,value])=>destination(name,value)!==undefined));
if(raw.wallpaper===null||typeof raw.wallpaper==='string') config.wallpaper=raw.wallpaper;

async function loadData(loadDetails) {
  const imports=[...new LocalWallpaperStore(legacy).list(),...localImports.list()].filter(item=>!item.missing);
  const entries=await exists(vocabulary.entries)?vocabulary.list().filter(item=>!item.archived):[];
  const legacyState=await readJson(join(legacy,'state.json'));
  const state=legacyState.wallpaper;
  const pageColor=/^#[a-f0-9]{6}$/i.test(legacyState.ui?.pageColor||'')?legacyState.ui.pageColor:undefined;
  const cache=await readJson(join(legacy,'catalog-cache.json'));
  const cached=cache.schemaVersion===2&&Array.isArray(cache.wallpapers)?cache.wallpapers.filter(item=>typeof item?.id==='string'&&typeof item.projectRoot==='string'):[];
  const library=[...new Map([...cached,...imports].map(row=>[row.id,row])).values()];
  const id=config.wallpaper??null;
  const item=library.find(row=>row.id===id);
  background=requestMedia(background,item,backgroundMedia,'background-cache');
  previewCatalog=new Map(library.map(item=>[item.id,item]));
  if(!runOnce)for(const item of library)void requestPoster(item);
  const theme={titlebarMode:'smart',titlebarColor:'#181528',opacity:.72,sidebarOpacity:.72,scrimOpacity:.2,blurPx:12,zoom:35,volume:0,
    fontColor:null,composerBackgroundColor:null,...cleanTheme({...state,zoom:undefined}),...config.theme};
  return {media:background.asset,mediaPending:background.pending,pageColor,selected:id,theme,destinations:{...destinations,...config.destinations},
    entries:loadDetails?entries.map(({id,source_text,favorite,notes})=>({id,source_text,favorite,notes})):[],
    entryCount:entries.length,wallpapers:library.map(({id,title,type,kind,capability,tags,bytes,sizeBytes,isLocalImport})=>({id,title:title||id,video:type==='video'||kind==='video',unsupported:capability==='unsupported'&&!['video','image'].includes(type),tags:Array.isArray(tags)?tags:[],size:Number(bytes??sizeBytes)||0,local:Boolean(isLocalImport)||imports.some(item=>item.id===id)}))};
}

const connections=new Map();
let importJob;
let stopping=false;
async function* mediaChunks(connection,size){
  const chunkSize=1024**2;
  for(let offset=0;offset<size;offset+=chunkSize){
    if(stopping)throw Error('Import cancelled');
    const length=Math.min(chunkSize,size-offset);
    const chunk=Buffer.from(await connection.evaluate('globalThis.guarder.importChunk('+offset+','+length+')',10000),'base64');
    if(chunk.length!==length)throw Error('Incomplete wallpaper file');
    yield chunk;
  }
}
async function importWallpaper(connection,{name,size}){
  let status='操作失败';
  try{
    const item=await localImports.importStream(Readable.from(mediaChunks(connection,size)),basename(name));
    config.wallpaper=item.id;
    await saveConfig();
    stateRevision++;
    status='壁纸导入完成';
  }catch(error){console.error('Wallpaper import:',error.code||error.name);}
  await connection.evaluate('globalThis.guarder.importFinished('+JSON.stringify(status)+')').catch(()=>{});
}

async function sendPreview(session,request){
  if(!request||typeof request.id!=='string')return;
  if(request.poster===true){
    const asset=await requestPoster(previewCatalog.get(request.id));
    if(!stopping)await session.connection.evaluate('globalThis.guarder?.posterReady('+JSON.stringify(request.id)+','+JSON.stringify(asset?.url??null)+')').catch(()=>{});
    return;
  }
  if(!Number.isSafeInteger(request.sequence))return;
  session.previewSequence=request.sequence;
  const item=previewCatalog.get(request.id);
  const media=await preview(item,join(stateRoot,'preview-cache'),request.convert===true).catch(()=>undefined);
  if(stopping||session.previewSequence!==request.sequence)return;
  await session.connection.evaluate('globalThis.guarder?.previewReady('+JSON.stringify(request)+','+JSON.stringify(media??null)+')').catch(()=>{});
}

async function detach() {
  for(const target of await targets().catch(()=>[])){
    const c=await connect(target).catch(()=>null);
    if(!c) continue;
    try{
      const restore=await c.evaluate('Boolean(globalThis.guarder?.usesNativeCaption?.())');
      await c.evaluate('globalThis.guarder?.stop()');
      if(restore)await c.setCaption(null).catch(()=>{});
    }finally{c.close();}
  }
}
if(cleanup){await detach();await hostDock(null);process.exit(0);}
await mkdir(stateRoot,{recursive:true});
let lastAttached;
let nextRecovery=0;
let recovery;
const recoveryScript=fileURLToPath(new URL('./recover-host.ps1',import.meta.url));
async function publishAttachment(attached){
  if(lastAttached===attached)return;
  await writeFile(readyPath,JSON.stringify({attached,pid:process.pid,updatedAt:new Date().toISOString()}));
  lastAttached=attached;
}
if(!runOnce){localImports.onChange=()=>{stateRevision++;};localImports.resumePending();}
for(;;){
  if(!runOnce&&await exists(stopPath)) break;
  let available=[];
  try{available=await targets();}catch(error){if(runOnce)throw error;}
  if(!runOnce&&!available.length&&!recovery&&Date.now()>=nextRecovery){
    nextRecovery=Date.now()+8000;
    const request=join(stateRoot,'recover-current');
    const current=await exists(request);
    if(current)await unlink(request).catch(()=>{});
    recovery=runFile('powershell.exe',['-NoProfile','-File',recoveryScript,...(current?['-CurrentWindow']:[])],{windowsHide:true,timeout:20000})
      .then(({stdout})=>{if(stdout.trim())console.log(stdout.trim());})
      .catch(error=>console.error('Antigravity recovery:',error.message.split('\n')[0]))
      .finally(()=>{recovery=undefined;});
  }
  if(runOnce&&!available.length)throw Error('No Antigravity Hub window is available.');
  for(const [id,session] of connections) {
    if(!available.some(target=>target.id===id&&target.url===session.url)){
      closeSession(id,session);
    }
  }
  for(const target of available){
    try{
      let session=connections.get(target.id);
      if(!session){
        session={url:target.url,details:false,revision:stateRevision,dockRevision:0,dockEvents:0};
        session.connection=await connect(target,runOnce?undefined:geometry=>{
          if(geometry!==null&&(!geometry||typeof geometry!=='object'||
             !['Viewport','X','Y','Width','Height'].every(key=>Number.isInteger(geometry[key])&&Math.abs(geometry[key])<=12000)))return;
          if(stopping||connections.get(target.id)!==session)return;
          session.dockEvents++;
          void updateDock(session,geometry);
        },runOnce?undefined:request=>{if(!stopping&&connections.get(target.id)===session)void sendPreview(session,request);},runOnce?undefined:options=>{
          if(stopping||connections.get(target.id)!==session||session.captionUnavailable)return;
          void session.connection.setCaption(options).then(ok=>{if(!ok)session.captionUnavailable=true;}).catch(()=>{});
        });
        connections.set(target.id,session);
      }
      const c=session.connection;
      const dockEvents=session.dockEvents;
      let view=await c.evaluate('globalThis.guarder?.snapshot('+(!runOnce)+')');
      if(!view) {
        if(runOnce) throw Error('Guarder is not attached to this window');
        const hub=await c.evaluate("Boolean(document.body && [...document.scripts].some(script => script.src && new URL(script.src).origin === location.origin && new URL(script.src).pathname === '/main.js'))");
        if(!hub) continue;
        allowMediaOrigin(new URL(target.url).origin);
        if(!runOnce)ensureDockWatcher();
        session.details=false;
        view=await c.evaluate('('+renderer+')('+JSON.stringify({dictionary:source,panel,config,css,icon,vocabIcon,data:await loadData(false)})+','+destination.toString()+')');
        void Promise.all([...previewCatalog.values()].map(async item=>[item.id,(await requestPoster(item))?.url??null])).then(async assets=>{
          if(stopping||connections.get(target.id)!==session)return;
          await c.evaluate('globalThis.guarder?.posterBatch('+JSON.stringify(assets)+')');
        }).catch(()=>{});
      }
      let refresh=view.open!==session.details;
      if(!runOnce&&dockEvents===session.dockEvents)void updateDock(session,view.gemini??null);
      if(!runOnce&&dockOwner===session)ensureDockWatcher();
      for(const command of view.commands){
        if(command.type==='config') {
          const change=command.change;
          if(locale.includes(change.language))config.language=change.language;
          if(change.pageColor===null)config.pageColor=null;
          if(/^#[a-f0-9]{6}$/i.test(change.pageColor||''))config.pageColor=change.pageColor;
          if(change.theme)config.theme={...config.theme,...cleanTheme(change.theme)};
          if(change.destination){const {name,value}=change.destination;const validated=destination(name,value);if(validated!==undefined)config.destinations[name]=validated;}
          if(typeof change.sync==='boolean')config.sync=change.sync;
          if(typeof change.favorite==='string'&&change.favorite.length<=250){
            const id=change.favorite;
            config.favorites=config.favorites.includes(id)?config.favorites.filter(value=>value!==id):[...config.favorites,id];
          }
          if(change.wallpaper===null||(typeof change.wallpaper==='string'&&change.wallpaper.length<=250))config.wallpaper=change.wallpaper;
          await saveConfig();
          stateRevision++;
        }
        if(command.type==='save'&&typeof command.text==='string'&&command.text.trim()&&command.text.length<=1500) {
          let status='操作失败';
          try{vocabulary.save(command.text);refresh=true;status='已加入生词本';}
          catch(error){console.error('Vocabulary save:',error.code||error.name);}
          await c.evaluate('globalThis.guarder.operationStatus('+JSON.stringify(status)+')');
        }
        if(command.type==='entry' && typeof command.id==='string' && /^[0-9a-f-]{36}$/i.test(command.id)){
          const item=vocabulary.list().find(entry=>entry.id===command.id);
          if(item){
            if(command.action==='favorite')vocabulary.update(item.id,item.revision,{favorite:!item.favorite});
            if(command.action==='archive')vocabulary.update(item.id,item.revision,{archived:true});
            if(command.action==='notes'&&typeof command.notes==='string')vocabulary.update(item.id,item.revision,{notes:command.notes});
            refresh=true;
          }
        }
        if(command.type==='refresh') refresh=true;
        if(command.type==='preview')void sendPreview(session,command);
        if(command.type==='destination'){const url=destination(command.name,command.value);if(url)openUrl(url);}
        if(command.type==='import'&&typeof command.name==='string'&&Number.isInteger(command.size)&&command.size>0&&command.size<=1024**3){
          if(importJob)await c.evaluate('globalThis.guarder.importFinished("操作失败")');
          else importJob=importWallpaper(c,command).finally(()=>{importJob=undefined;});
        }
        if(command.type==='searchSelection'&&typeof command.text==='string'&&command.text.length<=1500)
          openUrl('https://www.google.com/search?q='+encodeURIComponent(command.text));
      }
      if(refresh||session.revision!==stateRevision) {
        const revision=stateRevision;
        const data=await loadData(view.open);
        await c.evaluate('globalThis.guarder.refresh('+JSON.stringify(data)+','+JSON.stringify(config)+')');
        session.details=view.open;session.revision=revision;
      }
      if(runOnce){
        const {commands,...summary}=view;
        console.log(JSON.stringify(summary));
      } else if(!session.reported){
        session.reported=true;
      }
    }catch(error){
      const session=connections.get(target.id);
      if(session)closeSession(target.id,session);
      if(runOnce)throw error;
      console.error(new Date().toISOString(),error.message.split('\n')[0]);
    }
  }
  if(runOnce) break;
  await publishAttachment([...connections.values()].some(session=>session.reported));
  await sleep(850);
}
stopping=true;
for(const {connection} of connections.values())connection.close();
if(!runOnce){
  await dockQueue;
  if(dockOwner)await hideDock();
  dockWatcher?.watcher.kill();
  await importJob;localImports.stop();await stopMediaJobs();await detach();
}

