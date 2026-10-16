import { validText, TOPICS } from './workflow.js';
import { createHash } from 'node:crypto';
export function documentPackage(d,user,now=d.createdAt||Date.now()) {
  const documentDate=new Intl.DateTimeFormat('en-CA',{timeZone:process.env.MIRKAM_TIMEZONE||'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const a=d.answers,header=[d.court?.name||'בית המשפט המחוזי — לבחירה',`מזהה פנימי: ${d.id}`,`העותר: ${user.name}`,`מספר זהות: ${user.identity}`,`מספר אסיר: ${user.prisonerNumber}`,`בית סוהר: ${user.prison}; אגף: ${user.wing||'לא צוין'}`,'המשיב: שירות בתי הסוהר',''];
  const sections=[['הסעד המבוקש','relief'],['ההחלטה, המעשה או המחדל','decision'],['מועד האירוע','decision_date'],['העובדות','facts'],['פניות קודמות ומענה','prior_requests'],['עתירה קודמת ושינוי נסיבות','prior_petition'],['נימוקים','grounds'],['דחיפות ובקשה זמנית','urgency'],['רשימת נספחים','annexes']];
  const petition=[...header,'עתירת אסיר',`נושא: ${a.subject||'[להשלמה]'}`,'',...sections.filter(([_,key])=>a[key]).flatMap(([title,key],i)=>[`${i+1}. ${title}`,a[key],'']),`תאריך: ${documentDate}`,`שם העותר: ${user.name}`,'חתימת העותר: ____________________'].join('\n');
  const affidavit=[...header,'טיוטת תצהיר — טעונה חתימה ואימות כנדרש','המסמך אינו תצהיר מאומת. אין להגישו כתצהיר מאומת לפני השלמת האימות.',`אני, ${user.name}, מבקש להצהיר על העובדות שמסרתי:`,a.facts||'[להשלמה]','חתימת המצהיר: ____________________','אישור גורם מוסמך: ____________________'].join('\n');
  const fee=[...header,'טיוטת טופס אגרה — אינה קבלה',`נושא העתירה: ${a.subject||'[להשלמה]'}`,'סכום אגרה עדכני: לא אומת — להשלמה בידי הגורם המוסמך','אישור גבייה מחשבון האסיר: ____________________','תאריך ומזהה אישור הגבייה: ____________________','אין במסמך זה הוכחה לתשלום.'].join('\n');
  return [{kind:'petition',title:'עתירה',text:petition},{kind:'affidavit',title:'טיוטת תצהיר',text:affidavit},{kind:'fee',title:'טיוטת טופס אגרה',text:fee}];
}
export function missing(d){return ['subject','relief','decision','facts','grounds'].filter(key=>!d.answers[key]?.trim());}
export function reviewFingerprint(d,user,target,channel){return createHash('sha256').update(JSON.stringify({answers:d.answers,profile:{name:user.name,identity:user.identity,prisonerNumber:user.prisonerNumber,prison:user.prison,wing:user.wing},court:d.court,attachments:d.attachments||[],target,channel})).digest('hex');}
export function attachmentInput(name,mime,base64){
  name=validText(name,150);if(/[\/\\\x00-\x1f]/.test(name))throw Error('שם קובץ אינו תקין.');
  if(typeof base64!=='string'||base64.length>7*1024*1024||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('קובץ גדול מדי או לא תקין.');
  const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>5*1024*1024)throw Error('קובץ גדול מדי או ריק.');
  const signature=mime==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:false;
  if(!signature)throw Error('סוג הקובץ אינו תואם לתוכן.');return {name,mime,base64,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}

// The management preview uses the same renderer as telephone-created petitions.
export function documentTemplate(){
 const answers=Object.fromEntries(TOPICS.map(topic=>[topic.key,'[להשלמה: '+topic.label+']']));
 return documentPackage({id:'תבנית לדוגמה בלבד',answers}, {name:'[שם העותר]',identity:'[מספר זהות]',prisonerNumber:'[מספר אסיר]',prison:'[בית סוהר]',wing:'[אגף]'});
}
