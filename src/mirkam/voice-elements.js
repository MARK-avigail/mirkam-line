import {timingSafeEqual,randomUUID} from 'node:crypto';
import {createVoice} from './voice.js';
import {callDiagnostics} from './call-health.js';
import {fixedSpeechCache,RECOVERY_PROMPT} from './speech-cache.js';

const callPattern=/^VE[a-f0-9]{32}$/;
const MAX_AUDIO=6*1024*1024;
const authorized=req=>{
  const key=process.env.VOICE_ELEMENTS_BRIDGE_TOKEN;
  if(!key||key.length<32)return false;
  const a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+key);
  return a.length===b.length&&timingSafeEqual(a,b);
};
async function bytes(req,limit){const chunks=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>limit)throw Object.assign(Error('Payload too large'),{status:413});chunks.push(b);}return Buffer.concat(chunks,size);}

// The bridge uses its own authenticated endpoint and VE call IDs. It never
// disables signature verification on the existing Twilio endpoint.
export function createVoiceElements(service){
  const store=service.store;
  const purge=()=>{if(!store.closed)for(const r of store.list('bridge-audio'))if(r.expiresAt<Date.now())store.remove('bridge-audio',r.id);};
  purge();
  const cleanupTimer=setInterval(()=>{try{purge();}catch{console.error('Bridge recording cleanup failed');}},60000);cleanupTimer.unref();
  function recording(id){
    if(typeof id!=='string'||!/^ve:[a-f0-9-]{36}$/.test(id))throw Error('Invalid recording reference');
    const r=store.get('bridge-audio',id);
    if(!r||r.expiresAt<Date.now())throw Error('Recording expired');
    return r;
  }
  const voice=createVoice(service,{
    callPattern,
    authorize:(req,data)=>{
      if(!authorized(req)||store.get('call',data.CallSid)?.phase==='ended')return false;
      if(data.RecordingUrl){
        try{const r=recording(data.RecordingUrl),nonce=new URL(req.url,'http://localhost').searchParams.get('record');return r.callId===data.CallSid&&r.nonce===nonce&&(!data.RecordingSid||data.RecordingSid===data.RecordingUrl);}catch{return false;}
      }
      return true;
    },
    transcribe:async id=>{const r=recording(id);try{return await service.providers.transcribe(Buffer.from(r.data,'base64'),'audio/wav');}finally{store.remove('bridge-audio',id);}},
    retain:(user,id)=>{const r=recording(id);if(r.owner!==user)throw Error('Recording owner mismatch');return service.recordAudio(user,{providerId:'local',data:r.data,mime:'audio/wav'});},
    track:(user,id)=>{const r=recording(id);if(r.owner!==user)throw Error('Recording owner mismatch');return service.trackTransientAudio(user,'local');},
    dispose:async(user,id,recordId)=>{try{return await service.disposeTransientAudio(user,'local',recordId);}finally{store.remove('bridge-audio',id);}}
  });
  const speechCache=fixedSpeechCache();
  let speechBusy=0,speechWindow=0,speechCount=0;
  const synthesize=text=>speechCache.get(text,async()=>{
          if(Date.now()-speechWindow>60000){speechWindow=Date.now();speechCount=0;}
          if(speechBusy>=2||speechCount>=60)throw Object.assign(Error('Speech limit reached'),{status:429});
          speechBusy++;speechCount++;
          try{
            if(!service.providers.speak)throw Error('Speech provider not configured');
            return await service.providers.speak(text);
          }finally{speechBusy--;}
        });

  const handler=async(req,res)=>{
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(!authorized(req))return json({ok:false,error:'Unauthorized bridge'},403);
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method!=='POST')return json({ok:false},405);
      if(url.pathname==='/voice-elements/ready')return json({ok:true,protocol:1,liveVerified:false});
      if(url.pathname==='/voice-elements/recovery'){
        await bytes(req,1000);
        const audio=await synthesize(RECOVERY_PROMPT);
        if(!Buffer.isBuffer(audio)||!audio.length||audio.length>MAX_AUDIO)throw Error('Invalid recovery audio');
        res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});return res.end(audio);
      }
      if(url.pathname==='/voice-elements/speech-recover'){
        const data=JSON.parse((await bytes(req,1000)).toString('utf8'));
        const c=callPattern.test(data.callId||'')&&store.get('call',data.callId);
        if(!c||c.phase==='ended')throw Error('Call is no longer active');
        let token=c.token;try{if(token)service.identity.authenticate(token);}catch{token=null;}
        store.put('call',{...c,phase:token?'main':'login-code',token,code:null,inputNonce:null,recordNonce:null,jobId:null,speech:null,error:null,silence:0,messagePresented:null,deliveryPresented:null,speechRecoveries:(c.speechRecoveries||0)+1});
        return json({ok:true});
      }
      if(url.pathname==='/voice-elements/step'){
        req.url='/voice/step'+url.search;
        return await voice(req,res);
      }
      if(url.pathname==='/voice-elements/end'){
        const data=JSON.parse((await bytes(req,1000)).toString('utf8'));
        if(!callPattern.test(data.callId||''))throw Error('Invalid call');
        const c=store.get('call',data.callId);
        if(c){if(c.token)service.identity.logout(c.token);store.put('call',{...c,phase:'ended',token:null,code:null,inputNonce:null,recordNonce:null,jobId:null,endedAt:c.endedAt||Date.now(),diagnostics:c.diagnostics||callDiagnostics(data.diagnostics)});}
        for(const r of store.list('bridge-audio'))if(r.callId===data.callId)store.remove('bridge-audio',r.id);
        return json({ok:true});
      }
      if(url.pathname==='/voice-elements/record'){
        const id=url.searchParams.get('call'),nonce=url.searchParams.get('record'),c=store.get('call',id);
        if(!callPattern.test(id||'')||!c?.token||!nonce||nonce!==c.recordNonce)throw Error('No active recording prompt');
        const user=service.identity.authenticate(c.token).user;
        const audio=await bytes(req,MAX_AUDIO);
        if(audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('Expected WAV audio');
        service.identity.authenticate(c.token);
        if(store.get('call',id)?.recordNonce!==nonce)throw Error('Recording prompt changed');
        for(const r of store.list('bridge-audio'))if(r.expiresAt<Date.now())store.remove('bridge-audio',r.id);
        // One upload per prompt; retries reuse the first accepted recording.
        let item=store.list('bridge-audio',user.id).find(r=>r.callId===id&&r.nonce===nonce);
        if(!item)item=store.create('bridge-audio',user.id,{id:'ve:'+randomUUID(),callId:id,nonce,data:audio.toString('base64'),expiresAt:Date.now()+600000});
        return json({ok:true,recording:item.id});
      }
      if(url.pathname==='/voice-elements/speech'){
        const data=JSON.parse((await bytes(req,16000)).toString('utf8'));
        const c=callPattern.test(data.callId||'')&&store.get('call',data.callId);
        if(!c||c.phase==='ended'||typeof data.text!=='string'||!data.text.trim()||data.text.length>4000)throw Error('Invalid speech request');
        if(c.token)service.identity.authenticate(c.token);
        let audio;
        try{audio=await synthesize(data.text);}catch(error){
          const current=store.get('call',data.callId);
          const code=error.providerCode==='timeout'?'timeout':error.providerCode==='network'?'network':[401,403,429].includes(error.providerStatus)?'http-'+error.providerStatus:error.status===429?'local-limit':'provider-error';
          if(current&&current.phase!=='ended')store.put('call',{...current,speechFailureCode:code,speechFailureAt:Date.now(),speechFailureCount:(current.speechFailureCount||0)+1});
          throw Object.assign(Error('Speech provider unavailable'),{status:503});
        }
        {
          const current=store.get('call',data.callId);
          if(!current||current.phase==='ended'||current.token!==c.token)throw Error('Call is no longer active');
          if(c.token)service.identity.authenticate(c.token);
          if(!Buffer.isBuffer(audio)||!audio.length||audio.length>MAX_AUDIO)throw Error('Invalid speech response');
          res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});return res.end(audio);
        }
      }
      return json({ok:false},404);
    }catch(e){if(!res.headersSent)json({ok:false,error:'Voice bridge request failed'},[413,429,503].includes(e.status)?e.status:400);else res.end();}
  };
  handler.close=()=>{clearInterval(cleanupTimer);speechCache.clear();};
  return handler;
}
