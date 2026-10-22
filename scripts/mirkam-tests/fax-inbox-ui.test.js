import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {ui,json} from './ui-harness.js';
const item={id:'a'.repeat(64),pages:2,sender:'<script>untrusted</script>',userId:null,revision:1,mime:'application/pdf'};
test('inbox lists original document and explicit assignment with no HTML execution',async()=>{
 const u=ui(async url=>url==='/api/staff-login'?json({ok:true,token:'session',role:'owner'}):url==='/api/admin/users'?json({ok:true,items:[{id:'u',name:'משתמש בדיקה',prison:'בדיקה'}]}):json({ok:true,configured:true,items:[item],scan:null}));
 await u.submit('staff-login-form');await vm.runInContext('showFaxInbox()',u.context);
 assert.match(u.text('admin-pane'),/פקס ממתין לשיוך/);assert.ok(u.text('admin-pane').includes(item.sender));assert.ok(u.all.find(n=>n.textContent==='הורדת המסמך המקורי'));assert.ok(u.all.find(n=>n.textContent==='אישור שיוך לתיק'));assert.equal(u.all.some(n=>n.tag==='script'),false);
});
test('assigned fax appears inside its user dossier',async()=>{
 const u=ui(async url=>url==='/api/staff-login'?json({ok:true,token:'session',role:'owner'}):json({ok:true,user:{id:'u',name:'בדיקה'},faxes:[{...item,userId:'u'}]}));
 await u.submit('staff-login-form');await vm.runInContext("openUser('u','faxes')",u.context);assert.match(u.text('admin-pane'),/פקס שהתקבל · 2 עמודים/);assert.ok(u.all.find(n=>n.textContent==='הורדת המסמך המקורי'));
});
test('inbox shows failed background check instead of claiming no new faxes',async()=>{
 const u=ui(async url=>url==='/api/staff-login'?json({ok:true,token:'session',role:'owner'}):url==='/api/admin/users'?json({ok:true,items:[]}):json({ok:true,configured:true,items:[item],error:'INBOUND_FAX_UNAVAILABLE'}));
 await u.submit('staff-login-form');await vm.runInContext('showFaxInbox()',u.context);assert.match(u.text('admin-pane'),/האחרונה לא הושלמה/);assert.match(u.text('admin-pane'),/פקס ממתין לשיוך/);
});
