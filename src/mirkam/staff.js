import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
export const PERMISSIONS={owner:['*'],support:['users','contacts','tickets','status'],billing:['membership','payments','status']};
export function permitted(role,path){if(!Object.hasOwn(PERMISSIONS,role)||typeof path!=='string')return false;return ['logout','session'].includes(path)||PERMISSIONS[role].some(p=>p==='*'||path===p||path.startsWith(p+'/'));}
export class Staff {
  constructor(store){this.store=store;}
  create(name,role,actor){if(typeof name!=='string'||!name.trim()||!['support','billing'].includes(role))throw Error('שם או תפקיד צוות אינם תקינים.');const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');const r=this.store.create('staff','staff',{name:name.trim(),role,active:true,passwordSalt:salt,passwordHash:scryptSync(password,salt,32).toString('hex')});this.store.audit(actor,'staff.created',r.id);return {id:r.id,name:r.name,role,password};}
  createOwner(username,name,actor){
    if(actor!=='owner')throw Object.assign(Error('הגדרת בעלת המערכת דורשת את קוד ההגדרה הראשוני.'),{status:403});
    if(typeof username!=='string'||!/^[a-zA-Z][a-zA-Z0-9_.-]{2,39}$/.test(username)||typeof name!=='string'||!name.trim())throw Error('שם משתמש או שם להצגה אינם תקינים.');
    return this.store.atomic(()=>{
      if(this.store.list('staff').some(s=>s.role==='owner'))throw Error('כבר הוגדר חשבון בעלת מערכת.');
      if(this.store.get('staff',username))throw Error('שם המשתמש כבר קיים.');
      const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
      const s=this.store.create('staff','staff',{id:username,name:name.trim(),role:'owner',active:true,passwordSalt:salt,passwordHash:scryptSync(password,salt,32).toString('hex')});
      this.store.audit(actor,'owner.created',s.id);
      return {id:s.id,name:s.name,role:s.role,password};
    });
  }
  logout(token){this.store.remove('staff-token',hash(token));}
  login(id,password){const s=this.store.get('staff',id);if(!s?.active||typeof password!=='string'||password.length>200)throw Error('פרטי כניסת צוות לא זוהו.');const f=this.store.get('staff-failure',id);if(f?.count>=3&&f.until>Date.now())throw Error('כניסת הצוות הוגבלה זמנית.');const now=Date.now();const valid=timingSafeEqual(scryptSync(password,s.passwordSalt,32),Buffer.from(s.passwordHash,'hex'));if(!valid){if(f)this.store.put('staff-failure',{...f,count:f.until>now?f.count+1:1,until:now+900000});else this.store.create('staff-failure','staff',{id,count:1,until:now+900000});throw Error('פרטי כניסת צוות לא זוהו.');}this.store.remove('staff-failure',id);const token=randomBytes(32).toString('hex');this.store.create('staff-token',id,{id:hash(token),expiresAt:now+3600000});this.store.audit(id,'staff.login',id);return {token,role:s.role};}
  authenticate(token){const t=this.store.get('staff-token',hash(token)),s=t&&this.store.get('staff',t.owner);if(!t||t.expiresAt<Date.now()||!s?.active)throw Object.assign(Error('נדרשת כניסת צוות.'),{status:401});if(t.expiresAt-Date.now()<3300000)this.store.put('staff-token',{...t,expiresAt:Date.now()+3600000});return {actor:s.id,role:s.role};}
}
