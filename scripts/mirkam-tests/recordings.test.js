import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
import {ui,json} from './ui-harness.js';
const master='recording-test-'.repeat(5);process.env.MIRKAM_ADMIN_TOKEN=master;
const bytes=Buffer.alloc(46);bytes.write('RIFF');bytes.writeUInt32LE(38,4);bytes.write('WAVE',8);
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-recordings-')),store=new Store(dir),service=new Mirkam(store),server=createMirkamServer(service);t.after(()=>{server.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});const user=service.identity.register({name:'בדיקה',identity:'123456789',prison:'בדיקה',prisonerNumber:'1'},'owner').user;return {store,service,server,user};}
function request(server,url,token=master){return new Promise(resolve=>{const req=Readable.from([]);req.url=url;req.method='GET';req.headers={host:'test',authorization:'Bearer '+token};req.socket={remoteAddress:'127.0.0.1'};const res={status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(data=''){let body;try{body=JSON.parse(String(data));}catch{}resolve({status:this.status,headers:this.headers,body,bytes:Buffer.from(data)});}};server.emit('request',req,res);});}
const base=u=>'/api/admin/users/'+u.id;
const save=(f,extra={})=>f.service.recordAudio(f.user.id,{providerId:'local',data:bytes.toString('base64'),mime:'audio/wav',kind:'chat',...extra});
test('owner lists metadata and plays exact stored bytes with audit and no cache',async t=>{const f=fixture(t),a=save(f);const list=await request(f.server,base(f.user));assert.equal(list.status,200);assert.equal(list.body.recordings[0].availability,'available');assert.equal(list.body.recordings[0].kind,'chat');for(const key of ['data','providerId','owner','sourceId'])assert.equal(key in list.body.recordings[0],false);const r=await request(f.server,base(f.user)+'/recordings/'+a.id+'/file');assert.equal(r.status,200);assert.deepEqual(r.bytes,bytes);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers['Content-Type'],'audio/wav');});
for(const role of ['anonymous','support','billing','member'])test('recording playback denied for '+role,async t=>{const f=fixture(t),a=save(f);let token='';if(['support','billing'].includes(role)){const s=f.service.staff.create('test',role,'owner');token=f.service.staff.login(s.id,s.password).token;}if(role==='member')token='not-a-staff-session';const r=await request(f.server,base(f.user)+'/recordings/'+a.id+'/file',token);assert.equal(r.status,['anonymous','member'].includes(role)?401:403);if(role==='support'){const dossier=await request(f.server,base(f.user),token);assert.equal(dossier.body.recordings,undefined);}});
test('recording cannot be fetched through another account',async t=>{const f=fixture(t),a=save(f),other=f.service.identity.register({name:'other',identity:'123456788',prison:'test',prisonerNumber:'2'},'owner').user;assert.equal((await request(f.server,base(other)+'/recordings/'+a.id+'/file')).status,404);});
for(const extra of [{status:'deleted'},{status:'deleting'},{deleteAfter:1},{mime:'text/html'},{data:'not-base64'},{providerId:'https://private.example/audio'}])test('unavailable or unsafe recording refuses playback '+JSON.stringify(extra),async t=>{const f=fixture(t);let a=save(f);a=f.store.put('audio',{...a,...extra});assert.equal((await request(f.server,base(f.user)+'/recordings/'+a.id+'/file')).status,410);});
test('held recording remains available after original retention date',async t=>{const f=fixture(t);let a=save(f);f.store.put('audio',{...a,hold:true,deleteAfter:1});assert.equal((await request(f.server,base(f.user)+'/recordings/'+a.id+'/file')).status,200);});
test('deduplicated retention preserves first audio and all caller categories',t=>{const f=fixture(t);for(const kind of ['filling','chat','family-compose','ticket']){const a=save(f,{sourceId:kind,kind}),b=save(f,{sourceId:kind,kind,data:'changed'});assert.equal(a.id,b.id);assert.equal(b.data,bytes.toString('base64'));assert.ok(b.deleteAfter>b.created+100*86400000);}assert.equal(f.store.list('audio',f.user.id).length,4);});
test('revoked owner session cannot fetch audio',async t=>{const f=fixture(t),a=save(f),o=f.service.staff.createOwner('owneruser','owner','owner'),login=f.service.staff.login(o.id,o.password);f.service.staff.logout(login.token);assert.equal((await request(f.server,base(f.user)+'/recordings/'+a.id+'/file',login.token)).status,401);});
const find=(u,label)=>u.all.find(n=>n.tag==='button'&&n.textContent===label);
async function client(binary){const calls=[];const u=ui(async(url,options)=>{calls.push({url,options});if(url==='/api/staff-login')return json({ok:true,token:'s',role:'owner'});if(url==='/api/admin/logout')return json({ok:true});if(url==='/api/admin/users/a')return json({ok:true,user:{id:'a',name:'test',prison:'test'},recordings:[{id:'r',kind:'chat',created:Date.now(),deleteAfter:Date.now()+100000,availability:'available'}]});if(url.endsWith('/file'))return binary();throw Error(url);});await u.submit('staff-login-form');await vm.runInContext("openUser('a','recordings')",u.context);return {u,calls};}
test('owner recording tab loads binary only on click and clears audio on tab change',async()=>{const {u,calls}=await client(()=>new Response(bytes,{headers:{'content-type':'audio/wav'}}));assert.match(u.text('admin-pane'),/שיחה עם ליין/);assert.equal(calls.some(c=>c.url.endsWith('/file')),false);await find(u,'טעינת הקלטה להאזנה').onclick();assert.ok(vm.runInContext('recordingPlayback.url.startsWith("blob:")',u.context));assert.equal(calls.at(-1).options.headers.Authorization,'Bearer s');await find(u,'פרטים').onclick();assert.equal(vm.runInContext('recordingPlayback',u.context),null);});
test('logout while audio body is pending does not create a playable blob',async()=>{let release;const {u}=await client(()=>({ok:true,blob:()=>new Promise(r=>release=r)}));const pending=find(u,'טעינת הקלטה להאזנה').onclick();while(!release)await new Promise(r=>setImmediate(r));vm.runInContext('lockManagement()',u.context);release(new Blob([bytes],{type:'audio/wav'}));await pending;assert.equal(vm.runInContext('recordingPlayback',u.context),null);});
test('corrupt base64 is marked unavailable in the list, not offered as playable',async t=>{
 const f=fixture(t),a=save(f);f.store.put('audio',{...a,data:'%%%bad%%%'});
 const r=await request(f.server,base(f.user));assert.equal(r.body.recordings[0].availability,'unavailable');
});
test('stored recordings remain readable after reopening the encrypted database',async t=>{
 const f=fixture(t),a=save(f);const second=new Store(f.store.dir);t.after(()=>second.close());
 const recovered=second.get('audio',a.id);assert.equal(recovered.owner,f.user.id);assert.equal(recovered.data,bytes.toString('base64'));
});
