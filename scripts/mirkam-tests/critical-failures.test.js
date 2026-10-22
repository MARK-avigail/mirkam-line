import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'critical-audit-'));const store=new Store(dir),service=new Mirkam(store);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service};}
test('voice background persistence failure does not terminate the Node process',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'critical-child-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const script=`
 import {Store} from './src/mirkam/store.js';import {Mirkam} from './src/mirkam/service.js';import {createVoice} from './src/mirkam/voice.js';import {Readable} from 'node:stream';import {createHmac} from 'node:crypto';
 const store=new Store(${JSON.stringify(dir)}),service=new Mirkam(store,{supports:()=>true,familyMail:async()=>({status:'accepted_by_mail_server'})});
 const u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner'),login=service.identity.login(u.user.code,u.pin),contact=service.approveContact(u.user.id,{name:'test',email:'x@example.test'},'owner');
 let m=service.compose(u.user.id,contact.id,'test');const call='CA'+'a'.repeat(32);store.create('call','voice',{id:call,phase:'family-review',silence:0,token:login.token,messageId:m.id,messagePresented:m.id,inputNonce:'n'});
 const put=store.put.bind(store);store.put=(kind,record,...rest)=>{if(kind==='voice-job'&&record.status!=='processing')throw Error('injected storage failure');return put(kind,record,...rest);};
 process.env.BASE_URL='https://example.test';process.env.TWILIO_AUTH_TOKEN='test';const body={CallSid:call,Digits:'1'},route='/voice/step?input=n',signature=createHmac('sha1','test').update(process.env.BASE_URL+route+Object.keys(body).sort().map(k=>k+body[k]).join('')).digest('base64');const req=Readable.from([new URLSearchParams(body).toString()]);req.url=route;req.headers={'x-twilio-signature':signature};await createVoice(service)(req,{writeHead(){},end(){}});
 await new Promise(r=>setTimeout(r,30));(await import('node:fs')).writeFileSync(${JSON.stringify(path.join(dir,'survived'))},'yes');store.close();`;
 const r=spawnSync(process.execPath,['--unhandled-rejections=strict','--input-type=module','-e',script],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(path.join(dir,'survived'),'utf8'),'yes');
});
test('PIN reset storage failure rolls back PIN and session changes together',t=>{const {store,service}=fixture(t);const u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner'),login=service.identity.login(u.user.code,u.pin);const before=store.get('user',u.user.id);const remove=store.remove.bind(store);store.remove=(kind,id)=>{if(kind==='token')throw Error('injected token deletion failure');return remove(kind,id);};assert.throws(()=>service.identity.reset(u.user.id,'owner'));assert.deepEqual(store.get('user',u.user.id),before);assert.equal(service.identity.authenticate(login.token).user.id,u.user.id);assert.ok(service.identity.login(u.user.code,u.pin).token);});
test('registration audit failure does not strand an account without delivered credentials',t=>{const {store,service}=fixture(t);store.audit=()=>{throw Error('injected audit failure');};assert.throws(()=>service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner'));assert.equal(store.list('user').length,0);});
test('failed suspension audit rolls back account and revoked sessions',t=>{const {store,service}=fixture(t);const u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner'),login=service.identity.login(u.user.code,u.pin);store.audit=()=>{throw Error('audit unavailable');};assert.throws(()=>service.identity.suspend(u.user.id,false,'owner'));assert.equal(store.get('user',u.user.id).active,true);assert.equal(service.identity.authenticate(login.token).user.id,u.user.id);});
test('successful reset commits new PIN, audit and session revocation',t=>{const {store,service}=fixture(t);const u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner'),login=service.identity.login(u.user.code,u.pin);const changed=service.identity.reset(u.user.id,'owner');assert.throws(()=>service.identity.authenticate(login.token));assert.throws(()=>service.identity.login(u.user.code,u.pin));assert.ok(service.identity.login(u.user.code,changed.pin).token);assert.equal(store.list('audit').filter(x=>x.event==='user.pin-reset').length,1);});

test('failed contact approval audit never leaves an approved recipient behind',t=>{
 const {store,service}=fixture(t),u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner');
 const audit=store.audit.bind(store);store.audit=()=>{throw Error('audit unavailable');};
 assert.throws(()=>service.approveContact(u.user.id,{name:'family',email:'family@example.test'},'owner'));
 assert.equal(service.contacts(u.user.id).length,0);
 store.audit=audit;assert.ok(service.approveContact(u.user.id,{name:'family',email:'family@example.test'},'owner').id);
});
test('failed incoming reply audit rolls back message and retry records it once',t=>{
 const {store,service}=fixture(t),u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner');
 const contact=service.approveContact(u.user.id,{name:'family',email:'family@example.test'},'owner');
 const message=service.compose(u.user.id,contact.id,'hello'),audit=store.audit.bind(store);
 store.audit=()=>{throw Error('audit unavailable');};
 assert.throws(()=>service.receiveReply(message.id,contact.email,'reply','event-1','owner'));
 assert.equal(store.list('message',u.user.id).filter(m=>m.direction==='incoming').length,0);
 store.audit=audit;
 const reply=service.receiveReply(message.id,contact.email,'reply','event-1','owner');
 assert.equal(service.receiveReply(message.id,contact.email,'reply','event-1','owner').id,reply.id);
 assert.equal(store.list('audit').filter(a=>a.event==='message.received').length,1);
});
test('outer rollback includes a successful nested transaction',t=>{
 const {store}=fixture(t);
 assert.throws(()=>store.atomic(()=>{store.atomic(()=>store.create('probe','test',{id:'nested'}));throw Error('outer failed');}));
 assert.equal(store.get('probe','nested'),null);
 store.atomic(()=>store.create('probe','test',{id:'next'}));assert.ok(store.get('probe','next'));
});
test('caught nested rollback preserves outer work without leaking inner changes',t=>{
 const {store}=fixture(t);
 store.atomic(()=>{store.create('probe','test',{id:'outer'});assert.throws(()=>store.atomic(()=>{store.create('probe','test',{id:'inner'});throw Error('inner failed');}));store.create('probe','test',{id:'after'});});
 assert.equal(store.get('probe','inner'),null);assert.ok(store.get('probe','outer'));assert.ok(store.get('probe','after'));
});
