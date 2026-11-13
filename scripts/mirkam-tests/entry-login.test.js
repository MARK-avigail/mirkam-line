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
  return new Promise((resolve,reject)=>{const req=Readable.from(body===undefined?[]:[typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)]);req.url=url;req.method=method;req.headers={host:'example.test',...(token?{authorization:'Bearer '+token}:{}),...headers};req.socket={remoteAddress:'127.0.0.1'};const response={status:200,headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h={}){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(data=''){const text=Buffer.isBuffer(data)?data.toString():String(data);let parsed;try{parsed=JSON.parse(text);}catch{}resolve({status:this.status,headers:this.headers,text,body:parsed});}};server.emit('request',req,response);req.on('error',reject);});
}

const secret='bridge-test-'.repeat(4);process.env.VOICE_ELEMENTS_BRIDGE_TOKEN=secret;
const id='VE'+'1'.repeat(32);
const step=(server,values={},query='',key=secret)=>request(server,'/voice-elements/step'+query,{method:'POST',body:new URLSearchParams({CallSid:id,...values}).toString(),headers:{authorization:'Bearer '+key}});

function gated(t){process.env.MIRKAM_ENTRY_PROMPT='פתיחת בדיקה';t.after(()=>delete process.env.MIRKAM_ENTRY_PROMPT);return fixture(t);}
const press=(f,digit)=>step(f.server,{Digits:digit},'?input='+f.store.get('call',id).inputNonce);
test('configured entry speaks once, gathers hash as data, then hangs up on silence',async t=>{
 const f=gated(t);const r=await step(f.server);assert.match(r.text,/פתיחת בדיקה/);assert.match(r.text,/finishOnKey=""/);assert.match(r.text,/<Hangup\/>/);assert.doesNotMatch(r.text,/<Redirect|קוד משתמש/);
 const timeout=await step(f.server);assert.match(timeout.text,/<Hangup/);assert.doesNotMatch(timeout.text,/<Gather|פתיחת בדיקה/);
});
for(const digit of ['1','*','123456'])test('entry rejects '+digit+' without revealing login',async t=>{const f=gated(t);await step(f.server);const r=await press(f,digit);assert.match(r.text,/<Hangup/);assert.doesNotMatch(r.text,/<Gather|קוד משתמש/);});
test('hash opens login but does not bypass either credential',async t=>{const f=gated(t),u=enroll(f.service);await step(f.server);let r=await press(f,'#');assert.match(r.text,/קוד המשתמש/);assert.equal(f.store.list('token').length,0);await press(f,u.user.code);assert.equal(f.store.list('token').length,0);r=await press(f,u.pin);assert.equal(f.store.get('call',id).userId,u.user.id);assert.match(r.text,/מוקלטים/);});
test('old entry callback cannot reopen an ended call',async t=>{const f=gated(t);await step(f.server);const nonce=f.store.get('call',id).inputNonce;await press(f,'1');const r=await step(f.server,{Digits:'#'},'?input='+nonce);assert.notEqual(f.store.get('call',id).phase,'login-code');assert.doesNotMatch(r.text,/<Gather/);});
test('partial code inputs stop after three attempts instead of looping indefinitely',async t=>{const f=fixture(t);await step(f.server);for(let i=0;i<3;i++){const r=await press(f,'12');if(i<2)assert.match(r.text,/<Gather/);else assert.match(r.text,/<Hangup/);}assert.equal(f.store.list('token').length,0);});
test('partial PIN inputs stop after three attempts',async t=>{const f=fixture(t),u=enroll(f.service);await step(f.server);await press(f,u.user.code);let r;for(let i=0;i<3;i++)r=await press(f,'12');assert.match(r.text,/<Hangup/);assert.equal(f.store.list('token').length,0);});
test('failed pair returns to user code so an incorrect first code can be corrected',async t=>{const f=fixture(t),u=enroll(f.service);await step(f.server);await press(f,u.user.code==='000000'?'111111':'000000');await press(f,u.pin);assert.equal(f.store.get('call',id).phase,'login-code');await press(f,u.user.code);await press(f,u.pin);assert.equal(f.store.get('call',id).userId,u.user.id);});
test('three invalid credential pairs end the call without disclosing which code failed',async t=>{const f=fixture(t),u=enroll(f.service);await step(f.server);let r;for(let i=0;i<3;i++){await press(f,u.user.code);r=await press(f,u.pin==='000000'?'111111':'000000');}assert.match(r.text,/<Hangup/);assert.equal(f.store.list('token').length,0);});
test('login silence offers one reminder then ends',async t=>{const f=fixture(t);await step(f.server);assert.match((await step(f.server)).text,/<Gather/);assert.match((await step(f.server)).text,/<Hangup/);});
