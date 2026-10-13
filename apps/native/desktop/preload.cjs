'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mirkamNative',{platform:'windows',request:input=>ipcRenderer.invoke('mirkam:request',input)});
