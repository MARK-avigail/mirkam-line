import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession } from '../src/state-machine.js';
let dir,storage;
beforeEach(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ki-storage-'));vi.stubEnv('DATA_DIR',dir);vi.resetModules();storage=await import('../src/storage.js');});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();fs.rmSync(dir,{recursive:true,force:true});});
describe('private atomic session storage',()=>{
 it('roundtrips session and writes private files without temporary residue',()=>{const s=newSession();storage.saveSession(s);expect(storage.getSession(s.id)).toEqual(s);expect(fs.readdirSync(dir)).toEqual([`session-${s.id}.json`]);if(process.platform!=='win32')expect(fs.statSync(path.join(dir,`session-${s.id}.json`)).mode&0o777).toBe(0o600);});
 it('rejects traversal and invalid IDs in every ID interface',()=>{for(const id of ['../outside','../session-x','x',null]){expect(()=>storage.getSession(id)).toThrow();expect(()=>storage.deleteSession(id)).toThrow();expect(()=>storage.saveSession({...newSession(),id})).toThrow();}});
 it('skips corrupt sessions without exposing contents and keeps unrelated files',()=>{const s=newSession();storage.saveSession(s);fs.writeFileSync(path.join(dir,`session-${s.id}.json`),'SECRET invalid json');fs.writeFileSync(path.join(dir,'session-not-a-uuid.json'),'unrelated');const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});expect(storage.listSessions()).toEqual([]);expect(warn.mock.calls.flat().join(' ')).not.toContain('SECRET');storage.clearAll();expect(fs.readdirSync(dir)).toEqual(['session-not-a-uuid.json']);});
 it('rejects symlink session files without touching external target',()=>{if(process.platform==='win32')return;const s=newSession(),target=path.join(dir,'external');fs.writeFileSync(target,'unchanged');fs.symlinkSync(target,path.join(dir,`session-${s.id}.json`));expect(()=>storage.getSession(s.id)).toThrow();expect(()=>storage.saveSession(s)).toThrow();expect(()=>storage.deleteSession(s.id)).toThrow();expect(fs.readFileSync(target,'utf8')).toBe('unchanged');});
 it('recovers interrupted processing and marks ambiguous sends without retry',()=>{const processing=newSession(),sending=newSession();processing.stage='processing';processing.fields.name='נשמר';processing.pending='לא אושר';sending.stage='sending';storage.saveSession(processing);storage.saveSession(sending);expect(storage.recoverInterruptedSessions()).toBe(2);const p=storage.getSession(processing.id);expect(p.stage).toBe('field');expect(p.pending).toBe('');expect(p.fields.name).toBe('נשמר');expect(storage.getSession(sending.id).stage).toBe('delivery_unknown');expect(storage.recoverInterruptedSessions()).toBe(0);});
});
