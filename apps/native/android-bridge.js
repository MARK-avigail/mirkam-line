import { Capacitor, CapacitorHttp } from '@capacitor/core';
if(Capacitor.isNativePlatform())window.mirkamNative={platform:'android',async request(input){
  const result=await CapacitorHttp.request({url:input.endpoint+input.route,method:input.method||'GET',headers:input.headers,data:input.body?JSON.parse(input.body):undefined,responseType:'arraybuffer',connectTimeout:15000,readTimeout:45000,disableRedirects:true});
  return {status:result.status,headers:result.headers,base64:result.data};
}};
