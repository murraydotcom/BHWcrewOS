import shared from './_lib.js';
import cloud from './lib/operations-cloud.js';
export default async function handler(request){
  const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  const session=shared.getSession({headers:{authorization:request.headers.get('authorization')||''}});
  if(!session)return reply(401,{error:'Sign in to BHWcrewOS again.'});
  if(String(session.access||'').toLowerCase()!=='admin')return reply(403,{error:'Administrator access is required.'});
  const url=new URL(request.url),key=url.searchParams.get('workspace')||'healthcare',action=url.searchParams.get('action')||'';
  if(!['healthcare','purchases','library','marketing','invoices'].includes(key)||!['','preview','import','save'].includes(action))return reply(400,{error:'Unknown workspace or action.'});
  if(!['GET','POST'].includes(request.method))return reply(405,{error:'GET or POST only.'});
  const cursor=url.searchParams.get('cursor')||'';
  if(cursor&&!/^(?:[a-f0-9]{64}|crew-[a-f0-9-]{36})$/.test(cursor))return reply(400,{error:'Invalid page cursor.'});
  try{
    let body;
    if(request.method==='POST'){const raw=await request.text();if(new TextEncoder().encode(raw).length>60000)return reply(413,{error:'Upload is too large.'});try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON.'});}}
    const path=`/v1/notion-workspaces/${key}${action?'/'+action:''}${cursor?'?cursor='+encodeURIComponent(cursor):''}`;
    return reply(200,await cloud.operationsRequest(path,{actor:session,method:request.method,body}));
  }catch(error){return reply(Number(error.status)||503,{error:error.status===404?'The protected Cloud workspace service has not been deployed yet. Import is unavailable.':Number(error.status)?error.message:'Protected Cloud workspace is unavailable. Nothing is saved locally.'});}
}
