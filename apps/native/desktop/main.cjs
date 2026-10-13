'use strict';
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path');
const {validateRequest}=require('./network.cjs');
let mainWindow;
app.whenReady().then(()=>{
  ipcMain.handle('mirkam:request',async(event,input)=>{
    if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw Error('Untrusted frame');
    const req=validateRequest(input);
    const response=await fetch(req.url,{method:req.method,headers:req.headers,body:req.body,redirect:'error',signal:AbortSignal.timeout(45000)});
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>30000000)throw Error('Response too large');
    return {status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/octet-stream'},base64:bytes.toString('base64')};
  });
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===mainWindow?.webContents&&permission==='media'));
  mainWindow=new BrowserWindow({width:1200,height:850,minWidth:760,minHeight:600,title:'Mirkam Line',icon:path.join(__dirname,'../www/icon-512.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
  mainWindow.loadFile(path.join(__dirname,'../www/index.html'));
});
app.on('window-all-closed',()=>app.quit());
