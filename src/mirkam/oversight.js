export class Oversight {
  constructor(service){this.service=service;this.store=service.store;}
  grant(id,actor){return this.store.atomic(()=>{const u=this.store.get('user',id);if(!u)throw Error('החשבון לא נמצא.');const result=this.store.put('user',{...u,oversight:true,membership:'free'});this.store.audit(actor,'oversight.granted',id);return {id:result.id,code:result.code};});}
  require(id){const u=this.service.identity.user(id);if(u.oversight!==true)throw Object.assign(Error('אין הרשאת פיקוח.'),{status:403});return u;}
  target(actor,code){this.require(actor);const u=this.store.list('user').find(u=>u.code===code);if(!u)throw Error('קוד המשתמש לא נמצא.');return u;}
  read(actor,code,kind){const u=this.target(actor,code);if(!['conversation','draft'].includes(kind))throw Error('סוג מידע לא מורשה.');this.store.audit(actor,'oversight.read.'+kind,u.id);return this.store.list(kind,u.id);}
  summary(actor){this.require(actor);this.store.audit(actor,'oversight.summary',actor);const users=this.store.list('user'),payments=this.store.list('payment');return {accounts:users.length,active:users.filter(u=>u.active).length,aiRequests:this.store.list('usage').reduce((n,r)=>n+(r.requests||0),0),paymentsAgorot:payments.filter(p=>p.status==='paid').reduce((n,p)=>n+(p.amountAgorot||0),0),tickets:this.store.list('ticket').length,aiConfigured:Boolean(process.env.OPENAI_API_KEY),emailConfigured:Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS)};}
  suspend(actor,code,active){const u=this.target(actor,code);if(u.id===actor||u.oversight)throw Error('חשבון פיקוח ניתן לשינוי רק בידי בעלת המערכת.');return this.service.identity.suspend(u.id,active,actor);}
}
