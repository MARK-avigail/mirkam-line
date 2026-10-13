import { describe,it,expect,vi,beforeEach,afterAll } from 'vitest';
import request from 'supertest';
import twilio from 'twilio';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../src/ivr/stt.js',()=>({transcribeTwilio:vi.fn(async()=> 'תשובה מוקלטת'),transcribeAudio:vi.fn(async()=> 'תשובה מוקלטת')}));
vi.mock('../src/ivr/ai-help.js',()=>({generateHelp:vi.fn(async()=>({text:'ספרו מה קרה?'})),suggestWriting:vi.fn(async()=>({draft:'נוסח מוצע',question:''}))}));
vi.mock('../src/mailer.js',()=>({mailConfiguration:vi.fn(()=>({})),sendDocument:vi.fn(async()=>({status:'accepted_by_mail_server',inboxVerified:false}))}));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ki-ativa-http-'));
process.env.DATA_DIR=dir;process.env.ADMIN_TOKEN='test-admin';process.env.BASE_URL='https://example.test';process.env.TWILIO_AUTH_TOKEN='test-twilio';process.env.TWILIO_ACCOUNT_SID='AC'+'1'.repeat(32);process.env.TEST_EMAIL='test@example.test';process.env.PILOT_PIN='1234';process.env.PHONE_PILOT='1';
const {createApp}=await import('../src/server.js');const storage=await import('../src/storage.js');const sm=await import('../src/state-machine.js');const {SCHEMA}=await import('../src/schema.js');const {waitForJob}=await import('../src/jobs.js');const {sendDocument}=await import('../src/mailer.js');const app=createApp();
const {generateHelp}=await import('../src/ivr/ai-help.js');
const callSid='CA'+'2'.repeat(32);
function voice(route,body={}){const payload={CallSid:callSid,...body};const signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,process.env.BASE_URL+route,payload);return request(app).post(route).set('x-twilio-signature',signature).type('form').send(payload);}
function seed(){const s=sm.newSession('phone');s.callSid=callSid;s.pinVerified=true;sm.setEmail(s,process.env.TEST_EMAIL);sm.pickMenu(s,'2');sm.pickCourt(s,'2');storage.saveSession(s);return s;}
function ready(){const s=seed();for(let i=1;i<SCHEMA.length;i++){const f=SCHEMA[i];if(!f.required)sm.skipField(s);else{sm.submitAnswer(s,f.type==='digits'?'123456789':f.type==='date'?'08/10/2026':'תשובה בדוקה');sm.confirmAnswer(s);}}storage.saveSession(s);return s;}
async function completeReview(s){
 for(let i=0;i<100;i++){await voice('/ivr/review?sid='+s.id);const progress=storage.getSession(s.id).phoneReview;const r=await voice('/ivr/review-confirm?sid='+s.id+'&part='+progress.index,{Digits:'1'});if(storage.getSession(s.id).phoneReview.complete)return r;}
 throw new Error('Review did not finish');
}
beforeEach(()=>{storage.clearAll();vi.clearAllMocks();});afterAll(()=>fs.rmSync(dir,{recursive:true,force:true}));
describe('actual HTTP and TwiML flow',()=>{
 it('passes the visible typed draft into help without approving it',async()=>{const s=seed();s.index=8;storage.saveSession(s);const answer='לא פינו אותי לבית חולים';const r=await request(app).post('/api/session/'+s.id+'/action').set('Authorization','Bearer test-admin').send({action:'help',data:{text:answer}});expect(r.status).toBe(200);await waitForJob(s.id);expect(generateHelp).toHaveBeenCalledWith(expect.objectContaining({answer,field:expect.objectContaining({key:'decision'})}));expect(storage.getSession(s.id).fields.decision).toBeUndefined();});
 it('protects API and refuses unsigned voice',async()=>{expect((await request(app).get('/api/sessions')).status).toBe(401);expect((await request(app).post('/ivr/voice').type('form').send({CallSid:callSid})).status).toBe(403);});
 it('starts at PIN, and then a real menu',async()=>{const r=await voice('/ivr/voice');expect(r.status).toBe(200);expect(r.text).toContain('/ivr/pin');const sid=r.text.match(/sid=([a-f0-9-]+)/)[1];const pin=await voice('/ivr/pin?sid='+sid,{Digits:'1234'});expect(pin.text).toContain('/ivr/menu');expect(storage.getSession(sid).pinVerified).toBe(true);});
 it('rejects a signed callback from another call',async()=>{const s=seed();const payload={CallSid:'CA'+'3'.repeat(32)};const route='/ivr/field?sid='+s.id;const r=await request(app).post(route).set('x-twilio-signature',twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,process.env.BASE_URL+route,payload)).type('form').send(payload);expect(r.text).toContain('Hangup');});
 it('records full identity without collecting only one digit as answer',async()=>{const s=seed();s.index=3;storage.saveSession(s);const r=await voice('/ivr/field?sid='+s.id);expect(r.text).toContain('numDigits="9"');expect(r.text).not.toContain('input="dtmf speech"');});
 it('does not redirect confirmation to itself without speaking',async()=>{const s=seed();sm.submitAnswer(s,'מספר תיק');storage.saveSession(s);const r=await voice('/ivr/confirm?sid='+s.id);expect(r.text).toContain('<Gather');expect(r.text).toContain('מספר תיק');});
 it('does not send on silence at end of review',async()=>{const s=ready();const r=await voice('/ivr/review-confirm?sid='+s.id+'&part=999');expect(r.status).toBe(200);expect(storage.getSession(s.id).stage).toBe('review');expect(sendDocument).not.toHaveBeenCalled();});
 it('refuses a forged final chunk before review',async()=>{const s=ready();await voice('/ivr/review-confirm?sid='+s.id+'&part=999',{Digits:'1'});await voice('/ivr/approve?sid='+s.id,{Digits:'1'});expect(sendDocument).not.toHaveBeenCalled();expect(storage.getSession(s.id).phoneEmailAwaitingConfirmation).toBeUndefined();});
 it('resumes at the stored chunk instead of trusting the URL',async()=>{const s=ready();await voice('/ivr/review?sid='+s.id);await voice('/ivr/review-confirm?sid='+s.id+'&part=0',{Digits:'1'});const index=storage.getSession(s.id).phoneReview.index;const r=await voice('/ivr/review?sid='+s.id+'&part=999');expect(r.text).toContain('part='+index);});
 it('sends once after explicit approval',async()=>{const s=ready();await completeReview(s);await voice('/ivr/approve?sid='+s.id,{Digits:'1'});await waitForJob(s.id);expect(storage.getSession(s.id).stage).toBe('submitted');await voice('/ivr/send?sid='+s.id);expect(sendDocument).toHaveBeenCalledTimes(1);});
 it('accepts nine identity digits including leading control digits',async()=>{for(const digits of ['012345678','512345678','812345678','912345678']){const s=seed();s.index=3;storage.saveSession(s);const r=await voice('/ivr/field-key?sid='+s.id,{Digits:digits});expect(r.text).toContain('/ivr/confirm');expect(storage.getSession(s.id).pending).toBe(digits);}});
 it('does not commit incomplete identity',async()=>{const s=seed();s.index=3;storage.saveSession(s);await voice('/ivr/field-key?sid='+s.id,{Digits:'12345678'});expect(storage.getSession(s.id).stage).toBe('field');});
 it('requires recipient to be read back before explicit phone approval',async()=>{const s=ready();await voice('/ivr/approve?sid='+s.id,{Digits:'1'});expect(sendDocument).not.toHaveBeenCalled();expect(storage.getSession(s.id).stage).toBe('review');});
 it('blocks missing and malformed phone recipients',async()=>{for(const email of ['', 'invalid']){const s=ready();s.email=email;storage.saveSession(s);const r=await completeReview(s);expect(r.text).toContain('Hangup');await voice('/ivr/approve?sid='+s.id,{Digits:'1'});expect(sendDocument).not.toHaveBeenCalled();}});
 it('silence or an invalid approval key never sends',async()=>{for(const digits of ['', '9']){const s=ready();await completeReview(s);await voice('/ivr/approve?sid='+s.id,{Digits:digits});expect(storage.getSession(s.id).stage).toBe('review');expect(sendDocument).not.toHaveBeenCalled();}});
 it('uses a private admin API and disallows prototype actions',async()=>{const s=seed();const r=await request(app).post('/api/session/'+s.id+'/action').set('Authorization','Bearer test-admin').send({action:'toString'});expect(r.status).toBe(400);});
});
