import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DIR = path.resolve(process.env.DATA_DIR || './data');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function idValid(id) { if(typeof id!=='string' || !UUID.test(id)) throw new Error('invalid session id'); }
function ensureDir() { fs.mkdirSync(DIR,{recursive:true,mode:0o700}); if(fs.lstatSync(DIR).isSymbolicLink()) throw new Error('invalid data directory'); fs.chmodSync(DIR,0o700); }
function fileFor(id) { idValid(id); return path.join(DIR,`session-${id}.json`); }
function safeFile(file) { try { if(!fs.lstatSync(file).isFile()) throw new Error('invalid session file'); } catch(error) { if(error.code!=='ENOENT') throw error; } }
function validate(s,id) { if(!s || typeof s!=='object' || Array.isArray(s) || s.id!==id || typeof s.stage!=='string' || !s.fields || typeof s.fields!=='object' || Array.isArray(s.fields)) throw new Error('invalid stored session'); idValid(s.id); return s; }
export function saveSession(session) {
  const file=fileFor(session?.id); validate(session,session.id); ensureDir(); safeFile(file);
  const tmp=path.join(DIR,`.session-${session.id}-${randomUUID()}.tmp`);
  try { fs.writeFileSync(tmp,JSON.stringify(session,null,2),{flag:'wx',mode:0o600}); fs.renameSync(tmp,file); fs.chmodSync(file,0o600); }
  finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function getSession(id) {
  const file=fileFor(id); ensureDir(); safeFile(file); if(!fs.existsSync(file)) return null;
  try { return validate(JSON.parse(fs.readFileSync(file,'utf8')),id); } catch { throw new Error('stored session could not be read'); }
}
export function deleteSession(id) { const file=fileFor(id); ensureDir(); safeFile(file); if(fs.existsSync(file)) fs.unlinkSync(file); }
export function listSessions() {
  ensureDir(); const sessions=[];
  for(const name of fs.readdirSync(DIR)) {
    const match=name.match(/^session-([0-9a-f-]+)\.json$/i); if(!match || !UUID.test(match[1])) continue;
    try { const s=getSession(match[1]); if(s) sessions.push(s); } catch { console.warn('Skipped an unreadable session file.'); }
  }
  return sessions.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
}
export function clearAll() { ensureDir(); for(const name of fs.readdirSync(DIR)) { const match=name.match(/^session-([0-9a-f-]+)\.json$/i); if(match && UUID.test(match[1])) deleteSession(match[1]); } }
export function recoverInterruptedSessions() {
  let count=0;
  for(const s of listSessions()) {
    if(['processing','assistant_processing','transcription_processing'].includes(s.stage)) { s.stage=s.processingPrevious==='field_review'?'field_review':'field'; if(s.stage==='field')s.pending=''; delete s.jobId; delete s.processingPrevious; s.error='העיבוד נקטע. התשובות שאושרו נשמרו; אפשר לנסות שוב.'; }
    else if(s.stage==='sending') { s.stage='delivery_unknown'; s.error='השליחה נקטעה. בדקו אצל הספק ובתיבת המייל לפני פעולה נוספת; לא בוצעה שליחה חוזרת.'; }
    else continue;
    s.updatedAt=Date.now(); saveSession(s); count++;
  }
  return count;
}
