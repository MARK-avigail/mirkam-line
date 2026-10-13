import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));let failed=false,count=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','data','incoming','.git'].includes(entry.name))continue;const f=path.join(dir,entry.name);if(entry.isDirectory())walk(f);else if(/\.(?:js|mjs)$/.test(f)){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});count++;if(r.status!==0){failed=true;console.error(r.stderr);}}}}
walk(root);
for(const module of ['express','twilio','nodemailer','dotenv','vitest','supertest'])try{import.meta.resolve(module);}catch{failed=true;console.error('Missing dependency: '+module+' (run npm install)');}
const python=spawnSync(process.env.PYTHON_BIN||'python3',['-c','import reportlab; import ctypes.util; assert ctypes.util.find_library("fribidi") or __import__("bidi")'],{encoding:'utf8'});if(python.status!==0){failed=true;console.error('PDF runtime unavailable: install requirements-document.txt and Hebrew font.');}
console.log('Syntax checked '+count+' JavaScript files. External services were not contacted.');process.exitCode=failed?1:0;
