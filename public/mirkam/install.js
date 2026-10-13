'use strict';
const installButton=document.getElementById('install-app');
let installPrompt=null;
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
if(!standalone())installButton.hidden=false;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;if(!standalone())installButton.hidden=false;});
window.addEventListener('appinstalled',()=>{installPrompt=null;installButton.hidden=true;});
installButton.addEventListener('click',async()=>{
  if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch{document.getElementById('status').textContent='אפשר להתקין דרך תפריט הדפדפן: הוספה למסך הבית.';}}
  else document.getElementById('status').textContent=/iPad|iPhone|iPod/.test(navigator.userAgent)?'ב־Safari לחצו על שיתוף ואז ״הוספה למסך הבית״.':'פתחו את תפריט הדפדפן ובחרו ״התקנת אפליקציה״ או ״הוספה למסך הבית״. נדרש אתר HTTPS פעיל; האפשרות תלויה בדפדפן.';
});
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{document.getElementById('status').textContent='הגדרת ההתקנה לא הושלמה. אפשר להמשיך בדפדפן ולנסות שוב מאוחר יותר.';});
