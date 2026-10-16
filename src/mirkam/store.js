import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';

export class Conflict extends Error { constructor() { super('הנתונים השתנו בחיבור אחר. טענו את הגרסה העדכנית לפני המשך.'); this.status = 409; } }
export class Store {
  constructor(dir, key) {
    this.dir = path.resolve(dir); fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    if(fs.lstatSync(this.dir).isSymbolicLink())throw Error('Invalid data directory');
    fs.chmodSync(this.dir,0o700);
    const keyFile=path.join(this.dir,'encryption.key');
    const file=path.join(this.dir,'mirkam.sqlite');
    if(key) { this.key=Buffer.from(key,'base64'); if(this.key.length!==32)throw Error('DATA_ENCRYPTION_KEY must be a base64 32-byte key'); }
    else {
      if(!fs.existsSync(keyFile)){
        if(fs.existsSync(file))throw Error('Existing database requires its original encryption key; restore the key before starting.');
        fs.writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});
      }
      if(!fs.lstatSync(keyFile).isFile())throw Error('Invalid encryption key file');
      this.key=fs.readFileSync(keyFile);if(this.key.length!==32)throw Error('Invalid encryption key');
    }
    if(fs.existsSync(file)&&!fs.lstatSync(file).isFile())throw Error('Invalid database file');
    this.db=new DatabaseSync(file);fs.chmodSync(file,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,revision INTEGER NOT NULL,updated INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS owner_records ON records(kind,owner,updated);');
    try { const existing=this.db.prepare('SELECT payload FROM records LIMIT 1').get();if(existing)this.decode(existing.payload); }
    catch { this.db.close();this.closed=true;throw Error('Database decryption failed; verify the original encryption key and database integrity.'); }
  }
  encode(record) { const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv); const data=Buffer.concat([c.update(JSON.stringify(record),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64'); }
  decode(payload) { const b=Buffer.from(payload,'base64'),d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')); }
  get(kind,id) { const r=this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id);return r?this.decode(r.payload):null; }
  list(kind,owner) { const rows=owner===undefined?this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY updated DESC,id').all(kind):this.db.prepare('SELECT payload FROM records WHERE kind=? AND owner=? ORDER BY updated DESC,id').all(kind,owner);return rows.map(r=>this.decode(r.payload)); }
  create(kind,owner,data) { const r={...data,id:data.id||randomUUID(),owner,revision:1,createdAt:Date.now(),updatedAt:Date.now()};this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(kind,r.id,owner,1,r.updatedAt,this.encode(r));return r; }
  put(kind,record,expected=record.revision) {
    const r={...record,revision:expected+1,updatedAt:Date.now()};
    const result=this.db.prepare('UPDATE records SET revision=?,updated=?,payload=? WHERE kind=? AND id=? AND owner=? AND revision=?').run(r.revision,r.updatedAt,this.encode(r),kind,r.id,r.owner,expected);
    if(result.changes!==1)throw new Conflict();return r;
  }
  remove(kind,id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  atomic(fn) { this.db.exec('BEGIN IMMEDIATE');try{const result=fn();if(result&&typeof result.then==='function')throw Error('Transactions must not span async work');this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;} }
  owned(kind,id,owner) { const r=this.get(kind,id);if(!r||r.owner!==owner)throw Error('הפריט לא נמצא.');return r; }
  audit(actor,event,target) { return this.create('audit','staff',{actor,event,target}); }
  backup(destination) {
    const target=path.resolve(destination);if(fs.existsSync(target))throw Error('Backup destination exists');
    this.db.prepare('VACUUM INTO ?').run(target);fs.chmodSync(target,0o600);return target;
  }
  close(){if(!this.closed){this.db.close();this.closed=true;}}
}
