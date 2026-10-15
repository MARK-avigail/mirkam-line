import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { safeUser } from './identity.js';
import { BRANCHES } from './workflow.js';
import { renderPdf,renderDocx } from '../documents.js';
import { createVoice } from './voice.js';
import { permitted } from './staff.js';

const publicDir=fileURLToPath(new URL('../../public/mirkam/',import.meta.url));
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
async function body(req){let b='';for await(const chunk of req){b+=chunk.toString();if(Buffer.byteLength(b)>8*1024*1024)throw Error('הבקשה גדולה מדי.');}try{return b?JSON.parse(b):{};}catch{throw Error('הבקשה אינה תקינה.');}}
function staff(req,service){
  const master=process.env.MIRKAM_ADMIN_TOKEN;
  if(!master||master.length<32||!equal(req.headers.authorization,'Bearer '+master))return service.staff.authenticate((req.headers.authorization||'').replace(/^Bearer /,''));
  return {actor:'owner',role:'owner'};
}
export function createMirkamServer(service){
  const voice=createVoice(service);
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'");
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try{
      const u=new URL(req.url,'http://localhost'),route=u.pathname,method=req.method;
      if(route.startsWith('/voice/')&&method==='POST')return await voice(req,res);
      if(route==='/health')return send({ok:true,service:'Mirkam Line',version:'0.2.2'});
      if(!route.startsWith('/api/')){
        const allowed={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/install.js':'install.js','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png','/brand-logo.png':'brand-logo.png'};if(!allowed[route]||method!=='GET'){res.writeHead(404);return res.end();}
        res.setHeader('Content-Type',route.endsWith('.webmanifest')?'application/manifest+json; charset=utf-8':route.endsWith('.png')?'image/png':route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(publicDir,allowed[route])));
      }
      const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return send({ok:false,error:'גישה מאתר אחר נחסמה.'},403);
      const data=['POST','PUT','PATCH'].includes(method)?await body(req):{};
      if(route==='/api/login'&&method==='POST')return send({ok:true,...service.identity.login(data.code,data.pin,req.socket.remoteAddress||'unknown')});
      if(route==='/api/staff-login'&&method==='POST')return send({ok:true,...service.staff.login(data.id,data.password)});
      if(route.startsWith('/api/admin/')){
        const auth=staff(req,service),actor=auth.actor,suffix=route.slice(11);
        if(!permitted(auth.role,suffix))return send({ok:false,error:'אין הרשאה לתפקיד זה.'},403);
        if(suffix==='logout'&&method==='POST'){service.staff.logout((req.headers.authorization||'').replace(/^Bearer /,''));return send({ok:true});}
        if(suffix==='owner-profile'&&method==='POST')return send({ok:true,result:service.staff.createOwner(data.username,data.name,actor)});
        if(suffix==='oversight'&&method==='POST')return send({ok:true,result:service.oversight.grant(data.userId,actor)});
        if(suffix==='staff'&&method==='POST')return send({ok:true,result:service.staff.create(data.name,data.role,actor)});
        if(suffix==='membership'&&method==='GET')return send({ok:true,items:service.store.list('user').map(u=>({id:u.id,name:u.name,...service.membership(u.id)}))});
        if(suffix==='payments'&&method==='GET')return send({ok:true,items:service.store.list('payment')});
        if(['conversations','drafts','messages'].includes(suffix)&&method==='GET'){const kind={conversations:'conversation',drafts:'draft',messages:'message'}[suffix];return send({ok:true,items:service.store.list(kind)});}
        if(suffix==='users'&&method==='GET')return send({ok:true,items:service.store.list('user').map(u=>{const {code,...profile}=safeUser(u);return profile;})});
        if(suffix==='users'&&method==='POST'){if(data.freeMembership===true&&auth.role!=='owner')throw Error('רק בעלת המערכת יכולה לאשר הטבת מינוי.');return send({ok:true,...service.identity.register(data,actor)});}
        if(suffix==='destinations'&&method==='POST')return send({ok:true,item:service.setDestination(data,actor)});
        if(suffix==='contacts'&&method==='POST')return send({ok:true,item:service.approveContact(data.userId,data,actor)});
        if(suffix==='announcements'&&method==='POST')return send({ok:true,item:service.announce(data.text,actor)});
        if(suffix==='reply'&&method==='POST')return send({ok:true,item:service.receiveReply(data.messageId,data.sender,data.text,data.providerEvent,actor)});
        if(suffix==='cleanup'&&method==='POST')return send({ok:true,items:await service.cleanup()});
        if(suffix==='audit'&&method==='GET')return send({ok:true,items:service.store.list('audit')});
        if(suffix==='tickets'&&method==='GET')return send({ok:true,items:service.store.list('ticket')});
        if(suffix==='line'&&method==='GET')return send({ok:true,branches:BRANCHES,channel:'telephone',liveVerified:false});
        if(suffix==='status'&&method==='GET')return send({ok:true,aiConfigured:Boolean(process.env.OPENAI_API_KEY),emailConfigured:Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&[465,587].includes(Number(process.env.SMTP_PORT||587))),voiceConfigured:Boolean(process.env.TWILIO_AUTH_TOKEN&&/^https:\/\//.test(process.env.BASE_URL||'')),faxConfigured:false,paymentConfigured:false,liveVerified:false});
        const match=suffix.match(/^users\/([a-f0-9-]+)\/(reset|status)$/);if(match&&method==='POST')return send({ok:true,result:match[2]==='reset'?service.identity.reset(match[1],actor):service.identity.suspend(match[1],data.active,actor)});
        throw Error('פעולת ניהול לא מוכרת.');
      }
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');let user;
      try{user=service.identity.authenticate(token).user;}catch(e){e.status=401;throw e;}
      const id=user.id;
      if(route==='/api/oversight/summary')return send({ok:true,result:service.oversight.summary(id)});
      if(route==='/api/oversight/read'&&method==='POST')return send({ok:true,items:service.oversight.read(id,data.code,data.kind)});
      if(route==='/api/oversight/status'&&method==='POST'){if(data.confirm!==true)throw Error('נדרש אישור מפורש.');return send({ok:true,user:service.oversight.suspend(id,data.code,data.active)});}
      if(route==='/api/logout'&&method==='POST'){service.identity.logout(token);return send({ok:true});}
      if(route==='/api/home')return send({ok:true,user,branches:BRANCHES,membership:service.membership(id)});
      if(route==='/api/destinations')return send({ok:true,items:service.destinations().filter(d=>d.prisons.includes(user.prison))});
      if(route==='/api/drafts'&&method==='GET')return send({ok:true,items:service.store.list('draft',id).map(d=>service.viewDraft(d.id,id))});
      if(route==='/api/drafts'&&method==='POST')return send({ok:true,draft:service.createDraft(id,data.aiEnabled)});
      const draftRoute=route.match(/^\/api\/drafts\/([a-f0-9-]+)(?:\/(.+))?$/);
      if(draftRoute){const draftId=draftRoute[1],action=draftRoute[2];
        if(!action&&method==='GET')return send({ok:true,draft:service.viewDraft(draftId,id)});
        if(action==='package'&&method==='GET')return send({ok:true,documents:service.package(draftId,id)});
        if(['pdf','docx'].includes(action)&&method==='GET'){const doc=service.package(draftId,id).find(d=>d.kind===u.searchParams.get('kind'));if(!doc)throw Error('מסמך לא נמצא.');const bytes=action==='pdf'?await renderPdf(doc.text,{test:true}):renderDocx(doc.text,{test:true});res.writeHead(200,{'Content-Type':action==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="${doc.kind}.${action}"`});return res.end(bytes);}
        if(method!=='POST')throw Error('פעולה לא מוכרת.');let result;
        switch(action){case 'profile':result=service.confirmProfile(draftId,id,data.revision);break;case 'court':result=service.chooseCourt(draftId,id,data.targetId,data.revision);break;case 'answer':result=await service.answerWithCoach(draftId,id,data.text,data.revision);break;case 'clarify':result=await service.clarify(draftId,id,data.text,data.revision);break;case 'confirm':result=service.confirmAnswer(draftId,id,data.accept,data.revision);break;case 'skip':result=service.skip(draftId,id,data.revision);break;case 'edit':result=service.edit(draftId,id,data.key,data.revision);break;case 'restore':result=service.restore(draftId,id,data.revision);break;case 'coach':result=await service.coach(draftId,id,data.text);break;case 'attach':result=service.attach(draftId,id,data,data.revision);break;case 'offer':result=service.offer(draftId,id,data.targetId,data.channel,data.revision);break;case 'approve':result=service.approve(draftId,id,data.nonce,data.accept,data.revision);break;case 'send':return send({ok:true,delivery:await service.send(draftId,id,data.revision)});default:throw Error('פעולה לא מוכרת.');}
        return send({ok:true,draft:service.viewDraft(result.id,id)});
      }
      const resources={conversations:'conversation',contacts:'contact',messages:'message',deliveries:'delivery',versions:'version',tickets:'ticket'};
      const resource=route.match(/^\/api\/(conversations|contacts|messages|deliveries|versions|tickets)(?:\/([a-f0-9-]+)(?:\/(.+))?)?$/);
      if(resource){const [,name,rid,action]=resource,kind=resources[name];
        if(method==='GET')return send({ok:true,...(rid?{item:service.store.owned(kind,rid,id)}:{items:service.store.list(kind,id)})});
        if(name==='conversations'&&!rid&&method==='POST')return send({ok:true,item:service.newConversation(id,data.name)});
        if(name==='conversations'&&rid&&action==='chat'&&method==='POST')return send({ok:true,item:await service.chat(rid,id,data.text,data.revision)});
        if(name==='messages'&&!rid&&method==='POST')return send({ok:true,item:service.compose(id,data.contactId,data.text)});
        if(name==='messages'&&action==='approve'&&method==='POST')return send({ok:true,item:service.approveMessage(rid,id,data.accept,data.revision)});
        if(name==='messages'&&action==='send'&&method==='POST')return send({ok:true,item:await service.sendMessage(rid,id,data.revision)});
        if(name==='tickets'&&!rid&&method==='POST')return send({ok:true,item:service.ticket(id,data.text)});
      }
      if(route==='/api/announcements'&&method==='GET')return send({ok:true,items:service.store.list('announcement','all').filter(a=>a.active)});
      if(route==='/api/membership'&&method==='GET')return send({ok:true,membership:service.membership(id)});
      if(route==='/api/checkout'&&method==='POST')return send({ok:true,result:await service.paymentIntent(id)});
      if(route==='/api/transcribe'&&method==='POST'){if(!service.providers.transcribe)throw Error('תמלול לא הוגדר.');if(typeof data.audio!=='string'||data.audio.length>7*1024*1024)throw Error('הקלטה גדולה מדי.');if(data.draftId)service.draft(data.draftId,id);service.reserveAI(id);const bytes=Buffer.from(data.audio,'base64');if(data.draftId)service.recordAudio(id,{providerId:'local',data:data.audio,mime:data.mime});return send({ok:true,text:await service.providers.transcribe(bytes,data.mime)});}
      return send({ok:false,error:'לא נמצא.'},404);
    }catch(e){if(!res.headersSent)send({ok:false,error:e.message},e.status||400);else res.end();}
  });
}
