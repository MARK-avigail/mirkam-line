import { createHmac,timingSafeEqual,createHash,randomUUID } from 'node:crypto';
import { BRANCHES,TOPICS } from './workflow.js';
import { transcribeTwilio } from '../ivr/stt.js';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const say=s=>`<Say language="he-IL" voice="${escape(process.env.TWILIO_TTS_VOICE||'Google.he-IL-Standard-A')}">${escape(s)}</Say>`;
const redirect=()=>'<Redirect method="POST">/voice/step</Redirect>';
const gatherXml=(text,digits=1)=>`<Gather numDigits="${digits}" finishOnKey="#" action="/voice/step" method="POST" timeout="${digits===6?30:12}">${say(text)}</Gather>${redirect()}`;
export function validVoiceSignature(url,body,signature,secret){if(!secret||typeof signature!=='string')return false;const text=url+Object.keys(body).sort().map(k=>k+body[k]).join(''),expected=createHmac('sha1',secret).update(text).digest('base64');const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b);}
export function createVoice(service,transport={}){
  const transcribe=transport.transcribe||transcribeTwilio;
  const retain=transport.retain||((user,providerId)=>service.recordAudio(user,{providerId}));
  const track=transport.track||((user,providerId)=>service.trackTransientAudio(user,providerId));
  const dispose=transport.dispose||((user,providerId,id)=>service.disposeTransientAudio(user,providerId,id));
  const jobs=new Map();
  const store=service.store;
  const reviewHash=(id,user)=>createHash('sha256').update(JSON.stringify([service.package(id,user),service.draft(id,user).attachments])).digest('hex');
  function save(c){return store.put('call',c);}
  function job(c,kind,task){
    const j=store.create('voice-job',c.owner,{callId:c.id,kind,status:'processing',previous:c.phase});
    c=save({...c,phase:'processing',jobId:j.id});
    const work=Promise.resolve().then(task).then(result=>store.atomic(()=>{
      const current=store.get('call',c.id);if(current?.jobId!==j.id)return;
      store.put('call',{...current,...result,jobId:null});
      store.put('voice-job',{...j,status:'done'});
    })).catch(()=>store.atomic(()=>{
      const current=store.get('call',c.id);
      if(current?.jobId===j.id)store.put('call',{...current,phase:j.previous,jobId:null,error:'העיבוד לא הושלם. התשובות שאושרו נשמרו. יש לבדוק מצב משלוח לפני ניסיון נוסף.'});
      store.put('voice-job',{...j,status:'failed'});
    })).catch(()=>{
      // Persistence may also fail while recording an error. Never let this
      // detached task reject and terminate unrelated requests or calls.
      console.error('Voice job persistence failed; recovery required.');
    }).finally(()=>jobs.delete(j.id));
    jobs.set(j.id,work);return c;
  }
  return async function voice(req,res){
    let encoded='';for await(const chunk of req){encoded+=chunk;if(encoded.length>32768){res.writeHead(413);return res.end();}}
    const data=Object.fromEntries(new URLSearchParams(encoded));
    const base=String(process.env.BASE_URL||'').replace(/\/$/,'');
    if(transport.authorize?!transport.authorize(req,data):(!base.startsWith('https://')||!validVoiceSignature(base+req.url,data,req.headers['x-twilio-signature'],process.env.TWILIO_AUTH_TOKEN))){res.writeHead(403);return res.end();}
    if(!(transport.callPattern||/^CA[a-f0-9]{32}$/i).test(data.CallSid||'')){res.writeHead(400);return res.end();}
    let c=store.get('call',data.CallSid),out='';
    const nonce=new URL(req.url,'http://localhost').searchParams;
    const gather=(text,digits=1)=>{c={...c,inputNonce:randomUUID()};return gatherXml(text,digits).replace('<Gather ',['family-review','delivery-confirm','oversight-confirm'].includes(c.phase)?'<Gather clearDigits="true" ':'<Gather ').replace('action="/voice/step"',`action="/voice/step?input=${c.inputNonce}"`);};
    const record=(text,maxLength=180)=>{c={...c,recordNonce:randomUUID()};return say(text)+`<Record action="/voice/step?record=${c.recordNonce}" method="POST" maxLength="${maxLength}" timeout="5" finishOnKey="#" playBeep="true"/>${redirect()}`;};
    try{
      if(!c)c=store.create('call','voice',{id:data.CallSid,phase:'login-code',silence:0});
      let digit=data.Digits||'';
      if(digit&&(!c.inputNonce||nonce.get('input')!==c.inputNonce)){out=say('הבחירה אינה שייכת לשאלה הפעילה. נחזור לשאלה.')+redirect();res.writeHead(200,{'Content-Type':'text/xml; charset=utf-8'});return res.end('<Response>'+out+'</Response>');}
      if(data.RecordingUrl&&(!c.recordNonce||nonce.get('record')!==c.recordNonce)){out=say('ההקלטה אינה שייכת לשאלה הפעילה. העבודה נשמרה.')+redirect();res.writeHead(200,{'Content-Type':'text/xml; charset=utf-8'});return res.end('<Response>'+out+'</Response>');}
      if(digit)c=save({...c,inputNonce:null});if(data.RecordingUrl)c=save({...c,recordNonce:null});
      if(!digit&&!data.RecordingUrl&&c.phase!=='processing')c.silence++;
      else if(digit||data.RecordingUrl)c.silence=0;
      if(c.silence>5){out=say(c.phase.startsWith('login-')?'לא התקבלה הקשה במשך כמה ניסיונות. נסיים עכשיו, ואפשר להתקשר שוב כשהקודים מוכנים.':'לא התקבל קלט. העבודה שאושרה נשמרה. להתראות.')+'<Hangup/>';}
      else if(c.phase==='login-code'){
        if(/^\d{6}$/.test(digit)){c=save({...c,code:digit,phase:'login-pin'});out=gather('עכשיו הקישו את הקוד האישי, שש ספרות.',6);}
        else out=gather(c.silence>1||digit?'ננסה שוב בנחת. הקישו את קוד המשתמש, שש ספרות.':'שלום, כאן מרקם ליין, עם עוזר בינה מלאכותית. טוב שאתם כאן. הקישו קוד משתמש, שש ספרות.',6);
      }else if(c.phase==='login-pin'){
        if(/^\d{6}$/.test(digit)){try{const login=service.identity.login(c.code,digit,'voice:'+data.CallSid);c=save({...c,token:login.token,userId:login.user.id,phase:'main',speech:`שלום ${login.user.name.split(/\s+/)[0]}, מה שלומך? אני כאן לעזור. תמלולים והקלטות מילוי נשמרים להמשך העבודה. הקודים אינם מוקלטים.`});out=redirect();}catch{c=save({...c,attempts:(c.attempts||0)+1});out=say('הקוד לא זוהה.')+(c.attempts>=3?'<Hangup/>':gather('הקישו את הקוד האישי.',6));}}
        else out=gather('לא התקבל קוד מלא. זה בסדר, אפשר לנסות שוב בנחת. הקישו את כל שש הספרות של הקוד האישי. יש לכם שלושים שניות.',6);
      }else{
        let user;try{user=service.identity.authenticate(c.token).user;}catch{c=save({...c,token:null,phase:'login-code',code:null});res.writeHead(200,{'Content-Type':'text/xml; charset=utf-8'});return res.end('<Response>'+say('הכניסה הסתיימה או שהחשבון אינו זמין. יש להתקשר מחדש או לפנות למשרד.')+'<Hangup/></Response>');}const uid=user.id,token=c.token,validate=()=>service.identity.authenticate(token);
        if(['delivery-channel','delivery-confirm'].includes(c.phase)&&(c.reviewCompleted!==true||c.reviewHash!==reviewHash(c.draftId,uid))){c=save({...c,phase:'draft',reviewHash:null,reviewCompleted:false,reviewIndex:0});digit='';}
        if(c.phase==='processing'){out=say('הבקשה בעיבוד.')+'<Pause length="2"/>'+redirect();}
        else if(digit==='7'){c=save({...c,phase:'main',draftId:null});out=say('העבודה שאושרה נשמרה. להתראות.')+'<Hangup/>';}
        else if(digit==='*'){out=gather('לשמירה ויציאה הקישו 7. לחזרה לתפריט הראשי 8. לעזרה 9. לדילוג על פרט רשות 0. בזמן הקלטה סולמית מסיימת את ההקלטה.');}
        else if(digit==='8'){c=save({...c,phase:'main'});out=redirect();}
        else if(c.phase==='main'){
          const completion=c.speech;c={...c,speech:null};
          if(digit==='6'&&user.oversight){c=save({...c,phase:'oversight'});out=redirect();}else {const b=BRANCHES.find(b=>b.digit===digit);if(b){c=save({...c,phase:'branch',branch:b.digit});out=redirect();}else out=gather(BRANCHES.map(b=>`${b.title}, הקישו ${b.digit}`).join('. ')+(user.oversight?'. לפיקוח הקישו 6.':''));}
          if(completion)out=out.includes('<Gather')?out.replace(/(<Say[^>]*>)/,match=>match+escape(completion)+' '):say(completion)+out;
        }else if(c.phase==='oversight'){
          service.oversight.require(uid);
          if(digit==='1'){const s=service.oversight.summary(uid);out=say(`חשבונות: ${s.accounts}. פעילים: ${s.active}. פניות: ${s.tickets}. בקשות בינה מלאכותית: ${s.aiRequests}. תשלומים מאומתים: ${s.paymentsAgorot/100} שקלים. עלות ספקי השירות בפועל עדיין אינה מסונכרנת. הגדרות בינה מלאכותית: ${s.aiConfigured?'קיימות':'חסרות'}. הגדרות מייל: ${s.emailConfigured?'קיימות':'חסרות'}.`)+gather('לחזרה לתפריט הראשי 8.');}
          else if(['2','3','4','5'].includes(digit)){c=save({...c,phase:'oversight-user',oversightAction:digit});out=gather('הקישו קוד משתמש בן שש ספרות.',6);}
          else out=gather('מצב שירות, שימוש ותשלומים 1. שיחות משתמש 2. מסמכי משתמש 3. חסימת משתמש 4. הסרת חסימה 5.');
        }else if(c.phase==='oversight-user'){
          service.oversight.require(uid);
          if(!/^\d{6}$/.test(digit))out=gather('הקישו קוד משתמש בן שש ספרות.',6);
          else {const target=service.oversight.target(uid,digit);c=save({...c,oversightCode:digit,phase:['4','5'].includes(c.oversightAction)?'oversight-confirm':'oversight-read',oversightPage:0});out=say('חשבון '+target.name)+redirect();}
        }else if(c.phase==='oversight-confirm'){
          const target=service.oversight.target(uid,c.oversightCode);
          if(digit==='1'&&c.oversightPresented===target.id){service.oversight.suspend(uid,c.oversightCode,c.oversightAction==='5');c=save({...c,phase:'oversight',oversightPresented:null});out=say('מצב החשבון עודכן.')+redirect();}
          else{c=save({...c,oversightPresented:target.id});out=gather(`${c.oversightAction==='4'?'לחסום':'להפעיל'} את החשבון של ${target.name}? לאישור 1. לביטול וחזרה 8.`);}
        }else if(c.phase==='oversight-read'){
          const items=service.oversight.read(uid,c.oversightCode,c.oversightAction==='2'?'conversation':'draft');
          const text=items.map(x=>c.oversightAction==='2'?x.name+'. '+x.messages.map(m=>(m.role==='user'?'משתמש: ':'עוזר: ')+m.text).join('. '):Object.values(x.answers||{}).join('. ')).join('. מסמך או שיחה נוספים. ')||'אין פריטים שמורים.';
          const parts=text.match(/[\s\S]{1,600}/g)||[];let page=c.oversightPage||0;if(digit==='1')page=Math.min(page+1,parts.length-1);if(digit==='2')page=Math.max(page-1,0);c=save({...c,oversightPage:page});out=say(parts[page])+gather(`קטע ${page+1} מתוך ${parts.length}. לקטע הבא 1. לקודם 2. לחזרה 8.`);
        }else if(c.phase==='branch'){
          const b=BRANCHES.find(b=>b.digit===c.branch);
          if(!digit)out=gather(b.children.map(s=>`${s.title}, הקישו ${s.digit}`).join('. '));
          else if(b.digit==='1'&&['1','2'].includes(digit)){const d=service.createDraft(uid,digit==='1');c=save({...c,draftId:d.id,phase:'draft',courtPage:0,reviewIndex:0,reviewHash:null});out=redirect();}
          else if(b.digit==='2'&&digit==='1'){c=save({...c,phase:'draft-list',listPage:0});out=redirect();}
          else if(b.digit==='2'&&['2','3'].includes(digit)){const items=store.list(digit==='2'?'version':'delivery',uid);out=say(items.length?items.slice(0,8).map((v,i)=>`${i+1}. ${digit==='2'?'גרסת מסמך':v.status}. ${new Date(v.createdAt).toLocaleDateString('he-IL')}`).join('. '):'אין פריטים שמורים.')+gather('לחזרה לתפריט הראשי הקישו 8.');}
          else if(b.digit==='3'){if(digit==='1'){const conv=service.newConversation(uid,'שיחה '+new Date().toLocaleDateString('he-IL'));c=save({...c,conversationId:conv.id,phase:'chat'});out=redirect();}else if(digit==='2'){c=save({...c,phase:'conversation-list',listPage:0});out=redirect();}else out=redirect();}
          else if(b.digit==='4'&&digit==='1'){c=save({...c,phase:'contact-list',listPage:0});out=redirect();}
          else if(b.digit==='4'&&digit==='2'){out=say(store.list('message',uid).filter(m=>m.direction==='incoming').slice(0,8).map(m=>m.text).join('. ')||'אין תשובות חדשות.')+gather('לחזרה הקישו 8.');}
          else if(b.digit==='4'&&digit==='3'){out=say(service.contacts(uid).map(x=>x.name).join('. ')||'אין אנשי קשר מאושרים. אפשר לפנות למשרד.')+gather('לחזרה הקישו 8.');}
          else if(b.digit==='5'&&digit==='1'){out=say(store.list('announcement','all').filter(a=>a.active).map(a=>a.text).join('. ')||'אין הודעות חדשות.')+gather('לחזרה הקישו 8.');}
          else if(b.digit==='5'&&digit==='2'){const m=service.membership(uid);out=say(`מצב המינוי: ${{free:'ללא חיוב',trial:'תקופת ניסיון',paid:'פעיל',expired:'תקופת הניסיון הסתיימה'}[m.status]}. הטיוטות נשמרות בחשבון.`)+gather('לחזרה הקישו 8.');}
          else if(b.digit==='5'&&digit==='3'){c=save({...c,phase:'ticket'});out=redirect();}else out=redirect();
        }else if(['draft-list','conversation-list','contact-list'].includes(c.phase)){
          const items=c.phase==='draft-list'?store.list('draft',uid).filter(d=>!['sending','archived','delivery-unknown'].includes(d.stage)):c.phase==='conversation-list'?store.list('conversation',uid):service.contacts(uid);
          const pages=Math.max(1,Math.ceil(items.length/6));let page=Math.min(c.listPage||0,pages-1);
          if(digit==='0')page=(page+1)%pages;
          c=save({...c,listPage:page});const visible=items.slice(page*6,page*6+6);
          const chosen=/^[1-6]$/.test(digit)?visible[Number(digit)-1]:null;
          if(chosen){c=save({...c,...(c.phase==='draft-list'?{draftId:chosen.id,phase:'draft'}:c.phase==='conversation-list'?{conversationId:chosen.id,phase:'chat'}:{contactId:chosen.id,phase:'family-compose'})});out=redirect();}
          else out=items.length?gather(visible.map((x,i)=>`${x.name||x.answers?.subject||'טיוטה שמורה'}, הקישו ${i+1}`).join('. ')+(pages>1?`. עמוד ${page+1} מתוך ${pages}. לרשימה הבאה הקישו 0.`:'')+' לחזרה 8. לשמירה ויציאה 7.'):say('אין פריטים שמורים.')+gather('לחזרה הקישו 8.');
        }else if(c.phase==='draft'){
          const d=service.viewDraft(c.draftId,uid);
          if(d.stage==='profile'){if(digit==='1'){service.confirmProfile(d.id,uid,d.revision);out=redirect();}else out=gather(`שם: ${user.name}. מספר זהות: ${user.identity.split('').join(' ')}. מספר אסיר: ${user.prisonerNumber}. בית סוהר: ${user.prison}. לאישור הפרטים הקישו 1. לתיקון דרך המשרד הקישו 8.`);}
          else if(d.stage==='court'){
            const targets=service.destinations().filter(t=>t.prisons.includes(user.prison)),pages=Math.max(1,Math.ceil(targets.length/6));
            let page=Math.min(c.courtPage||0,pages-1);if(digit==='0')page=(page+1)%pages;
            c=save({...c,courtPage:page});const visible=targets.slice(page*6,page*6+6),target=/^[1-6]$/.test(digit)?visible[Number(digit)-1]:null;
            if(target){service.chooseCourt(d.id,uid,target.id,d.revision);out=redirect();}
            else out=targets.length?gather(visible.map((t,i)=>`${t.name}, הקישו ${i+1}`).join('. ')+(pages>1?`. עמוד ${page+1} מתוך ${pages}. לרשימה הבאה 0.`:'')+' לחזרה 8. לשמירה ויציאה 7.'):say('התאמת בית המשפט עדיין לא אומתה במשרד. הטיוטה נשמרה.')+gather('לחזרה הקישו 8.');
          }
          else if(d.stage==='dialogue'){
            if(digit==='0'){service.skip(d.id,uid,d.revision);out=redirect();}
            else if(digit==='9'){c=job(c,'coach',async()=>{const result=await service.coach(d.id,uid,'',validate);return {phase:'draft',speech:result.helper};});out=redirect();}
            else if(data.RecordingUrl){const recordingId=data.RecordingSid||data.RecordingUrl;if(c.lastRecording===recordingId)out=redirect();else{c=save({...c,lastRecording:recordingId});c=job(c,'transcribe',async()=>{retain(uid,recordingId);service.reserveAI(uid);const text=await transcribe(data.RecordingUrl);validate();await service.answerWithCoach(d.id,uid,text,d.revision,validate);return {phase:'draft'};});out=redirect();}}
            else {c={...c,inputNonce:randomUUID(),recordNonce:randomUUID()};out=`<Gather numDigits="1" action="/voice/step?input=${c.inputNonce}" timeout="4">${say((c.speech||'')+d.question+' לעזרה 9, לדילוג על שדה רשות 0, לשמירה ויציאה 7. להקלטה המתינו לצליל. סולמית מסיימת.')}</Gather><Record action="/voice/step?record=${c.recordNonce}" method="POST" maxLength="180" timeout="5" finishOnKey="#" playBeep="true"/>${redirect()}`;}
          }else if(d.stage==='answer-review'){
            if(['1','2'].includes(digit)){service.confirmAnswer(d.id,uid,digit==='1',d.revision);out=redirect();}
            else if(digit==='4'){c=job(c,'coach',async()=>{const result=await service.coach(d.id,uid,'',validate);return {phase:'draft',speech:result.helper};});out=redirect();}
            else if(digit==='6'){service.restore(d.id,uid,d.revision);out=redirect();}
            else if(digit==='5'){c=save({...c,phase:'draft-clarify'});out=record('אמרו את ההשלמה. סיימו בסולמית.',120);}
            else out=gather(`${d.helper||''} שמעתי: ${d.pending.text}. לאישור 1, להקלטה מחדש 2, לשמוע שוב 3, להצעת ניסוח 4, להוספת פרט 5, לחזרה למקור 6.`);
          }else if(d.stage==='review'){
            const currentReviewHash=reviewHash(d.id,uid);
            if(c.reviewHash!==currentReviewHash)c=save({...c,reviewHash:currentReviewHash,reviewCompleted:false,reviewIndex:0,presentedReview:null});
            const text=service.package(d.id,uid).map(x=>x.text).join('\n'),parts=text.match(/[\s\S]{1,700}/g)||[''],index=Math.min(c.reviewIndex||0,parts.length-1);
            if(digit==='1'&&c.presentedReview===index){c=save({...c,reviewIndex:index+1,presentedReview:null});if(index===parts.length-1){c=save({...c,phase:'delivery-channel',reviewCompleted:true});}out=redirect();}
            else{c=save({...c,presentedReview:index});out=gather(parts[index]+(index===parts.length-1?' הסתיימה ההקראה. לאישור החבילה ובחירת ערוץ הקישו 1.':' להמשך הקישו 1.')+' לחזרה על הקטע הקישו 3.');}
          }else out=say('המסמך שמור. מצב המשלוח ייבדק במשרד.')+gather('לחזרה הקישו 8.');
        }else if(c.phase==='draft-clarify'){
          if(data.RecordingUrl){const d=service.draft(c.draftId,uid);c=job(c,'clarify',async()=>{retain(uid,data.RecordingSid||data.RecordingUrl);service.reserveAI(uid);const text=await transcribe(data.RecordingUrl);validate();await service.clarify(d.id,uid,text,d.revision,validate);return {phase:'draft'};});out=redirect();}
          else{c=save({...c,phase:'draft'});out=redirect();}
        }else if(c.phase==='delivery-channel'){
          const channel={1:'email',2:'fax',3:'both'}[digit];if(channel){const d=service.draft(c.draftId,uid),offered=service.offer(d.id,uid,d.court.id,channel,d.revision);c=save({...c,phase:'delivery-confirm',nonce:offered.approval.nonce});out=redirect();}else out=gather('לשליחה במייל הקישו 1. בפקס 2. בשניהם 3.');
        }else if(c.phase==='delivery-confirm'){
          const d=service.draft(c.draftId,uid),target=service.destination(d.approval.targetId);
          if(digit==='1'&&c.deliveryPresented===c.nonce){const approved=service.approve(d.id,uid,c.nonce,true,d.revision);c=job(c,'delivery',async()=>{const result=await service.send(d.id,uid,approved.revision);return {phase:'main',speech:'מצב המשלוח: '+result.status};});out=redirect();}
          else{c=save({...c,deliveryPresented:c.nonce});out=gather(`החבילה תישלח אל ${target.name}. ערוץ: ${d.approval.channel}. מייל ${target.email.split('').join(' ')}. פקס ${target.fax}. לאישור ושליחה הקישו 1. לחזרה בלי שליחה 8.`);}
        }else if(['chat','family-compose','ticket'].includes(c.phase)){
          if(data.RecordingUrl){const phase=c.phase;c=job(c,'transcribe',async()=>{const providerId=data.RecordingSid||data.RecordingUrl,audio=track(uid,providerId);let text;try{service.reserveAI(uid);text=await transcribe(data.RecordingUrl);}finally{await dispose(uid,providerId,audio.id);}validate();
            if(phase==='chat'){const conv=store.owned('conversation',c.conversationId,uid),r=await service.chat(conv.id,uid,text,conv.revision,validate);return {phase:'chat',speech:r.messages.at(-1).text};}
            if(phase==='ticket'){service.ticket(uid,text);return {phase:'main',speech:'הפנייה נשמרה למשרד.'};}
            const message=service.compose(uid,c.contactId,text);return {phase:'family-review',messageId:message.id};});out=redirect();}
          else out=record(c.speech|| (c.phase==='chat'?'אני כאן. מה תרצו לשאול?':c.phase==='ticket'?'ספרו מה תרצו להעביר למשרד.':'מה תרצו לכתוב למשפחה? בסיום הקישו סולמית. נשמיע את הנוסח לבדיקה לפני השליחה.'));
        }else if(c.phase==='family-review'){
          const m=store.owned('message',c.messageId,uid),contact=store.owned('contact',m.contactId,uid);
          if(!['review','approved'].includes(m.status)){out=say(m.status==='accepted_by_mail_server'?'שרת המייל כבר קיבל את ההודעה.':'מצב המשלוח אינו ודאי. יש לבדוק עם המשרד לפני ניסיון נוסף.')+gather('לחזרה לתפריט הראשי הקישו 8.');}
          else if(digit==='1'&&c.messagePresented===m.id){const approved=m.status==='approved'?m:service.approveMessage(m.id,uid,true,m.revision);c=job(c,'family-mail',async()=>{await service.sendMessage(approved.id,uid,approved.revision);return {phase:'main',speech:'שרת המייל קיבל את ההודעה. זו אינה הוכחת קריאה.'};});out=redirect();}
          else if(digit==='2'){c=save({...c,phase:'family-compose',messagePresented:null,speech:null});out=redirect();}
          else{c=save({...c,messagePresented:m.id});out=gather(`זו ההודעה שנקלטה עבור ${contact.name}. בדקו שהמילים מדויקות: ${m.text}. אם הכול נכון, לאישור ושליחה הקישו 1. לתיקון בהקלטה מחדש 2. לשמיעה חוזרת 3. לחזרה בלי לשלוח 8.`);}
        }else{c=save({...c,phase:'main'});out=redirect();}
        if(c.error){out=say(c.error)+out;c=save({...c,error:null});}
      }
    }catch(e){out=say(e.message)+gather('אפשר לחזור לתפריט הראשי בהקשה על 8, או לשמור ולצאת בהקשה על 7.');}
    if(c){try{save(c);}catch{ /* Another event won the revision; do not overwrite it. */ }}
    res.writeHead(200,{'Content-Type':'text/xml; charset=utf-8'});res.end('<Response>'+out+'</Response>');
  };
}
