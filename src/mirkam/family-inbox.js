import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const script=fileURLToPath(new URL('../../scripts/mail/read-family-inbox.py',import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const configured=()=>process.env.MIRKAM_INBOUND_MAIL_ENABLED!=='0'&&process.env.SMTP_HOST?.toLowerCase()==='smtp.gmail.com'&&Boolean(process.env.SMTP_USER&&process.env.SMTP_PASS);
const safeCodes=new Set(['INBOUND_NOT_CONFIGURED','INBOUND_LOGIN_FAILED','INBOUND_MAILBOX_UNAVAILABLE','INBOUND_SEARCH_FAILED','INBOUND_FETCH_FAILED','INBOUND_INVALID_RESPONSE','INBOUND_UNAVAILABLE','INBOUND_INPUT_LIMIT','INBOUND_INVALID_INPUT']);
const fail=code=>Object.assign(Error('בדיקת המייל החוזר לא הושלמה.'),{code:safeCodes.has(code)?code:'INBOUND_UNAVAILABLE'});
export function readFamilyMailbox(input){
  return new Promise((resolve,reject)=>{
    const child=execFile(process.env.PYTHON_BIN||'python3',[script],{
      timeout:35000,maxBuffer:1024*1024,windowsHide:true,
      env:{PATH:process.env.PATH,PYTHONIOENCODING:'utf-8',SMTP_HOST:process.env.SMTP_HOST,SMTP_USER:process.env.SMTP_USER,SMTP_PASS:process.env.SMTP_PASS,...(process.env.SSL_CERT_FILE?{SSL_CERT_FILE:process.env.SSL_CERT_FILE}:{})}
    },(error,stdout)=>{
      if(error)return reject(fail('INBOUND_UNAVAILABLE'));
      try{const result=JSON.parse(stdout);if(!result.ok)return reject(fail(result.code));resolve(result);}catch(e){reject(safeCodes.has(e.code)?e:fail('INBOUND_INVALID_RESPONSE'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(input));
  });
}
export function createFamilyInbox(service,{read=service.providers.familyInbox||readFamilyMailbox,enabled=()=>Boolean(service.providers.familyInbox)||configured(),now=Date.now}={}){
  const store=service.store;
  let running=null,timer=null,closed=false;
  const state=()=>store.closed?null:store.get('mail-sync','family-inbox');
  const save=value=>{const previous=state();return previous?store.put('mail-sync',{...previous,...value}):store.create('mail-sync','system',{id:'family-inbox',...value});};
  const status=()=>{
    const s=state()||{};
    return {configured:Boolean(enabled()),busy:Boolean(running),checkedAt:s.checkedAt||null,lastImported:s.lastImported||0,totalImported:s.totalImported||0,scanned:s.scanned||0,pending:Boolean(s.pending),skipped:s.skipped||{},error:s.error||null,attachmentsIgnored:s.attachmentsIgnored||0};
  };
  async function perform(){
    if(closed||!enabled())return {...status(),error:'INBOUND_NOT_CONFIGURED'};
    const parents={};let earliest=now(),count=0;
    for(const m of store.list('message')){
      if(m.direction!=='outgoing'||!['sending','accepted_by_mail_server','delivery_unknown'].includes(m.status))continue;
      if(count>=500)break;count++;
      parents[`<${m.id}@mirkam.invalid>`]=m.id;
      if(typeof m.receipt?.messageId==='string'&&/^<[^<>\s\x00-\x20]{1,200}>$/.test(m.receipt.messageId))parents[m.receipt.messageId]=m.id;
      earliest=Math.min(earliest,m.createdAt);
    }
    if(!count){save({checkedAt:now(),lastImported:0,scanned:0,error:'INBOUND_NO_SENT_THREADS'});return status();}
    const mailbox=digest((process.env.SMTP_USER||'test-mailbox').toLowerCase()),before=state();
    const prior=before?.mailbox===mailbox?before:{};
    try{
      const result=await read({parents,cursor:prior.cursor||0,uidValidity:prior.uidValidity||0,since:new Date(Math.max(now()-30*86400000,earliest-2*86400000)).toISOString().slice(0,10)});
      if(closed||store.closed)throw fail('INBOUND_UNAVAILABLE');
      if(!Number.isSafeInteger(result.uidValidity)||result.uidValidity<=0||!Number.isSafeInteger(result.cursor)||result.cursor<0||!Number.isSafeInteger(result.scanned)||result.scanned<0||result.scanned>50||!Array.isArray(result.replies)||result.replies.length>50||typeof result.pending!=='boolean')throw fail('INBOUND_INVALID_RESPONSE');
      if(result.uidValidity===prior.uidValidity&&result.cursor<(prior.cursor||0))throw fail('INBOUND_INVALID_RESPONSE');
      if(result.replies.length>result.scanned)throw fail('INBOUND_INVALID_RESPONSE');
      let imported=0,attachments=0;
      const seenUids=new Set();
      const skipped={};for(const [key,value] of Object.entries(result.skipped||{}))if(['sender','unrelated','ambiguous','authentication','body','oversized'].includes(key)&&Number.isSafeInteger(value)&&value>=0&&value<=50)skipped[key]=value;
      store.atomic(()=>{
        for(const item of result.replies){
          if(!Number.isSafeInteger(item.uid)||item.uid<=0||item.uid>result.cursor||typeof item.text!=='string'||!item.text.trim()||item.text.length>5000||typeof item.sender!=='string'||item.sender.length>254||!Object.values(parents).includes(item.parentId))throw fail('INBOUND_INVALID_RESPONSE');
          if(seenUids.has(item.uid)||(result.uidValidity===prior.uidValidity&&item.uid<=(prior.cursor||0)))throw fail('INBOUND_INVALID_RESPONSE');seenUids.add(item.uid);
          const parent=store.get('message',item.parentId),contact=parent&&store.get('contact',parent.contactId);
          if(!parent||!contact||contact.owner!==parent.owner||!contact.active||!contact.approved||contact.email!==item.sender.toLowerCase()){skipped.contact=(skipped.contact||0)+1;continue;}
          const messageId=typeof item.messageId==='string'&&/^<[^<>\s]{1,200}>$/.test(item.messageId)?item.messageId:`uid:${result.uidValidity}:${item.uid}`;
          const event='gmail-imap:'+digest(mailbox+':'+messageId);
          const previous=store.get('message',digest(JSON.stringify(['incoming',event])));
          if(previous){if(previous.owner!==parent.owner||previous.parentId!==parent.id)skipped.ambiguous=(skipped.ambiguous||0)+1;else skipped.duplicate=(skipped.duplicate||0)+1;continue;}
          service.receiveReply(parent.id,item.sender,item.text,event,'gmail-imap');imported++;if(item.hasAttachments)attachments++;
        }
        save({mailbox,uidValidity:result.uidValidity,cursor:result.cursor,checkedAt:now(),lastImported:imported,totalImported:(before?.totalImported||0)+imported,scanned:result.scanned,pending:result.pending,skipped,error:null,attachmentsIgnored:attachments});
      });
      return status();
    }catch(error){
      if(!closed&&!store.closed)save({checkedAt:now(),lastImported:0,error:safeCodes.has(error.code)?error.code:'INBOUND_UNAVAILABLE'});
      return status();
    }
  }
  function sync(){if(running)return running;running=perform().finally(()=>{running=null;});return running;}
  async function tick(){
    try{await sync();}catch{ /* Never log mailbox, sender, credentials or content. */ }
    if(!closed){timer=setTimeout(tick,status().error?300000:status().pending?5000:60000);timer.unref?.();}
  }
  return {status,sync,start(){if(!closed&&!timer&&enabled()){timer=setTimeout(tick,1000);timer.unref?.();}},close(){closed=true;clearTimeout(timer);}};
}
