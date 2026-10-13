import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ivrRouter from './ivr/twilio.js';
import apiRouter from './api.js';
import { protectApi } from './config.js';
import { recoverInterruptedSessions } from './storage.js';
import memberRouter from './member-api.js';
export function createApp() {
 const app=express();app.disable('x-powered-by');
 app.use((_req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'"});next();});
 app.use('/ivr',express.urlencoded({extended:false,limit:'32kb'}),ivrRouter);
 app.use('/member',express.json({limit:'64kb'}),memberRouter);
 app.use('/api',protectApi,express.json({limit:'8mb'}),(_req,res,next)=>{res.set('Cache-Control','no-store');next();},apiRouter);
 app.get('/health',(_req,res)=>res.json({ok:true,service:'ki-ativa'}));
 app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
 app.use((err,_req,res,_next)=>res.status(400).json({ok:false,error:'הבקשה לא תקינה או גדולה מדי.'}));return app;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 recoverInterruptedSessions();createApp().listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log('קו עתירה: http://localhost:'+(process.env.PORT||3000)));
}
