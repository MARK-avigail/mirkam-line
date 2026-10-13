'use strict';
const installButton=document.getElementById('install-app');
let installPrompt=null;
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
if(!window.mirkamNative&&!standalone())installButton.hidden=false;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;if(!window.mirkamNative&&!standalone())installButton.hidden=false;});
window.addEventListener('appinstalled',()=>{installPrompt=null;installButton.hidden=true;});
installButton.addEventListener('click',async()=>{
  if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch{document.getElementById('status').textContent='אפשר להתקין דרך תפריט הדפדפן: הוספה למסך הבית.';}}
  else document.getElementById('status').textContent=/iPad|iPhone|iPod/.test(navigator.userAgent)?'ב־Safari לחצו על שיתוף ואז ״הוספה למסך הבית״.':'פתחו את תפריט הדפדפן ובחרו ״התקנת אפליקציה״ או ״הוספה למסך הבית״. נדרש אתר HTTPS פעיל; האפשרות תלויה בדפדפן.';
});
if(!window.mirkamNative&&'serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{document.getElementById('status').textContent='הגדרת ההתקנה לא הושלמה. אפשר להמשיך בדפדפן ולנסות שוב מאוחר יותר.';});

const connectionState=document.getElementById('connection-state');
const retryConnection=document.getElementById('retry-connection');
const offlineReady=document.getElementById('offline-ready');
let checking=false;
async function checkConnection(){
  if(checking)return;checking=true;
  let available=false,message='אין אינטרנט. מסך התוכנה זמין; כניסה, AI ושליחה דורשים חיבור.';
  try{
    if(navigator.onLine){
      const response=await fetch('/health',{cache:'no-store',signal:AbortSignal.timeout(4000)});
      available=response.ok&&!response.redirected&&response.headers.get('content-type')?.includes('application/json');
      if(available){const data=await response.json();available=data.service==='Mirkam Line';}
      message=available?'מחוברים לשירות': 'השרת אינו זמין או שנדרשת התחברות ל־GitHub. אפשר לפתוח את השירות דרך Ports ב־Codespaces.';
    }
  }catch{available=false;message='השרת אינו זמין כרגע. מסך התוכנה נשאר פתוח; הפעולות יתחדשו כשהשירות יחזור.';}
  connectionState.textContent=message;
  connectionState.parentElement.classList.toggle('unavailable',!available);
  retryConnection.hidden=available;checking=false;
}
function checkOfflineReady(){
  const controller=navigator.serviceWorker?.controller;
  offlineReady.textContent='מכינים את התוכנה לפתיחה ללא אינטרנט…';
  if(!controller)return;
  const channel=new MessageChannel();
  const timer=setTimeout(()=>{channel.port1.close();offlineReady.textContent='פתיחה ללא אינטרנט עדיין לא אושרה. השאירו את המסך פתוח כשהשירות מחובר.';},6000);
  channel.port1.onmessage=event=>{
    clearTimeout(timer);channel.port1.close();
    offlineReady.textContent=event.data.ready?'מוכן לפתיחה ללא אינטרנט. כניסה, AI ושליחה דורשים חיבור.':'ההכנה לפתיחה ללא אינטרנט טרם הושלמה.';
  };
  controller.postMessage({type:'OFFLINE_STATUS'},[channel.port2]);
}
retryConnection.addEventListener('click',checkConnection);
window.addEventListener('online',checkConnection);
window.addEventListener('offline',checkConnection);
window.addEventListener('focus',checkConnection);
checkConnection();
if(window.mirkamNative){offlineReady.textContent='מסך הבית מותקן במכשיר וזמין גם ללא אינטרנט.';}else if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('controllerchange',checkOfflineReady);
  navigator.serviceWorker.ready.then(checkOfflineReady);
}
