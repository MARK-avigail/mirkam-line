import {createHash} from 'node:crypto';
const BASE='https://rest.interfax.net/inbound/faxes';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=()=>Error('קליטת הפקס לא הושלמה. המסמכים שכבר נקלטו נשמרו; אפשר לבדוק שוב.');
const validId=x=>typeof x==='string'&&/^[1-9][0-9]{0,18}$/.test(x);
async function bounded(response,max){
 if(!response.ok){await response.body?.cancel();throw fail();}
 const reader=response.body?.getReader();if(!reader)throw fail();let size=0,done=false;const chunks=[];
 try{while(true){const part=await reader.read();if(part.done){done=true;break;}size+=part.value.length;if(size>max)throw fail();chunks.push(Buffer.from(part.value));}return Buffer.concat(chunks);}
 finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function inboundFaxProvider({env=process.env,request=(...args)=>fetch(...args)}={}){
 const configured=()=>env.MIRKAM_FAX_PROVIDER==='interfax'&&Boolean(env.INTERFAX_USERNAME&&env.INTERFAX_PASSWORD);
 const get=async(url,accept,max)=>{
  if(!configured()||env.INTERFAX_USERNAME.includes(':'))throw fail();
  try{return await bounded(await request(url,{method:'GET',headers:{Authorization:'Basic '+Buffer.from(env.INTERFAX_USERNAME+':'+env.INTERFAX_PASSWORD).toString('base64'),Accept:accept},redirect:'error',signal:AbortSignal.timeout(15000)}),max);}catch{throw fail();}
 };
 return {
  configured,account:()=>hash('interfax:'+String(env.INTERFAX_USERNAME||'')),
  async list(lastId=''){
   if(lastId&&!validId(lastId))throw fail();
   const url=new URL(BASE);url.search=new URLSearchParams({limit:'10',unreadOnly:'false',allUsers:'false',...(lastId?{lastId}:{})}).toString();
   let rows;try{rows=JSON.parse((await get(url,'application/json',65536)).toString().replace(/("messageId"\s*:\s*)(\d+)/g,'$1"$2"'));}catch{throw fail();}
   if(!Array.isArray(rows)||rows.length>10)throw fail();
   let previous=lastId;
   return rows.map(r=>{const id=String(r?.messageId||'');if(!validId(id)||previous&&BigInt(id)>=BigInt(previous))throw fail();previous=id;
    if(!Number.isSafeInteger(r.pages)||r.pages<0||r.pages>1000)throw fail();
    return {providerId:id,pages:r.pages,receivedAt:String(r.receiveTime||'').slice(0,80),sender:String(r.callerId||r.remoteCSID||'').slice(0,100)};
   });
  },
  async image(id){
   if(!validId(id))throw fail();const content=await get(BASE+'/'+id+'/image','application/pdf, image/tiff',20*1024*1024);
   const sig=content.subarray(0,4).toString('hex');const mime=content.subarray(0,5).toString()==='%PDF-'?'application/pdf':['49492a00','4d4d002a'].includes(sig)?'image/tiff':null;
   if(!mime)throw fail();return {content,mime};
  }
 };
}
export function createFaxInbox(service,{provider=inboundFaxProvider(),env=process.env}={}){
 const store=service.store;let running=null,timer=null,closed=false,lastError=null;
 const metadata=()=>store.list('fax-incoming');
 const status=()=>({configured:provider.configured(),running:Boolean(running),error:lastError,items:metadata(),scan:store.get('fax-scan',provider.account())||null});
 async function perform(){
  if(closed||!provider.configured())throw Error('פרטי חשבון הפקס טרם הוגדרו בשרת.');
  const account=provider.account(),state=store.get('fax-scan',account),rows=await provider.list(state?.cursor||'');
  let imported=0;
  for(const row of rows){
   if(closed)throw fail();const id=hash(account+':'+row.providerId);
   if(store.get('fax-incoming',id))continue;
   const image=await provider.image(row.providerId);if(closed)throw fail();
   store.atomic(()=>{
    store.create('fax-file','staff',{id,mime:image.mime,data:image.content.toString('base64')});
    store.create('fax-incoming','staff',{id,...row,account,mime:image.mime,status:'unassigned',userId:null});
    store.audit('interfax','fax.received',id);
   });imported++;
  }
  if(closed)throw fail();const scan={id:account,cursor:rows.length===10?rows.at(-1).providerId:'',checkedAt:Date.now(),imported,olderPending:rows.length===10};
  if(state)store.put('fax-scan',{...state,...scan});else store.create('fax-scan','staff',scan);
  return status();
 }
 function sync(){if(!running)running=perform().then(result=>{lastError=null;return {...result,error:null};}).catch(error=>{lastError='INBOUND_FAX_UNAVAILABLE';throw error;}).finally(()=>{running=null;});return running;}
 function assign(id,userId,revision,actor){
  const item=store.get('fax-incoming',id);if(!item)throw Error('הפקס לא נמצא.');
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('יש לרענן את רשימת הפקסים לפני השיוך.');
  if(typeof userId!=='string'||!store.get('user',userId))throw Error('יש לבחור משתמש קיים.');
  return store.atomic(()=>{const saved=store.put('fax-incoming',{...item,userId,status:'assigned',assignedBy:actor,assignedAt:Date.now()},revision);store.audit(actor,'fax.assigned',id);return saved;});
 }
 return {status,sync,assign,
  file(id){const r=store.get('fax-file',id);if(!r)throw Error('קובץ הפקס לא נמצא.');return {mime:r.mime,content:Buffer.from(r.data,'base64')};},
  start(){if(timer||env.MIRKAM_FAX_INBOUND_ENABLED!=='true')return;timer=setInterval(()=>{if(!closed)sync().catch(()=>{});},60000);timer.unref();},
  close(){closed=true;clearInterval(timer);}
 };
}
