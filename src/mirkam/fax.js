import {randomUUID} from 'node:crypto';
const BASE='https://rest.interfax.net';
const MAX_BYTES=20*1024*1024;
const fail=()=>Error('לא התקבל אישור תקין מספק הפקס. אין לשלוח שוב לפני בירור.');
export function faxNumber(value){
  if(typeof value!=='string')throw Error('מספר פקס חסר.');
  // Existing destinations may contain Israeli national notation.
  const result=/^0[2-9]\d{7,8}$/.test(value)?'+972'+value.slice(1):value;
  if(!/^\+[1-9]\d{7,14}$/.test(result))throw Error('מספר הפקס חייב להיות בפורמט בינלאומי תקין.');
  return result;
}
export function interfaxProvider({env=process.env,request=(...args)=>fetch(...args)}={}){
  const configured=()=>env.MIRKAM_FAX_PROVIDER==='interfax'&&Boolean(env.INTERFAX_USERNAME&&env.INTERFAX_PASSWORD&&env.MIRKAM_FAX_TEST_NUMBER);
  function headers(){if(!configured())throw Error('חיבור הפקס לניסיון טרם הוגדר.');if(env.INTERFAX_USERNAME.includes(':'))throw Error('שם משתמש הפקס אינו תקין.');return {Authorization:'Basic '+Buffer.from(env.INTERFAX_USERNAME+':'+env.INTERFAX_PASSWORD).toString('base64'),Accept:'application/json'};}
  function validate(target,attachments=[]){
    headers();const to=faxNumber(target.fax);
    if(to!==faxNumber(env.MIRKAM_FAX_TEST_NUMBER))throw Error('הפקס מוגבל כרגע למספר הניסיון שהוגדר במשרד.');
    let size=0;
    for(const a of attachments){if(!['application/pdf','image/png','image/jpeg'].includes(a.mime))throw Error('סוג נספח לא נתמך בפקס.');size+=Buffer.from(a.base64||'','base64').length;}
    if(size>MAX_BYTES)throw Error('חבילת הפקס גדולה מדי.');
    return to;
  }
  return {
    configured,validate,
    async send({target,files,idempotencyKey}){
      const to=validate(target);
      if(typeof idempotencyKey!=='string'||!/^[a-f0-9-]{36}$/.test(idempotencyKey))throw Error('אסמכתת פקס אינה תקינה.');
      if(!Array.isArray(files)||!files.length||files.length>20)throw Error('חבילת הפקס אינה תקינה.');
      const boundary='mirkam-'+randomUUID(),parts=[];let size=0;
      for(const [i,f] of files.entries()){
        if(!Buffer.isBuffer(f.content)||!f.content.length||!['application/pdf','image/png','image/jpeg'].includes(f.contentType))throw Error('קובץ פקס אינו תקין.');
        size+=f.content.length;if(size>MAX_BYTES)throw Error('חבילת הפקס גדולה מדי.');
        parts.push(Buffer.from(`--${boundary}\r\nContent-Type: ${f.contentType}\r\nContent-Disposition: attachment; filename="part-${i}.${f.contentType==='application/pdf'?'pdf':f.contentType==='image/png'?'png':'jpg'}"\r\n\r\n`),f.content,Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      const url=new URL('/outbound/faxes',BASE);
      // reference is a correlation ID, NOT provider-side idempotency. Never retry POST.
      url.search=new URLSearchParams({faxNumber:to,reference:idempotencyKey,retriesToPerform:'0'}).toString();
      let response;
      try{response=await request(url,{method:'POST',headers:{...headers(),'Content-Type':'multipart/mixed; boundary='+boundary},body:Buffer.concat(parts),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw fail();}
      const location=response.headers.get('location');await response.body?.cancel();
      if(response.status!==201||!location)throw fail();
      let result;try{result=new URL(location,BASE);}catch{throw fail();}
      const match=result.pathname.match(/^\/outbound\/faxes\/([1-9]\d{0,18})$/);
      if(result.origin!==BASE||result.username||result.password||result.search||result.hash||!match)throw fail();
      return {provider:'interfax',status:'accepted_by_fax_provider',providerId:match[1],reference:idempotencyKey,delivered:false};
    },
    async status(providerId){
      if(typeof providerId!=='string'||! /^[1-9]\d{0,18}$/.test(providerId))throw Error('מזהה פקס אינו תקין.');
      let response;
      try{response=await request(BASE+'/outbound/faxes/'+providerId,{headers:headers(),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw fail();}
      if(!response.ok){await response.body?.cancel();throw fail();}
      const reader=response.body?.getReader();if(!reader)throw fail();let size=0,complete=false;const chunks=[];
      try{
        while(true){const p=await reader.read();if(p.done){complete=true;break;}size+=p.value.length;if(size>65536)throw fail();chunks.push(Buffer.from(p.value));}
        const raw=Buffer.concat(chunks).toString();
        // IDs are Int64: preserve digits before JSON.parse to avoid rounding.
        const data=JSON.parse(raw.replace(/("id"\s*:\s*)(\d+)/g,'$1"$2"'));
        if(String(data.id)!==providerId||!Number.isInteger(data.status))throw fail();
        return {provider:'interfax',providerId,providerStatus:data.status,status:data.status===0?'fax_delivered':data.status<0?'accepted_by_fax_provider':'fax_failed',delivered:data.status===0,pagesSent:Number.isSafeInteger(data.pagesSent)&&data.pagesSent>=0?data.pagesSent:null};
      }catch{throw fail();}finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
  };
}
