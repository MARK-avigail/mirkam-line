import { requireKey, requestBytes } from '../providers.js';
export async function transcribeTwilio(recordingUrl) {
  if (process.env.STT_MODE && process.env.STT_MODE !== 'openai') throw new Error('בגרסה זו נתמך תמלול מאובטח דרך OpenAI בלבד.');
  const key = requireKey();
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!/^AC[a-fA-F0-9]{32}$/.test(sid || '') || !token) throw new Error('חיבור ההקלטות לא הוגדר בשרת.');
  let url;
  try { url = new URL(recordingUrl); } catch { throw new Error('כתובת הקלטה אינה תקינה.'); }
  const expected = new RegExp('^/2010-04-01/Accounts/' + sid + '/Recordings/RE[a-fA-F0-9]{32}(?:\\.mp3|\\.wav)?$');
  if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com' || url.port || url.username || url.password || url.search || url.hash || !expected.test(url.pathname)) throw new Error('כתובת הקלטה אינה מורשית.');
  if (!/\.(mp3|wav)$/.test(url.pathname)) url.pathname += '.mp3';
  const audio = await requestBytes(url.href, { headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') } });
  if (!audio.length) throw new Error('ההקלטה ריקה.');
  return transcribeAudio(audio, url.pathname.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
}
export async function transcribeAudio(audio, mime) {
  const key = requireKey();
  const extensions = {'audio/wav':'wav','audio/mpeg':'mp3','audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg'};
  const type = String(mime || '').split(';')[0];
  if(!extensions[type] || !audio?.length || audio.length > 24*1024*1024) throw new Error('הקלטה אינה תקינה או גדולה מדי.');
  const form = new FormData();
  form.append('file', new Blob([audio], {type}), 'recording.' + extensions[type]);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1');
  form.append('language', 'he');
  const result = await requestBytes('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form }, 1024 * 1024);
  let text;
  try { text = JSON.parse(result.toString('utf8')).text; } catch { throw new Error('תשובת התמלול אינה תקינה.'); }
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('לא התקבל תמלול תקין. נסו להקליט שוב.');
  return text.trim();
}
