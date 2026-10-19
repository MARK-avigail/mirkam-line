import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
const master='m'.repeat(64);process.env.MIRKAM_ADMIN_TOKEN=master;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-access-')),store=new Store(dir),service=new Mirkam(store),server=createMirkamServer(service);t.after(()=>{server.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service,server};}
function request(server,route,method='GET',token='',body={}){return new Promise(resolve=>{const req=Readable.from(method==='GET'?[]:[JSON.stringify(body)]);req.url=route;req.method=method;req.headers={host:'example.test',authorization:'Bearer '+token};req.socket={remoteAddress:'127.0.0.1'};const res={status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);this.headersSent=true;},end(data=''){let body;try{body=JSON.parse(String(data));}catch{}resolve({status:this.status,body,headers:this.headers});}};server.emit('request',req,res);});}

import {ui,json} from './ui-harness.js';
test('line chat saves context separately and rejects stale messages',async t=>{
 const {service,server,store}=fixture(t);let calls=0;
 service.providers.chat=async messages=>{calls++;assert.equal(messages.at(-1).text,'שלום');return 'שלום אביגיל';};
 const base='/api/admin/line-chat';
 let r=await request(server,base,'GET',master);assert.equal(r.body.item.revision,0);
 r=await request(server,base,'POST',master,{text:'שלום',revision:0});assert.equal(r.status,200);assert.equal(r.body.item.messages[1].text,'שלום אביגיל');
 r=await request(server,base,'POST',master,{text:'שלום',revision:0});assert.equal(r.status,409);assert.equal(calls,1);
 assert.equal(store.list('conversation').length,0);
 r=await request(server,base,'GET',master);assert.equal(r.body.item.messages.length,2);
 r=await request(server,base,'DELETE',master);assert.equal(r.status,200);assert.equal(store.list('staff-line-chat').length,0);
});
for(const role of ['anonymous','support','billing'])test('line chat denies '+role,async t=>{
 const {service,server}=fixture(t);let token='';if(role!=='anonymous'){const s=service.staff.create('test',role,'owner');token=service.staff.login(s.id,s.password).token;}
 for(const method of ['GET','POST','DELETE']){const r=await request(server,'/api/admin/line-chat',method,token,{text:'hello',revision:0});assert.equal(r.status,role==='anonymous'?401:403);}
});
test('inflight requests cannot duplicate or erase the chat; failure releases lock',async t=>{
 const {service,server}=fixture(t);let release;service.providers.chat=()=>new Promise(resolve=>{release=resolve;});
 const pending=request(server,'/api/admin/line-chat','POST',master,{text:'hello',revision:0});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 for(const method of ['POST','DELETE'])assert.equal((await request(server,'/api/admin/line-chat',method,master,{text:'hello',revision:0})).status,409);
 release('answer');assert.equal((await pending).status,200);
 service.providers.chat=async()=>{throw Error('offline');};
 assert.notEqual((await request(server,'/api/admin/line-chat','POST',master,{text:'hello',revision:1})).status,200);
 assert.equal((await request(server,'/api/admin/line-chat','DELETE',master)).status,200);
});
test('line screen exposes working assistant entry and chat navigation',async()=>{
 const u=ui(async url=>json(url==='/api/staff-login'?{ok:true,token:'s',role:'owner'}:url==='/api/admin/line'?{ok:true,branches:[]}:{ok:true,item:{messages:[],revision:0}}));
 await u.submit('staff-login-form');await u.click('suite-line');await u.click('menu-toggle');assert.equal(u.ids.get('suite-chats').hidden,false);
 const open=u.all.find(n=>n.textContent==='דברי עם ליין');assert.ok(open);await open.onclick();assert.match(u.text('admin-pane'),/מדברים עם ליין/);assert.ok(u.all.find(n=>n.textContent==='שליחה לליין'));
});

test('invalid input and hourly limit cannot reach the provider',async t=>{
 const {service,server,store}=fixture(t);let calls=0;service.providers.chat=async()=>{calls++;return 'ok';};
 for(const text of ['',{},'x'.repeat(4001)])assert.notEqual((await request(server,'/api/admin/line-chat','POST',master,{text,revision:0})).status,200);
 store.create('staff-line-usage','owner',{id:'owner',count:30,until:Date.now()+60000});
 assert.equal((await request(server,'/api/admin/line-chat','POST',master,{text:'hello',revision:0})).status,429);assert.equal(calls,0);
});
test('expired staff session cannot receive or save an in-flight answer',async t=>{
 const {service,server,store}=fixture(t),owner=service.staff.createOwner('avigail','test','owner'),token=service.staff.login(owner.id,owner.password).token;
 let release;service.providers.chat=()=>new Promise(resolve=>{release=resolve;});
 const pending=request(server,'/api/admin/line-chat','POST',token,{text:'hello',revision:0});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 service.staff.logout(token);release('private answer');const r=await pending;assert.equal(r.status,401);assert.equal(store.list('staff-line-chat').length,0);
});
test('new chats preserve legacy history, resume old chats and supply only own cross-chat context',async t=>{
 const {service,server,store}=fixture(t);store.create('staff-line-chat','owner',{id:'owner',messages:[{role:'user',text:'קוראים לי אביגיל'},{role:'assistant',text:'נעים להכיר'}]});
 store.create('staff-line-chat','other',{messages:[{role:'user',text:'OTHER_PRIVATE'}]});
 const base='/api/admin/line-chat';let r=await request(server,base+'/new','POST',master,{});assert.equal(r.status,200);const next=r.body.item;
 assert.notEqual(next.id,'owner');assert.equal(store.get('staff-line-chat','owner').messages.length,2);
 service.providers.chat=async context=>{assert.match(context[0].text,/אביגיל/);assert.ok(!JSON.stringify(context).includes('OTHER_PRIVATE'));return 'שלום אביגיל';};
 r=await request(server,base,'POST',master,{id:next.id,text:'מה שמי?',revision:next.revision});assert.equal(r.status,200);
 r=await request(server,base,'GET',master);assert.equal(r.body.items.length,2);
 r=await request(server,base+'?id=owner','GET',master);assert.equal(r.body.item.messages[0].text,'קוראים לי אביגיל');
 const other=store.list('staff-line-chat','other')[0];r=await request(server,base+'?id='+other.id,'GET',master);assert.notEqual(r.status,200);
});
test('long history is retained while AI context stays bounded',async t=>{
 const {service,server,store}=fixture(t);const messages=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',text:'message '+i}));const c=store.create('staff-line-chat','owner',{messages});
 service.providers.chat=async context=>{assert.equal(context.length,19);return 'answer';};
 const r=await request(server,'/api/admin/line-chat','POST',master,{id:c.id,text:'next',revision:c.revision});assert.equal(r.status,200);assert.equal(r.body.item.messages.length,26);assert.equal(r.body.item.messages[0].text,'message 0');
});
test('active staff session renews, idle expired session remains rejected',async t=>{
 const {service,store}=fixture(t),owner=service.staff.createOwner('avigail','test','owner'),token=service.staff.login(owner.id,owner.password).token;
 let record=store.list('staff-token')[0];assert.ok(record.expiresAt>Date.now()+3500000);
 record=store.put('staff-token',{...record,expiresAt:Date.now()+20000});service.staff.authenticate(token);
 record=store.get('staff-token',record.id);assert.ok(record.expiresAt>Date.now()+3500000);
 store.put('staff-token',{...record,expiresAt:Date.now()-1});assert.throws(()=>service.staff.authenticate(token));
});
test('opening a new chat in the UI never calls DELETE',async()=>{
 const calls=[];const u=ui(async(url,o)=>{calls.push([url,o.method]);return json(url==='/api/staff-login'?{ok:true,token:'s',role:'owner'}:url==='/api/admin/line'?{ok:true,branches:[]}:{ok:true,item:{id:'new',messages:[],revision:1},items:[{id:'old',name:'השיחה הקודמת'}]});});
 await u.submit('staff-login-form');await u.click('suite-line');await u.all.find(n=>n.textContent==='דברי עם ליין').onclick();await u.all.find(n=>n.textContent==='שיחה חדשה').onclick();
 assert.ok(calls.some(([url,method])=>url==='/api/admin/line-chat/new'&&method==='POST'));assert.ok(!calls.some(([,method])=>method==='DELETE'));assert.match(u.text('admin-pane'),/השיחה הקודמת/);
});
test('role revoked while AI runs cannot publish owner-only answer',async t=>{
 const {service,server,store}=fixture(t),owner=service.staff.createOwner('avigail','test','owner'),token=service.staff.login(owner.id,owner.password).token;
 let release;service.providers.chat=()=>new Promise(resolve=>{release=resolve;});
 const pending=request(server,'/api/admin/line-chat','POST',token,{text:'hello',revision:0});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const s=store.get('staff',owner.id);store.put('staff',{...s,role:'support'});release('owner-only answer');
 assert.equal((await pending).status,403);assert.equal(store.list('staff-line-chat').length,0);
});
test('audit persistence failure cannot commit an unacknowledged chat answer',async t=>{
 const {service,server,store}=fixture(t);service.providers.chat=async()=> 'answer';
 const original=store.audit.bind(store);store.audit=(actor,event,target)=>{if(event==='staff.line-chat')throw Error('disk failure');return original(actor,event,target);};
 const r=await request(server,'/api/admin/line-chat','POST',master,{text:'hello',revision:0});assert.notEqual(r.status,200);assert.equal(store.list('staff-line-chat').length,0);
});
