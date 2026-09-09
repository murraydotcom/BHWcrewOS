const { json } = require('./_lib');
exports.handler = async event => {
 if(event.httpMethod!=='GET') return json(405,{error:'GET only'});
 try {
  const base=new URL(process.env.RCM_CLOUD_API_URL || '');
  if(base.protocol!=='https:') throw new Error('configuration');
  const response=await fetch(`${base.href.replace(/\/$/,'')}/v1/patient/config`);
  if(!response.ok) throw new Error('configuration');
  const config=await response.json();
  const url=new URL(config.portalUrl);
  if(!config.enabled || url.protocol!=='https:') throw new Error('configuration');
  url.hash='leave';
  return json(200,{enabled:true,url:url.href});
 } catch {return json(503,{enabled:false,error:'Secure leave intake is not connected yet. Contact BHW.'});}
};
