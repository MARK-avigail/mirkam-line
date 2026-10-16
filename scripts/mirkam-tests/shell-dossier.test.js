import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
const master='c'.repeat(64);process.env.MIRKAM_ADMIN_TOKEN=master;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-access-')),store=new Store(dir),service=new Mirkam(store),server=createMirkamServer(service);t.after(()=>{server.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service,server};}
function request(server,route,method='GET',token='',body={}){return new Promise(resolve=>{const req=Readable.from(method==='GET'?[]:[JSON.stringify(body)]);req.url=route;req.method=method;req.headers={host:'example.test',authorization:'Bearer '+token};req.socket={remoteAddress:'127.0.0.1'};const res={status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);this.headersSent=true;},end(data=''){let body;try{body=JSON.parse(String(data));}catch{}resolve({status:this.status,body,headers:this.headers});}};server.emit('request',req,res);});}

import {ui,json} from './ui-harness.js';
function enrolled(service,identity){return service.identity.register({name:'בדיקה '+identity,identity,prison:'מקום',prisonerNumber:identity},'owner').user;}
for(const role of ['owner','support','billing','anonymous'])test(`user dossier scopes data and permissions for ${role}`,async t=>{
 const {server,service,store}=fixture(t);const a=enrolled(service,'123456789'),b=enrolled(service,'123456788');
 for(const kind of ['contact','ticket','draft','message','conversation','delivery']){store.create(kind,a.id,{name:'A',text:'A'});store.create(kind,b.id,{name:'B',text:'B'});}
 let token=role==='owner'?master:'';if(['support','billing'].includes(role)){const staff=service.staff.create('test',role,'owner');token=service.staff.login(staff.id,staff.password).token;}
 const r=await request(server,'/api/admin/users/'+a.id,'GET',token);
 if(['billing','anonymous'].includes(role)){assert.equal(r.status,role==='anonymous'?401:403);assert.equal(r.body.user,undefined);return;}
 assert.equal(r.status,200);assert.equal(r.body.user.id,a.id);for(const key of ['code','pin','pinSalt','pinHash'])assert.equal(r.body.user[key],undefined);
 for(const key of ['contacts','tickets']){assert.equal(r.body[key].length,1);assert.equal(r.body[key][0].owner,a.id);}
 for(const key of ['drafts','messages','conversations','deliveries']){if(role==='support')assert.equal(r.body[key],undefined);else{assert.equal(r.body[key].length,1);assert.equal(r.body[key][0].owner,a.id);}}
});
for(const role of ['owner','support','billing','anonymous'])test(`contact approval uses selected account path for ${role}`,async t=>{
 const {server,service,store}=fixture(t);const a=enrolled(service,'123456789'),b=enrolled(service,'123456788');let token=role==='owner'?master:'';
 if(['support','billing'].includes(role)){const staff=service.staff.create('test',role,'owner');token=service.staff.login(staff.id,staff.password).token;}
 const r=await request(server,'/api/admin/users/'+a.id+'/contacts','POST',token,{name:'contact',email:'contact@example.test',userId:b.id});
 assert.equal(r.status,role==='anonymous'?401:role==='billing'?403:200);assert.equal(store.list('contact',b.id).length,0);assert.equal(store.list('contact',a.id).length,['owner','support'].includes(role)?1:0);
});
test('unknown account dossier returns 404',async t=>{const {server}=fixture(t);assert.equal((await request(server,'/api/admin/users/11111111-1111-1111-1111-111111111111','GET',master)).status,404);});
const users=[{id:'a',name:'אלף',identity:'123456789',prisonerNumber:'101',prison:'מקום א',active:true},{id:'b',name:'בית',identity:'123456788',prisonerNumber:'202',prison:'מקום ב',active:true}];
async function client(){const calls=[];const u=ui(async(url,o)=>{calls.push({url,o});if(url==='/api/staff-login')return json({ok:true,token:'session',role:'owner'});if(url==='/api/admin/logout')return json({ok:true});if(url==='/api/admin/users')return json({ok:true,items:users});if(url.endsWith('/contacts'))return json({ok:true,item:{}});if(url==='/api/admin/users/a')return json({ok:true,user:users[0],drafts:[],messages:[],conversations:[],contacts:[],tickets:[]});if(url==='/api/admin/line')return json({ok:true,branches:[]});throw Error('Unexpected '+url);});await u.submit('staff-login-form');return {u,calls};}
const find=(u,text)=>u.all.find(n=>n.tag==='button'&&n.textContent===text);
test('two module choices lead to their own workspace and keep drawer closed',async()=>{const {u}=await client();const choices=u.ids.get('admin-pane').children.find(n=>n.className==='module-picker');assert.equal(choices.children.length,2);await choices.children[0].onclick();assert.equal(u.ids.get('shell-title').textContent,'מערכת הקו');assert.equal(u.ids.get('suite-sidebar').hidden,true);await u.click('shell-home');const again=u.ids.get('admin-pane').children.find(n=>n.className==='module-picker');await again.children[1].onclick();assert.equal(u.ids.get('shell-title').textContent,'ניהול המערכת');assert.match(u.text('admin-pane'),/חיפוש/);});
test('drawer has accessible open and close state',async()=>{const {u}=await client();await u.click('admin-users');u.click('menu-toggle');assert.equal(u.ids.get('suite-sidebar').hidden,false);assert.equal(u.ids.get('menu-toggle').attrs['aria-expanded'],'true');u.click('menu-close');assert.equal(u.ids.get('suite-sidebar').hidden,true);assert.equal(u.ids.get('menu-toggle').attrs['aria-expanded'],'false');});
for(const query of ['אלף','101','123456789','מקום א'])test(`search filters selected user by ${query}`,async()=>{const {u}=await client();await u.click('admin-users');const search=u.all.find(n=>n.type==='search');search.value=query;search.oninput();const result=u.all.find(n=>n.className==='user-results');assert.equal(result.children.length,1);assert.equal(result.children[0].children[0].textContent,'אלף');});
test('opening user hides other accounts and contact form cannot ask for account ID',async()=>{const {u,calls}=await client();await u.click('admin-users');await u.all.find(n=>n.className==='user-row').onclick();assert.ok(!u.text('admin-pane').includes('מקום ב'));await find(u,'אנשי קשר').onclick();await find(u,'הוספת איש קשר ואישורו').onclick();assert.ok(!u.text('admin-pane').includes('מזהה החשבון'));const email=u.all.find(n=>n.type==='email');assert.equal(email.dir,'ltr');email.value='test@example.test';await find(u,'שמירה').onclick();assert.equal(calls.find(c=>c.o.method==='POST'&&c.url.includes('/contacts')).url,'/api/admin/users/a/contacts');});

test('logout clears landing layout so subsequent login errors are visible',async()=>{const {u}=await client();assert.equal(u.context.document.body.classList.contains('module-home'),true);await u.click('admin-logout');assert.equal(u.context.document.body.classList.contains('module-home'),false);assert.equal(u.ids.get('staff-gate').hidden,false);});
