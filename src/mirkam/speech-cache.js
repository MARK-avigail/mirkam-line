import {BRANCHES} from './workflow.js';
// Fixed service prompts only. Never retain personal greetings, answers or documents.
export const RECOVERY_PROMPT='יש תקלה זמנית בהשמעה. נחזור לתפריט, ותוכלו לנסות שוב.';
export const PROCESSING_FAILURE_PROMPT='לא הצלחנו לעבד את הבקשה או להכין תשובה. לניסיון נוסף הקישו 1. לתפריט הראשי 8. ליציאה 7.';
export const DELIVERY_FAILURE_PROMPT='לא הצלחנו לאמת שהפעולה הושלמה. לפני שליחה נוספת יש לבדוק את מצב המשלוח. לתפריט הראשי 8. ליציאה 7.';
const MAIN_MENU=BRANCHES.map(b=>`${b.title}, הקישו ${b.digit}`).join('. ');
const FIXED=new Set([RECOVERY_PROMPT,PROCESSING_FAILURE_PROMPT,DELIVERY_FAILURE_PROMPT,MAIN_MENU,MAIN_MENU+'. לפיקוח הקישו 6.',
 ...BRANCHES.map(b=>b.children.map(s=>`${s.title}, הקישו ${s.digit}`).join('. ')),
 'רק רגע.','הבקשה בעיבוד.',
 'עכשיו הקישו את הקוד האישי, שש ספרות.',
 'ננסה שוב בנחת. הקישו את קוד המשתמש, שש ספרות.',
 'שלום, כאן מרקם ליין, עם עוזר בינה מלאכותית. טוב שאתם כאן. הקישו קוד משתמש, שש ספרות.',
 'אני כאן. מה תרצו לשאול?',
 'מה תרצו לכתוב למשפחה? בסיום הקישו סולמית. נשמיע את הנוסח לבדיקה לפני השליחה.'
]);
export function fixedSpeechCache({maxBytes=8*1024*1024}={}){
 const cached=new Map(),pending=new Map();let size=0;
 return {
  async get(text,generate){
   if(!FIXED.has(text))return generate();
   if(cached.has(text))return cached.get(text);
   if(pending.has(text))return pending.get(text);
   const work=Promise.resolve().then(generate).then(audio=>{
    if(!Buffer.isBuffer(audio)||!audio.length||audio.length>6*1024*1024)throw Error('Invalid speech response');
    if(audio.length<=maxBytes){
     while(size+audio.length>maxBytes&&cached.size){const key=cached.keys().next().value;size-=cached.get(key).length;cached.delete(key);}
     cached.set(text,audio);size+=audio.length;
    }
    return audio;
   }).finally(()=>pending.delete(text));
   pending.set(text,work);return work;
  },
  clear(){cached.clear();size=0;}
 };
}
