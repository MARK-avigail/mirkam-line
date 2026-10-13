import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
const {Updates,verifyBundle,FILES}=createRequire(import.meta.url)('../../apps/native/desktop/updates.cjs');
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const data=(version=2)=>({version,compatibility:'0.4',platform:'windows',files:Object.fromEntries(FILES.map(n=>[n,Buffer.from(n==='index.html'?'<main id="suite-home"></main>':n).toString('base64')]))});
function signed(d,key=keys.privateKey){const bytes=Buffer.from(JSON.stringify(d));return JSON.stringify({payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,key).toString('base64')});}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const bundled=path.join(root,'bundled');fs.mkdirSync(bundled);fs.writeFileSync(path.join(bundled,'index.html'),'original');fs.writeFileSync(path.join(bundled,'native-bridge.js'),'trusted native bridge');return new Updates(path.join(root,'updates'),bundled,keys.publicKey);}
test('accepts a signed matching-platform complete bundle',()=>assert.equal(verifyBundle(signed(data()),keys.publicKey,'windows').version,2));
test('rejects tampered payload',()=>{const envelope=JSON.parse(signed(data()));envelope.payload=Buffer.from(JSON.stringify(data(3))).toString('base64');assert.throws(()=>verifyBundle(JSON.stringify(envelope),keys.publicKey,'windows'),/signature/);});
test('rejects foreign signing key',()=>{const other=crypto.generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>verifyBundle(signed(data(),other.privateKey),keys.publicKey,'windows'),/signature/);});
for(const [name,change] of [['platform',d=>d.platform='android'],['compatibility',d=>d.compatibility='future'],['fractional version',d=>d.version=2.5],['negative version',d=>d.version=-2]])test(`rejects incompatible ${name}`,()=>{const d=data();change(d);assert.throws(()=>verifyBundle(signed(d),keys.publicKey,'windows'));});
for(const name of ['../escape.js','native-bridge.js','nested/file.js'])test(`rejects additional file ${name}`,()=>{const d=data();d.files[name]='YQ==';assert.throws(()=>verifyBundle(signed(d),keys.publicKey,'windows'),/file list/);});
test('rejects incomplete update',()=>{const d=data();delete d.files['app.js'];assert.throws(()=>verifyBundle(signed(d),keys.publicKey,'windows'));});
test('rejects empty assets',()=>{const d=data();d.files['app.js']='';assert.throws(()=>verifyBundle(signed(d),keys.publicKey,'windows'));});
test('rejects an unrelated HTML page',()=>{const d=data();d.files['index.html']=Buffer.from('login page').toString('base64');assert.throws(()=>verifyBundle(signed(d),keys.publicKey,'windows'),/home/);});
test('staging does not replace a running UI',t=>{const u=fixture(t);u.start();u.stage(signed(data()));assert.equal(u.read().current,0);assert.equal(fs.readFileSync(path.join(u.bundled,'index.html'),'utf8'),'original');assert.equal(u.read().pending,2);});
test('next launch activates staged update and copies immutable native bridge',t=>{const u=fixture(t);u.stage(signed(data()));const home=u.start();assert.equal(path.basename(home),'2');assert.equal(fs.readFileSync(path.join(home,'native-bridge.js'),'utf8'),'trusted native bridge');assert.equal(u.read().trial,true);});
test('successful startup is retained after relaunch',t=>{const u=fixture(t);u.stage(signed(data()));u.start();assert.equal(u.ready().version,2);assert.equal(path.basename(u.start()),'2');});
test('failed first boot rolls back to bundled home',t=>{const u=fixture(t);u.stage(signed(data()));u.start();assert.equal(u.start(),u.bundled);assert.equal(u.read().highest,2);});
test('failed later boot rolls back to last healthy version',t=>{const u=fixture(t);u.stage(signed(data()));u.start();u.ready();u.stage(signed(data(3)));u.start();assert.equal(path.basename(u.start()),'2');});
test('rejected version is not retried forever',t=>{const u=fixture(t);u.stage(signed(data()));u.start();u.start();assert.equal(u.stage(signed(data())).available,false);assert.equal(u.read().pending,0);});
test('older bundles cannot downgrade installed version',t=>{const u=fixture(t);u.stage(signed(data(5)));u.start();u.ready();u.stage(signed(data(4)));assert.equal(u.read().current,5);assert.equal(u.read().pending,0);});
test('bad signature leaves installed and staged state untouched',t=>{const u=fixture(t);u.stage(signed(data()));const before=u.read();assert.throws(()=>u.stage('{}'));assert.deepEqual(u.read(),before);});
test('missing updated files fall back to the installed home',t=>{const u=fixture(t);u.stage(signed(data()));fs.rmSync(u.dir(2),{recursive:true});assert.equal(u.start(),u.bundled);});
test('offline check leaves local UI usable',async t=>{const u=fixture(t);const original=global.fetch;global.fetch=async()=>{throw Error('offline');};try{await assert.rejects(u.check());assert.equal(u.start(),u.bundled);assert.equal(u.busy,false);}finally{global.fetch=original;}});
