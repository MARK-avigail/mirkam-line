'use strict';
const routes=/^\/(health|api\/[a-zA-Z0-9_/-]+)(\?[^#]*)?$/;
function validateRequest(input){
  if(!input||typeof input.endpoint!=='string'||typeof input.route!=='string')throw Error('Invalid request');
  const url=new URL(input.endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('HTTPS server origin required');
  if(!routes.test(input.route)||input.route.includes('..')||input.route.includes('//'))throw Error('Invalid API route');
  const method=input.method||'GET';if(!['GET','POST','PATCH','DELETE','PUT'].includes(method))throw Error('Invalid method');
  const headers={};for(const [key,value] of Object.entries(input.headers||{})){
    if(!['authorization','content-type','x-mirkam-otp'].includes(key.toLowerCase())||typeof value!=='string'||/[\r\n]/.test(value)||value.length>4096)throw Error('Invalid header');
    headers[key]=value;
  }
  if(input.body!==undefined&&(typeof input.body!=='string'||input.body.length>20000000))throw Error('Invalid body');
  return {url:url.origin+input.route,method,headers,body:input.body};
}
module.exports={validateRequest};
