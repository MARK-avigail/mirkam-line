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
test('bridge requires own secret and never opens Twilio signature bypass',async t=>{
 const {server,store}=fixture(t);
 assert.equal((await step(server,{},'','bad')).status,403);assert.equal(store.list('call').length,0);
 assert.equal((await step(server,{CallSid:'CA'+'1'.repeat(32)})).status,400);
 const r=await step(server);assert.equal(r.status,200);assert.match(r.text,/numDigits="6"/);assert.ok(!r.text.includes('<Record'));
 assert.equal((await request(server,'/voice/step',{method:'POST',body:'CallSid='+id,headers:{authorization:'Bearer '+secret}})).status,403);
});
test('bridge login follows the real code and PIN flow without recording PIN',async t=>{
 const {server,service,store}=fixture(t),u=enroll(service);
 await step(server);let c=store.get('call',id);
 let r=await step(server,{Digits:u.user.code},'?input='+c.inputNonce);assert.equal(r.status,200);assert.ok(!r.text.includes('<Record'));
 c=store.get('call',id);r=await step(server,{Digits:u.pin},'?input='+c.inputNonce);assert.equal(r.status,200);
 assert.equal(store.get('call',id).userId,u.user.id);assert.ok(!JSON.stringify(store.list('call')).includes(u.pin));
});
test('bridge blocks recording before login and foreign recording references',async t=>{
 const {server,store}=fixture(t);await step(server);
 let r=await request(server,'/voice-elements/record?call='+id+'&record=x',{method:'POST',body:'not audio',headers:{authorization:'Bearer '+secret}});assert.equal(r.status,400);assert.equal(store.list('bridge-audio').length,0);
 r=await step(server,{RecordingUrl:'https://attacker.invalid/audio'});assert.equal(r.status,403);
 r=await step(server,{RecordingUrl:'ve:11111111-1111-1111-1111-111111111111'});assert.equal(r.status,403);
});
test('speech is authenticated and uses configured provider, not a simulated answer',async t=>{
 const {server,service}=fixture(t);let calls=0;service.providers.speak=async text=>{calls++;assert.equal(text,'שלום');return Buffer.from('wav');};await step(server);
 const base='/voice-elements/speech';assert.equal((await request(server,base,{method:'POST',body:{callId:id,text:'שלום'}})).status,403);
 assert.equal((await request(server,base,{method:'POST',body:{callId:id,text:'שלום'},headers:{authorization:'Bearer '+secret}})).status,200);assert.equal(calls,1);
});
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVE',8);return b;}
async function prepared(t,phase='chat'){
 const f=fixture(t),u=enroll(f.service),login=f.service.identity.login(u.user.code,u.pin),conversation=f.service.newConversation(u.user.id,'test');
 f.store.create('call','voice',{id,phase,silence:0,token:login.token,userId:u.user.id,conversationId:conversation.id,recordNonce:'record'});
 return {...f,u,login,conversation};
}
test('uploaded WAV reaches real chat workflow and temporary audio is removed',async t=>{
 const {server,store,service,conversation}=await prepared(t);let transcribed=0;
 service.providers.transcribe=async(audio,mime)=>{transcribed++;assert.deepEqual(audio,wav());assert.equal(mime,'audio/wav');return 'שאלה לבדיקה';};
 service.providers.chat=async()=> 'תשובה לבדיקה';
 const upload=()=>request(server,'/voice-elements/record?call='+id+'&record=record',{method:'POST',body:wav(),headers:{authorization:'Bearer '+secret}});
 const r=await upload();assert.equal(r.status,200);const reference=r.body.recording;assert.equal((await upload()).body.recording,reference);
 const response=await step(server,{RecordingUrl:reference,RecordingSid:reference},'?record=record');assert.equal(response.status,200);
 for(let i=0;i<50&&store.get('call',id).phase==='processing';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(transcribed,1);assert.equal(store.get('conversation',conversation.id).messages.at(-1).text,'תשובה לבדיקה');
 assert.equal(store.list('bridge-audio').length,0);assert.equal(store.list('audio')[0].status,'deleted');
});
test('call end revokes login and cannot be resumed by replaying its identifier',async t=>{
 const {server,store,service,login}=await prepared(t);
 const r=await request(server,'/voice-elements/end',{method:'POST',body:{callId:id},headers:{authorization:'Bearer '+secret}});assert.equal(r.status,200);
 assert.throws(()=>service.identity.authenticate(login.token));assert.equal(store.get('call',id).phase,'ended');assert.equal((await step(server)).status,403);
});
test('WAV upload requires the current nonce and enforces size before storage',async t=>{
 const {server,store}=await prepared(t);
 for(const [nonce,audio,status] of [['stale',wav(),400],['record',Buffer.from('not WAV'),400],['record',Buffer.alloc(6*1024*1024+1),413]]){
 const r=await request(server,'/voice-elements/record?call='+id+'&record='+nonce,{method:'POST',body:audio,headers:{authorization:'Bearer '+secret}});assert.equal(r.status,status);assert.equal(store.list('bridge-audio').length,0);
 }
});
test('readiness reports protocol compatibility, never a verified live call',async t=>{
 const {server,store}=fixture(t);
 assert.equal((await request(server,'/voice-elements/ready',{method:'POST',body:{}})).status,403);
 const r=await request(server,'/voice-elements/ready',{method:'POST',body:{},headers:{authorization:'Bearer '+secret}});
 assert.deepEqual(r.body,{ok:true,protocol:1,liveVerified:false});assert.equal(store.list('call').length,0);
});

test('login gives 30 seconds, retries incomplete PIN without locking and explains idle exit',async t=>{
 const {server,service,store}=fixture(t),u=enroll(service);
 let r=await step(server);assert.match(r.text,/timeout="30"/);
 let c=store.get('call',id);await step(server,{Digits:u.user.code},'?input='+c.inputNonce);
 c=store.get('call',id);r=await step(server,{Digits:'12'},'?input='+c.inputNonce);
 assert.match(r.text,/לא התקבל קוד מלא/);assert.equal(store.list('failure').length,0);assert.equal(store.get('call',id).phase,'login-pin');
 for(let n=0;n<6;n++)r=await step(server);
 assert.match(r.text,/<Hangup/);assert.match(r.text,/כשהקודים מוכנים/);assert.doesNotMatch(r.text,/העבודה שאושרה נשמרה/);
});
test('speech sends the selected warm voice and Hebrew delivery instructions',async t=>{
 const {liveProviders}=await import('../../src/mirkam/providers.js');
 const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY='test-only';
 t.after(()=>{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;});
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/audio/speech');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-4o-mini-tts');assert.equal(body.voice,'coral');assert.match(body.instructions,/Israeli Hebrew/);assert.equal(body.input,'שלום');return new Response(wav(),{status:200});};
 assert.deepEqual(await liveProviders().speak('שלום'),wav());
});
test('family review offers replay and re-recording without sending or carrying old approval',async t=>{
 const {server,store,service}=fixture(t),u=enroll(service),login=service.identity.login(u.user.code,u.pin);
 const contact=service.approveContact(u.user.id,{name:'משפחה',email:'test@example.test'},'owner');
 const message=service.compose(u.user.id,contact.id,'שלום מתוך חומות הכל');let sent=0;service.providers.familyMail=async()=>{sent++;throw Error('must not send');};
 store.create('call','voice',{id,phase:'family-review',silence:0,token:login.token,messageId:message.id});
 let r=await step(server);assert.match(r.text,/בדקו שהמילים מדויקות/);assert.match(r.text,/לשמיעה חוזרת 3/);
 let c=store.get('call',id);r=await step(server,{Digits:'3'},'?input='+c.inputNonce);assert.match(r.text,/שלום מתוך חומות הכל/);assert.equal(sent,0);
 c=store.get('call',id);await step(server,{Digits:'2'},'?input='+c.inputNonce);c=store.get('call',id);assert.equal(c.phase,'family-compose');assert.equal(c.messagePresented,null);assert.equal(sent,0);assert.equal(store.get('message',message.id).status,'review');
});
test('repeated login prompt is short and keeps six-digit authentication',async t=>{
 const {server}=fixture(t);const first=await step(server),again=await step(server);
 assert.match(first.text,/טוב שאתם כאן/);assert.doesNotMatch(first.text,/תמלולים והקלטות/);assert.doesNotMatch(again.text,/תמלולים והקלטות/);assert.match(again.text,/numDigits="6"/);assert.match(again.text,/timeout="30"/);
});
test('owner can compare cached Hebrew samples; unauthenticated and unsupported choices cannot spend',async t=>{
 const {server,service}=fixture(t);let calls=0;
 service.providers.speak=async(text,options)=>{calls++;assert.match(text,/טוב שהתקשרת/);assert.doesNotMatch(text,/שלוחה|הקראה|משה/);assert.equal(options.voice,'marin');return wav();};
 const url='/api/admin/voice-sample';assert.notEqual((await request(server,url,{method:'POST',body:{voice:'marin'}})).status,200);
 assert.equal((await request(server,url,{method:'POST',token:admin,body:{voice:'invalid'}})).status,400);assert.equal(calls,0);
 for(let n=0;n<2;n++){const r=await request(server,url,{method:'POST',token:admin,body:{voice:'marin',text:'must ignore'}});assert.equal(r.status,200);assert.deepEqual(Buffer.from(r.body.audio,'base64'),wav());}assert.equal(calls,1);
 const member=service.staff.create('support','support','owner'),login=service.staff.login(member.id,member.password);
 assert.equal((await request(server,url,{method:'POST',token:login.token,body:{voice:'coral'}})).status,403);assert.equal(calls,1);
});
test('successful login greets the authenticated user once inside the interruptible main menu',async t=>{
 const {server,service,store}=fixture(t),u=enroll(service);await step(server);let c=store.get('call',id);
 await step(server,{Digits:u.user.code},'?input='+c.inputNonce);c=store.get('call',id);await step(server,{Digits:u.pin},'?input='+c.inputNonce);
 const first=await step(server);assert.match(first.text,/<Gather[^>]*><Say[^>]*>שלום שם, מה שלומך/);assert.match(first.text,/הקודים אינם מוקלטים/);
 const next=await step(server);assert.doesNotMatch(next.text,/מה שלומך/);
});
