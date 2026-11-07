// List metadata only; audio is fetched separately through an owner-only route.
const formats=new Set(['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg']);
const mimeOf=r=>String(r.mime||'').split(';')[0].trim().toLowerCase();
function availability(r,now=Date.now()){
  if(r.status!=='retained')return 'unavailable';
  if(!r.hold&&(!Number.isFinite(r.deleteAfter)||r.deleteAfter<=now))return 'expired';
  if(r.providerId!=='local')return 'provider-only';
  if(!formats.has(mimeOf(r))||typeof r.data!=='string'||!r.data.length||r.data.length>12*1024*1024)return 'unavailable';
  const bytes=Buffer.from(r.data,'base64');
  if(!bytes.length||bytes.toString('base64')!==r.data)return 'unavailable';
  return 'available';
}
export function recordingList(store,user){
  return store.list('audio',user).sort((a,b)=>(b.created||0)-(a.created||0)).map(r=>({id:r.id,kind:['filling','chat','family-compose','ticket'].includes(r.kind)?r.kind:'filling',created:r.created,deleteAfter:r.deleteAfter,hold:!!r.hold,availability:availability(r)}));
}
export function recordingFile(store,user,id){
  const r=store.get('audio',id);
  if(!r||r.owner!==user)throw Object.assign(Error('ההקלטה לא נמצאה בתיק זה.'),{status:404});
  if(availability(r)!=='available')throw Object.assign(Error('האודיו אינו זמין להאזנה.'),{status:410});
  const bytes=Buffer.from(r.data,'base64');
  if(!bytes.length||bytes.toString('base64')!==r.data)throw Object.assign(Error('קובץ ההקלטה אינו תקין.'),{status:410});
  return {bytes,mime:mimeOf(r)};
}
