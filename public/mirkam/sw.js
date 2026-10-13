'use strict';
// Network only: never cache authenticated pages, documents, credentials or API replies.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mavrika AI</title><h1>נדרש חיבור לאינטרנט</h1><p>חזרו לתוכנה לאחר שהחיבור יחזור. הכניסה תיבדק מחדש.</p></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
