import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store } from './mirkam/store.js';
import { Mirkam } from './mirkam/service.js';
import { liveProviders } from './mirkam/providers.js';
import { createMirkamServer } from './mirkam/http.js';

export function start(){
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Mirkam Line requires Node.js 22.13 or newer (Node.js 24 recommended).');
  if(fs.existsSync('.env'))for(const line of fs.readFileSync('.env','utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'').trim();}
  if(process.env.NODE_ENV==='production'&&(!process.env.DATA_ENCRYPTION_KEY||!process.env.MIRKAM_ADMIN_TOTP_SECRET))throw Error('Production requires externally managed encryption key and administrator MFA.');
  if(!process.env.MIRKAM_ADMIN_TOKEN){const file=path.resolve('mirkam-admin-secret.txt');if(!fs.existsSync(file))fs.writeFileSync(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});if(!fs.lstatSync(file).isFile())throw Error('Invalid admin secret file');process.env.MIRKAM_ADMIN_TOKEN=fs.readFileSync(file,'utf8').trim();console.log('Administrator secret is in mirkam-admin-secret.txt. Do not upload or share it.');}
  if(process.env.MIRKAM_ADMIN_TOKEN.length<32)throw Error('Administrator token must contain at least 32 characters.');
  const store=new Store(process.env.MIRKAM_DATA_DIR||'./mirkam-data',process.env.DATA_ENCRYPTION_KEY),service=new Mirkam(store,liveProviders());service.recover();
  const server=createMirkamServer(service);server.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log('Mirkam Line: http://localhost:'+(process.env.PORT||3000)));
  const stop=()=>server.close(()=>{store.close();process.exit(0);});process.once('SIGTERM',stop);process.once('SIGINT',stop);return {server,service,store};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start();
