'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILES=['index.html','app.js','style.css','install.js','connection.js','updates.js','icon-192.png','icon-512.png','brand-logo.png'];
const LIMIT=12*1024*1024;
function verifyBundle(envelope,key,platform){
  if(typeof envelope!=='string'||Buffer.byteLength(envelope)>LIMIT)throw Error('Update too large');
  const outer=JSON.parse(envelope);
  if(typeof outer.payload!=='string'||typeof outer.signature!=='string')throw Error('Invalid envelope');
  const bytes=Buffer.from(outer.payload,'base64');
  if(!crypto.verify('RSA-SHA256',bytes,key,Buffer.from(outer.signature,'base64')))throw Error('Invalid update signature');
  const data=JSON.parse(bytes.toString('utf8'));
  if(data.compatibility!=='0.4'||data.platform!==platform||!Number.isSafeInteger(data.version)||data.version<1||data.version>2147483647)throw Error('Incompatible update');
  if(!data.files||Object.keys(data.files).sort().join('|')!==[...FILES].sort().join('|'))throw Error('Invalid file list');
  const files={};let size=0;
  for(const name of FILES){if(typeof data.files[name]!=='string')throw Error('Invalid file');const b=Buffer.from(data.files[name],'base64');size+=b.length;if(!b.length||size>8*1024*1024)throw Error('Invalid file size');files[name]=b;}
  if(!files['index.html'].toString().includes('id="suite-home"'))throw Error('Invalid home');
  return {version:data.version,files};
}
class Updates {
  constructor(root,bundled,key,platform='windows'){this.root=root;this.bundled=bundled;this.key=key;this.platform=platform;fs.mkdirSync(root,{recursive:true});this.busy=false;}
  read(){try{return JSON.parse(fs.readFileSync(path.join(this.root,'state.json'),'utf8'));}catch{return {current:0,previous:0,pending:0,trial:false,highest:1};}}
  save(state){const temp=path.join(this.root,'state.tmp');fs.writeFileSync(temp,JSON.stringify(state));fs.renameSync(temp,path.join(this.root,'state.json'));}
  dir(version){return version?path.join(this.root,String(version)):this.bundled;}
  start(){let s=this.read();if(s.trial){s.current=s.previous||0;s.pending=0;s.trial=false;}
    if(s.pending){s.previous=s.current||0;s.current=s.pending;s.pending=0;s.trial=true;}
    if(!fs.existsSync(path.join(this.dir(s.current),'index.html'))){s.current=0;s.trial=false;}
    this.save(s);return this.dir(s.current);
  }
  ready(){const s=this.read();s.trial=false;this.save(s);for(const name of fs.readdirSync(this.root)){if(/^\d+$/.test(name)&&![s.current,s.previous,s.pending].includes(Number(name)))fs.rmSync(path.join(this.root,name),{recursive:true,force:true});}return {version:s.current||1,pending:s.pending||0};}
  stage(envelope){const data=verifyBundle(envelope,this.key,this.platform),s=this.read();if(data.version<=(s.highest||1))return {available:!!s.pending,version:s.pending||s.current||1};
    const temp=path.join(this.root,'staging');fs.rmSync(temp,{recursive:true,force:true});fs.mkdirSync(temp);
    try{for(const [name,bytes] of Object.entries(data.files))fs.writeFileSync(path.join(temp,name),bytes);fs.copyFileSync(path.join(this.bundled,'native-bridge.js'),path.join(temp,'native-bridge.js'));
      const target=this.dir(data.version);fs.rmSync(target,{recursive:true,force:true});fs.renameSync(temp,target);
      this.save({...s,pending:data.version,highest:data.version});
    }catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error;}
    return {available:true,version:data.version};
  }
  async check(){if(this.busy)return {busy:true};this.busy=true;try{
    const response=await fetch(`https://raw.githubusercontent.com/MARK-avigail/mirkam-line/main/updates/${this.platform}.json`,{headers:this.read().etag?{'If-None-Match':this.read().etag}:{},redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(response.status===304){const s=this.read();return {available:!!s.pending,version:s.pending||s.current||1};}
    if(!response.ok)throw Error('Update service unavailable');
    const reader=response.body.getReader();let size=0,chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();throw Error('Update too large');}chunks.push(Buffer.from(value));}
    const result=this.stage(Buffer.concat(chunks).toString('utf8'));const etag=response.headers.get('etag');if(etag)this.save({...this.read(),etag});return result;
  }finally{this.busy=false;}}
}
module.exports={Updates,verifyBundle,FILES};
