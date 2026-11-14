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

const press=(f,digit)=>step(f.server,{Digits:digit},'?input='+f.store.get('call',id).inputNonce);
const wrongPin=u=>u.pin==='000000'?'111111':'000000';
const credentialsRejected=r=>/לא זוהה|לא התאימו/.test(r.text);

test('each credential prompt requests a clean input boundary',async t=>{
 const f=fixture(t),u=enroll(f.service);
 for(const r of [await step(f.server),await press(f,u.user.code),await step(f.server)])assert.match(r.text,/<Gather clearDigits="true"[^>]*numDigits="6"/);
});
test('buffer model discards old user code and extra hash before PIN, preserves newly typed PIN',async t=>{
 const f=fixture(t),u=enroll(f.service);await step(f.server);const r=await press(f,u.user.code);
 // Models the existing bridge clearDigits contract, not the actual provider SDK.
 let buffer=u.user.code+'#';if(/<Gather clearDigits="true"/.test(r.text))buffer='';
 assert.equal(buffer,'','consumed user-code digits cannot become PIN');
 buffer+=u.pin;await press(f,buffer);assert.equal(f.store.get('call',id).userId,u.user.id);
});
test('code alone, PIN silence and old callback never authenticate or count failures',async t=>{
 const f=fixture(t),u=enroll(f.service);let calls=0;f.service.identity.login=()=>{calls++;throw Error('unexpected login');};
 await step(f.server);const old=f.store.get('call',id).inputNonce;const code=await press(f,u.user.code);assert.match(code.text,/הקוד האישי/);
 await step(f.server);await step(f.server,{Digits:u.user.code},'?input='+old);
 assert.equal(calls,0);assert.equal(f.store.list('failure').length,0);assert.equal(f.store.list('token').length,0);
});
test('successful login persists token and call together',async t=>{
 const f=fixture(t),u=enroll(f.service);await step(f.server);await press(f,u.user.code);await press(f,u.pin);
 const c=f.store.get('call',id);assert.equal(c.phase,'main');assert.equal(c.code,null);assert.equal(f.service.identity.authenticate(c.token).user.id,u.user.id);assert.equal(f.store.list('token').length,1);
});
test('failed call save rolls back token, does not report bad credentials and fails closed',async t=>{
 const f=fixture(t),u=enroll(f.service);await step(f.server);await press(f,u.user.code);const put=f.store.put.bind(f.store);
 f.store.put=(kind,r,...args)=>{if(kind==='call'&&r.phase==='main')throw Error('private storage fault');return put(kind,r,...args);};
 const r=await press(f,u.pin);assert.equal(r.status,503);assert.equal(credentialsRejected(r),false);assert.doesNotMatch(r.text,/private storage/);assert.equal(f.store.list('token').length,0);assert.equal(f.store.get('call',id).attempts||0,0);assert.equal(f.store.list('failure').length,0);
});
test('failed token creation preserves existing failure counters',t=>{
 const f=fixture(t),u=enroll(f.service);assert.throws(()=>f.service.identity.login(u.user.code,wrongPin(u),'source'));const before=f.store.list('failure');const create=f.store.create.bind(f.store);
 f.store.create=(kind,...args)=>{if(kind==='token')throw Error('private storage fault');return create(kind,...args);};
 assert.throws(()=>f.service.identity.login(u.user.code,u.pin,'source'),/private storage/);assert.deepEqual(f.store.list('failure'),before);assert.equal(f.store.list('token').length,0);
});
test('failed second counter creation rolls back first counter',t=>{
 const f=fixture(t),u=enroll(f.service);const create=f.store.create.bind(f.store);let writes=0;
 f.store.create=(kind,...args)=>{if(kind==='failure'&&++writes===2)throw Error('private storage fault');return create(kind,...args);};
 assert.throws(()=>f.service.identity.login(u.user.code,wrongPin(u),'source'),/private storage/);assert.equal(f.store.list('failure').length,0);
});
test('failed second counter update restores both previous counters',t=>{
 const f=fixture(t),u=enroll(f.service);assert.throws(()=>f.service.identity.login(u.user.code,wrongPin(u),'source'));const before=f.store.list('failure');const put=f.store.put.bind(f.store);let writes=0;
 f.store.put=(kind,...args)=>{if(kind==='failure'&&++writes===2)throw Error('private storage fault');return put(kind,...args);};
 assert.throws(()=>f.service.identity.login(u.user.code,wrongPin(u),'source'),/private storage/);assert.deepEqual(f.store.list('failure'),before);
});
test('credential rejection commits both counters and preserves cross-call lockout',t=>{
 const f=fixture(t),u=enroll(f.service);for(let n=0;n<3;n++)assert.throws(()=>f.service.identity.login(u.user.code,wrongPin(u),'call-'+n),e=>e.code==='AUTH_INVALID');
 assert.throws(()=>f.service.identity.login(u.user.code,u.pin,'fresh-call'),e=>e.code==='AUTH_LIMITED');assert.equal(f.store.list('token').length,0);
});
test('storage failure when recording bad credentials does not count a call attempt or expose detail',async t=>{
 const f=fixture(t),u=enroll(f.service);await step(f.server);await press(f,u.user.code);const create=f.store.create.bind(f.store);
 f.store.create=(kind,...args)=>{if(kind==='failure')throw Error('private storage fault');return create(kind,...args);};
 const r=await press(f,wrongPin(u));assert.equal(r.status,503);assert.equal(credentialsRejected(r),false);assert.equal(f.store.get('call',id).attempts||0,0);assert.equal(f.store.list('token').length,0);assert.doesNotMatch(r.text,/private storage/);
});
test('correct credentials still cannot enter inactive account',async t=>{
 const f=fixture(t),u=enroll(f.service);f.service.identity.suspend(u.user.id,false,'owner');await step(f.server);await press(f,u.user.code);const r=await press(f,u.pin);assert.equal(credentialsRejected(r),true);assert.equal(f.store.list('token').length,0);
});
test('six-digit leading zeros remain valid strings',async t=>{
 const f=fixture(t),u=enroll(f.service);const record=f.store.get('user',u.user.id);f.store.put('user',{...record,code:'000012'});await step(f.server);await press(f,'000012');await press(f,u.pin);assert.equal(f.store.get('call',id).userId,u.user.id);
});
test('failed prompt persistence must not send a PIN prompt with an unusable nonce',async t=>{
 const f=fixture(t),u=enroll(f.service);await step(f.server);const put=f.store.put.bind(f.store);
 f.store.put=(kind,r,...args)=>{if(kind==='call'&&r.phase==='login-pin'&&r.inputNonce)throw Error('private prompt failure');return put(kind,r,...args);};
 const r=await press(f,u.user.code);assert.equal(r.status,503);assert.doesNotMatch(r.text,/<Gather|private prompt/);assert.equal(f.store.list('token').length,0);
});
test('failure to create a call never speaks internal storage errors',async t=>{
 const f=fixture(t),create=f.store.create.bind(f.store);f.store.create=(kind,...args)=>{if(kind==='call')throw Error('private create failure');return create(kind,...args);};
 const r=await step(f.server);assert.equal(r.status,503);assert.doesNotMatch(r.text,/<Gather|private create/);assert.equal(f.store.list('token').length,0);
});
