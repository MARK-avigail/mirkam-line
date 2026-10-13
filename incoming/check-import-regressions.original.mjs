// Local logic checks added during import. Not the original Vitest/end-to-end suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as sm from '../src/state-machine.js';
import { SCHEMA } from '../src/schema.js';
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function complete(){
  const s=sm.newSession();sm.pickMenu(s,'2');sm.pickCourt(s,'1');
  while(s.stage!=='review'){
    const f=SCHEMA[s.index];
    if(f.required){sm.submitAnswer(s,f.type==='digits'?'012345678':f.key==='name'?'שם קודם':'בדיקה');sm.confirmAnswer(s)}else sm.skipField(s);
  }
  return s;
}
check('single-field edit returns to review and updates preview',()=>{
  const s=complete(),before={...s.fields};sm.editField(s,2);sm.submitAnswer(s,'שם חדש');sm.confirmAnswer(s);
  assert.equal(s.stage,'review');assert.match(sm.snapshot(s).document,/שם חדש/);assert.doesNotMatch(sm.snapshot(s).document,/שם קודם/);
  assert.equal(s.fields.facts,before.facts);
});
check('court edit returns to review',()=>{const s=complete();sm.editField(s,0);sm.pickCourt(s,'2');assert.equal(s.stage,'review');assert.match(s.document,/תל אביב/);});
check('invalid edit indexes are rejected',()=>{for(const index of ['2',NaN,1.5,-1,99])assert.throws(()=>sm.editField(complete(),index));});
check('optional edit skip returns to review',()=>{const s=complete();sm.editField(s,1);sm.skipField(s);assert.equal(s.stage,'review');});

// Execute the real route handlers with a small mocked Express/TwiML transport.
const source=fs.readFileSync(new URL('../src/ivr/twilio.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default router;','return router;');
const sessions=new Map(),routes=new Map();
class Response{
  constructor(){this.events=[]}
  gather(options){this.events.push(['gather',options]);return this}
  say(options,text){this.events.push(['say',text]);return this}
  redirect(url){this.events.push(['redirect',url]);return this}
  toString(){return JSON.stringify(this.events)}
}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
await new AsyncFunction('twilio','express','SCRIPT','sm','SCHEMA','getSession','saveSession','generateHelp','transcribeTwilio','sayTo',source)(
  {twiml:{VoiceResponse:Response}}, {Router:()=>({post:(name,fn)=>routes.set(name,fn)})},
  {confirmAnswer:text=>'שמעתי: '+text},sm,SCHEMA,id=>sessions.get(id),s=>sessions.set(s.id,s),()=>{},()=>{},(parent,text)=>parent.say({},text)
);
function runRoute(name,s,body={},query={}){
  sessions.set(s.id,s);let output;
  const res={type(){return this},send(text){output=JSON.parse(text);return this}};
  routes.get(name)({query:{sid:s.id,...query},body},res);
  return output;
}
check('initial confirmation emits spoken prompt rather than redirect only',()=>{
  const s=sm.newSession();sm.pickMenu(s,'2');sm.pickCourt(s,'1');sm.submitAnswer(s,'תשובה');
  const out=runRoute('/confirm',s);assert.ok(out.some(e=>e[0]==='gather'));assert.ok(out.some(e=>e[0]==='say'&&e[1].includes('תשובה')));
});
check('silence and unknown digits do not finalize or send',()=>{
  for(const digit of ['', '0', '9']){
    const s=complete();const out=runRoute('/review-confirm',s,{Digits:digit},{part:'999'});
    assert.equal(s.stage,'review');assert.ok(out.some(e=>e[0]==='gather'));assert.ok(!out.some(e=>e[0]==='redirect'&&e[1].includes('/ivr/send')));
  }
});
check('explicit final approval advances to send',()=>{
  const s=complete();const out=runRoute('/review-confirm',s,{Digits:'1'},{part:'999'});
  assert.equal(s.stage,'done');assert.ok(out.some(e=>e[0]==='redirect'&&e[1].includes('/ivr/send')));
});
console.log(checks+' local regression checks passed. No providers or HTTP server were contacted.');
const stt=await import('../src/ivr/stt.js');
await assert.rejects(()=>stt.transcribeTwilio('https://example.com/recording'),/עדיין לא הוגדר/);
const tts=await import('../src/ivr/tts.js');
await assert.rejects(()=>tts.speakToFile('בדיקה'),/עדיין אינה מחוברת/);
const spoken=[];const text=('תוכן לבדיקה '.repeat(300)).trim();tts.sayTo({say:(options,part)=>spoken.push(part)},text);
assert.equal(spoken.join(' '),text);assert.ok(spoken.every(part=>part.length<=1000));
console.log('3 additional checks passed: no fake transcription, no fake MP3, no lost readback text.');
