import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sm from '../src/state-machine.js';
import { SCHEMA } from '../src/schema.js';
import { identityAnswer, offerPhoneApproval, approvePhoneDelivery, requirePhoneDeliveryApproval } from '../src/ivr/phone-guards.js';
import { presentReviewChunk, confirmReviewChunk } from '../src/ivr/document-review.js';
function reviewed(s) {
 for(let i=0;i<100;i++){const chunk=presentReviewChunk(s);if(confirmReviewChunk(s,String(chunk.index),'1'))return s;}
 throw new Error('Review did not finish');
}
function ready() {
 const s=sm.newSession('phone');sm.pickMenu(s,'2');sm.pickCourt(s,'2');
 for(const f of SCHEMA.slice(1)){if(!f.required)sm.skipField(s);else{sm.submitAnswer(s,f.type==='digits'?'012345678':f.type==='date'?'09/10/2026':'נתון לבדיקה');sm.confirmAnswer(s);}}
 sm.setEmail(s,'recipient@example.test');return reviewed(s);
}
test('all nine digits preserved, including prefixes used for commands',()=>{for(const digits of ['012345678','512345678','812345678','912345678'])assert.equal(identityAnswer(digits),digits);});
test('short, overlength and nonnumeric identities are refused',()=>{for(const input of ['9','12345678','1234567890','12345678x',123456789])assert.equal(identityAnswer(input),null);});
test('silence and every other approval key leave document unapproved',()=>{for(const digit of ['',undefined,'0','2','3','9']){const s=ready();offerPhoneApproval(s);assert.throws(()=>approvePhoneDelivery(s,digit));assert.equal(s.stage,'review');assert.throws(()=>requirePhoneDeliveryApproval(s));}});
test('direct approval without prior recipient readback is refused',()=>{assert.throws(()=>approvePhoneDelivery(ready(),'1'));});
test('missing or malformed recipient cannot be offered for sending',()=>{for(const email of ['',null,'no-mail','a<b@example.test','a@b\n.test']){const s=ready();s.email=email;assert.throws(()=>offerPhoneApproval(s));assert.throws(()=>requirePhoneDeliveryApproval(s));}});
test('readback then explicit approval permits one delivery',()=>{const s=ready();offerPhoneApproval(s);approvePhoneDelivery(s,'1');requirePhoneDeliveryApproval(s);sm.beginDelivery(s);assert.throws(()=>sm.beginDelivery(s));});
test('changing recipient after readback invalidates the offer',()=>{const s=ready();offerPhoneApproval(s);sm.setEmail(s,'other@example.test');assert.throws(()=>approvePhoneDelivery(s,'1'));});
test('editing document after readback requires a fresh offer',()=>{const s=ready();offerPhoneApproval(s);sm.editField(s,2);sm.submitAnswer(s,'שם מתוקן');sm.confirmAnswer(s);assert.throws(()=>approvePhoneDelivery(s,'1'));reviewed(s);offerPhoneApproval(s);approvePhoneDelivery(s,'1');requirePhoneDeliveryApproval(s);});
test('tampered document after approval is blocked before delivery',()=>{const s=ready();offerPhoneApproval(s);approvePhoneDelivery(s,'1');s.fields.facts='טקסט שלא אושר';assert.throws(()=>requirePhoneDeliveryApproval(s));});
test('configuration failure before sending allows a new explicit approval',()=>{const s=ready();offerPhoneApproval(s);approvePhoneDelivery(s,'1');offerPhoneApproval(s);assert.equal(s.stage,'review');assert.throws(()=>requirePhoneDeliveryApproval(s));approvePhoneDelivery(s,'1');requirePhoneDeliveryApproval(s);});
