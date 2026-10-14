'use strict';
(()=>{
  if(!window.mirkamNative)return;
  const originalFetch=window.fetch.bind(window);
  const key='mirkam.server.origin';
  function endpoint(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('הזינו כתובת שרת HTTPS בלבד, ללא נתיב או סיסמה.');return url.origin;}
  window.fetch=async(input,options={})=>{
    if(typeof input!=='string'||!/^\/(api\/|health(?:$|\?))/.test(input))return originalFetch(input,options);
    const server=window.mirkamNative.serverOrigin||localStorage.getItem(key);if(!server)throw Error('יש להגדיר כתובת שרת בהגדרות החיבור. מסך הבית זמין גם ללא שרת.');
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const response=await window.mirkamNative.request({endpoint:endpoint(server),route:input,method:options.method||'GET',headers:options.headers||{},body:options.body});
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const bytes=Uint8Array.from(atob(response.base64),c=>c.charCodeAt(0));
    return new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,headers:response.headers});
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const details=document.createElement('details');details.className='server-settings';
    const summary=document.createElement('summary');summary.textContent='הגדרות חיבור לשרת';
    const form=document.createElement('form'),label=document.createElement('label'),field=document.createElement('input'),save=document.createElement('button'),notice=document.createElement('p');
    label.textContent='כתובת השירות';field.type='url';field.required=true;field.dir='ltr';field.placeholder='https://your-server.example';field.value=window.mirkamNative.serverOrigin||localStorage.getItem(key)||'';label.append(field);save.textContent='שמירה ובדיקת חיבור';notice.textContent='התוכנה מותקנת במכשיר. כניסה, AI וסנכרון דורשים שרת פעיל.';
    notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');form.noValidate=true;form.append(label,save,notice);details.append(summary,form);document.querySelector('main').prepend(details);
    form.onsubmit=async event=>{
      event.preventDefault();if(save.disabled)return;
      let timer;save.disabled=true;field.disabled=true;save.textContent='בודק חיבור…';
      try{
        if(!field.value.trim())throw Error('חסרה כתובת שרת. הדביקו כאן את כתובת השירות שמתחילה ב־https://.');
        const value=endpoint(field.value.trim());
        notice.textContent='בודק את השרת…';
        const response=await Promise.race([
          window.mirkamNative.request({endpoint:value,route:'/health',method:'GET',headers:{}}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('השרת לא ענה בזמן. בדקו שהשרת פועל ושיש חיבור לאינטרנט.')),10000);})
        ]);
        if([301,302,303,307,308,401,403].includes(response.status))throw Error('הגישה לשרת חסומה או דורשת התחברות נוספת. ב־Codespaces בדקו אם פורט 3000 פרטי.');
        if(response.status!==200)throw Error('השרת החזיר שגיאה '+response.status+'. בדקו את כתובת השירות ושהשרת פועל.');
        let data;try{data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(response.base64),c=>c.charCodeAt(0))));}catch{throw Error('הכתובת החזירה דף במקום שירות מרקם ליין. ייתכן שזה מסך התחברות של GitHub.');}
        if(data.ok!==true||data.service!=='Mirkam Line')throw Error('הכתובת אינה מחזירה שירות מרקם ליין תקין.');
        if(window.mirkamNative.saveServer&&!window.mirkamNative.saveServer(value))throw Error('שמירת הכתובת לא הושלמה.');
        localStorage.setItem(key,value);field.value=value;
        notice.textContent='הכתובת נשמרה והחיבור לשרת הצליח. אפשר להמשיך לכניסה לחשבון.';
        window.dispatchEvent(new Event('mirkam-server-saved'));
      }catch(error){notice.textContent=error.message||'לא ניתן להתחבר לשרת. בדקו את החיבור לאינטרנט ואת כתובת השירות.';}
      finally{clearTimeout(timer);save.disabled=false;field.disabled=false;save.textContent='שמירה ובדיקת חיבור';}
    };
    if(!field.value)details.open=true;
  });
})();
