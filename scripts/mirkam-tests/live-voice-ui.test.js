import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ui,json} from './ui-harness.js';
import {BRANCHES} from '../../src/mirkam/workflow.js';
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
async function setup(getUserMedia){
 const calls=[];const u=ui(async(url,options)=>{
  if(url==='/api/staff-login')return json({ok:true,token:'session',role:'owner'});
  if(url==='/api/admin/line')return json({ok:true,branches:BRANCHES});
  calls.push({url,options});
  return options.method==='POST'?json({ok:true,session:{id:'live_test'},transport:{sdp}},201):json({ok:true});
 });
 const peers=[];
 class Events{constructor(){this.listeners={};this.readyState='open';this.sent=[];}addEventListener(n,f){this.listeners[n]=f;}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState='closed';this.listeners.close?.();}emit(event){this.listeners.message?.({data:JSON.stringify(event)});}}
 class Peer{constructor(){this.listeners={};this.iceGatheringState='complete';this.connectionState='new';peers.push(this);}addEventListener(n,f){this.listeners[n]=f;}addTrack(){}createDataChannel(){return this.events=new Events();}async createOffer(){return {type:'offer',sdp};}async setLocalDescription(v){this.localDescription=v;}async setRemoteDescription(v){this.remoteDescription=v;}close(){this.connectionState='closed';this.listeners.connectionstatechange?.();}}
 u.context.RTCPeerConnection=Peer;u.context.navigator.mediaDevices={getUserMedia};
 await u.submit('staff-login-form');await u.click('suite-line');
 return {u,calls,peers,start:u.all.find(e=>e.textContent==='התחלת שיחה עם הקול שבחרתי'),stop:u.all.find(e=>e.textContent==='סיום ההאזנה')};
}
test('denied microphone permission never starts a paid voice session',async()=>{
 const f=await setup(async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});});
 await f.start.onclick();assert.equal(f.calls.length,0);assert.equal(f.start.disabled,false);assert.match(f.u.text('admin-pane'),/נדרשת הרשאת מיקרופון/);
});
test('stop during microphone permission closes a late stream without contacting provider',async()=>{
 let resolve,stops=0;const f=await setup(()=>new Promise(r=>{resolve=r;}));
 const pending=f.start.onclick();f.stop.onclick();resolve({getTracks:()=>[{stop:()=>stops++}]});await pending;
 assert.equal(stops,1);assert.equal(f.calls.length,0);assert.equal(f.start.disabled,false);
});
test('WebRTC startup exchanges SDP only; logout releases microphone and stops server session',async()=>{
 let stops=0;const track={stop:()=>stops++},f=await setup(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));
 await f.start.onclick();assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(f.calls[0].options.body),{sdp});
 assert.equal(f.peers[0].remoteDescription.sdp,sdp);assert.equal(f.peers[0].events.sent.length,0);
 f.peers[0].events.emit({type:'session.started',session:{id:'live_test'}});
 assert.match(f.u.text('admin-pane'),/מחובר/);
 vm.runInContext('lockManagement()',f.u.context);
 assert.equal(stops,1);assert.equal(f.peers[0].connectionState,'closed');assert.equal(f.calls.at(-1).options.method,'DELETE');
 assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer session');assert.equal(f.peers[0].events.sent[0].type,'session.close');
});
