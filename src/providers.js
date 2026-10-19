export function requireKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || /^sk-x+$/.test(key)) throw new Error('חיבור AI לא הוגדר. יש להגדיר מפתח API בשרת.');
  return key;
}
export async function requestBytes(url, options = {}, limit = 24 * 1024 * 1024) {
  const timeout = Math.min(60000, Math.max(1000, Number(process.env.PROVIDER_TIMEOUT_MS) || 20000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response, reader, complete=false;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new Error('שירות חיצוני החזיר שגיאה (' + response.status + ').');
    if (Number(response.headers.get('content-length')) > limit) throw new Error('תשובת השירות גדולה מדי.');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete=true; break; }
      size += value.byteLength;
      if (size > limit) throw new Error('תשובת השירות גדולה מדי.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('השירות לא ענה בזמן. לא נשמרה תשובה חדשה.');
    if (e.message?.startsWith('שירות') || e.message?.startsWith('תשובת')) throw e;
    throw new Error('לא ניתן להתחבר לשירות החיצוני.');
  } finally {
    if(!complete){try{if(reader)await reader.cancel();else await response?.body?.cancel();}catch{}}
    reader?.releaseLock();clearTimeout(timer);
  }
}
export async function openaiJSON(endpoint, body) {
  const key = requireKey();
  const bytes = await requestBytes('https://api.openai.com/v1/' + endpoint, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, 1024 * 1024);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('שירות AI החזיר תשובה שאינה תקינה.'); }
}
