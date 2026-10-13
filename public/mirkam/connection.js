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
    label.textContent='כתובת השירות';field.type='url';field.dir='ltr';field.placeholder='https://your-server.example';field.value=window.mirkamNative.serverOrigin||localStorage.getItem(key)||'';label.append(field);save.textContent='שמירה ובדיקת חיבור';notice.textContent='התוכנה מותקנת במכשיר. כניסה, AI וסנכרון דורשים שרת פעיל.';
    form.append(label,save,notice);details.append(summary,form);document.querySelector('main').prepend(details);
    form.onsubmit=event=>{event.preventDefault();try{const value=endpoint(field.value.trim());if(window.mirkamNative.saveServer&&!window.mirkamNative.saveServer(value))throw Error('שמירת הכתובת לא הושלמה.');localStorage.setItem(key,value);location.reload();}catch(error){notice.textContent=error.message;}};
    if(!field.value)details.open=true;
  });
})();
