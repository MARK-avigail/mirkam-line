import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLivePreview,liveVoiceProvider,CUSTOM_LIVE_VOICE} from '../../src/mirkam/live-voice.js';
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const answer={session:{id:'live_test'},transport:{type:'webrtc',sdp}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('custom voice uses Live session, never TTS, with no tools or credentials in response',async t=>{
 const old=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-secret';
 t.after(()=>{globalThis.fetch=old;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;});
 let seen;
 globalThis.fetch=async(url,opts)=>{seen={url,opts,body:JSON.parse(opts.body)};return Response.json({...answer,secret:'must not return',session:{...answer.session,secret:'must not return'}});};
 assert.deepEqual(await liveVoiceProvider().create(sdp),answer);
 assert.equal(seen.url,'https://api.openai.com/v1/live/sessions');assert.equal(seen.opts.redirect,'error');
 assert.equal(seen.body.session.audio.output.voice.id,CUSTOM_LIVE_VOICE);assert.equal(seen.body.session.model,'gpt-live-1');
 assert.deepEqual(seen.body.session.delegation,{type:'client'});assert.equal(seen.body.session.store,false);
 assert.equal(seen.body.session.audio.format,undefined);assert.equal(seen.body.transport.sdp,sdp);
 assert.doesNotMatch(JSON.stringify(seen.body),/test-secret/);
});
test('provider access errors are safe and do not retry paid session creation',async t=>{
 const old=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';let calls=0;
 t.after(()=>{globalThis.fetch=old;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;});
 globalThis.fetch=async()=>{calls++;return new Response('SECRET ERROR',{status:404});};
 await assert.rejects(liveVoiceProvider().create(sdp),e=>e.status===502&&!e.message.includes('SECRET')&&e.message.includes('פרויקט'));assert.equal(calls,1);
});
test('malformed SDP is rejected before contacting provider',async()=>{
 let calls=0;const manager=createLivePreview({create:async()=>{calls++;return answer;},close:async()=>{}});
 for(const bad of ['',null,'x'.repeat(65000),'v=0\r\nm=video'])await assert.rejects(manager.start('owner',bad,()=>{}));assert.equal(calls,0);
});
test('one in-flight session, same-actor stop, and late cancellation clean up',async()=>{
 const pending=deferred(),closed=[];const manager=createLivePreview({create:()=>pending.promise,close:async id=>closed.push(id)});
 const first=manager.start('owner',sdp,()=>{});
 await assert.rejects(manager.start('owner',sdp,()=>{}),e=>e.status===409);
 await assert.rejects(manager.stop('other'),e=>e.status===403);
 await manager.stop('owner');pending.resolve(answer);await assert.rejects(first,e=>e.status===409);
 assert.deepEqual(closed,['live_test']);assert.equal(manager.status('owner').active,false);
});
test('revoked authentication during provider wait closes session and returns no SDP',async()=>{
 const closed=[];const manager=createLivePreview({create:async()=>answer,close:async id=>closed.push(id)});
 await assert.rejects(manager.start('owner',sdp,()=>{throw Error('revoked');}),/revoked/);
 assert.deepEqual(closed,['live_test']);assert.equal(manager.status('owner').active,false);
});
test('server timer ends preview even when the browser does not send stop',async()=>{
 const ended=deferred();const manager=createLivePreview({create:async()=>answer,close:async()=>ended.resolve()},{durationMs:20});
 await manager.start('owner',sdp,()=>{});
 await Promise.race([ended.promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('not closed')),1000);ended.promise.then(()=>clearTimeout(timer));})]);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(manager.status('owner').active,false);
});
test('failed remote hangup keeps occupied slot until a confirmed close',async()=>{
 let fail=true;const manager=createLivePreview({create:async()=>answer,close:async()=>{if(fail)throw Error('close failed');}});
 await manager.start('owner',sdp,()=>{});await assert.rejects(manager.stop('owner'),/close failed/);
 assert.equal(manager.status('owner').closing,true);await assert.rejects(manager.start('owner',sdp,()=>{}),e=>e.status===409);
 fail=false;await manager.stop('owner');assert.equal(manager.status('owner').active,false);
});
test('trial limit counts failed attempts and resets only after time window',async()=>{
 let clock=1000000,calls=0;const manager=createLivePreview({create:async()=>{calls++;throw Error('no access');},close:async()=>{}},{now:()=>clock});
 for(let n=0;n<3;n++)await assert.rejects(manager.start('owner',sdp,()=>{}),/no access/);
 await assert.rejects(manager.start('owner',sdp,()=>{}),e=>e.status===429);assert.equal(calls,3);
 clock+=600001;await assert.rejects(manager.start('owner',sdp,()=>{}),/no access/);assert.equal(calls,4);
});
test('dispose closes active session and forbids creating a new one',async()=>{
 let closed=0;const manager=createLivePreview({create:async()=>answer,close:async()=>{closed++;}});
 await manager.start('owner',sdp,()=>{});await manager.dispose();assert.equal(closed,1);
 await assert.rejects(manager.start('owner',sdp,()=>{}),e=>e.status===503);
});
test('hangup encodes opaque session ID and never follows a redirect',async t=>{
 const old=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';
 t.after(()=>{globalThis.fetch=old;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;});
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://api.openai.com/v1/live/sessions/opaque%2Fid/hangup');assert.equal(opts.redirect,'error');return new Response(null,{status:204});};
 await liveVoiceProvider().close('opaque/id');
});

test('project header scopes creation and hangup while keeping the selected custom voice',async t=>{
 const old=globalThis.fetch,key=process.env.OPENAI_API_KEY,project=process.env.MIRKAM_LIVE_PROJECT_ID;
 process.env.OPENAI_API_KEY='test-secret';process.env.MIRKAM_LIVE_PROJECT_ID='proj_synthetic123';
 t.after(()=>{globalThis.fetch=old;for(const [name,value] of [['OPENAI_API_KEY',key],['MIRKAM_LIVE_PROJECT_ID',project]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
 const calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return url.endsWith('/hangup')?new Response(null,{status:204}):Response.json(answer);};
 const provider=liveVoiceProvider();await provider.create(sdp);await provider.close('live_test');
 assert.equal(calls.length,2);for(const call of calls)assert.equal(call.opts.headers['OpenAI-Project'],'proj_synthetic123');
 assert.equal(JSON.parse(calls[0].opts.body).session.audio.output.voice.id,CUSTOM_LIVE_VOICE);
 process.env.MIRKAM_LIVE_PROJECT_ID='invalid\r\nheader';
 await assert.rejects(provider.create(sdp),e=>e.status===503);assert.equal(calls.length,2);
 delete process.env.MIRKAM_LIVE_PROJECT_ID;await provider.create(sdp);assert.equal(calls[2].opts.headers['OpenAI-Project'],undefined);
});
