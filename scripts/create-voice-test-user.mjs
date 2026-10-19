import {randomInt} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Store} from '../src/mirkam/store.js';
import {Identity,safeUser} from '../src/mirkam/identity.js';

export function createVoiceTestUser(store){

    const existing=store.list('user').find(u=>u.testAccount===true&&u.testPurpose==='voice-acceptance');
    if(existing)return {user:safeUser(existing),existing:true};
    let identity;
    do{identity='000'+String(randomInt(1000000)).padStart(6,'0');}while(store.list('user').some(u=>u.identity===identity));
    const result=new Identity(store).register({name:'משתמש בדיקה — ליין',identity,prison:'סביבת בדיקה',prisonerNumber:'TEST'},'voice-test-setup',{testAccount:true});
    return {...result,existing:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const store=new Store(process.env.MIRKAM_DATA_DIR||'./mirkam-data',process.env.DATA_ENCRYPTION_KEY);
  try{
    const result=createVoiceTestUser(store);
    console.log('VOICE_TEST_USER_CODE='+result.user.code);
    if(result.pin)console.log('VOICE_TEST_USER_PIN='+result.pin);
    else console.log('TEST_USER_ALREADY_EXISTS: PIN unchanged; use management PIN reset if needed.');
    console.log('Private test credentials: do not share screenshots. Trial lasts 14 days; AI usage is billed by the provider. External delivery is blocked.');
  }finally{store.close();}
}
