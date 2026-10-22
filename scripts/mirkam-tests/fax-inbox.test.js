import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
import {Store} from '../../src/mirkam/store.js';import {Mirkam} from '../../src/mirkam/service.js';
import {inboundFaxProvider,createFaxInbox} from '../../src/mirkam/fax-inbox.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
const env={MIRKAM_FAX_PROVIDER:'interfax',INTERFAX_USERNAME:'test',INTERFAX_PASSWORD:'PRIVATE'};
const pdf=Buffer.from('%PDF-1.4 test original');
const row=id=>({providerId:String(id),pages:1,receivedAt:'test',sender:'test'});
function fixture(t,provider){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fax-in-')),store=new Store(dir),service=new Mirkam(store);const inbox=createFaxInbox(service,{provider:provider||{configured:()=>true,account:()=> 'account',list:async()=>[row(42)],image:async()=>({content:pdf,mime:'application/pdf'})}});t.after(()=>{inbox.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service,inbox,dir};}
test('provider uses bounded read-only account list and preserves large IDs',async()=>{
 const p=inboundFaxProvider({env,request:async(url,o)=>{assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(url.origin,'https://rest.interfax.net');assert.equal(url.searchParams.get('allUsers'),'false');assert.equal(url.searchParams.get('unreadOnly'),'false');assert.equal(url.searchParams.get('limit'),'10');return new Response('[{"messageId":9223372036854775807,"pages":1}]');}});
 assert.equal((await p.list())[0].providerId,'9223372036854775807');
});
for(const data of [{},[{messageId:'x',pages:1}],[{messageId:1,pages:-1}],[{messageId:1,pages:1},{messageId:2,pages:1}]])test('malformed list or unordered page rejected '+JSON.stringify(data),async()=>{
 const p=inboundFaxProvider({env,request:async()=>Response.json(data)});await assert.rejects(p.list());
});
test('image accepts original PDF and TIFF, refuses HTML and provider redirects',async()=>{
 for(const [raw,mime]of [[pdf,'application/pdf'],[Buffer.from('49492a0008000000','hex'),'image/tiff']]){const p=inboundFaxProvider({env,request:async()=>new Response(raw)});const image=await p.image('42');assert.equal(image.mime,mime);assert.deepEqual(image.content,raw);}
 for(const response of [new Response('<html>sign in</html>'),new Response(null,{status:302,headers:{location:'https://other.test'}})]){const p=inboundFaxProvider({env,request:async()=>response});await assert.rejects(p.image('42'));}
});
test('oversized list and image rejected without leaking provider details',async()=>{
 for(const [method,size]of [['list',65537],['image',20*1024*1024+1]]){const p=inboundFaxProvider({env,request:async()=>new Response(Buffer.alloc(size))});await assert.rejects(p[method]('42'),e=>!e.message.includes('PRIVATE'));}
});
test('import stores original encrypted file, does not guess owner and deduplicates across restarts',async t=>{
 const {store,service,inbox,dir}=fixture(t);await inbox.sync();await inbox.sync();const items=inbox.status().items;assert.equal(items.length,1);assert.equal(items[0].userId,null);assert.equal(items[0].status,'unassigned');assert.equal(items[0].data,undefined);assert.deepEqual(inbox.file(items[0].id).content,pdf);
 const copy=createFaxInbox(service,{provider:{configured:()=>true,account:()=> 'account',list:async()=>[row(42)],image:async()=>{throw Error('already imported');}}});t.after(()=>copy.close());await copy.sync();assert.equal(copy.status().items.length,1);
 store.db.exec('PRAGMA wal_checkpoint(FULL)');assert.equal(fs.readFileSync(path.join(dir,'mirkam.sqlite')).includes(pdf),false);
});
test('audit failure rolls back file and metadata and permits retry',async t=>{
 const {store,inbox}=fixture(t),audit=store.audit.bind(store);store.audit=()=>{throw Error('injected');};await assert.rejects(inbox.sync());assert.equal(store.list('fax-file').length,0);assert.equal(inbox.status().items.length,0);assert.equal(inbox.status().error,'INBOUND_FAX_UNAVAILABLE');store.audit=audit;await inbox.sync();assert.equal(inbox.status().items.length,1);assert.equal(inbox.status().error,null);
});
test('assignment requires existing user and current revision and survives failed reassignment',async t=>{
 const {store,service,inbox}=fixture(t);await inbox.sync();const item=inbox.status().items[0];const u=service.identity.register({name:'test',identity:'123456789',prison:'test',prisonerNumber:'1'},'owner');
 assert.throws(()=>inbox.assign(item.id,'missing',item.revision,'owner'));assert.throws(()=>inbox.assign(item.id,u.user.id,undefined,'owner'));
 const assigned=inbox.assign(item.id,u.user.id,item.revision,'owner');assert.equal(assigned.userId,u.user.id);assert.throws(()=>inbox.assign(item.id,u.user.id,item.revision,'owner'));
 store.audit=()=>{throw Error('injected');};assert.throws(()=>inbox.assign(item.id,u.user.id,assigned.revision,'owner'));assert.deepEqual(inbox.status().items[0],assigned);
});
test('overlapping sync requests share one provider request',async t=>{
 let release,calls=0;const f=fixture(t,{configured:()=>true,account:()=> 'account',list:()=>{calls++;return new Promise(r=>release=r);},image:async()=>({content:pdf,mime:'application/pdf'})});const a=f.inbox.sync(),b=f.inbox.sync();assert.equal(a,b);release([row(42)]);await a;assert.equal(calls,1);
});
test('descending pagination advances only after saving all files and restarts at latest',async t=>{
 const cursors=[];const provider={configured:()=>true,account:()=> 'account',list:async c=>{cursors.push(c);return c?[]:Array.from({length:10},(_,i)=>row(20-i));},image:async()=>({content:pdf,mime:'application/pdf'})};const {inbox}=fixture(t,provider);await inbox.sync();assert.equal(inbox.status().scan.cursor,'11');await inbox.sync();assert.equal(inbox.status().scan.cursor,'');await inbox.sync();assert.deepEqual(cursors,['','11','']);assert.equal(inbox.status().items.length,10);
});
function request(server,url,token,method='GET',body){return new Promise(resolve=>{const req=Readable.from(body?[JSON.stringify(body)]:[]);req.url=url;req.method=method;req.headers={host:'test',authorization:'Bearer '+token};req.socket={remoteAddress:'127.0.0.1'};const res={status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(data=''){let json;try{json=JSON.parse(data);}catch{}resolve({status:this.status,json,data});}};server.emit('request',req,res);});}
test('HTTP blocks support, billing and anonymous access to inbox, originals and assignment',async t=>{
 const {service,inbox}=fixture(t);await inbox.sync();const id=inbox.status().items[0].id;const server=createMirkamServer(service);t.after(()=>server.close());
 for(const role of ['support','billing']){const user=service.staff.create('test',role,'owner'),token=service.staff.login(user.id,user.password).token;for(const [route,method]of [['fax-inbox','GET'],['fax-inbox','POST'],['fax-inbox/'+id+'/file','GET'],['fax-inbox/'+id+'/assign','POST']])assert.equal((await request(server,'/api/admin/'+route,token,method,{})).status,403);}
 assert.equal((await request(server,'/api/admin/fax-inbox','invalid')).status,401);
});
test('owner assigns imported original and only the selected dossier receives its metadata',async t=>{
 const old=process.env.MIRKAM_ADMIN_TOKEN,token='a'.repeat(64);process.env.MIRKAM_ADMIN_TOKEN=token;t.after(()=>{if(old===undefined)delete process.env.MIRKAM_ADMIN_TOKEN;else process.env.MIRKAM_ADMIN_TOKEN=old;});
 const {service,inbox}=fixture(t);await inbox.sync();const item=inbox.status().items[0],server=createMirkamServer(service);t.after(()=>server.close());
 const users=['123456789','987654321'].map(identity=>service.identity.register({name:'test',identity,prison:'test',prisonerNumber:'1'},'owner').user);
 const saved=await request(server,'/api/admin/fax-inbox/'+item.id+'/assign',token,'POST',{userId:users[0].id,revision:item.revision});assert.equal(saved.status,200);
 assert.equal((await request(server,'/api/admin/users/'+users[0].id,token)).json.faxes.length,1);
 assert.equal((await request(server,'/api/admin/users/'+users[1].id,token)).json.faxes.length,0);
 const file=await request(server,'/api/admin/fax-inbox/'+item.id+'/file',token);assert.equal(file.status,200);assert.deepEqual(file.data,pdf);
 const list=await request(server,'/api/admin/fax-inbox',token);assert.ok(!JSON.stringify(list.json).includes(pdf.toString('base64')));
});
test('closing during download prevents writes after shutdown',async t=>{
 let release;const {inbox,store}=fixture(t,{configured:()=>true,account:()=> 'account',list:async()=>[row(42)],image:()=>new Promise(r=>release=r)});
 const work=inbox.sync();await new Promise(r=>setImmediate(r));inbox.close();release({content:pdf,mime:'application/pdf'});await assert.rejects(work);assert.equal(store.list('fax-file').length,0);
});
