import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../src/mirkam/store.js';
import {Staff,permitted} from '../../src/mirkam/staff.js';
import {totp} from '../../src/mirkam/identity.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-staff-')),store=new Store(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,staff:new Staff(store)};}
test('support cannot access billing or staff role creation',()=>{assert.equal(permitted('support','users'),true);assert.equal(permitted('support','payments'),false);assert.equal(permitted('support','staff'),false);});
test('billing cannot reset member PIN or approve contacts',()=>{assert.equal(permitted('billing','membership'),true);assert.equal(permitted('billing','users/u/reset'),false);assert.equal(permitted('billing','contacts'),false);});
test('staff creation cannot mint another owner',t=>{const {staff}=fixture(t);assert.throws(()=>staff.create('שם','owner','owner'));});
test('staff login requires its individual MFA code and grants only assigned role',t=>{const {staff}=fixture(t),r=staff.create('תמיכה','support','owner');assert.throws(()=>staff.login(r.id,r.password,'bad-code'));const login=staff.login(r.id,r.password,totp(r.mfaSecret));assert.equal(staff.authenticate(login.token).role,'support');});
test('a used staff MFA counter cannot issue another session',t=>{const {staff}=fixture(t),r=staff.create('תמיכה','support','owner');staff.login(r.id,r.password,totp(r.mfaSecret));assert.throws(()=>staff.login(r.id,r.password,totp(r.mfaSecret)));});
test('suspended staff loses existing token access',t=>{const {staff,store}=fixture(t),r=staff.create('כספים','billing','owner'),l=staff.login(r.id,r.password,totp(r.mfaSecret)),s=store.get('staff',r.id);store.put('staff',{...s,active:false});assert.throws(()=>staff.authenticate(l.token));});

test('bootstrap can create a named owner with mandatory individual MFA',t=>{const {staff}=fixture(t),r=staff.createOwner('mavrika.owner','בעלת המערכת','owner');assert.throws(()=>staff.login(r.id,r.password,''));const session=staff.login(r.id,r.password,totp(r.mfaSecret));assert.equal(staff.authenticate(session.token).role,'owner');});
test('owner setup rejects untrusted actors and unsafe usernames',t=>{const {staff}=fixture(t);assert.throws(()=>staff.createOwner('mavrika.owner','שם','support'));assert.throws(()=>staff.createOwner('../owner','שם','owner'));});
test('a second owner setup cannot replace the first credentials',t=>{const {staff,store}=fixture(t);staff.createOwner('mavrika.owner','שם','owner');assert.throws(()=>staff.createOwner('another.owner','שם','owner'));assert.equal(store.list('staff').filter(s=>s.role==='owner').length,1);});
test('logout revokes the staff session on the server',t=>{const {staff}=fixture(t),r=staff.createOwner('mavrika.owner','שם','owner'),l=staff.login(r.id,r.password,totp(r.mfaSecret));staff.logout(l.token);assert.throws(()=>staff.authenticate(l.token));});
