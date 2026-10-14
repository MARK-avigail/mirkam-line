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
 const window={addEventListener(){},dispatchEvent(){},confirm:()=>true};const document={body:{classList:{add(){},remove(){}}},getElementById:id=>ids.get(id)||null,createElement:tag=>{const n=new Element(tag);all.push(n);return n;},querySelectorAll:()=>all.filter(n=>n.tag==='button')};
 const context=vm.createContext({window,document,navigator:{onLine:true},fetch:fetcher,AbortController,Event,setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout,URL,console});
 vm.runInContext(fs.readFileSync(new URL('../../public/mirkam/app.js',import.meta.url),'utf8'),context);
 return {ids,all,context,window,submit:id=>ids.get(id).onsubmit({preventDefault(){}}),click:id=>ids.get(id).onclick(),text:id=>ids.get(id).children.map(n=>n.textContent).join(' ')};
}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
test('startup shows staff login and hides internal sections',()=>{const u=ui();for(const id of ['suite-sidebar','admin','workspace','login','app-header','app-footer'])assert.equal(u.ids.get(id).hidden,true,id);assert.equal(u.ids.get('staff-gate').hidden,false);assert.equal(u.window.mirkamStaffAuthenticated,false);});
test('successful staff login unlocks management and clears password',async()=>{const u=ui(async()=>json({ok:true,token:'session',role:'owner'}));u.ids.get('staff-password').value='password';await u.submit('staff-login-form');assert.equal(u.ids.get('staff-gate').hidden,true);assert.equal(u.ids.get('suite-sidebar').hidden,false);assert.equal(u.ids.get('admin').hidden,false);assert.equal(u.ids.get('staff-password').value,'');});
test('wrong password cannot reveal management',async()=>{const u=ui(async()=>json({ok:false,error:'פרטי כניסה שגויים'},401));await u.submit('staff-login-form');assert.equal(u.ids.get('admin').hidden,true);assert.equal(u.ids.get('suite-sidebar').hidden,true);assert.match(u.ids.get('status').textContent,/שגויים/);});
test('malformed successful response cannot unlock portal',async()=>{const u=ui(async()=>json({ok:true}));await u.submit('staff-login-form');assert.equal(u.window.mirkamStaffAuthenticated,false);});
for(const id of ['admin-users','admin-status','admin-destinations','admin-contacts','admin-announcement','admin-tickets','suite-home','suite-line','suite-chats','suite-documents','suite-family','suite-management'])test(`locked action ${id} neither fetches nor unlocks`,async()=>{let calls=0;const u=ui(async()=>{calls++;return json({ok:true});});await u.click(id);assert.equal(calls,0);assert.equal(u.ids.get('admin').hidden,true);});
async function owner(fetcher){const u=ui(async(url,o)=>url==='/api/staff-login'?json({ok:true,token:'session',role:'owner'}):fetcher(url,o));await u.submit('staff-login-form');return u;}
test('users list does not render user login code even with legacy backend response',async()=>{const u=await owner(async()=>json({ok:true,items:[{id:'u',name:'בדיקה',prison:'מקום',code:'654321'}]}));await u.click('admin-users');assert.doesNotMatch(u.text('admin-pane'),/654321/);assert.match(u.text('admin-pane'),/בדיקה/);});
test('expired session response locks portal and clears content',async()=>{const u=await owner(async()=>json({ok:false,error:'נדרשת כניסה'},401));u.ids.get('admin-pane').append(new Element('secret'));await u.click('admin-users');assert.equal(u.ids.get('admin').hidden,true);assert.equal(u.ids.get('admin-pane').children.length,0);});
test('logout clears portal even when server request fails',async()=>{const u=await owner(async()=>{throw Error('offline');});await u.click('admin-logout');assert.equal(u.ids.get('staff-gate').hidden,false);assert.equal(u.window.mirkamStaffAuthenticated,false);});
for(const [id,resource] of [['suite-chats','conversations'],['suite-documents','drafts'],['suite-family','messages']])test(`${id} uses authorized admin resource without member credentials`,async()=>{let requested;const u=await owner(async(url,o)=>{requested={url,o};return json({ok:true,items:[]});});await u.click(id);assert.equal(requested.url,'/api/admin/'+resource);assert.equal(requested.o.headers.Authorization,'Bearer session');assert.equal(u.ids.get('login').hidden,true);assert.match(u.text('admin-pane'),/אין פריטים/);});
for(const role of ['support','billing'])test(`${role} does not see owner-only navigation`,async()=>{const u=ui(async()=>json({ok:true,token:'session',role}));await u.submit('staff-login-form');for(const id of ['suite-chats','suite-documents','suite-family','admin-destinations','admin-announcement'])assert.equal(u.ids.get(id).hidden,true,id);});
test('stale response after session locking cannot repopulate user list',async()=>{let resolve;const u=await owner(()=>new Promise(r=>{resolve=r;}));const pending=u.click('admin-users');vm.runInContext('lockManagement()',u.context);resolve(json({ok:true,items:[{name:'PRIVATE',prison:'place'}]}));await pending;assert.doesNotMatch(u.text('admin-pane'),/PRIVATE/);assert.equal(u.ids.get('admin').hidden,true);});
