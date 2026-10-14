import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {validateRequest}=require('../../apps/native/desktop/network.cjs');
const valid={endpoint:'https://service.example',route:'/api/home'};
test('native request addresses only configured HTTPS API',()=>assert.equal(validateRequest(valid).url,'https://service.example/api/home'));
for(const endpoint of ['http://example.test','https://user:password@example.test','https://example.test/path','https://example.test/?token=x'])test(`rejects invalid endpoint ${endpoint}`,()=>assert.throws(()=>validateRequest({...valid,endpoint})));
for(const route of ['/','/icon-192.png','//other.test/api/home','/api/../private','/api/home#fragment'])test(`rejects non-API route ${route}`,()=>assert.throws(()=>validateRequest({...valid,route})));
test('rejects renderer-provided cookies and forged Origin',()=>{for(const key of ['Cookie','Origin','Host'])assert.throws(()=>validateRequest({...valid,headers:{[key]:'value'}}));});
test('rejects header injection and invalid methods',()=>{assert.throws(()=>validateRequest({...valid,headers:{Authorization:'Bearer x\r\nx'}}));assert.throws(()=>validateRequest({...valid,method:'CONNECT'}));});
test('preserves bearer authentication and staff OTP',()=>{const headers={Authorization:'Bearer test','X-Mirkam-OTP':'123456'};assert.deepEqual(validateRequest({...valid,headers}).headers,headers);});
function client(server,platform){const stored=new Map(server?[['mirkam.server.origin',server]]:[]);let request;
 const window={fetch:async()=>new Response('asset'),mirkamNative:{platform,async request(data){request=data;return {status:200,headers:{'content-type':'application/json'},base64:Buffer.from('{"ok":true}').toString('base64')};}}};
 vm.runInNewContext(fs.readFileSync(new URL('../../public/mirkam/connection.js',import.meta.url),'utf8'),{window,localStorage:{getItem:k=>stored.get(k)},document:{addEventListener(){}},URL,Response,Uint8Array,atob,DOMException});return {window,get request(){return request;}};
}
test('missing server shows setup error rather than navigating away',async()=>{const c=client();await assert.rejects(c.window.fetch('/api/home'),/כתובת שרת/);assert.equal(c.request,undefined);});
test('native bridge returns JSON and authenticates to shared server',async()=>{const c=client('https://service.example');const r=await c.window.fetch('/api/home',{headers:{Authorization:'Bearer test'}});assert.equal((await r.json()).ok,true);assert.equal(c.request.endpoint,'https://service.example');assert.equal(c.request.headers.Authorization,'Bearer test');});
test('local UI assets never require native server bridge',async()=>{const c=client();assert.equal(await (await c.window.fetch('./style.css')).text(),'asset');assert.equal(c.request,undefined);});
test('packaged home uses local assets and does not load a remote website',()=>{const html=fs.readFileSync(new URL('../../apps/native/www/index.html',import.meta.url),'utf8');assert.match(html,/src="\.\/brand-logo.png/);assert.match(html,/src="\.\/connection.js/);assert.doesNotMatch(html,/(?:src|href)="https?:/);assert.doesNotMatch(html,/rel="manifest"/);});

function settingsClient(reply){
 const elements=[],stored=new Map();let ready,calls=0,events=0;
 const node=tag=>{const n={tag,children:[],append(...items){this.children.push(...items);},prepend(){},setAttribute(){}};elements.push(n);return n;};
 const window={fetch:async()=>{},dispatchEvent(){events++;},mirkamNative:{async request(){calls++;return typeof reply==='function'?reply():reply;}}};
 vm.runInNewContext(fs.readFileSync(new URL('../../public/mirkam/connection.js',import.meta.url),'utf8'),{window,localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},document:{addEventListener(_,fn){ready=fn;},createElement:node,querySelector:()=>node('main')},URL,Response,Uint8Array,atob,DOMException,TextDecoder,Event,setTimeout,clearTimeout});ready();
 return {field:elements.find(n=>n.tag==='input'),save:elements.find(n=>n.tag==='button'),notice:elements.find(n=>n.tag==='p'),submit:()=>elements.find(n=>n.tag==='form').onsubmit({preventDefault(){}}),stored,get calls(){return calls;},get events(){return events;}};
}
const healthReply=(status,body)=>({status,base64:Buffer.from(body).toString('base64')});
test('empty server field explains missing address without request',async()=>{const c=settingsClient();c.field.value='';await c.submit();assert.equal(c.calls,0);assert.match(c.notice.textContent,/חסרה כתובת/);assert.equal(c.save.disabled,false);});
test('successful health check saves server without reloading and announces connection',async()=>{const c=settingsClient(healthReply(200,'{"ok":true,"service":"Mirkam Line"}'));c.field.value='https://service.example/';await c.submit();assert.equal(c.stored.get('mirkam.server.origin'),'https://service.example');assert.equal(c.events,1);assert.match(c.notice.textContent,/החיבור לשרת הצליח/);});
for(const status of [302,401,403])test(`private server status ${status} explains blocked access without saving`,async()=>{const c=settingsClient(healthReply(status,''));c.field.value='https://service.example';await c.submit();assert.match(c.notice.textContent,/הגישה לשרת חסומה/);assert.equal(c.stored.size,0);});
test('HTML login response is not mistaken for a healthy server',async()=>{const c=settingsClient(healthReply(200,'<html>Sign in</html>'));c.field.value='https://service.example';await c.submit();assert.match(c.notice.textContent,/דף במקום שירות/);assert.equal(c.stored.size,0);});
test('pending connection visibly disables duplicate submissions and recovers after failure',async()=>{let reject;const c=settingsClient(()=>new Promise((_,r)=>{reject=r;}));c.field.value='https://service.example';const pending=c.submit();assert.equal(c.save.disabled,true);assert.match(c.save.textContent,/בודק חיבור/);await c.submit();assert.equal(c.calls,1);reject(Error('network failed'));await pending;assert.equal(c.save.disabled,false);assert.equal(c.field.disabled,false);assert.equal(c.stored.size,0);});

for(const platform of ['android','windows'])test(`Codespaces transport header respects ${platform} bridge`,async()=>{const c=client('https://example-3000.app.github.dev',platform);await c.window.fetch('/api/home',{headers:{Authorization:'Bearer test'}});assert.equal(c.request.headers['X-GitHub-Codespaces-Skip-Anti-Phishing'],platform==='android'?'true':undefined);assert.equal(c.request.headers.Authorization,'Bearer test');});
test('Codespaces header is not sent to unrelated servers',async()=>{const c=client('https://service.example','android');await c.window.fetch('/health');assert.equal(c.request.headers['X-GitHub-Codespaces-Skip-Anti-Phishing'],undefined);});
