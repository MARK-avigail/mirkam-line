'use strict';
// Only the public application shell is cached. Never API responses or personal records.
const SHELL_CACHE='mirkam-shell-v3';
const SHELL_FILES=['/','/app.js','/style.css','/install.js','/manifest.webmanifest','/icon-192.png','/icon-512.png','/brand-logo.png'];
const expectedType=path=>path==='/'?'text/html':path.endsWith('.js')?'javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'manifest+json';
async function valid(response,path){
  if(!response?.ok||response.redirected||!response.headers.get('content-type')?.includes(expectedType(path)))return false;
  return path!=='/'||(await response.clone().text()).includes('id="suite-home"');
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  // Fetch and validate all assets before replacing any stored shell.
  const responses=await Promise.all(SHELL_FILES.map(async path=>{
    const r=await fetch(new Request(new URL(path,self.location.origin),{credentials:'include',cache:'reload',redirect:'error'}));
    if(!await valid(r,path))throw Error('Application shell unavailable');return r;
  }));
  const cache=await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_FILES.map((path,i)=>cache.put(path,responses[i])));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('mirkam-shell-')&&name!==SHELL_CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data?.type==='OFFLINE_STATUS'&&event.ports?.[0])event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);
    const ready=(await Promise.all(SHELL_FILES.map(path=>cache.match(path)))).every(Boolean);
    event.ports[0].postMessage({ready});
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!SHELL_FILES.includes(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL_CACHE),saved=await cache.match(url.pathname);
    if(event.request.mode!=='navigate'&&saved)return saved;
    try{
      const r=await fetch(event.request,{signal:AbortSignal.timeout(4000)});
      if(await valid(r,url.pathname))return r;
      if(saved)return saved;
      return r;
    }catch{
      if(saved)return saved;
      return new Response('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>מרקם ליין</title><h1>צריך חיבור ראשון להשלמת ההתקנה</h1><p>פתחו שוב כשהאינטרנט והשרת זמינים.</p></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    }
  })());
});
