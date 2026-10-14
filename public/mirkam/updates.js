'use strict';
(()=>{
  if(!window.mirkamNative?.updateCheck)return;
  document.addEventListener('DOMContentLoaded',async()=>{
    const section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),button=document.createElement('button');
    summary.textContent='עדכוני התוכנה';button.textContent='בדיקת עדכונים';button.type='button';status.setAttribute('role','status');status.textContent='שיפורי ממשק יורדים ברקע ויופעלו בפתיחה הבאה.';
    section.append(summary,status,button);document.querySelector('main').append(section);
    if(window.mirkamAppReady){try{const info=await window.mirkamNative.updateReady();status.textContent=`גרסת ממשק ${info.version}. שיפורים יופעלו בפתיחה הבאה.`;}catch{}}
    let checking=false;let currentVersion="";try{currentVersion=(await window.mirkamNative.updateReady()).version;}catch{}
    async function check(manual){if(checking||!navigator.onLine)return;checking=true;button.disabled=true;
      try{const result=await window.mirkamNative.updateCheck();status.textContent=result.available?'עדכון ממשק מוכן. הוא יופעל בסגירה מלאה ובפתיחה הבאה של התוכנה.':result.busy?'בדיקת עדכונים כבר פועלת.':`הממשק מעודכן. גרסת ממשק ${currentVersion||'לא זמינה'}.`;}
      catch{if(manual)status.textContent='לא ניתן לבדוק עדכונים כרגע. אפשר להמשיך להשתמש בגרסה השמורה.';}
      finally{checking=false;button.disabled=false;}
    }
    button.onclick=()=>{if(!navigator.onLine)status.textContent='בדיקת עדכונים דורשת אינטרנט. הגרסה השמורה ממשיכה לפעול.';else check(true);};
    setTimeout(()=>check(false),12000);
  });
})();
