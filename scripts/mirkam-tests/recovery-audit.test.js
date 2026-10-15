import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,Conflict} from '../../src/mirkam/store.js';

// Real SQLite failure/recovery cases, across the persisted business record kinds.
const kinds=['user','staff','draft','message','conversation','contact','delivery','version','payment','ticket','announcement','audit'];
const cases={
 'failed insert transaction leaves no partial record'(s,kind){assert.throws(()=>s.atomic(()=>{s.create(kind,'owner',{id:'partial'});throw Error('simulated interruption');}),/simulated/);assert.equal(s.get(kind,'partial'),null);},
 'failed update restores value and revision'(s,kind){const r=s.create(kind,'owner',{value:'before'});assert.throws(()=>s.atomic(()=>{s.put(kind,{...r,value:'after'});throw Error('simulated interruption');}));assert.deepEqual(s.get(kind,r.id),r);},
 'failed delete preserves original record'(s,kind){const r=s.create(kind,'owner',{value:'keep'});assert.throws(()=>s.atomic(()=>{s.remove(kind,r.id);throw Error('simulated interruption');}));assert.deepEqual(s.get(kind,r.id),r);},
 'async transaction rejected and synchronous writes rolled back'(s,kind){assert.throws(()=>s.atomic(()=>{s.create(kind,'owner',{id:'async-write'});return Promise.resolve();}),/async/);assert.equal(s.get(kind,'async-write'),null);},
 'stale writer cannot overwrite committed writer'(s,kind){const r=s.create(kind,'owner',{value:'initial'});const other=new Store(s.dir,s.key.toString('base64'));try{const stale=other.get(kind,r.id);const current=s.put(kind,{...r,value:'new'});assert.throws(()=>other.put(kind,{...stale,value:'stale'}),Conflict);assert.deepEqual(other.get(kind,r.id),current);}finally{other.close();}},
 'duplicate identifier leaves committed record intact'(s,kind){const r=s.create(kind,'owner',{id:'duplicate',value:'original'});assert.throws(()=>s.create(kind,'other',{id:r.id,value:'replacement'}));assert.deepEqual(s.get(kind,r.id),r);assert.equal(s.list(kind,'other').length,0);},
 'tampered encrypted payload cannot be read'(s,kind){const r=s.create(kind,'owner',{value:'private test data'});const row=s.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,r.id);const b=Buffer.from(row.payload,'base64');b[b.length-1]^=1;s.db.prepare('UPDATE records SET payload=? WHERE kind=? AND id=?').run(b.toString('base64'),kind,r.id);assert.throws(()=>s.get(kind,r.id));},
 'backup excludes later writes and refuses overwrite'(s,kind,dir){const r=s.create(kind,'owner',{value:'snapshot'});const dest=path.join(dir,'snapshot.sqlite');s.backup(dest);s.put(kind,{...r,value:'later'});const late=s.create(kind,'owner',{value:'created later'});const original=fs.readFileSync(dest);assert.throws(()=>s.backup(dest),/exists/);assert.deepEqual(fs.readFileSync(dest),original);const restore=path.join(dir,'restored');fs.mkdirSync(restore);fs.copyFileSync(dest,path.join(restore,'mirkam.sqlite'));const restored=new Store(restore,s.key.toString('base64'));try{assert.deepEqual(restored.get(kind,r.id),r);assert.equal(restored.get(kind,late.id),null);}finally{restored.close();}}
};
for(const kind of kinds)for(const [name,run] of Object.entries(cases))test(`${kind}: ${name}`,t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-audit-'));let s;t.after(()=>{s?.close();fs.rmSync(dir,{recursive:true,force:true});});s=new Store(path.join(dir,'source'));run(s,kind,dir);});
