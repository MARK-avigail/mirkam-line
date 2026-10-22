import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {interfaxProvider,faxNumber} from '../../src/mirkam/fax.js';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
const env={MIRKAM_FAX_PROVIDER:'interfax',INTERFAX_USERNAME:'test-user',INTERFAX_PASSWORD:'test-secret',MIRKAM_FAX_TEST_NUMBER:'+97231234567'};
const requestData={target:{fax:'031234567'},idempotencyKey:'12345678-1234-1234-1234-123456789abc',files:[{content:Buffer.from('%PDF-test'),contentType:'application/pdf'}]};
test('fax disabled without explicit credentials and test destination',()=>{for(const key of Object.keys(env)){const e={...env};delete e[key];assert.equal(interfaxProvider({env:e}).configured(),false);}});
test('national Israeli numbers normalize but ambiguous destinations fail',()=>{assert.equal(faxNumber('031234567'),'+97231234567');for(const n of ['123','+0','031234567,039876543','https://example.test'])assert.throws(()=>faxNumber(n));});
test('one multipart submission preserves documents and returns acceptance only',async()=>{
 let calls=0;const p=interfaxProvider({env,request:async(url,o)=>{calls++;assert.equal(url.origin,'https://rest.interfax.net');assert.equal(url.searchParams.get('faxNumber'),env.MIRKAM_FAX_TEST_NUMBER);assert.equal(url.searchParams.get('retriesToPerform'),'0');assert.equal(url.searchParams.get('reference'),requestData.idempotencyKey);assert.equal(o.redirect,'error');assert.match(o.headers['Content-Type'],/^multipart\/mixed/);assert.ok(o.body.includes(Buffer.from('%PDF-test')));return new Response(null,{status:201,headers:{location:'/outbound/faxes/9223372036854775807'}});}});
 const r=await p.send(requestData);assert.equal(calls,1);assert.equal(r.status,'accepted_by_fax_provider');assert.equal(r.delivered,false);assert.equal(r.providerId,'9223372036854775807');
});
test('fax cannot send to a number outside pilot allowlist',async()=>{let calls=0;const p=interfaxProvider({env,request:async()=>{calls++;}});await assert.rejects(p.send({...requestData,target:{fax:'+97239999999'}}),/מספר הניסיון/);assert.equal(calls,0);});
test('ambiguous POST failure is not retried and does not leak credentials',async()=>{let calls=0;const p=interfaxProvider({env,request:async()=>{calls++;throw Error('test-secret');}});await assert.rejects(p.send(requestData),e=>!e.message.includes('test-secret'));assert.equal(calls,1);});
for(const location of ['https://evil.test/outbound/faxes/12','/outbound/faxes/12?key=x','/outbound/faxes/not-id'])test('untrusted receipt cannot become accepted: '+location,async()=>{const p=interfaxProvider({env,request:async()=>new Response(null,{status:201,headers:{location}})});await assert.rejects(p.send(requestData));});
for(const [code,status] of [[-1,'accepted_by_fax_provider'],[0,'fax_delivered'],[42,'fax_failed']])test('fax status '+code+' is mapped independently of submission',async()=>{const p=interfaxProvider({env,request:async()=>new Response('{"id":9223372036854775807,"status":'+code+',"pagesSent":2}')});const r=await p.status('9223372036854775807');assert.equal(r.status,status);assert.equal(r.delivered,code===0);});
test('status for wrong receipt and malformed provider data rejected',async()=>{for(const data of [{id:43,status:0},{id:42,status:'0'}]){const p=interfaxProvider({env,request:async()=>Response.json(data)});await assert.rejects(p.status('42'));}});
test('oversized status responses rejected',async()=>{const p=interfaxProvider({env,request:async()=>new Response('x'.repeat(65537))});await assert.rejects(p.status('42'));});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fax-service-'));const store=new Store(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});const service=new Mirkam(store);const d=store.create('delivery','owner-a',{channel:'fax',status:'accepted_by_fax_provider',receipt:{provider:'interfax',providerId:'42'}});return {store,service,d};}
test('status refresh enforces ownership and preserves accepted receipt on failure',async t=>{const {service,store,d}=fixture(t);let calls=0;service.providers.faxStatus=async()=>{calls++;throw Error('offline');};await assert.rejects(service.refreshFax(d.id,'owner-b'));assert.equal(calls,0);await assert.rejects(service.refreshFax(d.id,'owner-a'));assert.equal(store.get('delivery',d.id).status,'accepted_by_fax_provider');});
test('revoked access after status request prevents update',async t=>{const {service,store,d}=fixture(t);service.providers.faxStatus=async()=>({providerId:'42',status:'fax_delivered'});await assert.rejects(service.refreshFax(d.id,'owner-a',()=>{throw Error('revoked');}));assert.equal(store.get('delivery',d.id).status,'accepted_by_fax_provider');});
test('final delivery is saved and repeat check does not send or query again',async t=>{const {service,d}=fixture(t);let calls=0;service.providers.faxStatus=async()=>{calls++;return {providerId:'42',status:'fax_delivered',delivered:true};};assert.equal((await service.refreshFax(d.id,'owner-a')).status,'fax_delivered');await service.refreshFax(d.id,'owner-a');assert.equal(calls,1);});

test('paid subscription sends to approved destinations without a test number',async()=>{
 const paid={...env,MIRKAM_FAX_MODE:'live'};delete paid.MIRKAM_FAX_TEST_NUMBER;
 let calls=0;const p=interfaxProvider({env:paid,request:async(url)=>{calls++;assert.equal(url.searchParams.get('faxNumber'),'+97239999999');return new Response(null,{status:201,headers:{location:'/outbound/faxes/42'}});}});
 assert.equal(p.configured(),true);
 assert.equal((await p.send({...requestData,target:{fax:'039999999'}})).status,'accepted_by_fax_provider');assert.equal(calls,1);
});
test('explicit live mode overrides an old pilot number',()=>{
 const p=interfaxProvider({env:{...env,MIRKAM_FAX_MODE:'live'}});
 assert.equal(p.validate({fax:'039999999'}),'+97239999999');
});
test('invalid delivery mode fails closed even with old pilot settings',()=>{
 assert.equal(interfaxProvider({env:{...env,MIRKAM_FAX_MODE:'liv'}}).configured(),false);
});
test('receipt lookup remains available when pilot destination configuration is absent',async()=>{
 const e={...env};delete e.MIRKAM_FAX_TEST_NUMBER;
 const p=interfaxProvider({env:e,request:async()=>Response.json({id:42,status:0})});
 assert.equal((await p.status('42')).status,'fax_delivered');
 assert.equal(p.configured(),false);
});
