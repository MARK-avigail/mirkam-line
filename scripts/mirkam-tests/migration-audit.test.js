import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {requestBytes} from '../../src/providers.js';
import {attachmentInput,reviewFingerprint} from '../../src/mirkam/documents.js';
import {Store} from '../../src/mirkam/store.js';
// Exercise byte limits with segmented streams: no content-length, honest and dishonest headers.
for(const size of [0,1,2,7,15,16,17,31,32,33,64])for(const header of ['absent','accurate','underreported'])test(`provider response cap: ${size} bytes, ${header} length`,async t=>{
 const original=globalThis.fetch;let cancelled=false;
 globalThis.fetch=async()=>({ok:true,headers:new Headers(header==='absent'?{}:{'content-length':String(header==='accurate'?size:0)}),body:{getReader(){let pos=0;return {async read(){if(pos>=size)return {done:true};const n=Math.min(7,size-pos);pos+=n;return {done:false,value:new Uint8Array(n).fill(65)};},async cancel(){cancelled=true;},releaseLock(){}};}}});t.after(()=>{globalThis.fetch=original;});
 if(size<=32)assert.equal((await requestBytes('https://provider.example.test',{},32)).length,size);
 else {await assert.rejects(requestBytes('https://provider.example.test',{},32),/גדולה מדי/);if(header!=='accurate')assert.equal(cancelled,true);}
});
const samples=[['application/pdf',Buffer.from('%PDF-test')],['image/png',Buffer.from([137,80,78,71,13,10,26,10,0])],['image/jpeg',Buffer.from([255,216,255,0])]];
for(const [mime,bytes] of samples)for(const name of ['../file','a/b','a\\b','a\u0000b','a\nb','a\rb','a\tb','','x'.repeat(151),'a\u001fb'])test(`attachment rejects unsafe name ${JSON.stringify(name)} for ${mime}`,()=>{assert.throws(()=>attachmentInput(name,mime,bytes.toString('base64')));});
const draft={answers:{subject:'נושא',facts:'עובדות'},court:{id:'court-a',name:'מחוזי'},attachments:[]},profile={name:'שם',identity:'123456789',prisonerNumber:'123',prison:'א',wing:'1'},target={email:'test@example.test',fax:'+97211111111'};
const changes={subject:d=>d[0].answers.subject='שונה',facts:d=>d[0].answers.facts='שונה',newAnswer:d=>d[0].answers.grounds='חדש',courtId:d=>d[0].court.id='b',courtName:d=>d[0].court.name='אחר',attachment:d=>d[0].attachments.push({sha256:'new'}),name:d=>d[1].name='אחר',identity:d=>d[1].identity='987654321',prisonerNumber:d=>d[1].prisonerNumber='456',prison:d=>d[1].prison='ב',wing:d=>d[1].wing='2',email:d=>d[2].email='other@example.test',fax:d=>d[2].fax='+97222222222',channel:d=>d[3]='fax'};
for(const [field,change] of Object.entries(changes))test(`delivery approval invalidated when ${field} changes`,()=>{const original=[draft,profile,target,'email'];const copy=structuredClone(original);change(copy);assert.notEqual(reviewFingerprint(...original),reviewFingerprint(...copy));});
for(const kind of ['user','staff','draft','message','conversation','contact','delivery','version','payment','ticket','announcement','audit'])test(`migration preserves encrypted ${kind} and original key`,t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'migration-'));let a,b,wrong;t.after(()=>{a?.close();b?.close();wrong?.close();fs.rmSync(dir,{recursive:true,force:true});});a=new Store(path.join(dir,'old'));const r=a.create(kind,'owner',{text:'מידע לבדיקה בלבד',nested:{enabled:true},status:'saved'});const backup=path.join(dir,'backup.sqlite');a.backup(backup);fs.mkdirSync(path.join(dir,'new'));fs.copyFileSync(backup,path.join(dir,'new','mirkam.sqlite'));const key=fs.readFileSync(path.join(dir,'old','encryption.key')).toString('base64');b=new Store(path.join(dir,'new'),key);assert.deepEqual(b.owned(kind,r.id,'owner'),r);assert.throws(()=>b.owned(kind,r.id,'another'));b.close();assert.throws(()=>{wrong=new Store(path.join(dir,'new'),Buffer.alloc(32,99).toString('base64'));},/decryption failed/);
});
