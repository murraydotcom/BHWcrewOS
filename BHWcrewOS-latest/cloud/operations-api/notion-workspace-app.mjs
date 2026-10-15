import {verifyCrewToken} from './auth.mjs';
import {WORKSPACES,workspaceDefinition,prepareImport,NotionWorkspaceRepository} from './notion-workspaces.mjs';
export function createNotionWorkspaceApp({baseApp,db,repository=new NotionWorkspaceRepository(db),environment=process.env}){
  return async request=>{
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/v1/notion-workspaces'))return baseApp(request);
    const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    try{
      const actor=verifyCrewToken(request.headers.get('authorization'),environment.CREWOS_OPERATIONS_TOKEN_SECRET);
      if(!['operations-manager','executive'].includes(actor.role))return reply(403,{error:'Administrator access is required.'});
      const match=url.pathname.match(/^\/v1\/notion-workspaces\/([a-z]+)(?:\/(preview|import|save))?$/);
      if(!match)return reply(404,{error:'Workspace route not found.'});
      const [,key,action]=match;const definition=workspaceDefinition(key);
      if(request.method==='GET'&&!action){const cursor=url.searchParams.get('cursor')||'';if(cursor&&!/^(?:[a-f0-9]{64}|crew-[a-f0-9-]{36})$/.test(cursor))return reply(400,{error:'Invalid page cursor.'});return reply(200,{ok:true,definition,workspaces:WORKSPACES,...await repository.list(key,cursor)});}
      if(request.method!=='POST'||!action)return reply(405,{error:'Unsupported method.'});
      const raw=await request.text();if(Buffer.byteLength(raw,'utf8')>60000)return reply(413,{error:'Upload is too large.'});
      let body;try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{return reply(400,{error:'Invalid JSON.'});}
      if(action==='save')return reply(200,{ok:true,...await repository.save(key,body,actor)});
      const prepared=prepareImport(key,body.csv);
      if(action==='preview')return reply(200,{ok:true,count:prepared.count,exportHash:prepared.exportHash,blankTitles:prepared.blankTitles,statusCounts:prepared.statusCounts});
      if(body.confirmation!=='IMPORT ALL RECORDS'||body.exportHash!==prepared.exportHash)return reply(409,{error:'Preview the current CSV and confirm IMPORT ALL RECORDS before importing.'});
      return reply(200,{ok:true,...await repository.import(key,prepared,actor)});
    }catch(error){return reply(Number(error.status)||500,{error:Number(error.status)?error.message:'Protected workspace is temporarily unavailable.'});}
  };
}
