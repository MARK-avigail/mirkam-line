let voiceSampleUrl,liveVoiceTrial;
'use strict';
const $=id=>document.getElementById(id);let token='',user=null,draft=null,conversation=null,message=null,busy=false,recorder=null,stream=null;
const pane=$('pane');let adminSession='',adminRole='',sessionTimer,authEpoch=0;
window.mirkamStaffAuthenticated=false;
let credentialPanel=null,credentialTimer,currentArea='home',selectedUserId=null;

function clearCredentials(){clearTimeout(credentialTimer);if(credentialPanel)credentialPanel.replaceChildren();credentialPanel=null;}
function lockManagement(){stopLiveVoice();if(voiceSampleUrl){URL.revokeObjectURL(voiceSampleUrl);voiceSampleUrl=null;}document.body?.classList.remove('module-home');closeDrawer();$('shell-bar').hidden=true;selectedUserId=null;currentArea='home';clearCredentials();$('status').textContent='';authEpoch++;clearTimeout(sessionTimer);adminSession='';adminRole='';token='';user=draft=conversation=message=null;window.mirkamStaffAuthenticated=false;document.body?.classList.add('locked');for(const id of ['suite-sidebar','app-header','app-footer','admin','workspace','login'])$(id).hidden=true;$('staff-gate').hidden=false;$('staff-password').value='';$('admin-token').value='';$('pin').value='';$('code').value='';$('admin-pane').replaceChildren();$('owner-result').replaceChildren();pane.replaceChildren();window.dispatchEvent?.(new Event('mirkam-auth-changed'));}
function unlockManagement(role){adminRole=role;window.mirkamStaffAuthenticated=true;document.body?.classList.remove('locked');$('staff-gate').hidden=true;$('admin').hidden=false;$('suite-sidebar').hidden=true;$('app-footer').hidden=true;$('admin').open=true;const owner=role==='owner';for(const id of ['suite-line','suite-chats','suite-documents','suite-family','admin-destinations','admin-announcement'])$(id).hidden=!owner;$('admin-users').hidden=!['owner','support'].includes(role);$('admin-contacts').hidden=!['owner','support'].includes(role);$('admin-tickets').hidden=!['owner','support'].includes(role);renewManagementTimer();window.dispatchEvent?.(new Event('mirkam-auth-changed'));}
function renewManagementTimer(){clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>{lockManagement();$('status').textContent='ההתחברות הסתיימה לאחר חוסר פעילות. היכנסו שוב.';},3300000);}
let lastSessionTouch=0,sessionTouchPending=false;
function managementActivity(){
 if(!adminSession||sessionTouchPending||Date.now()-lastSessionTouch<60000)return;
 sessionTouchPending=true;lastSessionTouch=Date.now();
 api('admin/session','POST',{},true).catch(()=>{}).finally(()=>{sessionTouchPending=false;});
}
document.addEventListener?.('pointerdown',managementActivity);
document.addEventListener?.('keydown',managementActivity);
function requireManagement(){if(!adminSession){lockManagement();throw Error('יש להיכנס לניהול עם שם משתמש וסיסמה.');}}
function suiteActive(id){document.querySelectorAll('.suite-sidebar button').forEach(b=>{if(b.id===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function memberArea(){$('admin').hidden=true;if(!token){$('status').textContent='כדי לפתוח את השיחות והמסמכים שלך, היכנסו לחשבון.';$('login').hidden=false;reveal($('login'));return false;}$('workspace').hidden=false;$('admin').hidden=true;return true;}
function closeDrawer(){ $('suite-sidebar').hidden=true;$('menu-backdrop').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false'); }
function configureDrawer(){
 const line=currentArea==='line';
 for(const id of ['suite-line','suite-chats','suite-documents','suite-family','suite-management','admin-users','admin-status','admin-destinations','admin-contacts','admin-announcement','admin-tickets']){
  const visible=line?['suite-line','suite-chats','suite-documents','admin-status'].includes(id):!['suite-line','suite-management','admin-contacts'].includes(id);
  $(id).hidden=!visible||!canManage(id);
 }
}
function enterArea(area){currentArea=area;document.body.classList.remove('module-home');$('shell-bar').hidden=false;$('shell-title').textContent=area==='line'?'מערכת הקו':'ניהול המערכת';$('admin').hidden=false;closeDrawer();configureDrawer();}
$('menu-toggle').onclick=()=>{if(!adminSession)return;const open=$('suite-sidebar').hidden;configureDrawer();$('suite-sidebar').hidden=!open;$('menu-backdrop').hidden=!open;$('menu-toggle').setAttribute('aria-expanded',String(open));};
$('menu-close').onclick=closeDrawer;$('menu-backdrop').onclick=closeDrawer;
$('shell-home').onclick=()=>run(async()=>{requireManagement();managementHome();});
document.addEventListener?.('keydown',event=>{if(event.key==='Escape'){closeDrawer();$('menu-toggle').focus?.();}});
function managementHome(){
 stopLiveVoice();
 clearCredentials();selectedUserId=null;currentArea='home';closeDrawer();$('shell-bar').hidden=true;document.body.classList.add('module-home');
 const p=$('admin-pane');$('admin').hidden=false;$('admin').open=true;
 p.replaceChildren(node('h1','מרקם ליין'),node('p','בחרי סביבת עבודה'));
 const cards=node('div');cards.className='module-picker';
 const line=node('button','מערכת הקו');line.type='button';line.onclick=()=>$('suite-line').onclick();line.disabled=!canManage('suite-line');
 const management=node('button','ניהול המערכת');management.type='button';management.onclick=()=>(canManage('admin-users')?$('admin-users'):$('admin-status')).onclick();
 cards.append(line,management);p.append(cards);reveal(p);
}
$('software-updates').onclick=()=>run(async()=>{
 stopLiveVoice();
 requireManagement();clearCredentials();closeDrawer();const p=$('admin-pane');p.replaceChildren(node('h2','עדכוני התוכנה'),node('p','גרסת ממשק: חיפוש ותיק משתמש — 16.10.2026.'));
 if(window.mirkamNative?.updateCheck){
  p.append(node('p','עדכוני ממשק נבדקים מתוך התוכנה. עדכון מוכן יופעל בסגירה מלאה ובפתיחה מחדש.'));
  button('בדיקת עדכונים',async()=>{const r=await window.mirkamNative.updateCheck();p.append(node('p',r.available?'עדכון מוכן לפתיחה הבאה.':r.busy?'בדיקת עדכונים כבר פועלת.':'לא נמצא עדכון חדש.'));},p);
 }else{
  p.append(node('p','אין צורך להתקין מחדש את האפליקציה לאחר שינוי באתר. לאחר התקנת העדכון בשרת, רענון טוען את הממשק המעודכן.'));
  button('רענון לגרסה שבשרת',async()=>{if(!navigator.onLine)throw Error('נדרש חיבור לאינטרנט כדי לטעון עדכון.');if(window.confirm('לרענן את התוכנה? יהיה צורך להיכנס מחדש.'))window.location.reload();},p);
 }
});
$('suite-home').onclick=()=>run(async()=>{requireManagement();managementHome();});
$('suite-line').onclick=()=>run(async()=>{
 requireManagement();const r=await api('admin/line','GET',undefined,true);suiteActive('suite-line');
 const p=$('admin-pane');p.replaceChildren(node('h2','הקו הטלפוני והשלוחות'),node('p','זהו תפריט השירות שהלקוחות שומעים בטלפון. מסך הניהול אינו מחייב אותם להשתמש באפליקציה.'));
 const samples=node('section');samples.append(node('h3','בחירת קול — האזנה בעברית'),node('p','כל דגימה נוצרת רק בלחיצה ומשתמשת ב־API בתשלום. האזנה חוזרת משתמשת בדגימה השמורה עד הפעלה מחדש של השרת. ההאזנה אינה משנה את קול הקו; בטלפון הצליל עשוי להשתנות.'));const player=node('audio');player.controls=true;samples.append(player);p.append(samples);
 for(const voice of ['coral','marin','shimmer'])button('הכנה והאזנה — '+voice,async()=>{const r=await api('admin/voice-sample','POST',{voice},true);if(voiceSampleUrl)URL.revokeObjectURL(voiceSampleUrl);voiceSampleUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.audio),c=>c.charCodeAt(0))],{type:r.mime}));player.src=voiceSampleUrl;try{await player.play();}catch{$('status').textContent='הדגימה מוכנה. לחצי על נגן השמע.';}},samples);

 addLiveVoiceTrial(p);
 button('דברי עם ליין',()=>showStaffLine(),p);
 for(const b of r.branches){const box=node('section');box.className='branch-card';box.append(node('h3','שלוחה '+b.digit+' — '+b.title));for(const child of b.children)box.append(node('p',child.digit+' · '+child.title));p.append(box);}
 p.append(node('p','הצגת התפריט אינה אישור לחיבור קו פעיל. יש לבדוק שיחה נכנסת, זיהוי, שמירה וחזרה לטיוטה מול ספק הטלפוניה.'));reveal(p);
});
for(const [id,resource,title] of [['suite-chats','conversations','שיחות'],['suite-documents','drafts','עתירות ומסמכים'],['suite-family','messages','קשר עם המשפחה']])$(id).onclick=()=>run(async()=>{requireManagement();const r=await api('admin/'+resource,'GET',undefined,true);suiteActive(id);const p=$('admin-pane');p.replaceChildren(node('h2',title));if(resource==='conversations')button('דברי עם ליין',()=>showStaffLine(),p);if(!r.items.length)p.append(node('p',resource==='drafts'?'אין פריטים שמורים. עתירות שנוצרות בקו הטלפוני יופיעו כאן להמשך מעקב.':'אין פריטים שמורים.'));if(resource==='drafts')button('הצגת תבנית העתירה והמסמכים הנלווים',()=>showAdminDocuments(),p);for(const item of r.items){const box=node('section');box.append(node('h3',item.name||item.answers?.subject||'פריט שמור'));box.append(node('pre',resource==='conversations'?(item.messages||[]).map(m=>m.text).join('\n'):resource==='drafts'?Object.values(item.answers||{}).join('\n'):item.text||''));if(resource==='drafts')button('פתיחת העתירה והמסמכים',()=>showAdminDocuments(item.id),box);p.append(box);}reveal(p);});
async function showStaffLine(id=''){
 stopLiveVoice();
 requireManagement();const route='admin/line-chat'+(id?'?id='+encodeURIComponent(id):''),r=await api(route,'GET',undefined,true),p=$('admin-pane');
 p.replaceChildren(node('h2','מדברים עם ליין'),node('p','השיחה נשמרת אוטומטית אחרי כל תשובה, גם כשיוצאים מהמסך. ליין נעזר בהקשר חלקי משלוש השיחות האחרונות שלך.'));
 button('שיחה חדשה',async()=>{const next=await api('admin/line-chat/new','POST',{},true);await showStaffLine(next.item.id);},p);
 if(r.items?.length){const history=node('section');history.append(node('h3','השיחות השמורות שלי'));for(const c of r.items)button(c.name,()=>showStaffLine(c.id),history);p.append(history);}
 for(const m of r.item.messages){const box=node('section');box.append(node('h3',m.role==='user'?'את':'ליין'),node('p',m.text));p.append(box);}
 const label=node('label','ההודעה שלך לליין'),text=node('textarea');text.maxLength=4000;label.append(text);p.append(label);
 button('שליחה לליין',async()=>{if(!text.value.trim())throw Error('כתבי הודעה לליין.');const sent=await api('admin/line-chat','POST',{id:r.item.id,text:text.value,revision:r.item.revision},true);await showStaffLine(sent.item.id);},p);
 reveal(p);
}
function stopLiveVoice(){
 const trial=liveVoiceTrial;if(!trial)return;
 liveVoiceTrial=null;trial.cancelled=true;clearTimeout(trial.limit);clearTimeout(trial.startLimit);
 trial.microphone?.getTracks().forEach(track=>track.stop());
 trial.player.pause?.();trial.player.srcObject=null;
 if(trial.events?.readyState==='open')try{trial.events.send(JSON.stringify({type:'session.close'}));}catch{}
 trial.events?.close();trial.peer?.close();
 trial.start.disabled=false;trial.stop.disabled=true;
 trial.status.textContent='ההאזנה הסתיימה.';
 if(trial.requested)fetch('/api/admin/live-voice',{method:'DELETE',headers:{Authorization:'Bearer '+trial.token},keepalive:true}).then(r=>{if(!r.ok)trial.status.textContent='ההאזנה המקומית נעצרה; לא התקבל אישור סיום מהשרת.';}).catch(()=>{trial.status.textContent='ההאזנה המקומית נעצרה; לא התקבל אישור סיום מהשרת.';});
}
window.addEventListener?.('pagehide',stopLiveVoice);
function addLiveVoiceTrial(parent){
 const box=node('section'),status=node('p'),player=node('audio'),start=node('button','התחלת שיחה עם הקול שבחרתי'),stop=node('button','סיום ההאזנה');
 start.type=stop.type='button';player.controls=true;player.autoplay=true;
 box.append(node('h3','הקול שבחרת — שיחת ניסיון'),node('p','שיחת האזנה עד שתי דקות, באמצעות המיקרופון. השימוש מחויב לפי תעריפי OpenAI. זהו קול שנוצר בבינה מלאכותית; הבדיקה אינה משנה את קול הקו הטלפוני ואינה שולחת הודעות. השיחה אינה נשמרת בהיסטוריית הניהול.'),start,stop,status,player);parent.append(box);
 stop.onclick=()=>{if(liveVoiceTrial)stopLiveVoice();else api('admin/live-voice','DELETE',undefined,true).then(()=>{status.textContent='הבדיקה הסתיימה.';}).catch(e=>{status.textContent=e.message;});};
 start.onclick=async()=>{
  if(liveVoiceTrial)return;
  if(!navigator.mediaDevices?.getUserMedia||typeof RTCPeerConnection==='undefined'){status.textContent='פתחי את אתר הניהול ב־Chrome דרך HTTPS כדי להשתמש במיקרופון.';return;}
  const trial={start,stop,status,player,token:adminSession,epoch:authEpoch};liveVoiceTrial=trial;start.disabled=true;stop.disabled=false;status.textContent='מחברים את הקול…';
  const current=()=>liveVoiceTrial===trial&&!trial.cancelled&&trial.epoch===authEpoch;
  try{
   trial.microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   if(!current()){trial.microphone.getTracks().forEach(t=>t.stop());return;}
   const peer=trial.peer=new RTCPeerConnection();
   peer.addEventListener('track',event=>{if(!current())return;player.srcObject=new MediaStream([event.track]);player.play().catch(()=>{if(current())status.textContent='לחצי על נגן השמע כדי לשמוע.';});});
   peer.addEventListener('connectionstatechange',()=>{if(current()&&['failed','closed'].includes(peer.connectionState)){stopLiveVoice();status.textContent='חיבור האודיו הסתיים.';}});
   trial.microphone.getAudioTracks().forEach(track=>peer.addTrack(track,trial.microphone));
   const events=trial.events=peer.createDataChannel('oai-events');
   events.addEventListener('message',({data})=>{
    if(!current())return;
    let event;try{event=JSON.parse(data);}catch{return;}
    if(event.type==='session.started'){clearTimeout(trial.startLimit);status.textContent='מחובר. אפשר לדבר ולהקשיב.';trial.limit=setTimeout(stopLiveVoice,120000);}
    else if(event.type==='session.closed'){stopLiveVoice();status.textContent='השיחה הסתיימה.';}
    else if(event.type==='error'){stopLiveVoice();status.textContent='ספק הקול דיווח על תקלה. השיחה נעצרה.';}
   });
   events.addEventListener('close',()=>{if(current())stopLiveVoice();});
   trial.startLimit=setTimeout(()=>{if(current()){stopLiveVoice();status.textContent='החיבור לא הושלם בזמן.';}},40000);
   await peer.setLocalDescription(await peer.createOffer());
   if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);};
    const changed=()=>{if(peer.iceGatheringState==='complete'){done();resolve();}};
    const timer=setTimeout(()=>{done();reject(Error('חיבור האודיו לא הוכן בזמן.'));},10000);
    peer.addEventListener('icegatheringstatechange',changed);changed();
   });
   if(!current())return;
   trial.requested=true;
   const result=await api('admin/live-voice','POST',{sdp:peer.localDescription.sdp},true);
   if(!current())return;
   await peer.setRemoteDescription({type:'answer',sdp:result.transport.sdp});
  }catch(e){if(current()){stopLiveVoice();status.textContent=e.name==='NotAllowedError'?'נדרשת הרשאת מיקרופון כדי לדבר עם הקול.':e.message||'לא ניתן לחבר את הקול כרגע.';}}
 };
}
async function showAdminDocuments(id,ownerId=null){
 const route=id?'admin/drafts/'+id+'/package':'admin/document-template',r=await api(route,'GET',undefined,true),p=$('admin-pane');
 p.replaceChildren(node('h2',id?'תצוגת העתירה והמסמכים':'תבנית העתירה והמסמכים הנלווים'),node('p',id?'תצוגה לבדיקה בלבד — אינה אישור להגשה או לשליחה.':'זו התבנית שהמערכת ממלאת מהתשובות שנאספות בקו. הצגתה אינה יוצרת עתירה או חשבון.'));
 if(r.missing?.length)p.append(node('p','הטיוטה אינה מלאה; נותרו '+r.missing.length+' שדות חובה להשלמה בקו.'));
 for(const doc of r.documents){const box=node('section');box.className='document-preview';box.append(node('h3',doc.title),node('pre',doc.text));
  if(id)for(const ext of ['pdf','docx'])button('הורדת תצוגה לבדיקה · '+ext.toUpperCase(),async()=>{
   const blob=await api('admin/drafts/'+id+'/'+ext+'?kind='+doc.kind,'GET',undefined,true,true),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='preview-'+doc.kind+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  },box);
  p.append(box);
 }
 const back=node('button',ownerId?'חזרה לתיק המשתמש':'חזרה לרשימת העתירות');back.type='button';back.onclick=()=>ownerId?run(()=>openUser(ownerId,'drafts')):$('suite-documents').onclick();p.append(back);reveal(p);
}
function familyInboxSummary(result){
 const errors={INBOUND_NOT_CONFIGURED:'קליטת תשובות אינה מוגדרת לתיבת Gmail בשרת.',INBOUND_LOGIN_FAILED:'Gmail לא אישר כניסה לתיבה. יש לבדוק הרשאת IMAP וסיסמת אפליקציה בשרת.',INBOUND_NO_SENT_THREADS:'עדיין אין במערכת הודעה שנשלחה למשפחה שאפשר לשייך אליה תשובה.'};
 if(result.error)return errors[result.error]||'בדיקת תיבת המייל לא הושלמה. ההודעות שכבר נקלטו נשמרו.';
 if(!result.configured)return 'קליטת תשובות אינה מוגדרת בשרת.';
 if(!result.checkedAt)return 'הקליטה מוכנה לבדיקה. עדיין אין תוצאת בדיקה.';
 const rejected=Object.entries(result.skipped||{}).filter(([key])=>!['unrelated','duplicate'].includes(key)).reduce((total,[,value])=>total+value,0);
 return 'בדיקה אחרונה: '+new Date(result.checkedAt).toLocaleString('he-IL')+'. נקלטו בבדיקה '+(result.lastImported||0)+' תשובות חדשות. סך הכול נקלטו '+(result.totalImported||0)+' תשובות.'+(result.lastRepaired?' תוקן פענוח התוכן של '+result.lastRepaired+' הודעות קודמות.':'')+(result.bodyUnavailable?' במייל המקורי של '+result.bodyUnavailable+' הודעות לא נמצא טקסט תשובה חדש.':'')+(result.pending?' יש הודעות נוספות בתור לבדיקה.':'')+(rejected?' '+rejected+' הודעות לא יובאו בגלל אימות, שיוך או גודל; יש לבדוק את התיבה.':'')+(result.attachmentsIgnored?' קבצים מצורפים לא יובאו; נקלט הטקסט בלבד.':'');
}
$('suite-family').onclick=()=>run(async()=>{
 requireManagement();suiteActive('suite-family');
 const p=$('admin-pane'),summary=node('p'),items=node('div');
 p.replaceChildren(node('h2','קשר עם המשפחה'),summary);
 async function refresh(){
  const result=await api('admin/messages','GET',undefined,true);items.replaceChildren();
  if(!result.items.length)items.append(node('p','אין פריטים שמורים.'));
  for(const item of result.items){const box=node('section');box.append(node('h3',item.direction==='incoming'?'תשובה מהמשפחה':'הודעה למשפחה'));if(item.userName||item.contactName)box.append(node('p',[item.userName,item.contactName].filter(Boolean).join(' · ')));box.append(node('pre',item.text||''));if(item.createdAt)box.append(node('p',new Date(item.createdAt).toLocaleString('he-IL')));if(item.owner)button('פתיחת תיק המשתמש',()=>openUser(item.owner,'messages'),box);items.append(box);}
 }
 button('בדיקת מיילים חוזרים',async()=>{summary.textContent='בודקים את תיבת המייל…';const result=await api('admin/family-inbox','POST',{},true);summary.textContent=familyInboxSummary(result);await refresh();},p);
 p.append(items);const [inboxStatus]=await Promise.all([api('admin/family-inbox','GET',undefined,true),refresh()]);summary.textContent=familyInboxSummary(inboxStatus);reveal(p);
});
$('suite-management').onclick=()=>{requireManagement();return (canManage('admin-users')?$('admin-users'):$('admin-status')).onclick();};
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function reveal(element){element.scrollIntoView?.({behavior:'smooth',block:'start'});}
function clear(title){pane.replaceChildren(node('h2',title));reveal(pane);}
function button(text,fn,parent=pane){const b=node('button',text);b.type='button';b.onclick=()=>run(fn);parent.append(b);return b;}
function input(label,type='text',parent=pane){const l=node('label',label),i=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;if(type==='email'){i.dir='ltr';i.autocomplete='email';}l.append(i);parent.append(l);return i;}
async function api(route,method='GET',data,admin=false,binary=false){const epoch=authEpoch;if(!navigator.onLine)throw Error('אין חיבור לאינטרנט. כניסה, שיחות ושליחה יהיו זמינות כשהחיבור יחזור.');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);try{const r=await fetch('/api/'+route,{method,headers:{Authorization:'Bearer '+(admin?(adminSession||$('admin-token').value):token),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:controller.signal});if(admin&&epoch!==authEpoch)throw Error('ההתחברות הסתיימה. היכנסו שוב.');if(admin&&r.ok)renewManagementTimer();if(binary&&r.ok)return r.blob();if(!r.headers.get('content-type')?.includes('application/json'))throw Error('השרת החזיר תשובה לא צפויה. נסו שוב או בדקו את מצב השירות.');const v=await r.json();if(admin&&epoch!==authEpoch)throw Error('ההתחברות הסתיימה. היכנסו שוב.');if(!r.ok||v.ok===false){if(admin&&r.status===401)lockManagement();throw Error(v.error||'הפעולה לא הושלמה.');}return v;}catch(e){if(e instanceof TypeError)throw Error('לא ניתן להגיע לשרת כרגע. בדקו את החיבור ואת פעילות השרת.');if(e.name==='AbortError')throw Error('השרת לא ענה בזמן. לפני משלוח נוסף בדקו את ההיסטוריה.');throw e;}finally{clearTimeout(timer);}}
async function run(fn){if(busy)return;busy=true;const status=$('status');status.textContent='מבצעים את הפעולה…';const buttons=[...document.querySelectorAll('#workspace button, #admin button, .suite-sidebar button, #login button')].filter(b=>!b.disabled);buttons.forEach(b=>b.disabled=true);try{await fn();if(status.textContent==='מבצעים את הפעולה…')status.textContent='';}catch(e){status.textContent=e.message||'הפעולה לא הושלמה.';reveal(status);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}}

function speak(text){if(!window.speechSynthesis){$('status').textContent='הקראה אינה נתמכת בדפדפן הזה.';return;}speechSynthesis.cancel();const voice=speechSynthesis.getVoices().find(v=>/^he/i.test(v.lang));if(!voice){$('status').textContent='לא נמצא קול עברי בדפדפן. הקול הטלפוני מוגדר בנפרד.';return;}for(const part of String(text).match(/[\s\S]{1,600}/g)||[]){const u=new SpeechSynthesisUtterance(part);u.lang='he-IL';u.voice=voice;u.rate=.9;speechSynthesis.speak(u);}}
async function audio(target,draftId){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('הקלטה דורשת דפדפן נתמך וכתובת מאובטחת.');if(recorder?.state==='recording')throw Error('הקלטה כבר פועלת.');stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/webm','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});const parts=[];const stop=button('סיום הקלטה',async()=>recorder.stop());let timer;recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};recorder.onstop=()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());stop.remove();run(async()=>{const blob=new Blob(parts,{type:recorder.mimeType});if(!blob.size)throw Error('ההקלטה ריקה.');const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});const response=await api('transcribe','POST',{audio:base64,mime:recorder.mimeType,...(draftId?{draftId}:{})});target.value=response.text;$('status').textContent='התמלול התקבל. בדקו אותו לפני אישור.';});};recorder.start();timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},180000);$('status').textContent='מקליטים. בסיום לחצו על סיום הקלטה.';}
async function home(){const h=await api('home');user=h.user;$('welcome').textContent='שלום '+user.name;$('branches').replaceChildren();h.branches.forEach(b=>button(b.digit+'. '+b.title,()=>branch(b),$('branches')));clear('מה תרצו לעשות היום?');pane.append(node('p','העבודה נשמרת במרקם ליין, בתוך Mavrika AI. פתחו שיחה או מסמך לפי הצורך.'));const cards=node('div');cards.className='overview-grid';button('שיחה חדשה עם העוזר',()=>choose('3','1'),cards);button('השיחות השמורות שלי',()=>choose('3','2'),cards);button('המסמכים והטיוטות שלי',()=>choose('2','1'),cards);button('יצירת עתירה חדשה',()=>branch(h.branches[0]),cards);pane.append(cards);suiteActive('suite-home');}
$('login-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await api('login','POST',{code:$('code').value,pin:$('pin').value});token=r.token;$('pin').value='';$('login').hidden=true;$('workspace').hidden=false;await home();});};
$('home').onclick=()=>run(home);$('logout').onclick=()=>run(async()=>{try{await api('logout','POST',{});}finally{token='';user=draft=conversation=message=null;pane.replaceChildren();$('workspace').hidden=true;$('login').hidden=false;if(window.speechSynthesis)speechSynthesis.cancel();}});
async function branch(b){clear(b.title);for(const child of b.children)button(child.title,()=>choose(b.digit,child.digit));}
async function list(kind,title,select){clear(title);const r=await api(kind);if(!r.items.length)pane.append(node('p','אין פריטים שמורים.'));for(const item of r.items){const label=item.name||item.answers?.subject||item.text?.slice(0,80)||item.status||'פריט שמור';button(label,()=>select(item));}}
async function choose(b,s){
  if(b==='1'){draft=(await api('drafts','POST',{aiEnabled:s==='1'})).draft;return renderDraft();}
  if(b==='2'&&s==='1')return list('drafts','הטיוטות שלי',async d=>{draft=d;await renderDraft();});
  if(b==='2'&&s==='2')return list('versions','גרסאות שמורות',async v=>{clear('גרסת מסמך');pane.append(node('pre',Object.entries(v.answers).map(([k,t])=>`${k}: ${t}`).join('\n')));});
  if(b==='2'&&s==='3')return list('deliveries','היסטוריית משלוחים',async d=>{clear('פרטי משלוח');pane.append(node('p',d.status));pane.append(node('p','אישור הספק אינו בהכרח אישור קבלה בבית המשפט.'));});
  if(b==='3'&&s==='1'){clear('שיחה חדשה');const name=input('שם השיחה');button('התחלת שיחה',async()=>{conversation=(await api('conversations','POST',{name:name.value})).item;renderConversation();});return;}
  if(b==='3')return list('conversations','שיחות שמורות',async c=>{conversation=c;renderConversation();});
  if(b==='4'&&s==='1')return list('contacts','בחרו איש קשר מאושר',async c=>{clear('הודעה אל '+c.name);const text=input('ההודעה שלכם','textarea');button('הקלטה',()=>audio(text));button('בדיקה לפני שליחה',async()=>{message=(await api('messages','POST',{contactId:c.id,text:text.value})).item;renderMessage(c);});});
  if(b==='4'&&s==='2')return list('messages','הודעות המשפחה',async m=>{clear(m.direction==='incoming'?'תשובה שהתקבלה':'הודעה שנשלחה');pane.append(node('pre',m.text));button('הקראה',()=>speak(m.text));});
  if(b==='4')return list('contacts','אנשי קשר מאושרים',async c=>{clear(c.name);pane.append(node('p',c.email));});
  if(b==='5'&&s==='1')return list('announcements','הודעות החברה',async a=>{clear('הודעת חברה');pane.append(node('pre',a.text));button('הקראה',()=>speak(a.text));});
  if(b==='5'&&s==='2'){clear('המינוי והשימוש שלי');const r=await api('membership');pane.append(node('p',({free:'מינוי ללא חיוב',trial:'תקופת ניסיון',paid:'מינוי פעיל',expired:'תקופת הניסיון הסתיימה'})[r.membership.status]));pane.append(node('p','המסמכים נשמרים. אין חיוב אוטומטי בלי הסכמה.'));button('בקשת קישור תשלום',async()=>{const r=await api('checkout','POST',{});if(r.result?.url&&/^https:\/\//.test(r.result.url))window.open(r.result.url,'_blank','noopener');else throw Error('לא התקבל קישור תשלום. שירות התשלום טרם זמין.');});return;}
  if(b==='5'){clear('פנייה למשרד');const text=input('איך נוכל לעזור?','textarea');button('הקלטה',()=>audio(text));button('שמירת פנייה',async()=>{await api('tickets','POST',{text:text.value});clear('הפנייה נשמרה');});}
}
async function action(name,data={}){draft=(await api('drafts/'+draft.id+'/'+name,'POST',{revision:draft.revision,...data})).draft;return renderDraft();}
async function renderDraft(){draft=(await api('drafts/'+draft.id)).draft;clear(draft.answers.subject||'העתירה שלכם');
  if(draft.stage==='profile'){pane.append(node('pre',`שם: ${user.name}\nמספר זהות: ${user.identity}\nמספר אסיר: ${user.prisonerNumber}\nבית סוהר: ${user.prison}\nאגף: ${user.wing||'לא צוין'}`));button('הפרטים נכונים',()=>action('profile'));pane.append(node('p','אם הפרטים שגויים, פנו למשרד לתיקון לפני המשך.'));return;}
  if(draft.stage==='court'){const r=await api('destinations');if(!r.items.length)pane.append(node('p','המשרד עדיין לא אימת התאמה לבית המשפט. הטיוטה נשמרה.'));for(const t of r.items)button(t.name,()=>action('court',{targetId:t.id}));return;}
  if(draft.stage==='dialogue'){pane.append(node('h3',draft.question));if(draft.helper)pane.append(node('p',draft.helper));const answer=input('ספרו במילים שלכם','textarea');answer.value=draft.answers[draft.currentTopic]||'';button('הקלטה',()=>audio(answer,draft.id));button('בדיקת התשובה',()=>action('answer',{text:answer.value}));if(draft.aiEnabled)button('עזרה ממוקדת',()=>action('coach',{text:answer.value}));button('דילוג על פרט רשות',()=>action('skip'));button('הקראת השאלה',()=>speak(draft.question));return;}
  if(draft.stage==='answer-review'){pane.append(node('pre',draft.pending.text));if(draft.helper)pane.append(node('p',draft.helper));const extra=input('רוצים להוסיף פרט או להשיב להבהרה?','textarea');button('הקלטת השלמה',()=>audio(extra,draft.id));button('הוספת הפרט לשיחה',()=>action('clarify',{text:extra.value}));button('נכון, שמירה והמשך',()=>action('confirm',{accept:true}));button('אני רוצה לתקן',()=>action('confirm',{accept:false}));if(draft.aiEnabled)button('עזרה בניסוח',()=>action('coach',{text:draft.pending.text}));if(draft.pending.aiProposal)button('חזרה למילים המקוריות',()=>action('restore'));button('הקראה',()=>speak(draft.pending.text));return;}
  if(draft.stage!=='review'){pane.append(node('p','מצב המסמך: '+draft.stage));return;}
  const r=await api('drafts/'+draft.id+'/package');for(const doc of r.documents){const box=node('section');box.append(node('h3',doc.title),node('pre',doc.text));button('הקראה',()=>speak(doc.text),box);for(const ext of ['pdf','docx'])button('הורדת '+ext.toUpperCase(),async()=>{const blob=await api('drafts/'+draft.id+'/'+ext+'?kind='+doc.kind,'GET',undefined,false,true);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=doc.kind+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},box);pane.append(box);}
  const key=input('שם הפרט לתיקון (למשל facts או relief)');button('תיקון פרט',()=>action('edit',{key:key.value}));
  const file=input('צירוף נספח PDF או תמונה','file');file.accept='.pdf,.png,.jpg,.jpeg';button('צירוף הקובץ',async()=>{const f=file.files[0];if(!f)throw Error('בחרו קובץ.');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(f);});return action('attach',{name:f.name,mime:f.type,base64});});
  const channel=document.createElement('select');for(const [value,label]of [['email','מייל'],['fax','פקס'],['both','שניהם']]){const o=node('option',label);o.value=value;channel.append(o);}pane.append(channel);button('בדיקת יעד לפני שליחה',()=>action('offer',{targetId:draft.court.id,channel:channel.value}));
  if(draft.approval){const targets=await api('destinations'),target=targets.items.find(t=>t.id===draft.approval.targetId);pane.append(node('p',`יעד: ${target?.name}. מייל: ${target?.email}. פקס: ${target?.fax}. ערוץ: ${draft.approval.channel}`));if(!draft.approval.confirmed)button('בדקתי את כל החבילה והיעד — אישור',()=>action('approve',{nonce:draft.approval.nonce,accept:true}));else button('שליחה מאושרת',async()=>{const sent=await api('drafts/'+draft.id+'/send','POST',{revision:draft.revision});clear('מצב משלוח');pane.append(node('p',sent.delivery.status));});}
}
function renderConversation(){clear(conversation.name);for(const m of conversation.messages){const p=node('p',(m.role==='user'?'אתם: ':'העוזר: ')+m.text);p.className='message';pane.append(p);}const text=input('מה תרצו לשאול או להוסיף?','textarea');button('הקלטה',()=>audio(text));button('שליחה לעוזר',async()=>{conversation=(await api('conversations/'+conversation.id+'/chat','POST',{text:text.value,revision:conversation.revision})).item;renderConversation();});}
function renderMessage(c){clear('בדיקת הודעה אל '+c.name);pane.append(node('pre',message.text));button('הקראה',()=>speak(message.text));button('אישור התוכן והנמען',async()=>{message=(await api('messages/'+message.id+'/approve','POST',{accept:true,revision:message.revision})).item;renderMessage(c);});if(message.status==='approved')button('שליחה',async()=>{message=(await api('messages/'+message.id+'/send','POST',{revision:message.revision})).item;clear('הודעה שמורה');pane.append(node('p',message.status));});}
function adminForm(title,fields,onSubmit){const p=$('admin-pane');p.replaceChildren(node('h3',title));const inputs={};fields.forEach(([key,label,type])=>inputs[key]=input(label,type||'text',p));button('שמירה',async()=>{await onSubmit(Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.type==='checkbox'?i.checked:i.value])));if($('status').textContent==='מבצעים את הפעולה…')$('status').textContent='הפרטים נשמרו.';reveal($('status'));},p);reveal(p);}
function showCredentials(name,credentials){
 clearCredentials();const p=$('admin-pane');p.replaceChildren(node('h3','פרטי כניסה עבור '+name));
 const panel=node('section');credentialPanel=panel;panel.className='credential-card';
 panel.append(node('p','הפרטים נועדו למסירה פרטית למשתמש הקו. ההצגה תיסגר במעבר מסך או לאחר דקה.'));
 const display=node('div');
 button('הצגת פרטי הכניסה',async()=>{display.replaceChildren();if(credentials.code)display.append(node('p','קוד משתמש: '+credentials.code));if(credentials.pin)display.append(node('p','PIN: '+credentials.pin));else display.append(node('p','ה-PIN הקיים אינו ניתן להצגה. אם נשכח, יש לאפס אותו.'));},panel);
 panel.append(display);button('סגירת פרטי הכניסה',async()=>clearCredentials(),panel);p.append(panel);
 credentialTimer=setTimeout(()=>{clearCredentials();},60000);
 $('status').textContent='הפעולה הושלמה. פרטי הכניסה זמינים באזור הפרטי למטה.';reveal(p);
}
$('admin-users').onclick=()=>run(async()=>{
 const r=await api('admin/users','GET',undefined,true),p=$('admin-pane');p.replaceChildren(node('h3','משתמשי הקו'));reveal(p);
 if(!r.items.length)p.append(node('p','עדיין אין משתמשים. לחצו על משתמש חדש.'));
 selectedUserId=null;
 const searchForm=node('form');searchForm.className='user-search';p.append(searchForm);const search=input('חיפוש משתמשים לפי שם, מספר אסיר, זהות או בית סוהר','search',searchForm);search.autocomplete='off';search.placeholder='הקלידי שם או מספר לחיפוש';const submit=node('button','חיפוש');submit.type='submit';submit.className='search-submit';searchForm.append(submit);const summary=node('p');summary.className='search-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');p.append(summary);const results=node('div');results.className='user-results';p.append(results);
 const render=()=>{const query=search.value.trim().toLocaleLowerCase('he');const items=r.items.filter(u=>[u.name,u.prisonerNumber,u.identity,u.prison].some(v=>String(v||'').toLocaleLowerCase('he').includes(query)));summary.textContent=query?(items.length?'נמצאו '+items.length+' תוצאות עבור ״'+search.value.trim()+'״':'לא נמצאו משתמשים עבור ״'+search.value.trim()+'״'):'מוצגים '+items.length+' משתמשים';results.replaceChildren();if(!items.length)results.append(node('p','לא נמצאו משתמשים.'));for(const u of items){const row=node('button');row.type='button';row.className='user-row';row.append(node('strong',u.name),node('span',u.prison+' · '+(u.active===false?'מושעה':'פעיל')));row.onclick=()=>run(()=>openUser(u.id));results.append(row);}};
 search.oninput=render;search.onchange=render;search.onsearch=render;searchForm.onsubmit=event=>{event.preventDefault();render();};render();
 button('משתמש חדש',async()=>{
  const fields=[['name','שם'],['identity','מספר זהות — תשע ספרות'],['prisonerNumber','מספר אסיר'],['prison','בית סוהר'],['wing','אגף']];
  if(adminRole==='owner')fields.push(['freeMembership','הטבת מינוי ללא חיוב','checkbox']);
  fields.push(['verificationConfirmed','בדקתי את זהות המשתמש ואת זכאותו לשירות','checkbox']);
  adminForm('רישום משתמש קו',fields,async data=>{
   if(data.verificationConfirmed!==true)throw Error('יש לאשר שבוצע אימות זהות וזכאות לפני הרישום.');
   const r=await api('admin/users','POST',data,true);selectedUserId=r.user.id;showCredentials(data.name,{code:r.user.code,pin:r.pin});
  });
  p.append(node('p','המערכת בודקת פורמט וכפילויות; היא אינה מאמתת זהות מול מרשם רשמי. האימות מבוצע על ידי איש הצוות.'));
 },p);
});
function backToUsers(parent){const back=node('button','חזרה למשתמשים');back.type='button';back.className='back-link';back.onclick=()=>$('admin-users').onclick();parent.append(back);}
function openContactForm(id){
 adminForm('אישור איש קשר למשתמש שנבחר',[['name','שם איש קשר'],['email','כתובת מייל','email']],async data=>{await api('admin/users/'+id+'/contacts','POST',data,true);await openUser(id,'contacts');});
 button('ביטול וחזרה לתיק המשתמש',()=>openUser(id,'contacts'),$('admin-pane'));
}
function mailStatus(value){return ({review:'ממתינה לאישור תוכן ונמען',approved:'מאושרת לשליחה',sending:'בתהליך שליחה',accepted_by_mail_server:'התקבלה אצל שרת המייל — הגעה לתיבה טרם אומתה',delivery_unknown:'מצב השליחה אינו ודאי — יש לבדוק לפני ניסיון נוסף',received:'הודעה שהתקבלה',accepted_by_fax_provider:'הפקס התקבל אצל הספק — המסירה טרם אושרה',fax_delivered:'ספק הפקס אישר מסירה',fax_failed:'שידור הפקס נכשל — אין שליחה חוזרת אוטומטית'})[value]||value;}
function composeAdminMail(userId,contacts){
 const p=$('admin-pane');clearCredentials();p.replaceChildren(node('h2','כתיבת הודעה מתוך תיק המשתמש'));
 const available=contacts.filter(c=>c.active&&c.approved);
 if(!available.length){p.append(node('p','יש להוסיף איש קשר מאושר בתיק המשתמש לפני כתיבת הודעה.'));button('חזרה לאנשי קשר',()=>openUser(userId,'contacts'),p);return;}
 const label=node('label','איש קשר מאושר'),select=node('select');for(const c of available){const option=node('option',c.name+' — '+c.email);option.value=c.id;select.append(option);}label.append(select);p.append(label);
 const text=input('תוכן ההודעה','textarea',p);
 button('בדיקה לפני שליחה',async()=>{const c=available.find(c=>c.id===select.value);if(!c)throw Error('יש לבחור איש קשר.');const r=await api('admin/users/'+userId+'/messages','POST',{contactId:c.id,text:text.value},true);reviewAdminMail(userId,r.item,c);},p);
 button('חזרה לתיק המשתמש',()=>openUser(userId,'messages'),p);
}
function reviewAdminMail(userId,item,contact){
 const p=$('admin-pane');p.replaceChildren(node('h2','אישור הודעה לפני שליחה'),node('p','נמען: '+contact.name));const address=node('p',contact.email);address.dir='ltr';p.append(address,node('pre',item.text),node('p',mailStatus(item.status)));
 if(item.status==='review')button('אישור התוכן והנמען',async()=>{const r=await api('admin/users/'+userId+'/messages/'+item.id+'/approve','POST',{accept:true,revision:item.revision},true);reviewAdminMail(userId,r.item,contact);},p);
 if(item.status==='approved')button('שליחת המייל',async()=>{const r=await api('admin/users/'+userId+'/messages/'+item.id+'/send','POST',{revision:item.revision},true);reviewAdminMail(userId,r.item,contact);},p);
 button('חזרה להודעות המשתמש',()=>openUser(userId,'messages'),p);
}
async function openUser(id,tab='profile'){
 const r=await api('admin/users/'+id,'GET',undefined,true);selectedUserId=id;enterArea('management');const p=$('admin-pane');p.replaceChildren();backToUsers(p);
 p.append(node('h1',r.user.name),node('p',r.user.prison+' · '+(r.user.active===false?'מושעה':'פעיל')));
 const tabs=node('nav');tabs.className='profile-tabs';tabs.setAttribute('aria-label','תיק משתמש');const content=node('div');content.className='profile-content';
 const labels=[['profile','פרטים'],['drafts','עתירות'],['messages','הודעות'],['deliveries','משלוחים'],...(adminRole==='owner'?[['faxes','פקסים שהתקבלו']]:[]),['conversations','שיחות'],['contacts','אנשי קשר'],['tickets','פניות']];
 const render=key=>{
  clearCredentials();content.replaceChildren();for(const b of tabs.children)b.setAttribute('aria-current',b.datasetTab===key?'page':'false');
  if(key==='profile'){
   for(const [label,value] of [['שם',r.user.name],['מספר זהות',r.user.identity],['מספר אסיר',r.user.prisonerNumber],['בית סוהר',r.user.prison],['אגף',r.user.wing]]){const row=node('p');row.append(node('strong',label+': '),node('span',value||'לא צוין'));content.append(row);}
   button(r.user.active===false?'ביטול חסימת משתמש':'חסימת משתמש',async()=>{const active=r.user.active===false;if(!window.confirm((active?'לבטל את החסימה של ':'לחסום את ')+r.user.name+'? '+(active?'תתאפשר כניסה מחדש.':'החיבורים הקיימים יבוטלו. הנתונים יישמרו.')))return;await api('admin/users/'+id+'/status','POST',{active},true);await openUser(id);},content);
   button('קוד משתמש למסירה',async()=>{const result=await api('admin/users/'+id+'/code','GET',undefined,true);showCredentials(r.user.name,{code:result.code});button('חזרה לתיק המשתמש',()=>openUser(id),$('admin-pane'));},content);
   button('איפוס PIN',async()=>{if(!window.confirm('לאפס את ה-PIN של '+r.user.name+'? הקוד הקודם לא יעבוד והחיבורים הקיימים יבוטלו.'))return;const result=await api('admin/users/'+id+'/reset','POST',{},true);showCredentials(r.user.name,result.result);button('חזרה לתיק המשתמש',()=>openUser(id),$('admin-pane'));},content);
   if(adminRole==='owner'){const extra=node('details');extra.className='advanced-permissions';extra.append(node('summary','הרשאות פיקוח מיוחדות'),node('p','פיקוח מאפשר גישה למידע של משתמשים אחרים וכולל מינוי ללא חיוב. אינו הרשאת ניהול באפליקציה.'));if(r.user.oversight)extra.append(node('p','פיקוח טלפוני כבר מופעל.'));else button('הענקת פיקוח טלפוני',async()=>{if(!window.confirm('להעניק ל-'+r.user.name+' גישה לשיחות, מסמכים וחשבונות של אחרים?'))return;await api('admin/oversight','POST',{userId:id},true);await openUser(id);},extra);content.append(extra);}
   return;
  }
  const items=r[key]||[];if(!items.length)content.append(node('p','אין פריטים בתיק זה.'));
  for(const item of items){const card=node('section');card.className='profile-record';card.append(node('h3',key==='messages'?(item.direction==='incoming'?'תשובה מהמשפחה':'הודעה למשפחה'):(item.name||item.answers?.subject||item.status||'פריט')));if(key==='faxes'){card.append(node('p','פקס שהתקבל · '+item.pages+' עמודים'));button('הורדת המסמך המקורי',()=>downloadIncomingFax(item),card);}else if(key==='deliveries'){card.append(node('p',mailStatus(item.status)),node('p','אישור מסירת פקס אינו אישור קליטת מסמך בבית המשפט.'));if(item.channel==='fax'&&item.receipt?.provider==='interfax'&&item.receipt.providerId)button('בדיקת מצב הפקס',async()=>{await api('admin/users/'+id+'/deliveries/'+item.id+'/refresh','POST',{},true);await openUser(id,'deliveries');},card);}else if(key==='drafts')button('פתיחת העתירה',()=>showAdminDocuments(item.id,id),card);else if(key==='contacts'){const address=node('p',item.email);address.dir='ltr';card.append(address,node('p',item.approved&&item.active?'מאושר ופעיל':'לא פעיל'));}else card.append(node('pre',key==='conversations'?(item.messages||[]).map(m=>m.text).join('\n'):item.text||''));if(key==='messages'){card.append(node('p',mailStatus(item.status)));const c=(r.contacts||[]).find(c=>c.id===item.contactId);if(c)card.append(node('p',(item.direction==='incoming'?'מאת: ':'אל: ')+c.name));if(item.createdAt)card.append(node('p',new Date(item.createdAt).toLocaleString('he-IL')));if(c&&item.direction==='outgoing'&&['review','approved'].includes(item.status))button('פתיחת הודעה לבדיקה',()=>reviewAdminMail(id,item,c),card);}content.append(card);}
  if(key==='messages'&&adminRole==='owner')button('כתיבת הודעה',()=>composeAdminMail(id,r.contacts||[]),content);
  if(key==='contacts')button('הוספת איש קשר ואישורו',()=>openContactForm(id),content);
 };
 for(const [key,label] of labels){if(key!=='profile'&&!Object.hasOwn(r,key))continue;const b=node('button',label);b.type='button';b.datasetTab=key;b.onclick=()=>render(key);tabs.append(b);}
 p.append(tabs,content);render(tab);reveal(p);
}
async function downloadIncomingFax(item){
 const blob=await api('admin/fax-inbox/'+item.id+'/file','GET',undefined,true,true),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='received-fax.'+(item.mime==='application/pdf'?'pdf':'tiff');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function showFaxInbox(){
 const [result,users]=await Promise.all([api('admin/fax-inbox','GET',undefined,true),api('admin/users','GET',undefined,true)]);
 const p=$('admin-pane');p.replaceChildren();p.append(node('h2','פקסים שהתקבלו'),node('p','בדקו את המסמך המקורי ובחרו את המשתמש שאליו הוא שייך.'));
 button('בדיקת פקסים נכנסים',async()=>{await api('admin/fax-inbox','POST',{},true);await showFaxInbox();},p);
 if(result.error)p.append(node('p','בדיקת הפקס האחרונה לא הושלמה. המסמכים שנקלטו נשמרו.'));
 if(!result.configured)p.append(node('p','פרטי חשבון הפקס טרם הוגדרו בשרת.'));
 if(result.scan?.olderPending)p.append(node('p','נותרו פקסים ישנים לסריקה. הבדיקה הבאה תמשיך מהם.'));
 if(!result.items.length)p.append(node('p','עדיין לא נקלטו פקסים.'));
 for(const item of result.items){
  const card=node('section');card.className='profile-record';card.append(node('h3',item.userId?'פקס משויך':'פקס ממתין לשיוך'),node('p','שולח כפי שדווח: '+(item.sender||'לא צוין')+' · עמודים: '+item.pages));
  button('הורדת המסמך המקורי',()=>downloadIncomingFax(item),card);
  const select=document.createElement('select');select.setAttribute('aria-label','המשתמש שאליו שייך הפקס');const blank=node('option','בחירת משתמש');blank.value='';select.append(blank);
  for(const user of users.items){const option=node('option',user.name+' · '+user.prison+' · '+(user.prisonerNumber||''));option.value=user.id;select.append(option);}select.value=item.userId||'';card.append(select);
  button('אישור שיוך לתיק',async()=>{if(!select.value)throw Error('יש לבחור משתמש.');const user=users.items.find(u=>u.id===select.value);if(!window.confirm('לשייך את הפקס לתיק של '+user.name+' לאחר בדיקת המסמך?'))return;await api('admin/fax-inbox/'+item.id+'/assign','POST',{userId:select.value,revision:item.revision},true);await showFaxInbox();},card);
  p.append(card);
 }
 reveal(p);
}
$('admin-status').onclick=()=>run(async()=>{
 const r=await api('admin/status','GET',undefined,true),p=$('admin-pane');
 p.replaceChildren(node('h2','חיבורים ומוכנות'),node('p','בדיקת הגדרות בלבד — אינה בדיקת שיחה או משלוח חי. תשלום על מנוי AI אינו מגדיר אוטומטית מפתח API בשרת.'));
 if(adminRole==='owner')button('פקסים שהתקבלו',()=>showFaxInbox(),p);
 const rows=[['AI וניסוח',r.aiConfigured,'הגדרת מפתח API בשרת ובדיקת תשובה בעברית'],['מייל יוצא',r.emailConfigured,'שליחת הודעת בדיקה ואימות הגעתה'],['קו טלפוני',r.voiceConfigured,'הגדרת ספק וכתובת callback וביצוע שיחה אמיתית'],['פקס',r.faxConfigured,'חיבור מתאם ספק ואימות משלוח'],['תשלום',r.paymentConfigured,'חיבור ספק ואימות תהליך חיוב בהסכמה']];
 for(const [title,configured,next] of rows){const box=node('section');box.className='connection-card';box.append(node('h3',title),node('p',configured?'הגדרות קיימות · טרם אומת כאן בבדיקה חיה':'לא מוגדר'),node('p',next));p.append(box);}
 if(adminRole==='owner'){
  const health=node('section');p.append(health);
  button('בדיקת ניתוקים אחרונים',async()=>{
   const result=await api('admin/voice-health','GET',undefined,true);health.replaceChildren(node('h3','שיחות שהסתיימו'));
   if(!result.recent.length)health.append(node('p','עדיין אין נתוני אבחון מהגשר המעודכן.'));
   const reasons={'remote-disconnect':'ניתוק שהתקבל מהקו','duration-limit':'הגעה למגבלת הזמן ביישום','workflow-hangup':'סיום לפי התפריט','loop-limit':'סיום מחזורי התפריט','no-next-instruction':'חסרה הוראת המשך',error:'שגיאה'};
   const stages={answer:'מענה',workflow:'תפריט','speech-generate':'יצירת קול','speech-convert':'המרת קול','speech-play':'השמעה','collect-digits':'הקלדת ספרות',record:'הקלטה','record-upload':'העברת הקלטה'};
   for(const item of result.recent){const duration=Number.isInteger(item.durationSeconds)?Math.floor(item.durationSeconds/60)+' דקות ו־'+item.durationSeconds%60+' שניות':'משך לא ידוע';health.append(node('p',duration+' · '+(reasons[item.reason]||'סיבה לא ידועה')+' · '+(stages[item.stage]||'שלב לא ידוע')));if(Number.isInteger(item.processingMs))health.append(node('p','עיבוד התשובה האחרונה: '+(item.processingMs/1000).toFixed(1)+' שניות.'));if(Number.isInteger(item.maxSpeechMs))health.append(node('p','המתנה מרבית ליצירת קטע קול: '+(item.maxSpeechMs/1000).toFixed(1)+' שניות.'));if(item.speechRecoveries>0)health.append(node('p','חזרות לתפריט בעקבות תקלת הקראה: '+item.speechRecoveries));health.append(node('p','קודי ספק: '+[item.generalCause,item.gcCause,item.dropError].map(x=>Number.isInteger(x)?x:'לא זמין').join(' / ')));if(item.scheduledDropSeconds>=0)health.append(node('p','טיימר ניתוק שהספק דיווח בתחילת השיחה: '+item.scheduledDropSeconds+' שניות.'));}
   health.append(node('p','הנתונים מסייעים לבירור; ניתוק מהקו לבדו אינו קובע מי יזם אותו.'));
  },p);
 }
 reveal(p);
});
$('admin-destinations').onclick=()=>adminForm('יעד מאומת',[['name','שם בית משפט'],['prisons','בתי סוהר מתאימים, מופרדים בפסיק'],['email','מייל'],['fax','פקס'],['verifiedSource','מקור האימות']],data=>api('admin/destinations','POST',{...data,prisons:data.prisons.split(',').map(x=>x.trim())},true));
$('admin-contacts').onclick=()=>{if(!selectedUserId){$('status').textContent='פתחו משתמש כדי לנהל את אנשי הקשר שלו.';return;}return openContactForm(selectedUserId);};
$('admin-announcement').onclick=()=>adminForm('הודעת חברה',[['text','הודעה','textarea']],data=>api('admin/announcements','POST',data,true));
$('admin-tickets').onclick=()=>run(async()=>{const r=await api('admin/tickets','GET',undefined,true);$('admin-pane').replaceChildren(...(r.items.length?r.items.map(t=>node('p',t.text+' · '+t.status)):[node('p','אין פניות שמורות.')]));reveal($('admin-pane'));});
window.addEventListener('beforeunload',()=>{clearCredentials();if(recorder?.state==='recording'){recorder.onstop=null;recorder.stop();}stream?.getTracks().forEach(t=>t.stop());window.speechSynthesis?.cancel();});

$('staff-login-form').onsubmit=e=>{e.preventDefault();return run(async()=>{const r=await api('staff-login','POST',{id:$('staff-username').value.trim(),password:$('staff-password').value});if(!r.token||!['owner','support','billing'].includes(r.role))throw Error('לא התקבלה הרשאת ניהול תקינה.');adminSession=r.token;$('staff-password').value='';$('admin-token').value='';unlockManagement(r.role);$('status').textContent='הכניסה לניהול הצליחה.';managementHome();reveal($('admin'));});};
$('admin-logout').onclick=()=>run(async()=>{try{if(adminSession)await api('admin/logout','POST',{},true);}finally{lockManagement();$('status').textContent='יצאתם מהניהול.';}});
$('owner-setup-form').onsubmit=e=>{e.preventDefault();return run(async()=>{
  const p=$('owner-result');p.replaceChildren();
  if(!$('admin-token').value.trim())throw Error('יש להדביק את קוד הניהול לפני יצירת החשבון.');
  const username=$('owner-username').value.trim(),name=$('owner-name').value.trim();
  if(!/^[A-Za-z][A-Za-z0-9_.-]{2,39}$/.test(username)||!name)throw Error('מלאו שם משתמש באנגלית (3–40 תווים) ושם להצגה.');
  $('admin-token').value=$('admin-token').value.trim();
  const r=await api('admin/owner-profile','POST',{username,name},true);
  p.replaceChildren(node('h3','החשבון נוצר — שמרו את פרטי הכניסה באופן פרטי'),node('p','שם משתמש: '+r.result.id),node('p','סיסמה: '+r.result.password),node('p','הכניסה לניהול דורשת שם משתמש וסיסמה. שמרו אותם באופן פרטי ואל תשתפו צילום של הפרטים.'));
  $('staff-username').value=r.result.id;$('admin-token').value='';reveal(p);
});};

function canManage(id){
 if(!adminSession)return false;
 if(adminRole==='owner')return true;
 if(['suite-home','suite-management','admin-status'].includes(id))return ['support','billing'].includes(adminRole);
 return adminRole==='support'&&['admin-users','admin-contacts','admin-tickets'].includes(id);
}
for(const id of ['admin-users','admin-status','admin-destinations','admin-contacts','admin-announcement','admin-tickets','suite-home','suite-line','suite-chats','suite-documents','suite-family','suite-management']){
 const handler=$(id).onclick;$(id).onclick=()=>{
  if(!adminSession){lockManagement();$('status').textContent='יש להיכנס לניהול.';return;}
  if(!canManage(id)){$('status').textContent='אין הרשאה לתפקיד זה.';return;}
  stopLiveVoice();clearCredentials();if(id!=='suite-home'){enterArea(id==='suite-line'?'line':(['suite-chats','suite-documents','admin-status'].includes(id)&&currentArea==='line'?'line':'management'));}return handler();
 };
}
lockManagement();
window.mirkamAppReady=true;
window.addEventListener('error',()=>{const s=$('status');s.textContent='אירעה תקלה בממשק. בדקו את גרסת הממשק בעדכוני התוכנה ודווחו איזו פעולה נכשלה.';reveal(s);});

document.addEventListener?.('visibilitychange',()=>{if(document.hidden)clearCredentials();});
