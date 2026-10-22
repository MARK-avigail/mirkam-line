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
test('overlapping callers keep audio, recordings and sessions separate when one hangs up',async t=>{
 const {server,service,store}=fixture(t), ids=[id,'VE'+'2'.repeat(32)];
 const users=[enroll(service),enroll(service,'987654321')];
 for(let i=0;i<2;i++){
  await step(server,{CallSid:ids[i]});
  await step(server,{CallSid:ids[i],Digits:users[i].user.code},'?input='+store.get('call',ids[i]).inputNonce);
  await step(server,{CallSid:ids[i],Digits:users[i].pin},'?input='+store.get('call',ids[i]).inputNonce);
 }
 const tokens=ids.map(call=>store.get('call',call).token);
 const releases=new Map();
 service.providers.speak=text=>new Promise(resolve=>releases.set(text,resolve));
 const speech=(callId,text)=>request(server,'/voice-elements/speech',{method:'POST',body:{callId,text},headers:{authorization:'Bearer '+secret}});
 const pending=[speech(ids[0],'תשובה אישית ראשונה'),speech(ids[1],'תשובה אישית שנייה')];
 for(let n=0;n<100&&releases.size<2;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(releases.size,2,'both synthesis requests must actually overlap');
 for(let i=0;i<2;i++)store.put('call',{...store.get('call',ids[i]),recordNonce:'nonce-'+i});
 const recordings=await Promise.all(ids.map((call,i)=>request(server,'/voice-elements/record?call='+call+'&record=nonce-'+i,{method:'POST',body:wav(),headers:{authorization:'Bearer '+secret}})));
 assert.deepEqual(recordings.map(r=>r.status),[200,200]);
 assert.notEqual(recordings[0].body.recording,recordings[1].body.recording);
 assert.equal((await step(server,{CallSid:ids[1],RecordingUrl:recordings[0].body.recording},'?record=nonce-0')).status,403);
 assert.equal((await request(server,'/voice-elements/end',{method:'POST',body:{callId:ids[0]},headers:{authorization:'Bearer '+secret}})).status,200);
 assert.throws(()=>service.identity.authenticate(tokens[0]));
 assert.equal(service.identity.authenticate(tokens[1]).user.id,users[1].user.id);
 assert.equal(store.get('bridge-audio',recordings[0].body.recording),null);
 assert.equal(store.get('bridge-audio',recordings[1].body.recording).callId,ids[1]);
 releases.get('תשובה אישית שנייה')(Buffer.from('second-only'));
 assert.equal((await pending[1]).text,'second-only');
 releases.get('תשובה אישית ראשונה')(Buffer.from('first-only'));
 const endedResponse=await pending[0];assert.equal(endedResponse.status,400);assert.ok(!endedResponse.text.includes('first-only'));
 assert.equal(store.get('call',ids[0]).phase,'ended');
 assert.equal((await step(server,{CallSid:ids[1]})).status,200);
 assert.notEqual(store.get('call',ids[1]).phase,'ended');
});
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
test('Live listening trial is owner-only and cannot accept a different voice or session target',async t=>{
 const {server,service}=fixture(t);let creates=0,closes=0;
 const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
 service.providers.liveVoice={create:async value=>{creates++;assert.equal(value,sdp);return {session:{id:'live_test'},transport:{type:'webrtc',sdp}};},close:async id=>{assert.equal(id,'live_test');closes++;}};
 const member=service.staff.create('support','support','owner'),login=service.staff.login(member.id,member.password),url='/api/admin/live-voice';
 for(const token of [undefined,login.token])assert.notEqual((await request(server,url,{method:'POST',token,body:{sdp}})).status,201);
 assert.equal(creates,0);
 const result=await request(server,url,{method:'POST',token:admin,body:{sdp,voice:'attacker',instructions:'send mail'}});
 assert.equal(result.status,201);assert.equal(result.body.voice,'voice_6ad601faaa188191aa00d6384fc09ca8');assert.equal(creates,1);
 assert.equal((await request(server,url,{method:'POST',token:admin,body:{sdp}})).status,409);
 assert.equal((await request(server,url,{method:'DELETE',token:admin,body:{id:'foreign'}})).status,200);assert.equal(closes,1);
});

test('speech completed after hangup is discarded rather than returned to the bridge',async t=>{
 const {server,service}=await prepared(t);let release,started;
 const began=new Promise(r=>started=r);service.providers.speak=()=>{started();return new Promise(r=>release=r);};
 const pending=request(server,'/voice-elements/speech',{method:'POST',body:{callId:id,text:'מידע פרטי'},headers:{authorization:'Bearer '+secret}});
 await began;
 await request(server,'/voice-elements/end',{method:'POST',body:{callId:id},headers:{authorization:'Bearer '+secret}});
 release(wav());const r=await pending;assert.equal(r.status,400);assert.doesNotMatch(r.text,/RIFF/);
});
test('revoking login during speech generation prevents releasing the audio',async t=>{
 const {server,service,login}=await prepared(t);let release,started;
 const began=new Promise(r=>started=r);service.providers.speak=()=>{started();return new Promise(r=>release=r);};
 const pending=request(server,'/voice-elements/speech',{method:'POST',body:{callId:id,text:'מידע פרטי'},headers:{authorization:'Bearer '+secret}});
 await began;service.identity.logout(login.token);release(wav());assert.equal((await pending).status,400);
});
test('a pending transcription failure cannot revive an ended call or restore its job',async t=>{
 const {server,service,store}=await prepared(t);let fail,started;
 const began=new Promise(r=>started=r);service.providers.transcribe=()=>{started();return new Promise((resolve,reject)=>fail=reject);};
 const upload=await request(server,'/voice-elements/record?call='+id+'&record=record',{method:'POST',body:wav(),headers:{authorization:'Bearer '+secret}});
 await step(server,{RecordingUrl:upload.body.recording,RecordingSid:upload.body.recording},'?record=record');await began;
 await request(server,'/voice-elements/end',{method:'POST',body:{callId:id},headers:{authorization:'Bearer '+secret}});
 fail(Error('provider failed'));
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 const c=store.get('call',id);assert.equal(c.phase,'ended');assert.equal(c.token,null);assert.equal(c.jobId,null);assert.equal((await step(server)).status,403);
});

test('announcements and family inbox can be interrupted with return during playback',async t=>{
 const {server,store,u}=await prepared(t,'branch');
 for(const branch of ['4','5']){
  const c=store.get('call',id);store.put('call',{...c,branch,inputNonce:'choose',phase:'branch'});
  if(branch==='4')store.create('message',u.user.id,{direction:'incoming',text:'הודעה מהמשפחה'});
  else store.create('announcement','all',{active:true,text:'עדכון מהמערכת'});
  const r=await step(server,{Digits:branch==='4'?'2':'1'},'?input=choose');
  assert.match(r.text,/<Response><Gather[^>]*><Say/);assert.match(r.text,branch==='4'?/הודעה מהמשפחה/:/עדכון מהמערכת/);
  const current=store.get('call',id);await step(server,{Digits:'8'},'?input='+current.inputNonce);
  assert.equal(store.get('call',id).phase,'main');
 }
});

test('the caller can leave an AI answer during playback without losing the conversation',async t=>{
 const {server,store,conversation}=await prepared(t);let c=store.get('call',id);store.put('call',{...c,speech:'תשובה ארוכה של ליין'});
 const r=await step(server);assert.match(r.text,/<Response><Gather[^>]*><Say[^>]*>תשובה ארוכה של ליין/);assert.match(r.text,/<\/Gather><Record/);
 c=store.get('call',id);await step(server,{Digits:'8'},'?input='+c.inputNonce);assert.equal(store.get('call',id).phase,'main');assert.ok(store.get('conversation',conversation.id));
});
test('numeric end diagnostics reach only the owner without caller or transcript fields',async t=>{
 const {server,store}=await prepared(t);
 const diagnostics={durationSeconds:303,reason:'remote-disconnect',stage:'speech-play',generalCause:16,gcCause:0,dropError:0,scheduledDropSeconds:300,caller:'SECRET-CALLER',transcript:'SECRET-TEXT'};
 const ended=await request(server,'/voice-elements/end',{method:'POST',body:{callId:id,diagnostics},headers:{authorization:'Bearer '+secret}});assert.equal(ended.status,200);
 const r=await request(server,'/api/admin/voice-health',{token:admin});assert.equal(r.status,200);assert.equal(r.body.recent[0].durationSeconds,303);assert.equal(r.body.recent[0].scheduledDropSeconds,300);
 assert.doesNotMatch(r.text,/SECRET|CallSid|VE1111|token|userId/);assert.doesNotMatch(JSON.stringify(store.get('call',id).diagnostics),/SECRET/);
 assert.equal((await request(server,'/api/admin/voice-health')).status,401);
 const f=fixture(t);const staff=f.service.staff.create('support','support','owner'),login=f.service.staff.login(staff.id,staff.password);
 assert.equal((await request(f.server,'/api/admin/voice-health',{token:login.token})).status,403);
});
test('diagnostics reject arbitrary text in reason, stage and numeric codes',async t=>{
 const {server,store}=await prepared(t);
 await request(server,'/voice-elements/end',{method:'POST',body:{callId:id,diagnostics:{reason:'SECRET',stage:'SECRET',durationSeconds:-1,generalCause:'SECRET',gcCause:1e20,dropError:null}},headers:{authorization:'Bearer '+secret}});
 assert.equal(store.get('call',id).diagnostics,null);
});
test('diagnostic history is bounded and does not expose other call fields',async t=>{
 const {server,store}=fixture(t);
 for(let i=0;i<25;i++)store.create('call','voice',{phase:'ended',endedAt:1000+i,diagnostics:{durationSeconds:i,reason:'error',stage:'speech-play'},token:'SECRET'});
 const r=await request(server,'/api/admin/voice-health',{token:admin});assert.equal(r.body.recent.length,10);assert.equal(r.body.recent[0].durationSeconds,24);assert.equal(r.body.recent[9].durationSeconds,15);assert.doesNotMatch(r.text,/SECRET/);
});
test('configured Voice Elements and fax providers are reflected without claiming live success',async t=>{
 const {server,service}=fixture(t);service.providers.supports=channel=>channel==='fax';
 const r=await request(server,'/api/admin/status',{token:admin});assert.equal(r.body.voiceConfigured,true);assert.equal(r.body.faxConfigured,true);assert.equal(r.body.liveVerified,false);assert.doesNotMatch(r.text,new RegExp(secret));
});

test('processing announces once and polls without repeating paid speech',async t=>{
 const {server,store}=await prepared(t,'processing');
 for(let i=0;i<8;i++){const r=await step(server);assert.equal(r.status,200);if(i===0)assert.match(r.text,/רק רגע/);else assert.doesNotMatch(r.text,/<Say/);assert.match(r.text,/<Pause length="1"/);assert.doesNotMatch(r.text,/<Hangup/);}
 assert.equal(store.get('call',id).processingNotified,true);
});
test('fixed prompts share a generation while personal speech is never cached',async t=>{
 const {server,service}=await prepared(t);let calls=0;service.providers.speak=async()=>{calls++;await new Promise(r=>setImmediate(r));return wav();};
 const speak=text=>request(server,'/voice-elements/speech',{method:'POST',body:{callId:id,text},headers:{authorization:'Bearer '+secret}});
 const both=await Promise.all([speak('רק רגע.'),speak('רק רגע.')]);assert.ok(both.every(r=>r.status===200));assert.equal(calls,1);
 assert.equal((await speak('רק רגע.')).status,200);assert.equal(calls,1);
 await speak('תוכן פרטי לבדיקה');await speak('תוכן פרטי לבדיקה');assert.equal(calls,3);
});
test('failed synthesis does not poison fixed prompt cache',async t=>{
 const {server,service}=await prepared(t);let calls=0;service.providers.speak=async()=>{calls++;if(calls===1)throw Error('unavailable');return wav();};
 const speak=()=>request(server,'/voice-elements/speech',{method:'POST',body:{callId:id,text:'רק רגע.'},headers:{authorization:'Bearer '+secret}});
 assert.equal((await speak()).status,400);assert.equal((await speak()).status,200);assert.equal((await speak()).status,200);assert.equal(calls,2);
});
test('telephone context reaches the answer provider and failed answer clears stale speech',async t=>{
 const {server,service,store}=await prepared(t);let seen;service.providers.transcribe=async()=> 'שאלה קצרה';service.providers.chat=async(messages,options)=>{seen=options;throw Error('unavailable');};
 const c=store.get('call',id);store.put('call',{...c,speech:'תשובה ישנה שאין להשמיע שוב'});
 const upload=await request(server,'/voice-elements/record?call='+id+'&record=record',{method:'POST',body:wav(),headers:{authorization:'Bearer '+secret}});
 await step(server,{RecordingUrl:upload.body.recording,RecordingSid:upload.body.recording},'?record=record');
 for(let i=0;i<30&&store.get('call',id).phase==='processing';i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(seen,{channel:'telephone'});assert.equal(store.get('call',id).speech,null);
 const response=await step(server);assert.doesNotMatch(response.text,/תשובה ישנה/);
});

test('recovery audio is fixed, authenticated and reused across requests',async t=>{
 const {server,service}=fixture(t);let calls=0;service.providers.speak=async text=>{calls++;assert.match(text,/תקלה זמנית בהשמעה/);assert.doesNotMatch(text,/PRIVATE/);return wav();};
 const post=key=>request(server,'/voice-elements/recovery',{method:'POST',body:{text:'PRIVATE'},headers:{authorization:'Bearer '+key}});
 assert.equal((await post('bad')).status,403);assert.equal(calls,0);
 assert.equal((await post(secret)).status,200);assert.equal((await post(secret)).status,200);assert.equal(calls,1);
});
test('speech recovery returns to menu without approving or sending and preserves saved work',async t=>{
 const {server,service,store,conversation,login,u}=await prepared(t);const draft=service.createDraft(u.user.id,false);let sends=0;service.providers.deliver=service.providers.familyMail=async()=>{sends++;throw Error('must not send');};
 const before=store.get('call',id);store.put('call',{...before,phase:'delivery-confirm',draftId:draft.id,inputNonce:'old-input',recordNonce:'old-record',deliveryPresented:'old-approval',speech:'old-answer'});
 const r=await request(server,'/voice-elements/speech-recover',{method:'POST',body:{callId:id},headers:{authorization:'Bearer '+secret}});assert.equal(r.status,200);
 const after=store.get('call',id);assert.equal(after.phase,'main');assert.equal(after.token,login.token);assert.equal(after.inputNonce,null);assert.equal(after.recordNonce,null);assert.equal(after.deliveryPresented,null);assert.equal(after.speech,null);assert.equal(after.speechRecoveries,1);assert.ok(store.get('conversation',conversation.id));assert.equal(store.get('draft',draft.id).revision,draft.revision);assert.equal(sends,0);
 const menu=await step(server);assert.match(menu.text,/כותבים עתירה/);assert.doesNotMatch(menu.text,/old-answer/);
});
test('speech recovery cannot restore revoked login or ended calls',async t=>{
 const {server,service,store,login}=await prepared(t);service.identity.logout(login.token);
 const post=()=>request(server,'/voice-elements/speech-recover',{method:'POST',body:{callId:id},headers:{authorization:'Bearer '+secret}});
 assert.equal((await post()).status,200);assert.equal(store.get('call',id).phase,'login-code');assert.equal(store.get('call',id).token,null);
 await request(server,'/voice-elements/end',{method:'POST',body:{callId:id},headers:{authorization:'Bearer '+secret}});
 assert.equal((await post()).status,400);assert.equal(store.get('call',id).phase,'ended');
});
test('fixed speech cache evicts within its byte limit and excludes arbitrary text',async()=>{
 const {fixedSpeechCache}=await import('../../src/mirkam/speech-cache.js');const cache=fixedSpeechCache({maxBytes:100});let calls=0;const generate=async()=>{calls++;return Buffer.alloc(80);};
 await cache.get('רק רגע.',generate);await cache.get('רק רגע.',generate);assert.equal(calls,1);
 await cache.get('אני כאן. מה תרצו לשאול?',generate);await cache.get('רק רגע.',generate);assert.equal(calls,3);
 await cache.get('מידע פרטי',generate);await cache.get('מידע פרטי',generate);assert.equal(calls,5);
});

test('completed chat answer is spoken once, not replayed after silence',async t=>{
 const {server,store}=await prepared(t);const answer='תשובה שהושלמה לבדיקה';
 store.put('call',{...store.get('call',id),speech:answer});
 const first=await step(server);assert.match(first.text,new RegExp(answer));
 assert.equal(store.get('call',id).speech,null);
 const retry=await step(server);assert.doesNotMatch(retry.text,new RegExp(answer));assert.match(retry.text,/מה תרצו לשאול/);
});
test('returning to main menu does not replay a pending answer from the previous branch',async t=>{
 const {server,store}=await prepared(t);const answer='תשובה ישנה מהשלוחה';
 store.put('call',{...store.get('call',id),speech:answer,inputNonce:'back'});
 await step(server,{Digits:'8'},'?input=back');
 const menu=await step(server);assert.doesNotMatch(menu.text,new RegExp(answer));assert.match(menu.text,/כותבים עתירה/);
});
test('restart recovery clears old answer and approval context without changing saved messages',async t=>{
 const {store,service,u}=await prepared(t,'processing');
 const job=store.create('voice-job','voice',{callId:id,kind:'family-mail',status:'processing',previous:'family-review'});
 store.create('message',u.user.id,{text:'תוכן שנשמר לבדיקה',status:'review'});
 const before=store.get('call',id);store.put('call',{...before,jobId:job.id,speech:'תשובה ישנה',inputNonce:'old-input',recordNonce:'old-record',messagePresented:'old-message',deliveryPresented:'old-delivery'});
 const savedBefore=store.list('message');service.recover();
 const after=store.get('call',id);assert.equal(after.phase,'family-review');assert.equal(after.jobId,null);
 for(const field of ['speech','inputNonce','recordNonce','messagePresented','deliveryPresented'])assert.equal(after[field],null);
 assert.equal(store.get('voice-job',job.id).status,'interrupted');assert.deepEqual(store.list('message'),savedBefore);
});
