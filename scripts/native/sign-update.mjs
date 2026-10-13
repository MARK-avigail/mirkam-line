// Run prepare.mjs first. The release private key must remain outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {FILES}=createRequire(import.meta.url)(path.join(root,'apps/native/desktop/updates.cjs'));
const version=Number(process.argv[2]);
if(!Number.isSafeInteger(version)||version<1)throw Error('Provide an integer UI release version');
if(!process.env.MIRKAM_UI_SIGNING_KEY_FILE)throw Error('Set MIRKAM_UI_SIGNING_KEY_FILE to the private release key path');
const key=fs.readFileSync(process.env.MIRKAM_UI_SIGNING_KEY_FILE);
const publicKey=fs.readFileSync(path.join(root,'apps/native/update-public.pem'));
const files=Object.fromEntries(FILES.map(name=>[name,fs.readFileSync(path.join(root,'apps/native/www',name)).toString('base64')]));
fs.mkdirSync(path.join(root,'updates'),{recursive:true});
for(const platform of ['android','windows']){
 const payload=Buffer.from(JSON.stringify({version,compatibility:'0.4',platform,files}));
 const signature=crypto.sign('RSA-SHA256',payload,key);
 if(!crypto.verify('RSA-SHA256',payload,publicKey,signature))throw Error('Release key does not match installed public key');
 fs.writeFileSync(path.join(root,`updates/${platform}.json`),JSON.stringify({payload:payload.toString('base64'),signature:signature.toString('base64')}));
}
console.log(`Signed UI release ${version} for Android and Windows. No private key included.`);
