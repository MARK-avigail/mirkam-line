const reasons=new Set(['remote-disconnect','duration-limit','workflow-hangup','loop-limit','no-next-instruction','error']);
const stages=new Set(['answer','workflow','speech-generate','speech-convert','speech-play','collect-digits','record','record-upload']);
export function callDiagnostics(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const result={};
  if(Number.isInteger(value.durationSeconds)&&value.durationSeconds>=0&&value.durationSeconds<=86400)result.durationSeconds=value.durationSeconds;
  if(reasons.has(value.reason))result.reason=value.reason;
  if(stages.has(value.stage))result.stage=value.stage;
  for(const key of ['generalCause','gcCause','dropError','scheduledDropSeconds','maxSpeechMs']){
    const n=value[key];if(Number.isInteger(n)&&n>=-2147483648&&n<=2147483647)result[key]=n;
  }
  return Object.keys(result).length?result:null;
}
export function callHealth(store){
  const recent=store.list('call').filter(c=>Number.isSafeInteger(c.endedAt)&&c.diagnostics).sort((a,b)=>b.endedAt-a.endedAt).slice(0,10).map(c=>({endedAt:c.endedAt,...callDiagnostics(c.diagnostics),...(Number.isSafeInteger(c.speechRecoveries)?{speechRecoveries:c.speechRecoveries}:{}),...(Number.isSafeInteger(c.processingMs)?{processingMs:c.processingMs}:{}),...(['timeout','network','http-401','http-403','http-429','local-limit','provider-error'].includes(c.speechFailureCode)?{speechFailureCode:c.speechFailureCode}:{})}));
  return {recent,liveVerified:false};
}
