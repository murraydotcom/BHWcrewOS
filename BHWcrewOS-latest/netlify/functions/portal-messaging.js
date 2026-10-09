const crypto=require('node:crypto');
const {getSession}=require('./_lib');
const MAX_REQUEST=2_150_000, MAX_FILE=512*1024;
function download(file){
  if(!file || !/^att-[a-f0-9]{40}$/.test(file.id) || !/^[a-z0-9][a-z0-9 _().-]{0,99}$/i.test(file.name) || file.name.includes('..') || !Number.isSafeInteger(file.size) || file.size<1 || file.size>MAX_FILE || typeof file.contentBase64!=='string' || file.contentBase64.length>Math.ceil(MAX_FILE/3)*4)throw Error('Invalid download');
  const bytes=Buffer.from(file.contentBase64,'base64');
  if(bytes.length!==file.size || bytes.toString('base64')!==file.contentBase64 || crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Invalid download');
  return {statusCode:200,isBase64Encoded:true,headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${file.name}"`,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"},body:file.contentBase64};
}
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
function messagingToken(session,secret,now=Date.now()) {
  if(!secret || !session?.staffId)throw Error('Messaging is unavailable.');
  const iat=Math.floor(now/1000);
  const claims={iss:'bhw-crewhq',aud:'bhw-rcm-cloud',sub:`crew:${session.staffId}`,staffId:session.staffId,name:session.name||'BHW staff',
    role:session.role||'staff',scope:'portal-messaging',iat,exp:iat+60};
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');
}
function createPortalMessagingHandler({sessionImpl=getSession,fetchImpl=fetch,environment=process.env,now=Date.now}={}) {
  return async event=>{
    if(!['GET','POST'].includes(event.httpMethod))return json(405,{ok:false,error:'GET or POST only.'});
    const session=sessionImpl(event);
    if(!session?.staffId)return json(401,{ok:false,error:'Sign in to CrewOS again.'});
    if(environment.SYNTHETIC_PORTAL_MESSAGING_ENABLED!=='true')return json(503,{ok:false,error:'Synthetic messaging is not enabled.'});
    let base;
    try{base=new URL(environment.HEALTH_CORE_API_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error();}
    catch{return json(503,{ok:false,error:'Messaging is unavailable.'});}
    const params=new URLSearchParams();
    for(const key of ['threadId','before']) {const value=event.queryStringParameters?.[key];if(value){if(!/^msg-[a-f0-9]{40}$/.test(value))return json(400,{ok:false,error:'Invalid conversation reference.'});params.set(key,value);}}
    if(event.queryStringParameters?.patient && event.queryStringParameters.patient!=='BHW0000')return json(403,{ok:false,error:'Real-patient messaging is disabled.'});
    const attachmentId=event.queryStringParameters?.attachmentId;
    if(attachmentId){if(event.httpMethod!=='GET' || !params.has('threadId') || !/^att-[a-f0-9]{40}$/.test(attachmentId))return json(400,{ok:false,error:'Invalid file reference.'});params.set('attachmentId',attachmentId);}
    let body;
    if(event.httpMethod==='POST') {
      const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):String(event.body||'');
      if(Buffer.byteLength(raw,'utf8')>MAX_REQUEST)return json(413,{ok:false,error:'Message request is too large.'});
      try{body=JSON.parse(raw);}catch{return json(400,{ok:false,error:'Invalid message request.'});}
      // Staff cannot select a patient outside the isolated BHW0000 store.
      if(body.bhwPatientId && body.bhwPatientId!=='BHW0000')return json(403,{ok:false,error:'Real-patient messaging is disabled.'});
    }
    try {
      const token=messagingToken(session,environment.CREWHQ_CLOUD_TOKEN_SECRET,now());
      const response=await fetchImpl(`${base.href.replace(/\/$/,'')}/v1/portal-messaging/inbox${params.size?'?'+params:''}`,{
        method:event.httpMethod,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(8000)});
      const data=await response.json().catch(()=>null);
      if(!data || typeof data.ok!=='boolean' || (response.ok && data.ok!==true))throw Error('Unconfirmed response');
      if(!response.ok)return json([400,401,403,404,409,413,422,429,503].includes(response.status)?response.status:502,{ok:false,error:response.status<500?data.error:'Messaging is unavailable.'});
      if(attachmentId){if(data.attachment?.id!==attachmentId)throw Error('Invalid file reference');return download(data.attachment);}
      if(body && data.commandId!==body.commandId)throw Error('Unconfirmed response');
      return json(200,data);
    }catch{return json(502,{ok:false,saveUnconfirmed:event.httpMethod==='POST',error:event.httpMethod==='POST'?'Save could not be confirmed. Retry the same submission.':'Messages could not be loaded.'});}
  };
}
exports.handler=createPortalMessagingHandler();
exports._test={createPortalMessagingHandler,messagingToken};
