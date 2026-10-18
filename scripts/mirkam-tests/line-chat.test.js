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
