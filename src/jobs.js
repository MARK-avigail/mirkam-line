import { randomUUID } from 'node:crypto';
import { getSession,saveSession } from './storage.js';
import * as sm from './state-machine.js';
import { generateHelp,suggestWriting } from './ivr/ai-help.js';
import { sendDocument,mailConfiguration } from './mailer.js';
import { requirePhoneDeliveryApproval } from './ivr/phone-guards.js';
const running=new Map();
export const waitForJob=id=>running.get(id)||Promise.resolve();
function launch(s,task) {
  if(running.has(s.id)) throw new Error('פעולה כבר מתבצעת.');
  saveSession(s);
  const work=Promise.resolve().then(task).finally(()=>running.delete(s.id));
  running.set(s.id,work); return s;
}
export function processAnswer(s,kind,task) {
  const previous=s.stage;
  if(!['field','field_review'].includes(previous)) throw new Error('לא ניתן לעבד בשלב הזה.');
  s.processingPrevious=previous; s.stage='processing'; s.jobId=randomUUID(); s.error=''; const jobId=s.jobId;
  return launch(s,async()=> {
    let current;
    try { const result=await task(); current=getSession(s.id); if(current?.jobId!==jobId || current.stage!=='processing') return; current.stage=previous;
      if(kind==='transcribe') sm.submitAnswer(current,result,'recording');
      else if(kind==='help') current.helperText=result.text;
      else { const original=current.pending; current.stage='field'; sm.submitAnswer(current,result.draft,'ai_proposal'); current.proposedOriginal ||= original; current.assistantQuestion=result.question; }
    } catch(e) { current=getSession(s.id); if(current?.jobId!==jobId || current.stage!=='processing') return; current.stage=previous; current.error=e.message; }
    current.updatedAt=Date.now(); delete current.jobId; delete current.processingPrevious; saveSession(current);
  });
}
export function help(s, draftAnswer) { const field=sm.snapshot(s).current; if(s.stage!=='field') throw new Error('עזרה זמינה בשאלה פתוחה.'); if(draftAnswer !== undefined && (typeof draftAnswer !== 'string' || draftAnswer.length > 5000)) throw new Error('התשובה לעזרה אינה תקינה.'); const answer=draftAnswer ?? s.pending; return processAnswer(s,'help',()=>generateHelp({field,fields:s.fields,answer})); }
export function assist(s) { const field=sm.snapshot(s).current; if(s.stage!=='field_review' || !['long','text'].includes(field?.type)) throw new Error('ניסוח זמין רק לתשובה מילולית הממתינה לאישור.'); return processAnswer(s,'assist',()=>suggestWriting({field,fields:s.fields,answer:s.pending})); }
export function deliver(s) {
  requirePhoneDeliveryApproval(s);
  mailConfiguration();
  sm.beginDelivery(s);
  return launch(s,async()=> { const current=getSession(s.id); try { current.receipt=await sendDocument(current); current.stage='submitted'; } catch { current.stage='delivery_unknown'; current.error='לא התקבל אישור שליחה. בדקו את התיבה ואת ספק המייל לפני ניסיון נוסף.'; } current.updatedAt=Date.now(); saveSession(current); });
}
