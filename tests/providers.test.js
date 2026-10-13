import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateHelp, suggestWriting } from '../src/ivr/ai-help.js';
import { transcribeTwilio } from '../src/ivr/stt.js';
import { sayTo, speakToFile, getHash, getCachedFile } from '../src/ivr/tts.js';
import { requestBytes } from '../src/providers.js';
const sid = 'AC' + 'a'.repeat(32);
const recording = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Recordings/RE' + 'b'.repeat(32);
function setup() { vi.stubEnv('OPENAI_API_KEY', 'test-private-key'); vi.stubEnv('TWILIO_ACCOUNT_SID', sid); vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-private-token'); }
function jsonCompletion(value) { return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]})); }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('real service adapters, isolated transport', () => {
 it('missing AI key cannot fabricate help or transcription', async () => { vi.stubEnv('OPENAI_API_KEY',''); await expect(generateHelp({field:{key:'facts',label:'עובדות'}})).rejects.toThrow('מפתח'); await expect(transcribeTwilio(recording)).rejects.toThrow('מפתח'); });
 it('help calls model and returns its short Hebrew question', async () => { setup(); const fetcher=vi.fn(async()=>jsonCompletion({text:'מתי קרה האירוע?'}));vi.stubGlobal('fetch',fetcher);expect(await generateHelp({field:{key:'facts',label:'עובדות'}})).toEqual({type:'clarify',text:'מתי קרה האירוע?'}); expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions'); });
 it('rejects invalid generated writing', async()=>{setup();vi.stubGlobal('fetch',vi.fn(async()=>jsonCompletion({draft:23,question:''})));await expect(suggestWriting({field:{key:'facts',label:'עובדות'},answer:'קרה אירוע'})).rejects.toThrow('תקינה');});
 it('returns proposed text without approving or changing fields',async()=>{setup();vi.stubGlobal('fetch',vi.fn(async()=>jsonCompletion({draft:'פניתי לקבלת טיפול.',question:'מתי פניתם?'})));const fields={facts:'ביקשתי טיפול'};expect((await suggestWriting({field:{key:'facts',label:'עובדות'},answer:fields.facts,fields})).draft).toBe('פניתי לקבלת טיפול.');expect(fields.facts).toBe('ביקשתי טיפול');});
 it.each(['http://api.twilio.com/x','https://attacker.example/recording','https://api.twilio.com@attacker.example/x',recording+'?redirect=1',recording.replace(sid,'AC'+'c'.repeat(32))])('rejects untrusted recording %s without fetch', async(url)=>{setup();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await expect(transcribeTwilio(url)).rejects.toThrow('מורשית');expect(fetcher).not.toHaveBeenCalled();});
 it('downloads authenticated audio and transcribes hosted, with redirect rejection',async()=>{setup();const fetcher=vi.fn().mockResolvedValueOnce(new Response('real audio bytes')).mockResolvedValueOnce(new Response(JSON.stringify({text:'ביקשתי טיפול'})));vi.stubGlobal('fetch',fetcher);expect(await transcribeTwilio(recording)).toBe('ביקשתי טיפול');expect(fetcher.mock.calls[0][1].redirect).toBe('error');expect(fetcher.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);expect(fetcher.mock.calls[1][1].body).toBeInstanceOf(FormData);});
 it('network errors do not expose secret-bearing error text',async()=>{setup();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('test-private-key leaked')}));await expect(transcribeTwilio(recording)).rejects.toThrow('לא ניתן');});
 it('oversized provider result fails',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('1234')));await expect(requestBytes('https://api.openai.com',{},3)).rejects.toThrow('גדולה');});
 it('long Twilio speech preserves all words and specifies Hebrew voice',()=>{const calls=[];sayTo({say:(options,text)=>calls.push({options,text})},'שלום '.repeat(650));expect(calls.length).toBeGreaterThan(1);expect(calls.map(x=>x.text).join(' ').replace(/\s+/g,' ').trim()).toBe('שלום '.repeat(650).trim());expect(calls[0].options.voice).toContain('he-IL');});
 it('TTS never creates placeholder audio or accepts bad cache hashes',async()=>{vi.stubEnv('OPENAI_API_KEY','');await expect(speakToFile('שלום')).rejects.toThrow('מפתח');expect(getHash('שלום')).toMatch(/^[a-f0-9]{64}$/);expect(getCachedFile('../secrets')).toBeNull();});
});
