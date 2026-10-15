import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Store} from '../../src/mirkam/store.js';
import {Mirkam} from '../../src/mirkam/service.js';
import {createMirkamServer} from '../../src/mirkam/http.js';
const master='m'.repeat(64);process.env.MIRKAM_ADMIN_TOKEN=master;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mirkam-access-')),store=new Store(dir),service=new Mirkam(store),server=createMirkamServer(service);t.after(()=>{server.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,service,server};}
function request(server,route,method='GET',token='',body={}){return new Promise(resolve=>{const req=Readable.from(method==='GET'?[]:[JSON.stringify(body)]);req.url=route;req.method=method;req.headers={host:'example.test',authorization:'Bearer '+token};req.socket={remoteAddress:'127.0.0.1'};const res={status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);this.headersSent=true;},end(data=''){let body;try{body=JSON.parse(String(data));}catch{}resolve({status:this.status,body,headers:this.headers});}};server.emit('request',req,res);});}

import {BRANCHES} from '../../src/mirkam/workflow.js';

const envKeys=['OPENAI_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS','SMTP_PORT','TWILIO_AUTH_TOKEN','BASE_URL'];
const original=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
for(let mask=0;mask<128;mask++)test(`connection configuration combination ${mask}: report configuration, never live success`,async t=>{
 const bit=n=>Boolean(mask&(1<<n));
 const values=['test-api-secret','smtp.example.test','test-user','test-mail-secret','587','test-voice-secret','https://line.example.test'];
 for(let i=0;i<envKeys.length;i++){if(bit(i))process.env[envKeys[i]]=values[i];else delete process.env[envKeys[i]];}
 // A present but unsupported SMTP port must be reported as unconfigured.
 if(!bit(4))process.env.SMTP_PORT='25';
 const {server}=fixture(t);const r=await request(server,'/api/admin/status','GET',master);
 assert.equal(r.status,200);assert.equal(r.body.aiConfigured,bit(0));
 assert.equal(r.body.emailConfigured,bit(1)&&bit(2)&&bit(3)&&bit(4));
 assert.equal(r.body.voiceConfigured,bit(5)&&bit(6));
 assert.equal(r.body.faxConfigured,false);assert.equal(r.body.paymentConfigured,false);assert.equal(r.body.liveVerified,false);
 for(const value of values.filter(v=>v.includes('secret')))assert.ok(!JSON.stringify(r.body).includes(value));
 for(const k of envKeys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}
});
test('management line menu uses the actual telephone menu including child digits',async t=>{
 const {server}=fixture(t);const r=await request(server,'/api/admin/line','GET',master);
 assert.equal(r.status,200);assert.deepEqual(r.body.branches,BRANCHES);assert.equal(r.body.channel,'telephone');assert.equal(r.body.liveVerified,false);
});
for(const role of ['anonymous','support','billing'])test(`${role} cannot inspect owner line menu`,async t=>{
 const {service,server}=fixture(t);let token='';if(role!=='anonymous'){const s=service.staff.create('test',role,'owner');token=service.staff.login(s.id,s.password).token;}
 const r=await request(server,'/api/admin/line','GET',token);assert.equal(r.status,role==='anonymous'?401:403);assert.equal(r.body.branches,undefined);
});
