import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomInt, randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';

const LOCK_MS = 15 * 60 * 1000, TOKEN_MS = 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
function location() {
  const dir = path.resolve(process.env.DATA_DIR || './data');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Invalid data directory');
  fs.chmodSync(dir, 0o700);
  return path.join(dir, 'accounts.json');
}
function read() {
  const file = location();
  if (!fs.existsSync(file)) return { accounts: [], tokens: [], attempts: {} };
  if (!fs.lstatSync(file).isFile()) throw new Error('Invalid accounts file');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(db.accounts) || !Array.isArray(db.tokens) || !db.attempts) throw new Error('Invalid accounts data');
  return db;
}
function write(db) {
  const file = location(), temp = file + '.' + randomUUID() + '.tmp';
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error('Invalid accounts file');
  try { fs.writeFileSync(temp, JSON.stringify(db), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function pinHash(pin, salt) { return scryptSync(pin, salt, 32).toString('hex'); }
function text(value, limit = 150) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('פרטי חשבון חסרים או ארוכים מדי.');
  return value.trim();
}
export function publicAccount(a) {
  const { pinSalt, pinDigest, ...safe } = a;
  return safe;
}
export function listAccounts() { return read().accounts.map(publicAccount); }
export function createAccount(input) {
  const db = read();
  const name = text(input.name), identity = text(input.identity, 9);
  if (!/^\d{9}$/.test(identity)) throw new Error('נדרשות תשע ספרות במספר הזהות.');
  if (db.accounts.some(a => a.identity === identity)) throw new Error('כבר קיים חשבון למספר הזהות הזה.');
  const verifiedBy = text(input.verifiedBy), prisonerNumber = text(input.prisonerNumber), prison = text(input.prison);
  let code; do { code = String(randomInt(100000, 1000000)); } while (db.accounts.some(a => a.code === code));
  const pin = String(randomInt(100000, 1000000)), salt = randomBytes(16).toString('hex');
  const account = { id: randomUUID(), code, name, identity, prisonerNumber, prison, wing: String(input.wing || '').slice(0, 100), verifiedBy, verifiedAt: Date.now(), active: true, createdAt: Date.now(), pinSalt: salt, pinDigest: pinHash(pin, salt), credentialVersion: 1 };
  db.accounts.push(account); write(db);
  return { account: publicAccount(account), pin };
}
export function changeAccount(id, input) {
  const db = read(), a = db.accounts.find(x => x.id === id);
  if (!a) throw new Error('החשבון לא נמצא.');
  if (typeof input.active !== 'boolean') throw new Error('נדרש מצב חשבון.');
  a.active = input.active;
  db.tokens = db.tokens.filter(t => t.accountId !== id); write(db);
  return publicAccount(a);
}
export function resetPin(id) {
  const db = read(), a = db.accounts.find(x => x.id === id);
  if (!a) throw new Error('החשבון לא נמצא.');
  const pin = String(randomInt(100000, 1000000));
  a.pinSalt = randomBytes(16).toString('hex'); a.pinDigest = pinHash(pin, a.pinSalt); a.credentialVersion++;
  db.tokens = db.tokens.filter(t => t.accountId !== id); delete db.attempts[hash(a.code)]; write(db);
  return { account: publicAccount(a), pin };
}
export function authenticate(code, pin, source = 'local') {
  const db = read(), now = Date.now();
  // Bound retained failure records; an unknown code receives the same error.
  for (const [key, a] of Object.entries(db.attempts)) if (a.until <= now) delete db.attempts[key];
  const keys = [hash(String(code)), hash('source:' + source)];
  if (keys.some(key => db.attempts[key]?.count >= (key === keys[0] ? 3 : 20))) throw new Error('הכניסה לא זמינה כרגע. נסו שוב מאוחר יותר או פנו למשרד.');
  const a = db.accounts.find(x => x.code === code);
  const digest = pinHash(/^\d{6}$/.test(String(pin)) ? String(pin) : 'invalid', a?.pinSalt || 'unknown-account-salt');
  const expected = a?.pinDigest || '0'.repeat(64);
  const valid = a?.active && typeof code === 'string' && typeof pin === 'string' && /^\d{6}$/.test(code) && /^\d{6}$/.test(pin) && timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(expected, 'hex'));
  if (!valid) {
    for (const key of keys) { const old = db.attempts[key]; db.attempts[key] = { count: (old?.count || 0) + 1, until: old?.until || now + LOCK_MS }; }
    write(db); throw new Error('פרטי הכניסה לא זוהו.');
  }
  delete db.attempts[keys[0]];
  const token = randomBytes(32).toString('hex');
  db.tokens = db.tokens.filter(t => t.expiresAt > now);
  db.tokens.push({ digest: hash(token), accountId: a.id, expiresAt: now + TOKEN_MS }); write(db);
  return { token, expiresAt: now + TOKEN_MS, account: publicAccount(a) };
}
export function accountForToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('נדרשת כניסה לחשבון.');
  const db = read(), t = db.tokens.find(t => t.digest === hash(token) && t.expiresAt > Date.now());
  const a = t && db.accounts.find(a => a.id === t.accountId && a.active);
  if (!a) throw new Error('נדרשת כניסה מחדש לחשבון.');
  return publicAccount(a);
}
export function revokeToken(token) {
  const db = read(); db.tokens = db.tokens.filter(t => t.digest !== hash(String(token))); write(db);
}
