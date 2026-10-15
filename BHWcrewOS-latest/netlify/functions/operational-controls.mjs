import shared from './_lib.js';
import store from './lib/operational-store.js';
import controls from './lib/operational-controls.js';

export default async function handler(request) {
  const respond=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  const session=shared.getSession({headers:{authorization:request.headers.get('authorization')||''}});
  if(!session) return respond(401,{error:'Sign in to BHWcrewOS again.'});
  if(String(session.access||'').toLowerCase()!=='admin') return respond(403,{error:'Administrator access is required.'});
  if(!['GET','POST'].includes(request.method)) return respond(405,{error:'GET or POST only.'});
  try {
    if(await store.cutoverMode()!=='database') return respond(409,{error:'Complete the verified Notion import in Notion Connections first. Editing is available once BHWcrewOS owns the records.'});
    const pool=await store.getOperationalPool();
    if(request.method==='GET') {
      const namespace=new URL(request.url).searchParams.get('namespace')||'staff';
      return respond(200,{ok:true,...await controls.listControls(pool,namespace),sections:Object.entries(controls.DEFINITIONS).map(([key,value])=>({key,label:value.label}))});
    }
    const raw=await request.text();
    if(raw.length>40000) return respond(413,{error:'Record is too large.'});
    let body;try{body=JSON.parse(raw);}catch{return respond(400,{error:'Invalid request.'});}
    const saved=await controls.saveControl(pool,String(body.namespace||''),body,session);
    return respond(200,{ok:true,...saved});
  }catch(error){return respond(Number(error.status)||500,{error:Number(error.status)?error.message:'Operational controls are unavailable. Retry shortly.'});}
}
