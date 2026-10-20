// Run inside the application container. Does not send email or print credentials/content.
const key=process.env.MIRKAM_ADMIN_TOKEN;
if(!key||key.length<32){console.error('SERVER_ADMIN_CREDENTIAL_MISSING');process.exit(1);}
try{
 const response=await fetch('http://127.0.0.1:'+(Number(process.env.PORT)||3000)+'/api/admin/family-inbox',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(50000)});
 const result=await response.json();
 if(!response.ok||!result.ok)throw Error();
 console.log(JSON.stringify({check:'FAMILY_INBOX',configured:result.configured,error:result.error,checkedAt:result.checkedAt,importedNow:result.lastImported,totalImported:result.totalImported,repairedNow:result.lastRepaired,totalRepaired:result.totalRepaired,bodyUnavailable:result.bodyUnavailable,scanned:result.scanned,pending:result.pending,skipped:result.skipped,attachmentsIgnored:result.attachmentsIgnored}));
 if(result.error)process.exitCode=1;
}catch{console.error('FAMILY_INBOX_CHECK_UNAVAILABLE: no credentials or message content logged');process.exitCode=1;}
