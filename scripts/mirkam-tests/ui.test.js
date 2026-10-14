import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.attrs={};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 scrollIntoView(){this.revealed=true;}
}
function ui(fetcher=async()=>new Response('{"ok":true}',{headers:{'content-type':'application/json'}})){
 const ids=new Map(),all=[];const html=fs.readFileSync(new URL('../../public/mirkam/index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/id="([^"]+)"/g)){const n=new Element('element');ids.set(match[1],n);all.push(n);}
 const window={addEventListener(){},confirm:()=>true};const document={getElementById:id=>ids.get(id)||null,createElement:tag=>{const n=new Element(tag);all.push(n);return n;},querySelectorAll:()=>all.filter(n=>n.tag==='button')};
 const context=vm.createContext({window,document,navigator:{onLine:true},fetch:fetcher,AbortController,setTimeout,clearTimeout,URL,console});
 vm.runInContext(fs.readFileSync(new URL('../../public/mirkam/app.js',import.meta.url),'utf8'),context);
 return {ids,all,context,window,submit:id=>ids.get(id).onsubmit({preventDefault(){}}),click:id=>ids.get(id).onclick(),text:id=>ids.get(id).children.map(n=>n.textContent).join(' ')};
}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
test('full application initializes and every named action is bound',()=>{const u=ui();assert.equal(u.window.mirkamAppReady,true);for(const id of ['suite-home','suite-line','suite-chats','suite-documents','suite-family','suite-management','home','logout','admin-users','admin-status','admin-destinations','admin-contacts','admin-announcement','admin-tickets','admin-logout'])assert.equal(typeof u.ids.get(id).onclick,'function',id);for(const id of ['owner-setup-form','staff-login-form','login-form'])assert.equal(typeof u.ids.get(id).onsubmit,'function',id);});
test('owner setup fields exist before any click',()=>{const u=ui();assert.ok(u.ids.has('owner-username'));assert.ok(u.ids.has('owner-name'));assert.ok(u.ids.has('owner-result'));});
test('owner setup without secret exposes a visible error and sends nothing',async()=>{let calls=0;const u=ui(async()=>{calls++;});await u.submit('owner-setup-form');assert.equal(calls,0);assert.match(u.ids.get('status').textContent,/קוד הניהול/);assert.equal(u.ids.get('status').revealed,true);});
test('owner creation sends credentials to API and displays result in same form',async()=>{let request;const u=ui(async(url,options)=>{request={url,options};return json({ok:true,result:{id:'Avigail',password:'TEST-ONLY',mfaSecret:'TEST-ONLY'}});});u.ids.get('admin-token').value=' test-secret ';u.ids.get('owner-username').value='Avigail';u.ids.get('owner-name').value='אביגיל';await u.submit('owner-setup-form');assert.equal(request.url,'/api/admin/owner-profile');assert.equal(request.options.headers.Authorization,'Bearer test-secret');assert.match(u.text('owner-result'),/החשבון נוצר/);assert.equal(u.ids.get('owner-result').revealed,true);assert.equal(u.ids.get('admin-token').value,'');});
test('failed owner request preserves entered values and surfaces backend error',async()=>{const u=ui(async()=>json({ok:false,error:'קוד ניהול שגוי'},401));u.ids.get('admin-token').value='wrong';u.ids.get('owner-username').value='Avigail';u.ids.get('owner-name').value='אביגיל';await u.submit('owner-setup-form');assert.match(u.ids.get('status').textContent,/קוד ניהול שגוי/);assert.equal(u.ids.get('owner-name').value,'אביגיל');assert.equal(u.ids.get('status').revealed,true);});
test('switching from management to unauthenticated chats hides management and reveals login',async()=>{const u=ui();u.click('suite-management');await u.click('suite-chats');assert.equal(u.ids.get('admin').hidden,true);assert.equal(u.ids.get('login').hidden,false);assert.equal(u.ids.get('login').revealed,true);});
test('admin forms open visibly and use non-submit action buttons',()=>{const u=ui();for(const id of ['admin-destinations','admin-contacts','admin-announcement']){u.click(id);assert.equal(u.ids.get('admin-pane').revealed,true);const b=u.ids.get('admin-pane').children.at(-1);assert.equal(b.type,'button');}});
test('empty users and tickets return explanatory results',async()=>{const u=ui(async()=>json({ok:true,items:[]}));await u.click('admin-users');assert.match(u.text('admin-pane'),/עדיין אין משתמשים/);await u.click('admin-tickets');assert.match(u.text('admin-pane'),/אין פניות/);});
test('saving announcement displays completion feedback',async()=>{let sent=false;const u=ui(async()=>{sent=true;return json({ok:true});});u.click('admin-announcement');await u.ids.get('admin-pane').children.at(-1).onclick();assert.equal(sent,true);assert.match(u.ids.get('status').textContent,/נשמרו/);});
test('saved conversations open and sending uses selected conversation API',async()=>{const urls=[];const u=ui(async(url)=>{urls.push(url);return json(url==='/api/conversations'?{ok:true,items:[{id:'c1',name:'בדיקה',messages:[],revision:1}]}:{ok:true,item:{id:'c1',name:'בדיקה',messages:[{role:'assistant',text:'תשובת בדיקה'}],revision:2}});});vm.runInContext("token='test';",u.context);await u.click('suite-chats');await u.ids.get('pane').children.at(-1).onclick();const send=u.ids.get('pane').children.find(n=>n.textContent==='שליחה לעוזר');await send.onclick();assert.ok(urls.includes('/api/conversations/c1/chat'));assert.match(u.text('pane'),/תשובת בדיקה/);});
test('empty document list is visible rather than inert',async()=>{const u=ui(async()=>json({ok:true,items:[]}));vm.runInContext("token='test';",u.context);await u.click('suite-documents');assert.match(u.text('pane'),/אין פריטים שמורים/);});
test('missing AI configuration surfaces server error and preserves conversation',async()=>{const u=ui(async()=>json({ok:false,error:'שירות העוזר טרם הוגדר.'},400));vm.runInContext("conversation={id:'c1',name:'בדיקה',messages:[],revision:1};renderConversation();",u.context);await u.ids.get('pane').children.find(n=>n.textContent==='שליחה לעוזר').onclick();assert.match(u.ids.get('status').textContent,/טרם הוגדר/);assert.match(u.text('pane'),/בדיקה/);});
test('family list requests authenticated message resource',async()=>{let route;const u=ui(async(url)=>{route=url;return json({ok:true,items:[]});});vm.runInContext("token='test';",u.context);await u.click('suite-family');assert.equal(route,'/api/messages');assert.match(u.text('pane'),/אין פריטים/);});
