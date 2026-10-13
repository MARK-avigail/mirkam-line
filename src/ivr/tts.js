import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireKey, requestBytes } from '../providers.js';
function cacheDir() { return path.join(process.env.DATA_DIR || './data', 'tts-cache'); }
export function getHash(text) {
  return crypto.createHash('sha256').update(JSON.stringify([process.env.OPENAI_TTS_MODEL || 'tts-1', process.env.OPENAI_TTS_VOICE || 'alloy', String(text)])).digest('hex');
}
export function getCachedFile(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash || '')) return null;
  const file = path.join(cacheDir(), hash + '.mp3');
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}
export async function speakToFile(text) {
  const key = requireKey();
  const input = String(text || '').trim();
  if (!input || input.length > 4000) throw new Error('יש להקריא קטע באורך של עד 4000 תווים.');
  const hash = getHash(input);
  const existing = getCachedFile(hash);
  if (existing) return existing;
  const bytes = await requestBytes('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'tts-1', voice: process.env.OPENAI_TTS_VOICE || 'alloy', input, response_format: 'mp3' })
  }, 8 * 1024 * 1024);
  if (bytes.length < 3 || !(bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224))) throw new Error('שירות הקול לא החזיר MP3 תקין.');
  fs.mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  const file = path.join(cacheDir(), hash + '.mp3');
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return file;
}
export function sayTo(parent, text) {
  let rest = String(text || '');
  while (rest) {
    let end = Math.min(1000, rest.length);
    if (end < rest.length) { const boundary = rest.lastIndexOf(' ', end); if (boundary > 0) end = boundary; }
    parent.say({ language: 'he-IL', voice: process.env.TWILIO_TTS_VOICE || 'Google.he-IL-Standard-A' }, rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
}
