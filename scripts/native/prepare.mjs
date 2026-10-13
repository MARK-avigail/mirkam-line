import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dest=path.join(root,'apps/native/www');
fs.mkdirSync(dest,{recursive:true});
for(const name of ['index.html','app.js','style.css','install.js','connection.js','icon-192.png','icon-512.png','brand-logo.png'])fs.copyFileSync(path.join(root,'public/mirkam',name),path.join(dest,name));
let html=fs.readFileSync(path.join(dest,'index.html'),'utf8').replace(/<link rel="manifest"[^>]*>/,'').replace(/(src|href)="\//g,'$1="./');
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\' data:; media-src \'self\' blob:; object-src \'none\'">');
html=html.replace('<script src="./app.js"','<script src="./native-bridge.js"></script><script src="./connection.js"></script><script src="./app.js"');
fs.writeFileSync(path.join(dest,'index.html'),html);
// Desktop supplies its bridge through preload. Android replaces this file with its bundled bridge.
fs.writeFileSync(path.join(dest,'native-bridge.js'),'// Desktop bridge is supplied by preload.\n');
console.log('Packaged local application shell in apps/native/www');
