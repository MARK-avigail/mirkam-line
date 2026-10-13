import express from 'express';
import twilio from 'twilio';
import * as sm from '../state-machine.js';
import { SCHEMA } from '../schema.js';
import { COURTS } from '../courts.js';
import { getSession,saveSession,listSessions } from '../storage.js';
import { sayTo } from './tts.js';
import { transcribeTwilio } from './stt.js';
import { help,assist,deliver,processAnswer } from '../jobs.js';
import { equal,pilot,present } from '../config.js';
const router=express.Router(),VoiceResponse=twilio.twiml.VoiceResponse;
import { validRecipient,identityAnswer,offerPhoneApproval,approvePhoneDelivery } from './phone-guards.js';
import { presentReviewChunk,confirmReviewChunk } from './document-review.js';
export { chunks } from './document-review.js';
const base=()=>String(process.env.BASE_URL||'').replace(/\/$/,'');
const url=(route,s,extra='')=>base()+'/ivr/'+route+'?sid='+s.id+extra;
function send(res,t){res.type('text/xml').send(t.toString());}
function go(t,s,route){t.redirect({method:'POST'},url(route,s));}
function gather(t,s,route,text,opts={}){const g=t.gather({numDigits:1,action:url(route,s),method:'POST',timeout:8,...opts});sayTo(g,text);return g;}
function target(s){return s.stage==='menu'?'menu':s.stage==='court'?'court':s.stage==='field_review'?'confirm':s.stage==='processing'?'processing':['review','approved'].includes(s.stage)?'review':s.stage==='sending'||s.stage.startsWith('delivery_')||s.stage==='submitted'?'delivery-status':'field';}
router.use((req,res,next)=>{
 if(!present('TWILIO_AUTH_TOKEN')||!/^https:\/\//.test(base()))return res.status(503).send('Voice service is not configured');
 if(!twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN,req.get('x-twilio-signature')||'',base()+req.originalUrl,req.body||{}))return res.status(403).send('Invalid signature');
 if(!/^CA[a-f0-9]{32}$/i.test(req.body?.CallSid||''))return res.status(400).send('Invalid call');
 next();
});
function route(name,fn){router.post('/'+name,(req,res)=>{
 const t=new VoiceResponse();let s;
 try {s=getSession(String(req.query.sid||''));if(!s||s.callSid!==req.body.CallSid){s=null;throw new Error('השיחה לא נמצאה.');}if(!s.pinVerified)throw new Error('נדרש קוד ניסיון.');fn(req,t,s);}
 catch(e){sayTo(t,e.message);if(s?.pinVerified)go(t,s,target(s));else t.hangup();}
 send(res,t);
});}
router.post('/voice',(req,res)=>{
 const t=new VoiceResponse();
 if(!pilot()||!present('TEST_EMAIL')||!/^\d{4,10}$/.test(process.env.PILOT_PIN||'')){sayTo(t,'קו הניסיון עדיין לא הוגדר.');t.hangup();return send(res,t);}
 let s=listSessions().find(x=>x.callSid===req.body.CallSid);
 if(!s){s=sm.newSession('phone');s.callSid=req.body.CallSid;sm.setEmail(s,process.env.TEST_EMAIL);saveSession(s);}
 if(s.pinVerified)go(t,s,target(s));else{gather(t,s,'pin','שלום, הגעתם לקו עתירה. הקישו את קוד הניסיון ולאחריו סולמית.',{numDigits:process.env.PILOT_PIN.length});t.hangup();}send(res,t);
});
router.post('/pin',(req,res)=>{
 const t=new VoiceResponse();let s;
 try{s=getSession(String(req.query.sid||''));if(!s||s.callSid!==req.body.CallSid)throw Error();s.pinAttempts=(s.pinAttempts||0)+1;
 if(s.pinAttempts<=3 && equal(req.body.Digits||'',process.env.PILOT_PIN)){s.pinVerified=true;saveSession(s);go(t,s,target(s));}
 else{saveSession(s);sayTo(t,'הקוד לא זוהה.');if(s.pinAttempts<3)go(t,s,'voice');else t.hangup();}}
 catch{sayTo(t,'לא ניתן להמשיך בשיחה.');t.hangup();}send(res,t);
});
const courtPrompt=()=> 'בחרו את בית המשפט המחוזי. '+COURTS.filter(c=>c.group==='מחוזי').map(c=>c.label+', הקישו '+c.code+'.').join(' ');
route('menu',(req,t,s)=>{if(s.stage!=='menu'){go(t,s,target(s));return;}if(req.body.Digits==='2'){sm.pickMenu(s,'2');saveSession(s);go(t,s,'court');return;}gather(t,s,'menu','להכנת עתירה לבית המשפט המחוזי, הקישו 2. קו זה הוא ניסיון ליצירת מסמך לבדיקה.');go(t,s,'no-input');});
route('court',(req,t,s)=>{if(s.stage!=='court'){go(t,s,target(s));return;}const c=COURTS.find(c=>c.group==='מחוזי'&&c.code===req.body.Digits);if(c){s.pendingCourt=c.code;saveSession(s);gather(t,s,'court-confirm','בחרתם '+c.label+'. לאישור הקישו 1. לבחירה אחרת הקישו 2.');go(t,s,'court');return;}gather(t,s,'court',courtPrompt());go(t,s,'no-input');});
route('court-confirm',(req,t,s)=>{if(s.stage==='court'&&s.pendingCourt&&req.body.Digits==='1'){sm.pickCourt(s,s.pendingCourt);delete s.pendingCourt;saveSession(s);}go(t,s,target(s));});
function prompt(f){let p='השאלה הבאה: '+f.label+'. ';if(f.type==='date')p+='אמרו תאריך במספרים, יום חודש ושנה. ';else if(f.type==='digits')p+='אמרו כל אחת מתשע הספרות בנפרד. ';else p+='ספרו במילים שלכם. ';return p+'לעזרה הקישו 9. לחזרה הקישו 8. לשמוע שוב הקישו 0. '+(!f.required?'לדילוג הקישו 5. ':'')+'להקלטה המתינו לצליל. בסיום ההקלטה הקישו סולמית.';}
route('field',(req,t,s)=>{if(s.stage!=='field'){go(t,s,target(s));return;}const f=SCHEMA[s.index];if(!f)throw Error('לא נמצאה שאלה.');if(f.type==='digits'){gather(t,s,'field-key','הקישו את כל תשע ספרות מספר הזהות, כולל אפס בתחילת המספר. לעזרה הקישו 9 וסולמית, לחזרה 8 וסולמית, לשמוע שוב 0 וסולמית. אם תרצו לומר את המספר, המתינו לצליל.',{numDigits:f.length,finishOnKey:'#',timeout:10});}else gather(t,s,'field-key',prompt(f),{timeout:4});t.record({action:url('field-record-done',s),method:'POST',maxLength:f.maxSeconds||90,timeout:5,finishOnKey:'#',playBeep:true,transcribe:false});go(t,s,'field');});
route('field-key',(req,t,s)=>{if(s.stage!=='field'){go(t,s,target(s));return;}const d=req.body.Digits;
 if(SCHEMA[s.index]?.type==='digits' && identityAnswer(d)!==null){sm.submitAnswer(s,d,'dtmf');saveSession(s);go(t,s,'confirm');return;}
 if(d==='9'){help(s);go(t,s,'processing');return;}
 if(d==='8')sm.goBack(s);else if(d==='5')sm.skipField(s);else if(d!=='0')sayTo(t,'לא זיהיתי את הבחירה.');saveSession(s);go(t,s,target(s));});
route('field-record-done',(req,t,s)=>{if(s.stage!=='field'){go(t,s,target(s));return;}if(!Number(req.body.RecordingDuration)){s.silenceCount=(s.silenceCount||0)+1;saveSession(s);sayTo(t,'לא נקלטה תשובה.');if(s.silenceCount>=5)t.hangup();else go(t,s,'field');return;}
 s.silenceCount=0;const f=SCHEMA[s.index];processAnswer(s,'transcribe',async()=>{let text=await transcribeTwilio(req.body.RecordingUrl);if(f.type==='digits')text=text.replace(/[\s-]/g,'');return text;});go(t,s,'processing');});
route('processing',(_req,t,s)=>{if(s.stage==='processing'){t.pause({length:2});go(t,s,'processing');return;}if(s.error){sayTo(t,s.error);s.error='';saveSession(s);}if(s.helperText){sayTo(t,s.helperText);s.helperText='';saveSession(s);}go(t,s,target(s));});
route('confirm',(req,t,s)=>{if(s.stage!=='field_review'){go(t,s,target(s));return;}
 const d=req.body.Digits;if(d==='1'){sm.confirmAnswer(s);delete s.proposedOriginal;s.assistantQuestion='';saveSession(s);go(t,s,target(s));return;}
 if(d==='2'){sm.rejectAnswer(s);delete s.proposedOriginal;s.assistantQuestion='';saveSession(s);go(t,s,'field');return;}
 if(d==='4'){assist(s);go(t,s,'processing');return;}
 if(d==='7'&&s.proposedOriginal){s.pending=s.proposedOriginal;delete s.proposedOriginal;saveSession(s);}
 gather(t,s,'confirm','שמעתי: '+s.pending+'. '+(s.assistantQuestion||'')+' לאישור הקישו 1. להקלטה חדשה הקישו 2. לשמוע שוב הקישו 3. להצעת ניסוח הקישו 4. '+(s.proposedOriginal?'לחזרה למילים המקוריות הקישו 7.':''));go(t,s,'confirm');});
route('review',(req,t,s)=>{if(s.stage!=='review'&&s.stage!=='approved'){go(t,s,target(s));return;}const chunk=presentReviewChunk(s);saveSession(s);
 gather(t,s,'review-confirm',chunk.text+(chunk.last?'. הסתיימה ההקראה. לתיקון שדה הקישו 2. לחזרה על הקטע הקישו 3. לאישור המסמך ולבדיקת כתובת המייל הקישו 1.':'. להמשך הקישו 1. לחזרה על הקטע הקישו 3. לתיקון שדה הקישו 2.'),{action:url('review-confirm',s,'&part='+chunk.index)});go(t,s,'review');});
route('review-confirm',(req,t,s)=>{if(s.stage!=='review'&&s.stage!=='approved'){go(t,s,target(s));return;}
 if(req.body.Digits==='2'){if(s.stage==='approved'){s.stage='review';s.approvedAt=null;saveSession(s);}go(t,s,'edit');}
 else {const complete=confirmReviewChunk(s,req.query.part,req.body.Digits);saveSession(s);if(complete){if(!validRecipient(s.email)){sayTo(t,'לא הוגדרה כתובת מייל תקינה. המסמך נשמר והשליחה נחסמה. יש להגדיר כתובת נמען לפני שליחה.');t.hangup();return;}offerPhoneApproval(s);saveSession(s);gather(t,s,'approve','המסמך יישלח לכתובת: '+s.email.split('').join(' ')+'. זה מסמך ניסיון, לא להגשה. לאישור התוכן והכתובת ולשליחה הקישו 1. לתיקון המסמך הקישו 2.');go(t,s,'review');}else go(t,s,'review');}});
route('edit',(req,t,s)=>{if(s.stage!=='review')throw Error('המסמך אינו בשלב תיקון.');const n=Number(req.body.Digits);if(req.body.Digits&&Number.isInteger(n)&&n>=1&&n<=SCHEMA.length){sm.editField(s,n-1);saveSession(s);go(t,s,target(s));return;}gather(t,s,'edit','איזה שדה לתקן? '+SCHEMA.map((f,i)=>f.label+', '+(i+1)).join('. ')+'. הקישו מספר שדה וסולמית.',{numDigits:2,finishOnKey:'#'});go(t,s,'review');});
route('approve',(req,t,s)=>{if(req.body.Digits==='1'&&s.stage==='review'){approvePhoneDelivery(s,req.body.Digits);saveSession(s);deliver(s);go(t,s,'delivery-status');}else if(req.body.Digits==='2'&&s.stage==='review')go(t,s,'edit');else go(t,s,target(s));});
route('send',(_req,t,s)=>{if(s.stage==='approved')deliver(s);go(t,s,'delivery-status');});
route('delivery-status',(_req,t,s)=>{if(s.stage==='sending'){t.pause({length:2});go(t,s,'delivery-status');return;}if(s.stage==='submitted')sayTo(t,'שרת המייל קיבל את המסמך. בדקו את תיבת הדואר ואת תיקיית הספאם. תודה ולהתראות.');else sayTo(t,s.error||'השליחה לא אושרה. המסמך נשמר.');t.hangup();});
route('no-input',(_req,t,s)=>{s.silenceCount=(s.silenceCount||0)+1;saveSession(s);if(s.silenceCount>=5){sayTo(t,'לא נשמע קלט. התשובות שאושרו נשמרו. שלום.');t.hangup();}else{sayTo(t,'אני כאן. ננסה שוב.');go(t,s,target(s));}});
export default router;
