import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../../public/mirkam/sw.js',import.meta.url),'utf8');
function fixture(){
 const events={},stores=new Map();let network;
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const m=stores.get(name);return {async put(k,v){m.set(k,v.clone());},async match(k){return m.get(k)?.clone();}};},async keys(){return [...stores.keys()];},async delete(k){return stores.delete(k);}};
 const asset=req=>{const p=new URL(req.url).pathname;return new Response(p==='/'?'<main id="suite-home">public shell</main>':'asset',{headers:{'content-type':p==='/'?'text/html':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'application/manifest+json'}});};
 network=asset;
 vm.runInNewContext(code,{URL,Request,Response,AbortSignal,caches,fetch:(...args)=>network(...args),self:{location:{origin:'https://example.test'},addEventListener:(n,f)=>events[n]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 return {stores,setNetwork:f=>network=f,async install(){let p;events.install({waitUntil:x=>p=x});await p;},async activate(){let p;events.activate({waitUntil:x=>p=x});await p;},get(path='/',method='GET',mode='navigate'){let p;events.fetch({request:{url:new URL(path,'https://example.test').href,method,mode},respondWith:x=>p=x});return p;},async status(){let p,result;events.message({data:{type:'OFFLINE_STATUS'},ports:[{postMessage:x=>result=x}],waitUntil:x=>p=x});await p;return result.ready;}};
}
test('complete public shell is required before offline readiness',async()=>{const f=fixture();assert.equal(await f.status(),false);await f.install();assert.equal(await f.status(),true);assert.equal(f.stores.get('mirkam-shell-v3').size,8);});
test('offline navigation opens cached application',async()=>{const f=fixture();await f.install();f.setNetwork(()=>{throw Error('offline');});assert.match(await (await f.get()).text(),/public shell/);});
for(const status of [401,403,500,503])test(`server ${status} opens cached application`,async()=>{const f=fixture();await f.install();f.setNetwork(()=>new Response('unavailable',{status}));assert.match(await (await f.get()).text(),/public shell/);});
test('login HTML is never substituted for cached application',async()=>{const f=fixture();await f.install();f.setNetwork(()=>new Response('GitHub login',{headers:{'content-type':'text/html'}}));assert.match(await (await f.get()).text(),/public shell/);});
test('failed installation does not cache authentication pages',async()=>{const f=fixture();f.setNetwork(()=>new Response('login',{headers:{'content-type':'text/html'}}));await assert.rejects(f.install());assert.equal(f.stores.size,0);});
for(const path of ['/api/chats','/api/documents','/health','https://other.test/'])test(`does not intercept ${path}`,()=>assert.equal(fixture().get(path),undefined));
test('does not intercept POST',()=>assert.equal(fixture().get('/','POST'),undefined));
test('activation deletes only outdated application caches',async()=>{const f=fixture();f.stores.set('mirkam-shell-v1',new Map());f.stores.set('unrelated',new Map());await f.install();await f.activate();assert.equal(f.stores.has('mirkam-shell-v1'),false);assert.equal(f.stores.has('unrelated'),true);assert.equal(await f.status(),true);});
test('first offline visit reports setup requirement without claiming readiness',async()=>{const f=fixture();f.setNetwork(()=>{throw Error('offline');});assert.equal((await f.get()).status,503);assert.equal(await f.status(),false);});
test('versioned icon requests work offline',async()=>{const f=fixture();await f.install();f.setNetwork(()=>{throw Error('offline');});assert.equal((await f.get('/icon-192.png?v=new','GET','cors')).status,200);});
