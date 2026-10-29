const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHomeHandler,personalMetrics}=require('../netlify/functions/hq-home')._test;
const actor={staffId:'synthetic-a',name:'Synthetic staff',role:'care-manager',divisions:['Care Management']};
const time=Date.parse('2026-10-27T16:00:00Z');
const request=(id,extra={})=>({id,source:'crewos',workflowContext:{kind:'handoff',fromDivision:'Primary Care',toDivision:'Care Management'},
  status:'new',statusCategory:'received',assignedTo:'',createdBy:'crew:synthetic-other',updatedAt:'2026-10-27T15:00:00Z',...extra});
const event={httpMethod:'GET',headers:{}};
function handler({rows=[],projects=[],portal={statusCode:503,body:'{}'},...overrides}={}){
 return createHomeHandler({sessionImpl:()=>actor,now:()=>time,operationsImpl:async url=>({requests:rows.filter(r=>r.source===new URL('https://example.test'+url).searchParams.get('source'))}),
  queryImpl:async()=>projects,portalImpl:async()=>portal,fetchImpl:async()=>Response.json({submissions:[]}),...overrides});
}
test('anonymous and forged/expired sessions receive no home data or downstream calls',async()=>{
 let calls=0;const h=handler({sessionImpl:()=>null,operationsImpl:async()=>{calls++;}});
 assert.equal((await h(event)).statusCode,401);assert.equal(calls,0);
 const real=require('../netlify/functions/hq-home').handler;
 assert.equal((await real({...event,headers:{authorization:'Bearer forged.token'}})).statusCode,401);
});
test('client cannot select a different person, role, divisions, or method',async()=>{
 const h=handler();for(const key of ['staffId','role','divisions'])assert.equal((await h({...event,queryStringParameters:{[key]:'other'}})).statusCode,400);
 assert.equal((await h({...event,httpMethod:'POST'})).statusCode,405);
});
test('personal home separates own work, role queue, outgoing work, and other assignees',async()=>{
 const rows=[request('own',{assignedTo:'crew:synthetic-a'}),request('team'),request('sent',{createdBy:'crew:synthetic-a',assignedTo:'crew:synthetic-b'}),
  request('other-owner',{assignedTo:'crew:synthetic-b'}),request('wrong-area',{workflowContext:{kind:'handoff',toDivision:'Flow'}}),
  request('name-only',{assignedToName:actor.name}),request('fax',{source:'front-desk',summary:'PRIVATE PHONE TEXT'}),request('general',{workflowContext:{},summary:'PRIVATE MESSAGE'})];
 const response=await handler({rows})(event);const d=JSON.parse(response.body);
 assert.deepEqual(new Set(d.handoffs.items.map(r=>r.id)),new Set(['own','team','sent']));
 assert.match(response.headers['Cache-Control'],/no-store, private/);
 assert(!response.body.includes('PRIVATE'));assert(!response.body.includes('other-owner'));assert(!response.body.includes('synthetic-b'));
 assert.equal(d.notifications.portal.count,null);
});
test('care replies require current protected source status and exact identity or role routing',async()=>{
 const old=process.env.CREWHQ_CARE_TOKEN_SECRET;process.env.CREWHQ_CARE_TOKEN_SECRET='synthetic-test-only';
 try{const rows=[request('content-own',{source:'patient-content-html',workflowContext:{},assignedTeam:'clinical',assignedTo:'crew:synthetic-a',sourceReference:'submission-a',summary:'DO NOT COPY'}),
  request('content-other',{source:'patient-content-html',workflowContext:{},assignedTeam:'clinical',assignedTo:'crew:synthetic-b',sourceReference:'submission-b'}),
  request('content-reviewed',{source:'patient-content-html',workflowContext:{},assignedTeam:'clinical',assignedTo:'crew:synthetic-a',sourceReference:'submission-c'})];
 const h=handler({rows,fetchImpl:async()=>Response.json({submissions:[{id:'submission-a',status:'new',feedback:'SECRET ANSWER'},{id:'submission-b',status:'new'},{id:'submission-c',status:'reviewed'}]})});
 const r=await h(event);const d=JSON.parse(r.body);assert.equal(d.notifications.care.count,1);assert.equal(d.notifications.care.items[0].id,'content-own');
 assert(!r.body.includes('SECRET ANSWER'));assert(!r.body.includes('DO NOT COPY'));
 }finally{if(old===undefined)delete process.env.CREWHQ_CARE_TOKEN_SECRET;else process.env.CREWHQ_CARE_TOKEN_SECRET=old;}
});

test('all-area staff retain role filtering and exact assignment ownership',async()=>{
 const rows=[request('provider-attention',{requestType:'clinical_review',assignedTeam:'provider_review',status:'waiting_on_clinician'}),
  request('routine-team'),request('other-owner',{assignedTo:'crew:synthetic-b',assignedTeam:'provider_review',status:'waiting_on_clinician'}),
  request('unknown-area',{assignedTeam:'provider_review',status:'waiting_on_clinician',workflowContext:{kind:'handoff',toDivision:'Unknown'}})];
 for(const all of ['All','All Divisions']){
  const provider={...actor,role:'CRNP',divisions:[all]};
  const d=JSON.parse((await handler({rows,sessionImpl:()=>provider})(event)).body);
  assert.deepEqual(d.handoffs.items.map(r=>r.id),['provider-attention']);
  assert.deepEqual(d.user.divisions,[all]);
  const care=JSON.parse((await handler({rows,sessionImpl:()=>({...actor,divisions:[all]})})(event)).body);
  assert.deepEqual(new Set(care.handoffs.items.map(r=>r.id)),new Set(['provider-attention','routine-team']));
 }
});
test('myBHW uses existing inbox grants, shows own unread threads, and preserves pilot status',async()=>{
 const h=handler({portal:{statusCode:200,body:JSON.stringify({ok:true,actor:{id:'granted-staff-a'},threads:[
  {id:'thread-own',assignedTo:'granted-staff-a',unreadCount:2,subject:'PRIVATE SUBJECT'},
  {id:'thread-other',assignedTo:'other',unreadCount:9},{id:'unassigned',unreadCount:4}]})}});
 const r=await h(event),d=JSON.parse(r.body);assert.equal(d.notifications.portal.count,2);assert.equal(d.notifications.portal.pilot,true);
 assert(!r.body.includes('PRIVATE SUBJECT'));assert(!r.body.includes('thread-other'));
});
test('failure cannot become zero workload or a fabricated KPI',async()=>{
 const h=handler({operationsImpl:async()=>{throw Error('Private upstream error');},queryImpl:async()=>{throw Error('private');}});
 const r=await h(event),d=JSON.parse(r.body);assert.equal(d.handoffs.available,false);assert.equal(d.metrics.available,false);
 assert.deepEqual(d.metrics.items,[]);assert.equal(d.notifications.care.count,null);assert.equal(d.goals.available,false);assert(!r.body.includes('Private upstream'));
});
test('metrics attribute completions to stable staff identity and require dates for on-time fraction',()=>{
 const rows=[request('mine',{assignedTo:'crew:synthetic-a',updatedBy:'crew:synthetic-a',statusCategory:'completed',updatedAt:'2026-10-26T10:00:00Z',resolvedAt:'2026-10-26T10:00:00Z',dueAt:'2026-10-26T11:00:00Z'}),
  request('someone-else',{assignedTo:'crew:synthetic-a',updatedBy:'crew:other',statusCategory:'completed',resolvedAt:'2026-10-26T10:00:00Z'}),
  request('no-due',{updatedBy:'crew:synthetic-a',statusCategory:'completed',updatedAt:'2026-10-26T10:00:00Z',resolvedAt:'2026-10-26T10:00:00Z'}),
  request('old',{updatedBy:'crew:synthetic-a',statusCategory:'completed',resolvedAt:'2026-09-26T10:00:00Z'})];
 const metrics=personalMetrics(rows,actor,'care-manager',time);assert.equal(metrics[0].value,2);assert.equal(metrics[2].value,'1 / 1');assert(metrics.every(m=>m.target===null));
 assert.equal(personalMetrics([],actor,'care-manager',time)[2].value,null);
 const anotherActor=request('touched-later',{updatedBy:'crew:synthetic-a',statusCategory:'completed',resolvedAt:'2026-10-26T10:00:00Z',
  statusHistory:[{category:'completed',actor:'crew:synthetic-b',at:'2026-10-26T10:00:00Z'}]});
 assert.equal(personalMetrics([anotherActor],actor,'care-manager',time)[0].value,0);
});
test('new source replies enter the established role queue without creating or syncing records',async()=>{
 const old=process.env.CREWHQ_CARE_TOKEN_SECRET;process.env.CREWHQ_CARE_TOKEN_SECRET='synthetic-test-only';
 try{const calls=[];const h=handler({operationsImpl:async(url,options)=>{calls.push(options.method||'GET');return {requests:[]};},fetchImpl:async()=>Response.json({submissions:[
  {id:'submission-new',status:'new',contentPath:'/bhw-patient-material-viewer.html',submittedAt:'2026-10-27T15:00:00Z'},
  {id:'submission-med',status:'new',contentPath:'/bhw-medication-request.html'},
  {id:'submission-other',status:'new',assignedTo:'crew:synthetic-b'}]})});
 const d=JSON.parse((await h(event)).body);assert.equal(d.notifications.care.count,1);assert.equal(d.notifications.care.items[0].scope,'Your role’s review queue');
 assert(calls.every(method=>method==='GET'));
 }finally{if(old===undefined)delete process.env.CREWHQ_CARE_TOKEN_SECRET;else process.env.CREWHQ_CARE_TOKEN_SECRET=old;}
});
test('only projects assigned to exact staff identity appear as personal goals',async()=>{
 const project=(id,staff)=>({id,properties:{Project:{title:[{plain_text:'Goal '+id}]},Staff:{relation:[{id:staff}]},Status:{select:{name:'Active'}}}});
 const d=JSON.parse((await handler({projects:[project('a','synthetic-a'),project('b','synthetic-b')]})(event)).body);
 assert.equal(d.goals.items.length,1);assert.equal(d.goals.items[0].id,'a');
});
test('window limits are disclosed and closed workflow history stays reviewable',async()=>{
 const rows=Array.from({length:500},(_,i)=>request('work-'+i,{assignedTo:'crew:synthetic-a'}));rows[0].statusCategory='completed';
 const d=JSON.parse((await handler({rows})(event)).body);assert.equal(d.handoffs.limited,true);assert.equal(d.metrics.limited,true);assert.equal(d.handoffs.recentClosed[0].id,'work-0');
});
test('approved layout keeps original palette and resource links without mockup data or role switching',()=>{
 const site=path.resolve(__dirname,'..');const html=fs.readFileSync(path.join(site,'hq.html'),'utf8');const js=fs.readFileSync(path.join(site,'hq-home.mjs'),'utf8');
 assert.match(html,/--bg:#091722/);assert.match(html,/--bg:#f4eede/);assert.match(html,/--gold:#e0b75e; --teal:#5fb3ac; --peri:#8aa9d6/);
 assert.match(html,/clinical-access\.html/);assert.match(html,/provider-360\.html/);assert.match(html,/FrontdeskOS communications stay separate/);
 assert(html.indexOf('id="goalsTitle"')>html.indexOf('id="toolsTitle"'));
 assert(!/Demo patient|Preview role|Work requests/.test(html+js));assert.match(js,/cache:'no-store'/);
});

test('a slow two-minute refresh keeps the current person visible until actual session expiry',async()=>{
 let clock=Date.parse('2026-10-29T04:00:00Z'),sequence=0,resolveRefresh,calls=0;
 const expires=clock+3600000,timers=new Map(),nodes=new Map();
 function node(){return {value:'',textContent:'',children:[],hidden:false,disabled:false,
  append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
  setAttribute(){},addEventListener(){}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const data={ok:true,user:{name:'Synthetic provider',role:'CRNP',divisions:['All']},checkedAt:new Date(clock).toISOString(),
  notifications:{care:{available:true,count:0,message:'No replies',items:[]},portal:{available:false,message:'Pilot disabled',items:[]}},
  handoffs:{available:true,items:[],recentClosed:[]},metrics:{available:true,period:'Last 7 days',items:[]},goals:{available:true,items:[]}};
 const schedule=(fn,ms,repeat=false)=>{const id=++sequence;timers.set(id,{fn,at:clock+ms,ms,repeat});return id;};
 const token=Buffer.from(JSON.stringify({exp:expires})).toString('base64url')+'.synthetic';
 const context=vm.createContext({document:{getElementById:get,createElement:node,hidden:false,addEventListener(){},documentElement:{dataset:{theme:'dark'}}},
  window:{addEventListener(){}},sessionStorage:{getItem:()=>token},localStorage:{setItem(){}},
  Date:class extends Date{static now(){return clock;}},atob:s=>Buffer.from(s,'base64').toString(),AbortSignal,
  setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),
  fetch:async()=>{calls++;if(clock>=expires)return Response.json({error:'expired'},{status:401});
   if(calls===2)return new Promise(resolve=>{resolveRefresh=()=>resolve(Response.json(data));});return Response.json(data);}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../hq-home.mjs'),'utf8'),context);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
 assert.match(get('personScope').textContent,/Synthetic provider/);
 clock+=120000;
 for(const [id,t] of [...timers])if(t.at<=clock){if(t.repeat)t.at+=t.ms;else timers.delete(id);t.fn();}
 await flush();assert.equal(calls,2);
 assert.match(get('personScope').textContent,/Synthetic provider/,'in-flight refresh must not blank the current identity');
 resolveRefresh();await flush();assert.match(get('personScope').textContent,/Synthetic provider/);
 clock=expires;
 for(const [id,t] of [...timers])if(t.at<=clock){if(t.repeat)t.at+=t.ms;else timers.delete(id);t.fn();}
 await flush();assert.doesNotMatch(get('personScope').textContent,/Synthetic provider/);
 assert.equal(get('careCount').textContent,'—');
});
