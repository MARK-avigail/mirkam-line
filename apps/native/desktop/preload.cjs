'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mirkamNative',{platform:'windows',serverOrigin:ipcRenderer.sendSync('mirkam:server-get'),saveServer:origin=>ipcRenderer.sendSync('mirkam:server-save',origin),updateCheck:()=>ipcRenderer.invoke('mirkam:update-check'),updateReady:()=>ipcRenderer.invoke('mirkam:update-ready'),request:input=>ipcRenderer.invoke('mirkam:request',input)});
