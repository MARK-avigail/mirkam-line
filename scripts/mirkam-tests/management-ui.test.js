import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ui,json} from './ui-harness.js';
import {BRANCHES} from '../../src/mirkam/workflow.js';
const pages={owner:['admin-users','admin-status','admin-tickets','suite-line','suite-chats','suite-documents','suite-family'],support:['admin-users','admin-status','admin-tickets'],billing:['admin-status']};
const text=n=>[n.textContent,...n.children.map(text)].join(' ');
const cases=['empty','populated','unauthorized','forbidden','server-error','non-json','network','expired-inflight'];
for(const [role,ids] of Object.entries(pages))for(const id of ids)for(const scenario of cases)test(`${role} ${id}: ${scenario}`,async()=>{
 let resolve,calls=0;
 const payload={ok:true,items:scenario==='populated'?[{id:'test',name:'fixture',text:'fixture',status:'open',answers:{subject:'fixture'},messages:[{text:'fixture'}]}]:[],branches:BRANCHES,aiConfigured:scenario==='populated',emailConfigured:scenario==='populated',voiceConfigured:scenario==='populated',faxConfigured:false,paymentConfigured:false,liveVerified:false};
 const u=ui(async(url,options)=>{
  if(url==='/api/staff-login')return json({ok:true,token:'session',role});
  calls++;assert.equal(options.headers.Authorization,'Bearer session');assert.equal(options.method,'GET');assert.match(url,/^\/api\/admin\//);
  if(scenario==='expired-inflight')return new Promise(r=>{resolve=r;});
  if(scenario==='network')throw new TypeError('network');
  if(scenario==='non-json')return new Response('<html>proxy error</html>',{status:502,headers:{'content-type':'text/html'}});
  const status={unauthorized:401,forbidden:403,'server-error':500}[scenario];
  return status?json({ok:false,error:'test failure'},status):json(payload);
 });
 await u.submit('staff-login-form');const pending=u.click(id);
 if(scenario==='expired-inflight'){vm.runInContext('lockManagement()',u.context);resolve(json(payload));}
 await pending;assert.equal(calls,1);assert.equal(u.ids.get('login').hidden,true);assert.equal(u.ids.get('workspace').hidden,true);
 const content=text(u.ids.get('admin-pane'));
 if(['unauthorized','expired-inflight'].includes(scenario)){
  assert.equal(u.ids.get('admin').hidden,true);assert.equal(u.ids.get('staff-gate').hidden,false);assert.equal(u.ids.get('admin-pane').children.length,0);
 }else if(['forbidden','server-error','non-json','network'].includes(scenario)){
  assert.ok(u.ids.get('status').textContent);assert.ok(!content.includes('fixture'));assert.ok(!u.ids.get('status').textContent.includes('Codespaces'));
 }else{
  assert.equal(u.ids.get('admin').hidden,false);assert.ok(content.length>0);
  if(id==='admin-status'){assert.match(content,/AI/);assert.match(content,/פקס/);assert.match(content,/אינה בדיקת/);assert.match(content,scenario==='populated'?/הגדרות קיימות/:/לא מוגדר/);}
  else if(id==='suite-line'){for(const branch of BRANCHES)assert.ok(content.includes(branch.title));assert.match(content,/ללא צורך|אינו מחייב/);}
  else if(scenario==='populated')assert.match(content,/fixture/);
  else assert.match(content,/אין|עדיין/);
 }
 assert.equal(u.ids.get('staff-password').value,'');
});
for(const role of ['support','billing'])for(const id of ['suite-line','suite-chats','suite-documents','suite-family','admin-destinations','admin-announcement'])test(`${role} cannot invoke hidden owner control ${id}`,async()=>{
 let calls=0;const u=ui(async url=>{if(url==='/api/staff-login')return json({ok:true,token:'session',role});calls++;return json({ok:true,items:[]});});
 await u.submit('staff-login-form');await u.click(id);assert.equal(calls,0);assert.match(u.ids.get('status').textContent,/אין הרשאה/);
});
test('login offers exactly two workspaces and hides the navigation drawer',async()=>{
 const u=ui(async()=>json({ok:true,token:'session',role:'owner'}));await u.submit('staff-login-form');const cards=u.ids.get('admin-pane').children.find(n=>n.className==='module-picker');assert.equal(cards.children.length,2);assert.deepEqual(cards.children.map(n=>n.textContent),['מערכת הקו','ניהול המערכת']);assert.equal(u.ids.get('suite-sidebar').hidden,true);
});
