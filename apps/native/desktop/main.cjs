'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {Updates}=require('./updates.cjs');
let updater;
let smokeUpdateVersion;
const {validateRequest}=require('./network.cjs');
let mainWindow;
const updateSmoke=process.argv.includes('--mirkam-update-smoke');
const smoke=process.argv.includes('--mirkam-smoke')||updateSmoke;
if(updateSmoke)app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mirkam-update-smoke-')));
if(smoke)setTimeout(()=>{console.error('Offline home smoke test timed out');app.exit(1);},20000).unref();
app.whenReady().then(()=>{
  ipcMain.on('mirkam:server-get',(event)=>{if(event.sender!==mainWindow?.webContents){event.returnValue='';return;}try{event.returnValue=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'server.json'),'utf8')).origin||'';}catch{event.returnValue='';}});
  ipcMain.on('mirkam:server-save',(event,origin)=>{if(event.sender!==mainWindow?.webContents){event.returnValue=false;return;}try{validateRequest({endpoint:origin,route:'/health'});fs.writeFileSync(path.join(app.getPath('userData'),'server.json'),JSON.stringify({origin}));event.returnValue=true;}catch{event.returnValue=false;}});
  updater=new Updates(path.join(app.getPath('userData'),'ui-updates-0.4'),path.join(__dirname,'../www'),fs.readFileSync(path.join(__dirname,'../update-public.pem'),'utf8'));
  if(updateSmoke){const arg=process.argv.find(x=>x.startsWith('--update-bundle='));if(!arg)throw Error('Missing smoke bundle');const staged=updater.stage(fs.readFileSync(arg.slice('--update-bundle='.length),'utf8'));if(!staged.available)throw Error('Smoke bundle was not staged');smokeUpdateVersion=staged.version;}
  const home=updater.start();
  for(const [name,fn] of [['mirkam:update-check',()=>updater.check()],['mirkam:update-ready',()=>updater.ready()]])ipcMain.handle(name,(event)=>{if(event.sender!==mainWindow?.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw Error('Untrusted frame');return fn();});
  ipcMain.handle('mirkam:request',async(event,input)=>{
    if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw Error('Untrusted frame');
    const req=validateRequest(input);
    const response=await fetch(req.url,{method:req.method,headers:req.headers,body:req.body,redirect:'error',signal:AbortSignal.timeout(45000)});
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>30000000)throw Error('Response too large');
    return {status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/octet-stream'},base64:bytes.toString('base64')};
  });
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===mainWindow?.webContents&&permission==='media'));
  mainWindow=new BrowserWindow({show:!smoke,width:1200,height:850,minWidth:760,minHeight:600,title:'Mirkam Line',icon:path.join(__dirname,'../www/icon-512.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
  if(smoke){
    mainWindow.webContents.once('did-finish-load',async()=>{
      try{
        const result=await mainWindow.webContents.executeJavaScript(`(async()=>{
          if(!document.getElementById('suite-home')||!document.querySelector('.brand-logo')?.naturalWidth)throw Error('Local home assets did not load');
          if(!window.mirkamNative||!document.getElementById('offline-ready').textContent.includes('מותקן'))throw Error('Native offline mode did not initialize');
          try{await fetch('/api/home');throw Error('Unexpected server access');}catch(error){if(!error.message.includes('כתובת שרת'))throw error;}
          return 'OFFLINE_HOME_OK';
        })()`);
        if(updateSmoke&&(updater.read().current!==smokeUpdateVersion||path.resolve(home)!==path.resolve(updater.dir(smokeUpdateVersion))))throw Error('Staged UI update not loaded');
        console.log(result);app.exit(result==='OFFLINE_HOME_OK'?0:1);
      }catch(error){console.error(error.message);app.exit(1);}
    });
    mainWindow.webContents.once('did-fail-load',()=>app.exit(1));
  }
  mainWindow.loadFile(path.join(home,'index.html'));
});
app.on('window-all-closed',()=>app.quit());
