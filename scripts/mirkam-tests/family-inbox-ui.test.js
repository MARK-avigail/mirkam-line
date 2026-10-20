import test from 'node:test';
import assert from 'node:assert/strict';
import {ui,json} from './ui-harness.js';
import vm from 'node:vm';

test('user dossier shows Hebrew direction, family name, full reply and date',async()=>{
 const u=ui(async url=>url==='/api/staff-login'?json({ok:true,token:'session',role:'owner'}):json({ok:true,user:{id:'a',name:'משה כהן',active:true},contacts:[{id:'c',name:'המשפחה'}],messages:[{id:'m',direction:'incoming',contactId:'c',status:'received',text:'מחכים לך בבית. כלא ולא הכל.',createdAt:Date.now()}]}));
 await u.submit('staff-login-form');await vm.runInContext("openUser('a','messages')",u.context);
 const text=u.text('admin-pane');assert.match(text,/תשובה מהמשפחה/);assert.match(text,/מאת: המשפחה/);assert.match(text,/מחכים לך בבית. כלא ולא הכל./);assert.doesNotMatch(text,/received/);
});

test('owner checks inbox and sees newly received reply without HTML rendering',async()=>{
 let imported=false,checks=0;const text='הכוונה הייתה כלא, ולא הכל. <script>test</script>';
 const u=ui(async(url,options)=>{
  if(url==='/api/staff-login')return json({ok:true,token:'session',role:'owner'});
  if(url==='/api/admin/messages')return json({ok:true,items:imported?[{direction:'incoming',text,createdAt:Date.now()}]:[]});
  if(url==='/api/admin/family-inbox'){
   if(options.method==='POST'){checks++;imported=true;}
   return json({ok:true,configured:true,checkedAt:imported?Date.now():null,lastImported:imported?1:0,skipped:{}});
  }
  throw Error('unexpected request');
 });
 await u.submit('staff-login-form');await u.click('suite-family');assert.match(u.text('admin-pane'),/אין פריטים/);
 const check=u.all.find(n=>n.textContent==='בדיקת מיילים חוזרים');await check.onclick();
 assert.equal(checks,1);assert.match(u.text('admin-pane'),/נקלטו בבדיקה 1/);assert.match(u.text('admin-pane'),/תשובה מהמשפחה/);assert.ok(u.text('admin-pane').includes(text));
 assert.equal(u.all.some(n=>n.tag==='script'),false);
});
test('failed login is shown as failure and never as an empty successful inbox',async()=>{
 const u=ui(async url=>url==='/api/staff-login'?json({ok:true,token:'session',role:'owner'}):url==='/api/admin/messages'?json({ok:true,items:[]}):json({ok:true,configured:true,error:'INBOUND_LOGIN_FAILED'}));
 await u.submit('staff-login-form');await u.click('suite-family');assert.match(u.text('admin-pane'),/Gmail לא אישר כניסה/);assert.doesNotMatch(u.text('admin-pane'),/נקלטו בבדיקה 0/);
});
test('mailbox checks are not available to support or billing accounts',async()=>{
 for(const role of ['support','billing']){
  let calls=0;const u=ui(async url=>{if(url==='/api/staff-login')return json({ok:true,token:'session',role});calls++;return json({ok:true,items:[]});});
  await u.submit('staff-login-form');await u.click('suite-family');assert.equal(calls,0);assert.match(u.text('status'),/אין הרשאה/);
 }
});
