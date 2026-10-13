import { timingSafeEqual } from 'node:crypto';
export const present = name => Boolean(process.env[name]?.trim()) && !/^(?:sk-|AC)?x+$|your-domain|you@gmail|app-password/.test(process.env[name]);
export const pilot = () => process.env.PHONE_PILOT !== '0';
export function setup() {
  const specs = {ai:['OPENAI_API_KEY'],telephony:['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','BASE_URL','PILOT_PIN'],smtp:['SMTP_HOST','SMTP_USER','SMTP_PASS'],pilot:['TEST_EMAIL']};
  return {groups:Object.fromEntries(Object.entries(specs).map(([k,names])=>[k,{configured:names.every(present),missing:names.filter(n=>!present(n))}])),liveVerified:false};
}
export function capabilities() { const {groups}=setup(); return {ai:groups.ai.configured,stt:groups.ai.configured,smtp:groups.smtp.configured && (!pilot() || groups.pilot.configured)}; }
export function equal(a,b) { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && timingSafeEqual(x,y); }
export function protectApi(req,res,next) {
  const origin=req.get('origin');
  if(origin) { try { if(new URL(origin).host!==req.get('host')) return res.status(403).json({ok:false,error:'גישה מאתר אחר נחסמה.'}); } catch { return res.sendStatus(403); } }
  const token=process.env.ADMIN_TOKEN;
  if(token) { if(!equal(req.get('authorization')||'','Bearer '+token)) return res.status(401).json({ok:false,error:'נדרש קוד גישה.'}); }
  else if(process.env.BASE_URL || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.status(403).json({ok:false,error:'נדרש ADMIN_TOKEN לגישה מרחוק.'});
  next();
}
