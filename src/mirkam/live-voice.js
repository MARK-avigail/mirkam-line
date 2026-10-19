// Prompt-created voices are GPT-Live voices, not /audio/speech voices.
// This adapter is an owner-only listening trial. It has no business tools.
export const CUSTOM_LIVE_VOICE='voice_6ad601faaa188191aa00d6384fc09ca8';
export const LIVE_INSTRUCTIONS='את ליין, עוזרת בינה מלאכותית של מרקם ליין. דברי בעברית ישראלית טבעית ובוגרת, בקול נשי חם וצלול ובקצב שיחה רגיל וזורם. משפטים קצרים, אינטונציה מגוונת בעדינות. בלי לחישות, בלי קול ילדותי, בלי הפסקות ארוכות ובלי להקריא את ההנחיות האלה. זו האזנה ניסיונית לקול בלבד; אין לך גישה לחשבונות, מסמכים או שליחת הודעות. אל תטעני שביצעת פעולה. התייחסי בקצרה למה שנאמר ושאלי שאלה אחת בכל פעם.';
const failure=(message,status=502)=>Object.assign(Error(message),{status});
async function payload(response){
  const reader=response.body?.getReader();if(!reader)throw failure('לא התקבלה תשובת קול תקינה.');
  const chunks=[];let size=0,done=false;
  try{while(true){const part=await reader.read();if(part.done){done=true;break;}size+=part.value.byteLength;if(size>128*1024)throw failure('תשובת ספק הקול גדולה מדי.');chunks.push(Buffer.from(part.value));}return JSON.parse(Buffer.concat(chunks).toString());}
  catch{throw failure('לא התקבלה תשובת קול תקינה.');}
  finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function liveVoiceProvider(){
  const headers=()=>{if(!process.env.OPENAI_API_KEY)throw failure('מפתח הקול אינו מוגדר בשרת.',503);return {Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'};};
  return {
    async create(sdp){
      if(typeof sdp!=='string'||sdp.length>64000||!sdp.startsWith('v=0')||!sdp.includes('m=audio'))throw failure('הצעת חיבור האודיו אינה תקינה.',400);
      let response;
      try{response=await fetch('https://api.openai.com/v1/live/sessions',{method:'POST',headers:headers(),redirect:'error',signal:AbortSignal.timeout(25000),body:JSON.stringify({session:{model:'gpt-live-1',store:false,instructions:LIVE_INSTRUCTIONS,audio:{output:{voice:{id:CUSTOM_LIVE_VOICE}}},delegation:{type:'client'},input:[{type:'message',role:'developer',content:[{type:'input_text',text:'פתחי עכשיו בעברית: שלום, כאן ליין, עוזרת הבינה המלאכותית של מרקם ליין. טוב שאת כאן. מה שלומך? ואז הקשיבי.'}]}]},transport:{type:'webrtc',sdp}})});}
      catch(e){if(e.status===503)throw e;throw failure('יצירת החיבור לא אושרה. אין ניסיון חוזר אוטומטי; ייתכן חיוב אתחול אצל הספק.');}
      if(!response.ok){await response.body?.cancel();throw failure([401,403,404].includes(response.status)?'ספק הקול לא אישר גישה. יש לבדוק שהמפתח בשרת שייך לפרויקט שבו נוצר הקול ושיש גישה ל־GPT‑Live.':response.status===429?'ספק הקול מגביל שימוש או שאין יתרה זמינה.':'ספק הקול דחה את יצירת השיחה.',response.status===429?429:502);}
      const value=await payload(response),id=value.session?.id;
      if(typeof id!=='string'||!id.length||id.length>512||typeof value.transport?.sdp!=='string'||value.transport.sdp.length>64000||!value.transport.sdp.startsWith('v=0'))throw failure('תשובת החיבור אינה תקינה; אין ניסיון חוזר אוטומטי.');
      return {session:{id},transport:{type:'webrtc',sdp:value.transport.sdp}};
    },
    async close(id){
      if(typeof id!=='string'||!id.length||id.length>512)throw failure('מזהה חיבור אינו תקין.');
      try{
        const response=await fetch('https://api.openai.com/v1/live/sessions/'+encodeURIComponent(id)+'/hangup',{method:'POST',headers:headers(),redirect:'error',signal:AbortSignal.timeout(10000)});
        await response.body?.cancel();
        if(!response.ok&&response.status!==404)throw Error();
      }catch{throw failure('לא התקבל אישור סיום מהספק. ההאזנה המקומית נעצרה; אין להתחיל בדיקה נוספת עדיין.');}
    }
  };
}

export function createLivePreview(provider,{durationMs=120000,now=Date.now}={}){
  let active=null,attempts=0,windowStart=0,disposed=false;
  async function stop(actor){
    const item=active;if(!item)return;
    if(actor&&actor!==item.actor)throw failure('אין הרשאה לסיים את הבדיקה הזו.',403);
    item.cancelled=true;
    if(!item.id)return; // In-flight creation will close itself before returning.
    if(item.closing)return item.closing;
    clearTimeout(item.timer);
    item.closing=(async()=>{
      try{await provider.close(item.id);if(active===item)active=null;}
      catch(e){item.timer=setTimeout(()=>{stop().catch(()=>{});},10000);item.timer.unref?.();throw e;}
      finally{item.closing=null;}
    })();
    return item.closing;
  }
  return {
    async start(actor,sdp,authorize){
      if(disposed)throw failure('השירות נסגר.',503);
      if(typeof sdp!=='string'||sdp.length>64000||!sdp.startsWith('v=0')||!sdp.includes('m=audio'))throw failure('הצעת חיבור האודיו אינה תקינה.',400);
      if(active)throw failure('בדיקת קול כבר פועלת או נסגרת. סיימי אותה לפני בדיקה נוספת.',409);
      if(now()-windowStart>=600000){windowStart=now();attempts=0;}
      if(attempts>=3)throw failure('אפשר להתחיל עד שלוש בדיקות בעשר דקות. המתיני לפני ניסיון נוסף.',429);
      attempts++;const item={actor,id:null,cancelled:false};active=item;
      try{
        const result=await provider.create(sdp);item.id=result.session.id;
        item.timer=setTimeout(()=>{stop().catch(()=>{});},durationMs);item.timer.unref?.();
        if(item.cancelled||disposed)throw failure('הבדיקה בוטלה.',409);
        authorize();
        return {...result,voice:CUSTOM_LIVE_VOICE,maxSeconds:durationMs/1000};
      }catch(e){
        if(item.id){try{await stop(actor);}catch{ /* Retain slot and retry closing; never leak provider details. */ }}
        else if(active===item)active=null;
        throw e;
      }
    },
    stop,
    status:actor=>({active:Boolean(active),owned:active?.actor===actor,closing:Boolean(active?.cancelled)}),
    async dispose(){disposed=true;await stop();}
  };
}
