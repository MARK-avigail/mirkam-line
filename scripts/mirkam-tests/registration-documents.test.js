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

import {documentPackage} from '../../src/mirkam/documents.js';
import {ui,json} from './ui-harness.js';
const enrollment={name:'בדיקה',identity:'123456789',prison:'בדיקה',prisonerNumber:'123'};
for(const value of [undefined,false,'true',1,null])test(`registration rejects unconfirmed eligibility ${value}`,async t=>{
 const {server,store}=fixture(t);const r=await request(server,'/api/admin/users','POST',master,{...enrollment,verificationConfirmed:value});assert.equal(r.status,400);assert.equal(store.list('user').length,0);
});
test('confirmed enrollment creates one account and duplicate does not create another',async t=>{
 const {server,store}=fixture(t);const data={...enrollment,verificationConfirmed:true};const r=await request(server,'/api/admin/users','POST',master,data);assert.equal(r.status,200);assert.match(r.body.pin,/^\d{6}$/);assert.equal((await request(server,'/api/admin/users','POST',master,data)).status,400);assert.equal(store.list('user').length,1);
});
test('template is readable with no customer data and does not create records',async t=>{
 const {server,store}=fixture(t);const r=await request(server,'/api/admin/document-template','GET',master);assert.equal(r.status,200);assert.equal(r.body.documents.length,3);assert.equal(r.body.previewOnly,true);assert.match(r.body.documents[0].text,/הסעד המבוקש/);assert.match(r.body.documents[0].text,/להשלמה/);assert.equal(store.list('draft').length,0);assert.equal(store.list('user').length,0);
});
test('management preview uses the same document renderer as saved telephone answers',async t=>{
 const {server,service,store}=fixture(t);const {user}=service.identity.register(enrollment,'owner');let d=service.createDraft(user.id,false);d=store.put('draft',{...d,answers:{subject:'נושא בדיקה',facts:'עובדות שנמסרו בקו',relief:'בקשה לבדיקה'}});
 const before=store.get('draft',d.id);const r=await request(server,'/api/admin/drafts/'+d.id+'/package','GET',master);
 assert.equal(r.status,200);assert.deepEqual(r.body.documents,documentPackage(d,user));assert.equal(r.body.previewOnly,true);assert.ok(r.body.missing.includes('grounds'));assert.deepEqual(store.get('draft',d.id),before);assert.equal(store.list('delivery').length,0);
});
for(const role of ['anonymous','support','billing'])for(const suffix of ['document-template','drafts/11111111-1111-1111-1111-111111111111/package','drafts/11111111-1111-1111-1111-111111111111/docx?kind=petition'])test(`${role} cannot read management document ${suffix}`,async t=>{
 const {server,service}=fixture(t);let token='';if(role!=='anonymous'){const account=service.staff.create('test',role,'owner');token=service.staff.login(account.id,account.password).token;}const r=await request(server,'/api/admin/'+suffix,'GET',token);assert.equal(r.status,role==='anonymous'?401:403);
});
test('nonexistent document returns 404 without generating a draft',async t=>{
 const {server,store}=fixture(t);assert.equal((await request(server,'/api/admin/drafts/11111111-1111-1111-1111-111111111111/package','GET',master)).status,404);assert.equal(store.list('draft').length,0);
});
async function ownerUI(role='owner'){
 let posts=0;const u=ui(async(url,o)=>{
  if(url==='/api/staff-login')return json({ok:true,token:'session',role});
  if(url==='/api/admin/users/u'&&o.method==='GET')return json({ok:true,user:{id:'u',name:'בדיקה',prison:'בדיקה'},contacts:[],tickets:[]});
  if(o.method==='POST'){posts++;return json({ok:true,result:{pin:'456789'},user:{code:'123456'},pin:'456789'});}
  return json({ok:true,items:[{id:'u',name:'בדיקה',prison:'בדיקה',active:true}]});
 });await u.submit('staff-login-form');await u.click('admin-users');return {u,posts:()=>posts};
}
const findButton=(u,label)=>u.all.find(n=>n.tag==='button'&&n.textContent===label);
test('support does not receive oversight or free membership controls',async()=>{
 const {u}=await ownerUI('support');assert.equal(findButton(u,'הענקת פיקוח טלפוני'),undefined);await findButton(u,'משתמש חדש').onclick();assert.ok(!u.text('admin-pane').includes('הטבת מינוי'));assert.match(u.text('admin-pane'),/בדקתי את זהות/);
});
test('cancelled PIN reset sends no mutation',async()=>{
 const {u,posts}=await ownerUI();await u.all.find(n=>n.className==='user-row').onclick();u.window.confirm=()=>false;await findButton(u,'איפוס PIN').onclick();assert.equal(posts(),0);
});
test('reset credentials are hidden until reveal, never in status, and cleared on navigation',async()=>{
 const {u}=await ownerUI();await u.all.find(n=>n.className==='user-row').onclick();await findButton(u,'איפוס PIN').onclick();assert.ok(!u.text('admin-pane').includes('456789'));assert.ok(!u.ids.get('status').textContent.includes('456789'));
 await findButton(u,'הצגת פרטי הכניסה').onclick();assert.match(u.text('admin-pane'),/456789/);await u.click('suite-home');assert.ok(!u.text('admin-pane').includes('456789'));assert.ok(!u.ids.get('status').textContent.includes('456789'));
});
test('credentials dismissal clears revealed values',async()=>{
 const {u}=await ownerUI();await u.all.find(n=>n.className==='user-row').onclick();await findButton(u,'איפוס PIN').onclick();await findButton(u,'הצגת פרטי הכניסה').onclick();await findButton(u,'סגירת פרטי הכניסה').onclick();assert.ok(!u.text('admin-pane').includes('456789'));
});
test('registration without verification checkbox makes no request',async()=>{
 const {u,posts}=await ownerUI();await findButton(u,'משתמש חדש').onclick();await findButton(u,'שמירה').onclick();assert.equal(posts(),0);assert.match(u.ids.get('status').textContent,/אימות זהות/);
});
test('successful registration removes the form and keeps credentials off the global status',async()=>{
 const {u,posts}=await ownerUI();await findButton(u,'משתמש חדש').onclick();const inputs=u.all.filter(n=>n.tag==='input');for(const n of inputs){n.value='test';if(n.type==='checkbox')n.checked=true;}await findButton(u,'שמירה').onclick();assert.equal(posts(),1);assert.ok(!u.text('admin-pane').includes('456789'));assert.ok(!u.ids.get('status').textContent.includes('123456'));assert.match(u.text('admin-pane'),/הצגת פרטי הכניסה/);
});
for(const isTemplate of [true,false])test(`document screen renders ${isTemplate?'template':'saved petition'} without member authentication`,async()=>{
 const routes=[];const u=ui(async(url,o)=>{routes.push(url);if(url==='/api/staff-login')return json({ok:true,token:'session',role:'owner'});assert.equal(o.headers.Authorization,'Bearer session');if(url==='/api/admin/drafts')return json({ok:true,items:isTemplate?[]:[{id:'d',answers:{subject:'נושא'}}]});return json({ok:true,previewOnly:true,missing:['facts'],documents:[{kind:'petition',title:'עתירה',text:'תוכן העתירה לבדיקה'},{kind:'affidavit',title:'טיוטת תצהיר',text:'לא מאומת'}]});});
 await u.submit('staff-login-form');await u.click('suite-documents');await findButton(u,isTemplate?'הצגת תבנית העתירה והמסמכים הנלווים':'פתיחת העתירה והמסמכים').onclick();
 assert.equal(routes.at(-1),isTemplate?'/api/admin/document-template':'/api/admin/drafts/d/package');assert.match(u.text('admin-pane'),/תוכן העתירה לבדיקה/);assert.match(u.text('admin-pane'),/טיוטת תצהיר/);assert.equal(u.ids.get('login').hidden,true);
});
test('owner can preview an archived account document without activating its account',async t=>{
 const {server,service,store}=fixture(t);const {user}=service.identity.register(enrollment,'owner');const d=service.createDraft(user.id,false);service.identity.suspend(user.id,false,'owner');const r=await request(server,'/api/admin/drafts/'+d.id+'/package','GET',master);assert.equal(r.status,200);assert.equal(store.get('user',user.id).active,false);
});
test('document preview rejects unknown document kind',async t=>{
 const {server,service}=fixture(t);const {user}=service.identity.register(enrollment,'owner');const d=service.createDraft(user.id,false);const r=await request(server,'/api/admin/drafts/'+d.id+'/docx?kind=unknown','GET',master);assert.equal(r.status,404);
});
test('owner can download a DOCX preview through authorized admin route',async t=>{
 const {server,service}=fixture(t);const {user}=service.identity.register(enrollment,'owner');const d=service.createDraft(user.id,false);const r=await request(server,'/api/admin/drafts/'+d.id+'/docx?kind=petition','GET',master);assert.equal(r.status,200);assert.match(r.headers['Content-Type'],/wordprocessingml/);assert.match(r.headers['Content-Disposition'],/preview-petition/);
});
