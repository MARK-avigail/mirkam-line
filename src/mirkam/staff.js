import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {totp} from './identity.js';
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
function base32(bytes){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const byte of bytes)bits+=byte.toString(2).padStart(8,'0');return (bits.match(/.{1,5}/g)||[]).map(b=>alphabet[parseInt(b.padEnd(5,'0'),2)]).join('');}
export const PERMISSIONS={owner:['*'],support:['users','contacts','tickets','status'],billing:['membership','payments','status']};
export function permitted(role,path){return (path==='logout'&&Boolean(PERMISSIONS[role]))||PERMISSIONS[role]?.some(p=>p==='*'||path===p||path.startsWith(p+'/'))||false;}
export class Staff {
  constructor(store){this.store=store;}
  create(name,role,actor){if(typeof name!=='string'||!name.trim()||!['support','billing'].includes(role))throw Error('שם או תפקיד צוות אינם תקינים.');const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex'),secret=base32(randomBytes(20));const r=this.store.create('staff','staff',{name:name.trim(),role,active:true,passwordSalt:salt,passwordHash:scryptSync(password,salt,32).toString('hex'),mfaSecret:secret,lastCounter:-1});this.store.audit(actor,'staff.created',r.id);return {id:r.id,name:r.name,role,password,mfaSecret:secret};}
  createOwner(username,name,actor){
    if(actor!=='owner')throw Object.assign(Error('הגדרת בעלת המערכת דורשת את קוד ההגדרה הראשוני.'),{status:403});
    if(typeof username!=='string'||!/^[a-zA-Z][a-zA-Z0-9_.-]{2,39}$/.test(username)||typeof name!=='string'||!name.trim())throw Error('שם משתמש או שם להצגה אינם תקינים.');
    return this.store.atomic(()=>{
      if(this.store.list('staff').some(s=>s.role==='owner'))throw Error('כבר הוגדר חשבון בעלת מערכת.');
      if(this.store.get('staff',username))throw Error('שם המשתמש כבר קיים.');
      const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex'),secret=base32(randomBytes(20));
      const s=this.store.create('staff','staff',{id:username,name:name.trim(),role:'owner',active:true,passwordSalt:salt,passwordHash:scryptSync(password,salt,32).toString('hex'),mfaSecret:secret,lastCounter:-1});
      this.store.audit(actor,'owner.created',s.id);
      return {id:s.id,name:s.name,role:s.role,password,mfaSecret:secret};
    });
  }
  logout(token){this.store.remove('staff-token',hash(token));}
  login(id,password,otp){let s=this.store.get('staff',id);if(!s?.active||typeof password!=='string'||password.length>200)throw Error('פרטי כניסת צוות לא זוהו.');const f=this.store.get('staff-failure',id);if(f?.count>=3&&f.until>Date.now())throw Error('כניסת הצוות הוגבלה זמנית.');const now=Date.now(),offset=[-30000,0,30000].find(n=>String(otp)===totp(s.mfaSecret,now+n));const valid=timingSafeEqual(scryptSync(password,s.passwordSalt,32),Buffer.from(s.passwordHash,'hex'))&&offset!==undefined;const counter=Math.floor((now+(offset||0))/30000);if(!valid||counter<=s.lastCounter){if(f)this.store.put('staff-failure',{...f,count:f.until>now?f.count+1:1,until:now+900000});else this.store.create('staff-failure','staff',{id,count:1,until:now+900000});throw Error('פרטי כניסת צוות לא זוהו.');}this.store.remove('staff-failure',id);s=this.store.put('staff',{...s,lastCounter:counter});const token=randomBytes(32).toString('hex');this.store.create('staff-token',id,{id:hash(token),expiresAt:now+600000});this.store.audit(id,'staff.login',id);return {token,role:s.role};}
  authenticate(token){const t=this.store.get('staff-token',hash(token)),s=t&&this.store.get('staff',t.owner);if(!t||t.expiresAt<Date.now()||!s?.active)throw Object.assign(Error('נדרשת כניסת צוות.'),{status:401});return {actor:s.id,role:s.role};}
}
