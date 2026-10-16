import { randomUUID, createHash } from 'node:crypto';
import { Identity,safeUser } from './identity.js';
import { TOPICS, nextTopic, prompt,validText,calendarDate,addCalendarMonths } from './workflow.js';
import { documentPackage,missing,reviewFingerprint,attachmentInput } from './documents.js';
import {Staff} from './staff.js';
import {Oversight} from './oversight.js';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export class Mirkam {
  constructor(store,providers={}){this.store=store;this.identity=new Identity(store);this.staff=new Staff(store);this.providers=providers;this.oversight=new Oversight(this);}
  profile(id){return safeUser(this.identity.user(id));}
  requireService(id){const u=this.identity.user(id);if(u.membership!=='free'&&!(u.paidUntil>Date.now())&&!(u.trialUntil>Date.now()))throw Error('תקופת הניסיון הסתיימה. הטיוטות והמסמכים נשמרו; יש להסדיר מינוי להמשך השירות.');return u;}
  draft(id,user){return this.store.owned('draft',id,user);}
  createDraft(user,aiEnabled){
    this.requireService(user);if(typeof aiEnabled!=='boolean')throw Error('יש לבחור אם להשתמש בעזרת AI.');
    const d=this.store.create('draft',user,{answers:{},aiEnabled,stage:'profile',profileConfirmed:false,court:null,pending:null,editing:null,attachments:[],approval:null});this.store.audit(user,'draft.created',d.id);return d;
  }
  confirmProfile(id,user,revision){let d=this.draft(id,user);if(d.stage!=='profile')throw Error('אישור הפרטים אינו זמין בשלב זה.');d={...d,profileConfirmed:true,stage:'court'};return this.store.put('draft',d,revision);}
  destinations(){return this.store.list('destination').filter(x=>x.active&&x.verifiedBy);}
  destination(id){const d=this.store.get('destination',id);if(!d?.active||!d.verifiedBy)throw Error('יעד השליחה לא אומת או אינו פעיל.');return d;}
  setDestination(data,actor){
    const name=validText(data.name,150),prisons=Array.isArray(data.prisons)?data.prisons.map(p=>validText(p,150)):[];
    if(data.email&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(data.email))throw Error('כתובת מייל אינה תקינה.');
    if(data.fax&&!/^\+?[0-9]{8,15}$/.test(data.fax))throw Error('מספר פקס אינו תקין.');
    const r=this.store.create('destination','staff',{name,prisons,email:data.email||'',fax:data.fax||'',verifiedBy:actor,verifiedSource:validText(data.verifiedSource,500),verifiedAt:Date.now(),active:true});this.store.audit(actor,'destination.verified',r.id);return r;
  }
  chooseCourt(id,user,destinationId,revision){let d=this.draft(id,user);if(!d.profileConfirmed||d.stage!=='court')throw Error('יש לאשר קודם את הפרטים האישיים.');const target=this.destination(destinationId),profile=this.profile(user);if(!target.prisons.includes(profile.prison))throw Error('לא אומתה התאמת בית הסוהר לבית המשפט הזה.');return this.store.put('draft',{...d,court:{id:target.id,name:target.name},stage:'dialogue'},revision);}
  invalidate(d){return {...d,approval:null,review:null};}
  answer(id,user,text,revision){
    let d=this.draft(id,user);if(d.stage!=='dialogue')throw Error('אין שאלה פתוחה בשלב זה.');const topic=TOPICS.find(t=>t.key===nextTopic(d));if(!topic)throw Error('אין שאלה פתוחה.');
    text=topic.date?calendarDate(text):validText(text);return this.store.put('draft',{...this.invalidate(d),pending:{key:topic.key,original:text,text,aiProposal:false},stage:'answer-review'},revision);
  }
  async answerWithCoach(id,user,text,revision){
    let d=this.answer(id,user,text,revision);
    if(d.aiEnabled&&this.providers.coach){try{d=await this.coach(id,user,text);}catch(e){const current=this.draft(id,user);if(current.revision===d.revision)d=this.store.put('draft',{...current,helper:e.message});else d=current;}}
    return d;
  }
  async clarify(id,user,text,revision){
    let d=this.draft(id,user);if(d.stage!=='answer-review'||!d.pending)throw Error('אין תשובה להשלמה.');
    text=validText(text,2000);const original=d.pending.original+'\n'+text;if(original.length>5000)throw Error('התשובה ארוכה מדי.');
    d=this.store.put('draft',{...this.invalidate(d),pending:{...d.pending,original,text:original,aiProposal:false}},revision);
    if(d.aiEnabled&&this.providers.coach){try{return await this.coach(id,user,original);}catch(e){return this.store.put('draft',{...d,helper:e.message});}}
    return d;
  }
  confirmAnswer(id,user,accept,revision){
    let d=this.draft(id,user);if(d.stage!=='answer-review'||!d.pending)throw Error('אין תשובה לאישור.');if(typeof accept!=='boolean')throw Error('נדרש אישור מפורש.');
    if(!accept)return this.store.put('draft',{...d,pending:null,stage:'dialogue'},revision);
    const answers={...d.answers,[d.pending.key]:d.pending.text};d={...this.invalidate(d),answers,pending:null,editing:null,stage:'dialogue'};if(!nextTopic(d))d.stage='review';
    return this.store.atomic(()=>{const saved=this.store.put('draft',d,revision);this.store.create('version',user,{draftId:id,answers,court:d.court,attachments:d.attachments});return saved;});
  }
  skip(id,user,revision){let d=this.draft(id,user);if(d.stage!=='dialogue')throw Error('אין שאלה לדילוג.');const topic=TOPICS.find(t=>t.key===nextTopic(d));if(!topic||topic.required)throw Error('אי אפשר לדלג על פרט חובה.');d={...this.invalidate(d),answers:{...d.answers,[topic.key]:''},editing:null};if(!nextTopic(d))d.stage='review';return this.store.put('draft',d,revision);}
  edit(id,user,key,revision){let d=this.draft(id,user);if(!['review','dialogue','answer-review'].includes(d.stage)||!TOPICS.some(t=>t.key===key))throw Error('אי אפשר לערוך את הפרט הזה.');return this.store.put('draft',{...this.invalidate(d),editing:key,pending:null,stage:'dialogue'},revision);}
  restore(id,user,revision){const d=this.draft(id,user);if(d.stage!=='answer-review'||!d.pending?.aiProposal)throw Error('אין הצעת ניסוח לשחזור.');return this.store.put('draft',{...d,pending:{...d.pending,text:d.pending.original,aiProposal:false}},revision);}
  reserveAI(user){this.requireService(user);const date=new Date().toISOString().slice(0,10),id=hash([user,date]),limit=Number(process.env.MIRKAM_AI_REQUESTS_PER_DAY)||40;return this.store.atomic(()=>{const usage=this.store.get('usage',id);if((usage?.requests||0)>=limit)throw Error('מכסת בקשות העוזר להיום הסתיימה. אפשר לשמור ולהמשיך בלי העוזר.');if(usage)return this.store.put('usage',{...usage,requests:usage.requests+1});return this.store.create('usage',user,{id,date,requests:1});});}
  async coach(id,user,text=''){
    const d=this.draft(id,user);if(!d.aiEnabled)throw Error('עזרת AI כבויה למסמך זה.');if(!['dialogue','answer-review'].includes(d.stage))throw Error('עזרה אינה זמינה בשלב זה.');if(!this.providers.coach)throw Error('שירות העוזר טרם הוגדר.');
    if(text)text=validText(text);const topic=TOPICS.find(t=>t.key===(d.pending?.key||nextTopic(d)));this.reserveAI(user);
    const result=await this.providers.coach({topic,answers:d.answers,currentAnswer:text||d.pending?.text||'',history:d.dialogue||[]});
    if(typeof result.text!=='string'||!result.text.trim()||result.text.length>1000)throw Error('תשובת העוזר אינה תקינה.');
    if(topic.key!=='case_number'&&/מספר\s+ה?תיק/.test(result.text))result.text='נתמקד במה שתיארת ובשאלה הנוכחית. אפשר להסביר במילים שלך.';
    const updated={...d,dialogue:[...(d.dialogue||[]).slice(-18),{role:'user',text:text||d.pending?.text||topic.label},{role:'assistant',text:result.text}],helper:result.text};
    if(result.draft&&d.pending){updated.pending={...d.pending,text:validText(result.draft),aiProposal:true};}
    return this.store.put('draft',updated,d.revision);
  }
  attach(id,user,input,revision){const d=this.draft(id,user);if(!['dialogue','review'].includes(d.stage))throw Error('אי אפשר לצרף קובץ בשלב זה.');if(d.attachments.length>=10)throw Error('הגעתם למספר הנספחים המותר.');const file=attachmentInput(input.name,input.mime,input.base64);return this.store.atomic(()=>{const attachment=this.store.create('attachment',user,{draftId:id,...file});return this.store.put('draft',{...this.invalidate(d),attachments:[...d.attachments,{id:attachment.id,name:file.name,mime:file.mime,sha256:file.sha256}]},revision);});}
  package(id,user){const d=this.draft(id,user);return documentPackage(d,this.profile(user));}
  offer(id,user,targetId,channel,revision){
    const d=this.draft(id,user);if(d.stage!=='review'||missing(d).length)throw Error('יש להשלים ולאשר את פרטי המסמך.');const target=this.destination(targetId);if(d.court?.id!==targetId)throw Error('יעד השליחה חייב להתאים לבית המשפט שאושר.');
    if(!['email','fax','both'].includes(channel))throw Error('ערוץ שליחה לא מוכר.');if(channel!=='fax'&&!target.email||channel!=='email'&&!target.fax)throw Error('לא הוגדר יעד לערוץ שנבחר.');
    const offered={targetId,channel,fingerprint:reviewFingerprint(d,this.profile(user),target,channel),targetRevision:target.revision,nonce:randomUUID()};
    return this.store.put('draft',{...d,approval:{...offered,confirmed:false}},revision);
  }
  approve(id,user,nonce,accept,revision){const d=this.draft(id,user),a=d.approval;if(accept!==true||!a||a.nonce!==nonce||d.stage!=='review')throw Error('יש לאשר במפורש את החבילה והיעד שנקראו.');const target=this.destination(a.targetId);if(a.targetRevision!==target.revision||a.fingerprint!==reviewFingerprint(d,this.profile(user),target,a.channel))throw Error('המסמך או היעד השתנו. נדרש אישור חדש.');return this.store.put('draft',{...d,approval:{...a,confirmed:true,confirmedAt:Date.now()}},revision);}
  async send(id,user,revision){
    this.requireService(user);
    let d=this.draft(id,user),a=d.approval;if(!a?.confirmed||d.stage!=='review')throw Error('נדרש אישור שליחה מפורש.');const target=this.destination(a.targetId);
    if(a.fingerprint!==reviewFingerprint(d,this.profile(user),target,a.channel)||target.revision!==a.targetRevision)throw Error('המסמך או היעד השתנו.');
    if(!this.providers.deliver||!this.providers.supports?.(a.channel))throw Error('ספק השליחה לערוץ זה לא הוגדר. המסמך נשמר.');
    const delivery=this.store.atomic(()=>{d=this.store.put('draft',{...d,stage:'sending'},revision);return this.store.create('delivery',user,{draftId:id,targetId:target.id,channel:a.channel,status:'sending',idempotencyKey:a.nonce,approvedAt:a.confirmedAt});});
    try{
      const receipt=await this.providers.deliver({idempotencyKey:delivery.idempotencyKey,channel:a.channel,target,documents:this.package(id,user),attachments:d.attachments.map(f=>this.store.owned('attachment',f.id,user))});
      if(!receipt||!['accepted_by_mail_server','accepted_by_fax_provider'].includes(receipt.status))throw Error('Unknown delivery result');
      this.store.put('delivery',{...delivery,status:receipt.status,receipt});this.store.put('draft',{...d,stage:'archived'});return this.store.get('delivery',delivery.id);
    }catch{this.store.put('delivery',{...delivery,status:'delivery_unknown'});this.store.put('draft',{...d,stage:'delivery-unknown'});throw Error('מצב המשלוח אינו ודאי. לא נשלח שוב אוטומטית; יש לבדוק עם המשרד.');}
  }
  contacts(user){return this.store.list('contact',user).filter(c=>c.approved&&c.active);}
  approveContact(user,data,actor){this.identity.user(user);const email=validText(data.email,254).toLowerCase();if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw Error('כתובת איש קשר אינה תקינה.');const limit=Number(process.env.MIRKAM_CONTACT_LIMIT)||5;if(this.contacts(user).length>=limit)throw Error('מגבלת אנשי הקשר הוגדרה במשרד.');if(this.contacts(user).some(c=>c.email===email))throw Error('איש הקשר כבר מאושר.');const r=this.store.create('contact',user,{name:validText(data.name,150),email,approved:true,active:true,approvedBy:actor,approvedAt:Date.now()});this.store.audit(actor,'contact.approved',r.id);return r;}
  compose(user,contactId,text){this.requireService(user);const c=this.store.owned('contact',contactId,user);if(!c.active||!c.approved)throw Error('איש הקשר אינו מאושר.');return this.store.create('message',user,{contactId,text:validText(text),direction:'outgoing',status:'review',contactRevision:c.revision,approval:null});}
  approveMessage(id,user,accept,revision){const m=this.store.owned('message',id,user),c=this.store.owned('contact',m.contactId,user);if(accept!==true||m.status!=='review'||!c.active||!c.approved||c.revision!==m.contactRevision)throw Error('נדרש אישור לתוכן ולאיש הקשר הפעיל.');return this.store.put('message',{...m,approval:hash([m.text,c.email,c.revision]),status:'approved'},revision);}
  async sendMessage(id,user,revision){this.requireService(user);let m=this.store.owned('message',id,user),c=this.store.owned('contact',m.contactId,user);if(m.status!=='approved'||!c.active||!c.approved||m.approval!==hash([m.text,c.email,c.revision]))throw Error('נדרש אישור הודעה מחדש.');if(!this.providers.familyMail||(this.providers.supports&&!this.providers.supports('email')))throw Error('שירות המייל לא הוגדר.');m=this.store.put('message',{...m,status:'sending'},revision);try{const receipt=await this.providers.familyMail({idempotencyKey:m.id,to:c.email,text:m.text,replyToken:m.id});if(receipt?.status!=='accepted_by_mail_server')throw Error();return this.store.put('message',{...m,status:'accepted_by_mail_server',receipt});}catch{this.store.put('message',{...m,status:'delivery_unknown'});throw Error('מצב המייל אינו ודאי. יש לבדוק לפני ניסיון נוסף.');}}
  receiveReply(messageId,sender,text,providerEvent,actor){const m=this.store.get('message',messageId);if(!m||m.direction!=='outgoing')throw Error('שרשור לא נמצא.');const c=this.store.owned('contact',m.contactId,m.owner);if(!c.active||!c.approved||sender.toLowerCase()!==c.email)throw Error('השולח אינו מורשה בשרשור זה.');const id=hash(['incoming',validText(providerEvent,200)]);const existing=this.store.get('message',id);if(existing){if(existing.owner!==m.owner||existing.parentId!==m.id)throw Error('אירוע הספק כבר שויך לשרשור אחר.');return existing;}const r=this.store.create('message',m.owner,{id,direction:'incoming',contactId:c.id,parentId:m.id,text:validText(text),status:'received',verifiedBy:actor});this.store.audit(actor,'message.received',r.id);return r;}
  newConversation(user,name){this.requireService(user);return this.store.create('conversation',user,{name:validText(name,120),messages:[]});}
  async chat(id,user,text,revision){const c=this.store.owned('conversation',id,user);if(revision!==c.revision)throw Error('השיחה השתנתה. טענו אותה מחדש.');if(!this.providers.chat)throw Error('שירות העוזר לא הוגדר.');text=validText(text,3000);this.reserveAI(user);const reply=validText(await this.providers.chat([...c.messages.slice(-18),{role:'user',text}]),5000);return this.store.put('conversation',{...c,messages:[...c.messages,{role:'user',text},{role:'assistant',text:reply}]},revision);}
  announce(text,actor){const a=this.store.create('announcement','all',{text:validText(text),active:true});this.store.audit(actor,'announcement.created',a.id);return a;}
  ticket(user,text){this.identity.user(user);return this.store.create('ticket',user,{text:validText(text),status:'open'});}
  membership(user){const u=this.profile(user);return {status:u.membership==='free'?'free':u.paidUntil>Date.now()?'paid':u.trialUntil>Date.now()?'trial':'expired',trialUntil:u.trialUntil,paidUntil:u.paidUntil||null,renewalConsent:u.renewalConsent,priceAgorot:u.priceAgorot,usage:this.store.list('usage',user)};}
  paymentIntent(user){this.identity.user(user);if(!this.providers.checkout)throw Error('ספק התשלום עדיין לא הוגדר. אין חיוב.');return this.providers.checkout({accountId:user,amountAgorot:4990,currency:'ILS',idempotencyKey:randomUUID()});}
  paymentVerified(user,event,actor){const u=this.identity.user(user);if(event.currency!=='ILS'||event.amountAgorot!==4990||!event.id)throw Error('פרטי התשלום אינם תואמים.');const id=hash(['payment',event.id]);return this.store.atomic(()=>{const existing=this.store.get('payment',id);if(existing){if(existing.owner!==user)throw Error('אירוע התשלום כבר שויך לחשבון אחר.');return existing;}const p=this.store.create('payment',user,{...event,id,status:'paid',verifiedBy:actor});this.store.put('user',{...u,membership:'paid',paidUntil:addCalendarMonths(Math.max(Date.now(),u.paidUntil||0),1)});return p;});}
  recordAudio(user,{providerId,kind='filling',createdAt=Date.now(),data,mime}){if(kind!=='filling')throw Error('הקלטה זו אינה חלק ממדיניות הקלטות המילוי.');return this.store.create('audio',user,{providerId:validText(providerId,200),...(data?{data,mime}:{}),created:createdAt,deleteAfter:addCalendarMonths(createdAt),hold:false,status:'retained'});}
  async disposeTransientAudio(user,providerId){const r=this.store.create('audio',user,{providerId:validText(providerId,200),kind:'transient',created:Date.now(),deleteAfter:Date.now(),hold:false,status:'delete_pending'});if(!this.providers.deleteAudio)return r;try{await this.providers.deleteAudio(providerId);return this.store.put('audio',{...r,status:'deleted',deletedAt:Date.now()});}catch{return r;}}
  holdAudio(id,hold,reason,actor){const r=this.store.get('audio',id);if(!r||typeof hold!=='boolean')throw Error('הקלטה לא נמצאה.');const saved=this.store.put('audio',{...r,hold,holdReason:validText(reason,500)});this.store.audit(actor,'audio.hold-changed',id);return saved;}
  async cleanup(now=Date.now()){const results=[];for(const r of this.store.list('audio')){if(r.hold||r.deleteAfter>now||r.status==='deleted')continue;if(r.providerId==='local'){const {data,...metadata}=r;this.store.put('audio',{...metadata,status:'deleted',deletedAt:now});results.push({id:r.id,status:'deleted'});continue;}if(!this.providers.deleteAudio){results.push({id:r.id,status:'provider_not_configured'});continue;}try{await this.providers.deleteAudio(r.providerId);this.store.put('audio',{...r,status:'deleted',deletedAt:now});results.push({id:r.id,status:'deleted'});}catch{this.store.put('audio',{...r,status:'delete_pending'});results.push({id:r.id,status:'delete_pending'});}}return results;}
  recover(){for(const kind of ['draft','delivery','message'])for(const r of this.store.list(kind)){if(r.stage==='sending')this.store.put(kind,{...r,stage:'delivery-unknown'});if(r.status==='sending')this.store.put(kind,{...r,status:'delivery_unknown'});}for(const c of this.store.list('call'))if(c.phase==='processing'){const j=this.store.get('voice-job',c.jobId);this.store.put('call',{...c,phase:j?.previous||'main',jobId:null,error:'העיבוד נקטע בהפעלה מחדש. העבודה שאושרה נשמרה.'});if(j?.status==='processing')this.store.put('voice-job',{...j,status:'interrupted'});}}
  viewDraft(id,user){const d=this.draft(id,user);return {...d,currentTopic:nextTopic(d),question:prompt(d),missing:missing(d)};}
}
