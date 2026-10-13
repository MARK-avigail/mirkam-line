import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirkam-accounts-'));
process.env.DATA_DIR = dir;
const accounts = await import('../src/accounts.js');
const storage = await import('../src/storage.js');
const { ownedDraft } = await import('../src/owned-drafts.js');
const { newSession, pickMenu, goBack } = await import('../src/state-machine.js');
let sequence = 0;
function register() { return accounts.createAccount({ name: 'משתמש בדיקה', identity: String(++sequence).padStart(9,'0'), prisonerNumber: String(sequence), prison: 'בדיקה', verifiedBy: 'מנהל בדיקה' }); }
after(() => fs.rmSync(dir, { recursive: true, force: true }));
test('saved draft can return to the menu and resume district court selection', () => {
  const r = register(), s = newSession('member'); s.ownerId = r.account.id;
  pickMenu(s, '2'); goBack(s); storage.saveSession(s);
  const restored = ownedDraft(s.id, r.account.id); assert.equal(restored.stage, 'menu');
  pickMenu(restored, '2'); storage.saveSession(restored);
  assert.equal(ownedDraft(s.id, r.account.id).stage, 'court');
});
test('registration requires verified identity details and unique identity', () => {
  assert.throws(() => accounts.createAccount({ name: 'שם' }));
  const r = register();
  assert.match(r.account.code, /^\d{6}$/); assert.match(r.pin, /^\d{6}$/);
  assert.throws(() => accounts.createAccount({ ...r.account, verifiedBy: 'מנהל' }));
});
test('PIN and bearer tokens are not stored in plaintext or returned by account listing', () => {
  const r = register(), login = accounts.authenticate(r.account.code, r.pin, 'hash-test');
  const raw = fs.readFileSync(path.join(dir, 'accounts.json'),'utf8');
  const db = JSON.parse(raw), a = db.accounts.find(a => a.id === r.account.id);
  assert.notEqual(a.pinDigest, r.pin); assert.equal(a.pin, undefined);
  assert.ok(!raw.includes(login.token));
  assert.equal(accounts.listAccounts().find(a => a.id === r.account.id).pinDigest, undefined);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir,'accounts.json')).mode & 0o777, 0o600);
});
test('three failed attempts remain locked across subsequent authentication calls', () => {
  const r = register(), wrong = r.pin === '000000' ? '111111' : '000000';
  for(let i=0;i<3;i++) assert.throws(() => accounts.authenticate(r.account.code, wrong, 'lock-test'));
  assert.throws(() => accounts.authenticate(r.account.code, r.pin, 'other-call'));
});
test('PIN reset revokes existing tokens and restores access with a fresh PIN', () => {
  const r = register(), login = accounts.authenticate(r.account.code,r.pin,'reset-test');
  const reset = accounts.resetPin(r.account.id);
  assert.throws(() => accounts.accountForToken(login.token));
  const fresh = accounts.authenticate(r.account.code,reset.pin,'reset-test');
  assert.equal(accounts.accountForToken(fresh.token).id,r.account.id);
});
test('suspension and logout revoke access', () => {
  const r = register(), first = accounts.authenticate(r.account.code,r.pin,'logout-test');
  accounts.revokeToken(first.token); assert.throws(() => accounts.accountForToken(first.token));
  const second = accounts.authenticate(r.account.code,r.pin,'logout-test');
  accounts.changeAccount(r.account.id,{active:false});
  assert.throws(() => accounts.accountForToken(second.token));
  assert.throws(() => accounts.authenticate(r.account.code,r.pin,'logout-test'));
});
test('expired and forged tokens cannot retrieve accounts', () => {
  const r=register(), login=accounts.authenticate(r.account.code,r.pin,'expiry-test');
  const file=path.join(dir,'accounts.json'), db=JSON.parse(fs.readFileSync(file,'utf8'));
  db.tokens.forEach(t=>{if(t.accountId===r.account.id)t.expiresAt=0;});fs.writeFileSync(file,JSON.stringify(db));
  assert.throws(()=>accounts.accountForToken(login.token));assert.throws(()=>accounts.accountForToken('a'.repeat(64)));
});
test('draft ownership survives save/reload and refuses another account and unowned drafts', () => {
  const a=register(), b=register(), s=newSession('member');s.ownerId=a.account.id;s.fields.name='נשמר';storage.saveSession(s);
  assert.equal(ownedDraft(s.id,a.account.id).fields.name,'נשמר');
  assert.throws(()=>ownedDraft(s.id,b.account.id));assert.throws(()=>ownedDraft(s.id,undefined));
  const legacy=newSession();storage.saveSession(legacy);assert.throws(()=>ownedDraft(legacy.id,a.account.id));
});
