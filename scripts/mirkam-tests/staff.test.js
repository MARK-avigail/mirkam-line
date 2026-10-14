import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../src/mirkam/store.js';
import {Staff,permitted} from '../../src/mirkam/staff.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-staff-')),store=new Store(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,staff:new Staff(store)};}
test('support cannot access billing or staff role creation',()=>{assert.equal(permitted('support','users'),true);assert.equal(permitted('support','payments'),false);assert.equal(permitted('support','staff'),false);});
test('billing cannot reset member PIN or approve contacts',()=>{assert.equal(permitted('billing','membership'),true);assert.equal(permitted('billing','users/u/reset'),false);assert.equal(permitted('billing','contacts'),false);});
test('staff creation cannot mint another owner',t=>{const {staff}=fixture(t);assert.throws(()=>staff.create('שם','owner','owner'));});
test('staff login requires correct password and grants assigned role',t=>{const {staff}=fixture(t),r=staff.create('תמיכה','support','owner');assert.throws(()=>staff.login(r.id,'wrong'));const login=staff.login(r.id,r.password);assert.equal(staff.authenticate(login.token).role,'support');assert.equal(r.mfaSecret,undefined);});
test('repeated wrong passwords temporarily block staff login',t=>{const {staff}=fixture(t),r=staff.create('תמיכה','support','owner');for(let i=0;i<3;i++)assert.throws(()=>staff.login(r.id,'wrong'));assert.throws(()=>staff.login(r.id,r.password),/הוגבלה/);});
test('suspended staff loses existing token access',t=>{const {staff,store}=fixture(t),r=staff.create('כספים','billing','owner'),l=staff.login(r.id,r.password),s=store.get('staff',r.id);store.put('staff',{...s,active:false});assert.throws(()=>staff.authenticate(l.token));});

test('bootstrap creates an owner using password without an authenticator',t=>{const {staff}=fixture(t),r=staff.createOwner('mavrika.owner','בעלת המערכת','owner');assert.equal(r.mfaSecret,undefined);const session=staff.login(r.id,r.password);assert.equal(staff.authenticate(session.token).role,'owner');});
test('owner setup rejects untrusted actors and unsafe usernames',t=>{const {staff}=fixture(t);assert.throws(()=>staff.createOwner('mavrika.owner','שם','support'));assert.throws(()=>staff.createOwner('../owner','שם','owner'));});
test('a second owner setup cannot replace the first credentials',t=>{const {staff,store}=fixture(t);staff.createOwner('mavrika.owner','שם','owner');assert.throws(()=>staff.createOwner('another.owner','שם','owner'));assert.equal(store.list('staff').filter(s=>s.role==='owner').length,1);});
test('logout revokes the staff session on the server',t=>{const {staff}=fixture(t),r=staff.createOwner('mavrika.owner','שם','owner'),l=staff.login(r.id,r.password);staff.logout(l.token);assert.throws(()=>staff.authenticate(l.token));});

test('existing owner with stored MFA secret can log in without OTP and retains password',t=>{const {staff,store}=fixture(t),r=staff.createOwner('existing.owner','שם','owner');const s=store.get('staff',r.id);store.put('staff',{...s,mfaSecret:'LEGACYSECRET',lastCounter:999999999});const l=staff.login(r.id,r.password);assert.equal(staff.authenticate(l.token).role,'owner');assert.equal(store.get('staff',r.id).passwordHash,s.passwordHash);});
