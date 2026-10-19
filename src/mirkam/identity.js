import { randomInt, randomBytes, createHash, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const digest=x=>createHash('sha256').update(String(x)).digest('hex');
const hashPin=(pin,salt)=>scryptSync(pin,salt,32).toString('hex');
const clean=(s,max=150)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('פרטים חסרים או לא תקינים.');return s.trim();};
export const safeUser=u=>{const {pinHash,pinSalt,...safe}=u;return safe;};
export function totp(secret, now=Date.now()) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
  for(const c of String(secret).toUpperCase().replace(/=+$/,'')){const n=alphabet.indexOf(c);if(n<0)throw Error('Invalid MFA secret');bits+=n.toString(2).padStart(5,'0');}
  const key=Buffer.from((bits.match(/.{8}/g)||[]).map(x=>parseInt(x,2)));if(key.length<16)throw Error('MFA secret too short');
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
  const h=createHmac('sha1',key).update(counter).digest(),o=h[19]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0');
}
export class Identity {
  constructor(store){this.store=store;}
  register(data,actor) {
    return this.store.atomic(()=>{
    const identity=clean(data.identity,9);if(!/^\d{9}$/.test(identity))throw Error('מספר זהות צריך להכיל תשע ספרות.');
    if(this.store.list('user').some(u=>u.identity===identity))throw Error('כבר קיים חשבון למספר זהות זה.');
    const users=this.store.list('user');let code;do{code=String(randomInt(1000000)).padStart(6,'0');}while(users.some(u=>u.code===code));
    const pin=String(randomInt(1000000)).padStart(6,'0'),pinSalt=randomBytes(16).toString('hex');
    const user=this.store.create('user','users',{code,name:clean(data.name),identity,prisonerNumber:clean(data.prisonerNumber),prison:clean(data.prison),wing:String(data.wing||'').slice(0,100),verifiedBy:clean(actor),verifiedAt:Date.now(),active:true,pinSalt,pinHash:hashPin(pin,pinSalt),trialUntil:Date.now()+14*86400000,membership:data.freeMembership===true?'free':'trial',renewalConsent:false,priceAgorot:4990});
    this.store.audit(actor,'user.enrolled',user.id);return {user:safeUser(user),pin};
    });
  }
  user(id){const u=this.store.get('user',id);if(!u||!u.active)throw Error('החשבון אינו זמין.');return u;}
  login(code,pin,source='unknown') {
    const now=Date.now(),key=digest('code:'+String(code)),sourceKey=digest('source:'+source);
    const failures=[key,sourceKey].map(id=>this.store.get('failure',id));
    if(failures.some((f,i)=>f&&f.until>now&&f.count>=(i?20:3)))throw Error('ניסיונות הכניסה הוגבלו זמנית. אפשר לפנות למשרד.');
    const u=this.store.list('user').find(u=>u.code===code);
    const candidate=hashPin(typeof pin==='string'&&/^\d{6}$/.test(pin)?pin:'invalid',u?.pinSalt||'unknown-account-salt');
    if(!u?.active||typeof code!=='string'||!/^\d{6}$/.test(code)||typeof pin!=='string'||!/^\d{6}$/.test(pin)||!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(u.pinHash,'hex'))) {
      for(const id of [key,sourceKey]){const f=this.store.get('failure',id);if(f)this.store.put('failure',{...f,count:f.until>now?f.count+1:1,until:f.until>now?f.until:now+900000});else this.store.create('failure','auth',{id,count:1,until:now+900000});}
      throw Error('פרטי הכניסה לא זוהו.');
    }
    this.store.remove('failure',key);
    const token=randomBytes(32).toString('hex');this.store.create('token',u.id,{id:digest(token),expiresAt:now+3600000,role:'member'});
    return {token,user:safeUser(u)};
  }
  authenticate(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('נדרשת כניסה.');const t=this.store.get('token',digest(token));if(!t||t.expiresAt<Date.now())throw Error('נדרשת כניסה מחדש.');return {user:safeUser(this.user(t.owner)),tokenId:t.id};}
  logout(token){this.store.remove('token',digest(token));}
  revoke(id){for(const t of this.store.list('token',id))this.store.remove('token',t.id);}
  reset(id,actor){return this.store.atomic(()=>{const u=this.store.get('user',id);if(!u)throw Error('החשבון לא נמצא.');let pin;do{pin=String(randomInt(1000000)).padStart(6,'0');}while(hashPin(pin,u.pinSalt)===u.pinHash);const salt=randomBytes(16).toString('hex');this.store.put('user',{...u,pinSalt:salt,pinHash:hashPin(pin,salt)});this.revoke(id);this.store.remove('failure',digest('code:'+u.code));this.store.audit(actor,'user.pin-reset',id);return {pin};});}
  suspend(id,active,actor){return this.store.atomic(()=>{const u=this.store.get('user',id);if(!u||typeof active!=='boolean')throw Error('החשבון או המצב לא תקינים.');const r=this.store.put('user',{...u,active});this.revoke(id);this.store.audit(actor,'user.status',id);return safeUser(r);});}
}
