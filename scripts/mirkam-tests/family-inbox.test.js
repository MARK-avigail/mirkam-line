import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
import {fileURLToPath} from 'node:url';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {createFamilyInbox} from '../../src/mirkam/family-inbox.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
const admin='a'.repeat(64);process.env.MIRKAM_ADMIN_TOKEN=admin;process.env.VOICE_ELEMENTS_BRIDGE_TOKEN='test-bridge-'.repeat(4);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'family-mail-')),store=new Store(dir),service=new Mirkam(store);
 const account=service.identity.register({name:'משתמש בדיקה',identity:'123456789',prisonerNumber:'101',prison:'בדיקה'},'owner');
 const contact=service.approveContact(account.user.id,{name:'משפחה',email:'family@example.test'},'owner');
 let message=service.compose(account.user.id,contact.id,'שלום למשפחה');message=store.put('message',{...message,status:'accepted_by_mail_server'});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service,account,contact,message};
}
const batch=(message,{uid=1,messageId='<family-reply@example.test>',sender='family@example.test',text='הכוונה הייתה כלא, ולא הכל.'}={})=>({ok:true,uidValidity:42,cursor:uid,scanned:1,pending:false,skipped:{},replies:[{uid,parentId:message.id,sender,messageId,text,hasAttachments:false}]});
function receiver(t,f,read){const inbox=createFamilyInbox(f.service,{read,enabled:()=>true});t.after(()=>inbox.close());return inbox;}
function request(server,url,{method='GET',token=admin,body}={}){
 return new Promise((resolve,reject)=>{const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);req.url=url;req.method=method;req.headers={authorization:'Bearer '+token,host:'example.test'};req.socket={remoteAddress:'127.0.0.1'};
 const response={setHeader(){},writeHead(status){this.status=status;},end(data=''){const text=String(data);let parsed;try{parsed=JSON.parse(text);}catch{}resolve({status:this.status,text,body:parsed});}};server.emit('request',req,response);req.on('error',reject);});
}
test('reply is owned by the original user, visible in management and spoken in branch 4/2',async t=>{
 const f=fixture(t);
 // Real Python MIME parser -> real SQLite intake -> management/telephone handlers.
 const script=fileURLToPath(new URL('../mail/read-family-inbox.py',import.meta.url));
 const py=`import importlib.util,json,sys\nfrom email.message import EmailMessage\ns=importlib.util.spec_from_file_location('mail',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=EmailMessage();x['From']='family@example.test';x['Authentication-Results']='mx.google.com; dmarc=pass header.from=example.test';x['In-Reply-To']=sys.argv[2];x['Message-ID']='<actual-parser@example.test>';x.set_content('הכוונה הייתה כלא, ולא הכל.');item,error=m.parse_reply(x.as_bytes(),{sys.argv[2]:sys.argv[3]},1);assert not error;print(json.dumps(item))`;
 const parsed=JSON.parse((await execute('python3',['-c',py,script,`<${f.message.id}@mirkam.invalid>`,f.message.id],{encoding:'utf8'})).stdout);
 f.service.providers.familyInbox=async input=>{assert.equal(input.parents[`<${f.message.id}@mirkam.invalid>`],f.message.id);return {...batch(f.message),replies:[parsed]};};
 const server=createMirkamServer(f.service);t.after(()=>server.close());
 let response=await request(server,'/api/admin/family-inbox',{method:'POST',body:{}});assert.equal(response.status,200);assert.equal(response.body.lastImported,1);
 const received=f.store.list('message',f.account.user.id).find(m=>m.direction==='incoming');assert.equal(received.text,'הכוונה הייתה כלא, ולא הכל.');assert.equal(received.parentId,f.message.id);
 response=await request(server,'/api/admin/messages');assert.ok(response.body.items.some(m=>m.id===received.id&&m.userName===f.account.user.name&&m.contactName==='משפחה'));
 const login=f.service.identity.login(f.account.user.code,f.account.pin),call='VE'+'1'.repeat(32);
 f.store.create('call','voice',{id:call,phase:'branch',branch:'4',token:login.token,silence:0,inputNonce:'choose'});
 response=await request(server,'/voice-elements/step?input=choose',{method:'POST',token:process.env.VOICE_ELEMENTS_BRIDGE_TOKEN,body:new URLSearchParams({CallSid:call,Digits:'2'}).toString()});
 assert.equal(response.status,200);assert.match(response.text,/הכוונה הייתה כלא, ולא הכל/);
 assert.doesNotMatch(JSON.stringify(response.body||{}),/SMTP_PASS/);
});
test('message-ID deduplication survives new IMAP UID and service restart',async t=>{
 const f=fixture(t);let uid=1;const read=async()=>batch(f.message,{uid:uid++});
 await receiver(t,f,read).sync();const result=await receiver(t,f,read).sync();
 assert.equal(result.lastImported,0);assert.equal(result.totalImported,1);assert.equal(result.skipped.duplicate,1);assert.equal(f.store.list('message').filter(m=>m.direction==='incoming').length,1);
});
test('wrong sender and revoked contact cannot populate a user inbox',async t=>{
 const f=fixture(t);let uid=1;const read=async()=>batch(f.message,{uid:uid++,sender:'attacker@example.test'});const inbox=receiver(t,f,read);
 assert.equal((await inbox.sync()).lastImported,0);
 f.store.put('contact',{...f.contact,active:false});f.service.providers.familyInbox=async()=>batch(f.message,{uid:3});
 assert.equal((await receiver(t,f,f.service.providers.familyInbox).sync()).lastImported,0);assert.equal(f.store.list('message').filter(m=>m.direction==='incoming').length,0);
});
test('storage failure rolls back import, audit and cursor so the reply can be retried',async t=>{
 const f=fixture(t),inbox=receiver(t,f,async()=>batch(f.message)),put=f.store.put.bind(f.store),create=f.store.create.bind(f.store);
 f.store.create=(kind,...args)=>{if(kind==='mail-sync')throw Error('injected disk failure');return create(kind,...args);};
 await assert.rejects(inbox.sync());assert.equal(f.store.list('message').filter(m=>m.direction==='incoming').length,0);assert.equal(f.store.get('mail-sync','family-inbox'),null);
 f.store.create=create;assert.equal((await inbox.sync()).lastImported,1);
});
test('concurrent checks coalesce, and provider failure never advances the saved cursor',async t=>{
 const f=fixture(t);let resolve,calls=0;const pending=new Promise(r=>{resolve=r;}),inbox=receiver(t,f,async()=>{calls++;return pending;});
 const a=inbox.sync(),b=inbox.sync();resolve(batch(f.message));await Promise.all([a,b]);assert.equal(calls,1);assert.equal(inbox.status().totalImported,1);
 const failed=receiver(t,f,async()=>{throw Object.assign(Error('SECRET RAW PROVIDER RESPONSE'),{code:'INBOUND_LOGIN_FAILED'});});
 const result=await failed.sync();assert.equal(result.error,'INBOUND_LOGIN_FAILED');assert.equal(f.store.get('mail-sync','family-inbox').cursor,1);assert.doesNotMatch(JSON.stringify(result),/SECRET|family@example|הכוונה/);
});
test('disabled connector and accounts with no sent messages never open a mailbox',async t=>{
 const f=fixture(t);let calls=0;const read=async()=>{calls++;throw Error();};
 const disabled=createFamilyInbox(f.service,{read,enabled:()=>false});t.after(()=>disabled.close());assert.equal((await disabled.sync()).error,'INBOUND_NOT_CONFIGURED');
 f.store.put('message',{...f.message,status:'review'});assert.equal((await receiver(t,f,read).sync()).error,'INBOUND_NO_SENT_THREADS');assert.equal(calls,0);
});
test('malformed provider batch is rejected atomically',async t=>{
 const f=fixture(t),bad=batch(f.message);bad.replies.push({...bad.replies[0],uid:2});
 const result=await receiver(t,f,async()=>bad).sync();assert.equal(result.error,'INBOUND_INVALID_RESPONSE');assert.equal(f.store.list('message').filter(m=>m.direction==='incoming').length,0);
});
test('only owner can trigger or inspect mailbox sync',async t=>{
 const f=fixture(t);let calls=0;f.service.providers.familyInbox=async()=>{calls++;return batch(f.message);};
 const staff=f.service.staff.create('תמיכה','support','owner'),login=f.service.staff.login(staff.id,staff.password),server=createMirkamServer(f.service);t.after(()=>server.close());
 for(const method of ['GET','POST']){assert.equal((await request(server,'/api/admin/family-inbox',{method,token:'invalid',body:method==='POST'?{}:undefined})).status,401);assert.equal((await request(server,'/api/admin/family-inbox',{method,token:login.token,body:method==='POST'?{}:undefined})).status,403);}
 assert.equal(calls,0);
});
test('long family replies are read in bounded sections, with next, repeat and back controls',async t=>{
 const f=fixture(t),call='VE'+'2'.repeat(32),login=f.service.identity.login(f.account.user.code,f.account.pin);
 const text='תחילת הודעה '+('א&'.repeat(2200))+' סוף התשובה';
 f.service.receiveReply(f.message.id,'family@example.test',text,'long-reply','test');
 const server=createMirkamServer(f.service);t.after(()=>server.close());
 f.store.create('call','voice',{id:call,phase:'branch',branch:'4',token:login.token,silence:0,inputNonce:'choose'});
 const step=async digit=>{const c=f.store.get('call',call);return request(server,'/voice-elements/step?input='+c.inputNonce,{method:'POST',token:process.env.VOICE_ELEMENTS_BRIDGE_TOKEN,body:new URLSearchParams({CallSid:call,Digits:digit}).toString()});};
 let response=await step('2');assert.match(response.text,/תחילת הודעה/);assert.doesNotMatch(response.text,/סוף התשובה/);assert.ok(response.text.length<6000);
 response=await step('1');assert.equal(f.store.get('call',call).familyReadPart,1);
 await step('3');assert.equal(f.store.get('call',call).familyReadPart,1);
 await step('2');assert.equal(f.store.get('call',call).familyReadPart,0);
 for(let n=0;n<8&&!response.text.includes('סוף התשובה');n++){response=await step('1');assert.ok(response.text.length<6000);}
 assert.match(response.text,/סוף התשובה/);assert.match(response.text,/סוף ההודעות/);
 await step('8');assert.equal(f.store.get('call',call).phase,'main');
});
