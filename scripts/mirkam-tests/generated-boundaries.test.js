import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHmac} from 'node:crypto';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
import {validVoiceSignature} from '../../src/mirkam/voice.js';

const admin='a'.repeat(64);process.env.MIRKAM_ADMIN_TOKEN=admin;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-http-')),store=new Store(dir),service=new Mirkam(store),server=createMirkamServer(service);t.after(()=>{store.close();server.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service,server};}
function enroll(service,identity='123456789'){return service.identity.register({name:'שם בדיקה',identity,prison:'בדיקה',prisonerNumber:'123'},'owner');}
function request(server,url,{method='GET',token,body,headers={}}={}){
  return new Promise((resolve,reject)=>{const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);req.url=url;req.method=method;req.headers={host:'example.test',...(token?{authorization:'Bearer '+token}:{}),...headers};req.socket={remoteAddress:'127.0.0.1'};const response={status:200,headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h={}){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(data=''){const text=Buffer.isBuffer(data)?data.toString():String(data);let parsed;try{parsed=JSON.parse(text);}catch{}resolve({status:this.status,headers:this.headers,text,body:parsed});}};server.emit('request',req,response);req.on('error',reject);});
}

// Explicit input matrix: 8 protected routes x 16 invalid credentials x 8 bodies.
// No external network, real accounts, calls or paid AI requests are used.
const routes=['/api/admin/line-chat','/api/admin/line-chat/new','/api/admin/users','/api/admin/status','/voice-elements/step','/voice-elements/speech','/voice-elements/record','/voice-elements/end'];
const tokens=['',' ','null','undefined','0','Bearer','Basic fake','z'.repeat(64),'z'.repeat(32),'z'.repeat(128),'x\nInjected: yes','測試','אביגיל','../secret','%00','fake-token'];
const bodies=[{},null,[],{text:'test',revision:0},'invalid json','null','true','0'];
test('1024 unauthorized input combinations cannot mutate records or reach providers',async t=>{
 const {server,store,service}=fixture(t);let called=0;service.providers.chat=service.providers.speak=service.providers.transcribe=async()=>{called++;throw Error('Must not be called');};
 for(let r=0;r<routes.length;r++)for(let k=0;k<tokens.length;k++)for(let b=0;b<bodies.length;b++)await t.test(`route=${r}, credential=${k}, body=${b}`,async()=>{
 const result=await request(server,routes[r],{method:'POST',token:tokens[k],body:bodies[b]});assert.ok([400,401,403].includes(result.status),String(result.status));
 assert.equal(called,0);for(const kind of ['user','call','staff-line-chat','bridge-audio'])assert.equal(store.list(kind).length,0);
 });
});
test('1024 signed callback mutations cannot authenticate changed data',async t=>{
 const url='https://example.test/voice/step',body={CallSid:'CA'+'1'.repeat(32),Digits:'123456'},secret='test-signature-secret';
 const signed=createHmac('sha1',secret).update(url+Object.keys(body).sort().map(k=>k+body[k]).join('')).digest('base64');
 assert.equal(validVoiceSignature(url,body,signed,secret),true);
 for(let i=0;i<256;i++){
 await t.test('url mutation '+i,()=>assert.equal(validVoiceSignature(url+'?record='+i,body,signed,secret),false));
 await t.test('digit mutation '+i,()=>assert.equal(validVoiceSignature(url,{...body,Digits:String(i).padStart(6,'0')},signed,secret),false));
 await t.test('secret mutation '+i,()=>assert.equal(validVoiceSignature(url,body,signed,secret+i),false));
 await t.test('signature mutation '+i,()=>{const pos=i%signed.length;let char=String.fromCharCode(33+i%90);if(char===signed[pos])char=' ';const changed=signed.slice(0,pos)+char+signed.slice(pos+1);assert.equal(validVoiceSignature(url,body,changed,secret),false);});
 }
});
