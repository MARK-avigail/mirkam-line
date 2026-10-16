import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {TOPICS} from '../../src/mirkam/workflow.js';
import {renderPdf} from '../../src/documents.js';
import {liveProviders} from '../../src/mirkam/providers.js';
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resilience-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(t,providers={}){const store=new Store(directory(t));t.after(()=>store.close());return {store,service:new Mirkam(store,providers)};}
function environment(t,key,value){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
function fetchMock(t,fn){const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old;});environment(t,'OPENAI_API_KEY','test-only');}
function approved(service){const user=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner').user.id;const target=service.setDestination({name:'test',prisons:['test'],email:'test@example.test',verifiedSource:'test'},'owner');let d=service.createDraft(user,false);d=service.confirmProfile(d.id,user,d.revision);d=service.chooseCourt(d.id,user,target.id,d.revision);for(const topic of TOPICS){if(!topic.required)d=service.skip(d.id,user,d.revision);else{d=service.answer(d.id,user,'test '+topic.key,d.revision);d=service.confirmAnswer(d.id,user,true,d.revision);}}d=service.offer(d.id,user,target.id,'email',d.revision);d=service.approve(d.id,user,d.approval.nonce,true,d.revision);return {user,d};}

test('PDF burst rejects excess work without spawning unlimited renderers; capacity returns after completion',async t=>{
 const dir=directory(t),bin=path.join(dir,'fake-python'),calls=path.join(dir,'calls');
 fs.writeFileSync(bin,`#!/bin/sh\necho started >> '${calls}'\nsleep 0.2\nprintf '%%PDF-test'\n`,{mode:0o700});environment(t,'PYTHON_BIN',bin);
 const results=await Promise.allSettled([renderPdf('one'),renderPdf('two'),renderPdf('three')]);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===503).length,1);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,2);
 assert.ok((await renderPdf('later')).subarray(0,5).equals(Buffer.from('%PDF-')));
});
test('AI streaming response is cancelled at a byte limit before the full oversized JSON is allocated',async t=>{
 let cancelled=false,reads=0;const chunks=[Buffer.from('{"choices":[{"message":{"content":"'),...Array.from({length:32},()=>Buffer.alloc(128*1024,97)),Buffer.from('"}}]}')];
 fetchMock(t,async()=>new Response(new ReadableStream({pull(c){reads++;if(chunks.length)c.enqueue(chunks.shift());else c.close();},cancel(){cancelled=true;}})));
 await assert.rejects(liveProviders().chat([{role:'user',text:'test'}]));assert.equal(cancelled,true);assert.ok(reads<20);
});
test('normal bounded AI response still succeeds',async t=>{fetchMock(t,async()=>Response.json({choices:[{message:{content:'שלום'}}]}));assert.equal(await liveProviders().chat([{role:'user',text:'test'}]),'שלום');});
test('existing encrypted database refuses a wrong key before allowing new writes',t=>{
 const dir=directory(t);let store=new Store(dir);const key=store.key.toString('base64'),record=store.create('user','users',{name:'preserve'});store.close();
 assert.throws(()=>{const wrong=new Store(dir,randomBytes(32).toString('base64'));wrong.close();},/key|decrypt/i);
 store=new Store(dir,key);try{assert.equal(store.get('user',record.id).name,'preserve');assert.equal(store.list('user').length,1);}finally{store.close();}
});
test('restored database without its encryption key refuses to invent a replacement key',t=>{
 const dir=directory(t);const store=new Store(dir);const key=Buffer.from(store.key),record=store.create('user','users',{name:'keep'});store.close();fs.unlinkSync(path.join(dir,'encryption.key'));
 assert.throws(()=>{const wrong=new Store(dir);wrong.close();},/key/i);assert.equal(fs.existsSync(path.join(dir,'encryption.key')),false);
 const restored=new Store(dir,key.toString('base64'));try{assert.equal(restored.get('user',record.id).name,'keep');}finally{restored.close();}
});
test('failure after delivery receipt cannot strand a draft in sending or allow a duplicate send',async t=>{
 let sends=0;const {store,service}=fixture(t,{supports:()=>true,deliver:async()=>{sends++;return {status:'accepted_by_mail_server',messageId:'test-receipt'};}});const {user,d}=approved(service);
 const put=store.put.bind(store);let failed=false;store.put=(kind,record,...rest)=>{if(kind==='draft'&&record.stage==='archived'&&!failed){failed=true;throw Error('injected archive write failure');}return put(kind,record,...rest);};
 await assert.rejects(service.send(d.id,user,d.revision));assert.equal(failed,true);
 assert.equal(store.get('draft',d.id).stage,'delivery-unknown');assert.equal(store.list('delivery',user)[0].status,'delivery_unknown');assert.equal(store.list('delivery',user)[0].receipt.messageId,'test-receipt');
 await assert.rejects(service.send(d.id,user,store.get('draft',d.id).revision));assert.equal(sends,1);
});
test('normal delivery commits receipt and archived draft together',async t=>{const {store,service}=fixture(t,{supports:()=>true,deliver:async()=>({status:'accepted_by_mail_server',messageId:'ok'})});const {user,d}=approved(service);const receipt=await service.send(d.id,user,d.revision);assert.equal(receipt.status,'accepted_by_mail_server');assert.equal(store.get('draft',d.id).stage,'archived');});
test('failed PDF executable releases capacity for later attempts',async t=>{environment(t,'PYTHON_BIN',path.join(directory(t),'does-not-exist'));for(let i=0;i<4;i++)await assert.rejects(renderPdf('test'),e=>e.status!==503&&/renderer unavailable/.test(e.message));});
test('AI advertised oversized body is cancelled without reading it all',async t=>{let cancelled=false;fetchMock(t,async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':String(2*1024*1024)}}));await assert.rejects(liveProviders().chat([{role:'user',text:'test'}]),/גדולה מדי/);assert.equal(cancelled,true);});
test('failed delivery error persistence stays recoverable without partial terminal records',async t=>{
 let sends=0;const {store,service}=fixture(t,{supports:()=>true,deliver:async()=>{sends++;throw Error('provider timeout');}});const {user,d}=approved(service);const put=store.put.bind(store);
 store.put=(kind,record,...rest)=>{if(kind==='draft'&&record.stage==='delivery-unknown')throw Error('storage unavailable');return put(kind,record,...rest);};
 await assert.rejects(service.send(d.id,user,d.revision));assert.equal(store.list('delivery',user)[0].status,'sending');assert.equal(store.get('draft',d.id).stage,'sending');
 store.put=put;service.recover();assert.equal(store.list('delivery',user)[0].status,'delivery_unknown');assert.equal(store.get('draft',d.id).stage,'delivery-unknown');await assert.rejects(service.send(d.id,user,store.get('draft',d.id).revision));assert.equal(sends,1);
});
