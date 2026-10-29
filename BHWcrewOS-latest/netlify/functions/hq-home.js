// Read-only, identity-scoped projection of existing records. No new queue,
// patient writes, clinical activation, or outbound notifications.
const { getSession, json, DB, P, DIVISIONS, normalizeDivision } = require('./_lib');
const { operationsRequest } = require('./lib/operations-cloud');
const { queryOperational } = require('./lib/operational-store');
const { careCloudToken, medicationApiBase } = require('./lib/care-cloud-auth');
const { handler: portalInbox } = require('./portal-messaging');
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const identity = v => clean(v).replace(/^crew:/, '');
const owns = (v, actor) => Boolean(identity(v) && identity(v) === actor.staffId);
const finished = r => r.statusCategory === 'completed' || ['resolved','closed','cancelled'].includes(r.status);
const kind = r => ['handoff','referral'].includes(r.workflowContext?.kind) ? r.workflowContext.kind : '';
const due = r => clean(r.dueAt || r.slaDueAt || r.workflowContext?.dueAt || '', 40);
const validDate = v => Boolean(v && Number.isFinite(Date.parse(v)));
const idOf = r => clean(r.id || r.patientRequestId, 100);
const unavailable = message => ({ available: false, count: null, items: [], message });
function actorFrom(session) {
  return { staffId: clean(session.staffId), name: clean(session.name, 120), role: clean(session.role, 100),
    access: clean(session.access, 60), divisions: (session.divisions || []).map(normalizeDivision) };
}
function related(r, actor, roleRelevant, { outgoing = false } = {}) {
  const assignee = clean(r.assignedTo || r.assignedToId);
  if (assignee) return owns(assignee, actor) || (outgoing && owns(r.createdBy, actor));
  if (outgoing && owns(r.createdBy, actor)) return true;
  // A legacy name alone is not a verified personal assignment.
  if (clean(r.assignedToName)) return false;
  // "All" is an existing staff-area setting, not a division name. Expand it
  // only for area matching; personal assignments and role routing still apply.
  const areaActor = actor.divisions.some(d => ['All','All Divisions'].includes(d))
    ? { ...actor, divisions: DIVISIONS } : actor;
  if (kind(r)) {
    const division = normalizeDivision(r.workflowContext?.toDivision);
    if (!division || !areaActor.divisions.includes(division)) return false;
  }
  return roleRelevant(r, areaActor);
}
function handoff(r, actor) {
  const context = r.workflowContext || {};
  const sent = owns(r.createdBy, actor) && !owns(r.assignedTo || r.assignedToId, actor);
  const destination = normalizeDivision(context.toDivision);
  return { id: idOf(r), kind: kind(r), title: kind(r) === 'referral' ? clean(context.referralType,120) || 'Referral' : 'Warm handoff',
    from: normalizeDivision(context.fromDivision), to: destination,
    relationship: owns(r.assignedTo || r.assignedToId, actor) ? 'Assigned to you' : sent ? 'Sent by you' : 'Your area · unassigned',
    owner: owns(r.assignedTo || r.assignedToId, actor) ? 'You' : clean(r.assignedToName, 120) || 'Unassigned',
    status: clean(r.statusLabel || r.status || 'Open', 100).replaceAll('_', ' '), dueAt: due(r),
    updatedAt: clean(r.updatedAt || r.createdAt, 40), completed: finished(r),
    nextAction: Array.isArray(context.needs) && context.needs.length ? context.needs.slice(0,3).map(v=>clean(v,160)).join(' · ')
      : 'Review the original '+(kind(r)==='referral'?'referral':'handoff')+' for its next action.',
    // Open the original request; do not mirror clinical narrative on the home page.
    href: `/crewos?view=${encodeURIComponent(destination.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))}&request=${encodeURIComponent(idOf(r))}` };
}
function personalMetrics(rows, actor, role, now) {
  const cutoff = now - 7 * 86400000;
  const assigned = rows.filter(r => owns(r.assignedTo || r.assignedToId, actor));
  const closedByMe = rows.filter(r => {
    if(!finished(r) || !validDate(r.resolvedAt) || Date.parse(r.resolvedAt)<cutoff || Date.parse(r.resolvedAt)>now) return false;
    const completion=(Array.isArray(r.statusHistory)?r.statusHistory:[]).filter(h=>h.category==='completed' && h.at===r.resolvedAt);
    return completion.length ? completion.some(h=>owns(h.actor,actor))
      : owns(r.updatedBy,actor) && r.updatedAt===r.resolvedAt;
  });
  const timed = closedByMe.filter(r => validDate(due(r)));
  const prefixes = { provider:'Provider', 'ma-bha':'Clinical support', 'care-manager':'Care coordination', rcm:'Revenue cycle',
    'front-desk':'Patient access', 'operations-manager':'Operations', executive:'Leadership' };
  const label = prefixes[role] || 'My';
  return [
    { label: `${label} handoffs completed`, value: closedByMe.filter(r=>kind(r)==='handoff').length, detail:'Completed by you · last 7 days', target:null },
    { label: 'My open referral follow-through', value: assigned.filter(r=>kind(r)==='referral' && !finished(r)).length, detail:'Assigned to you · current recorded work', target:null },
    { label: 'My completed work on time', value: timed.length ? `${timed.filter(r=>Date.parse(r.resolvedAt)<=Date.parse(due(r))).length} / ${timed.length}` : null,
      detail: timed.length ? 'Your completions with a recorded due date · 7 days' : 'No dated completions to measure in the last 7 days', target:null },
  ];
}
function createHomeHandler({ sessionImpl=getSession, operationsImpl=operationsRequest, queryImpl=queryOperational,
  portalImpl=portalInbox, fetchImpl=fetch, now=Date.now }={}) {
  return async event => {
    if(event.httpMethod !== 'GET') return json(405,{error:'GET only'});
    const session=sessionImpl(event);
    if(!session?.staffId) return json(401,{error:'Sign in to CrewHQ again.'});
    if(Object.keys(event.queryStringParameters || {}).length) return json(400,{error:'CrewHQ home uses your signed-in identity.'});
    const actor=actorFrom(session);
    const { isRoleRelevantRequest, normalizeAlertRole } = await import('../../bhw-alert-center.mjs');
    const role=normalizeAlertRole(actor);
    const sources=['crewos','health-core','patient-content-html'];
    const requests = sources.map(source=>operationsImpl(`/v1/patient-requests?source=${source}&limit=500`,{actor:session,
      fetchImpl:(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.timeout(8000)})}));
    const settled=await Promise.allSettled([...requests, queryImpl('crewProjects',DB.crewProjects),
      portalImpl({...event,queryStringParameters:{}}),
      (async()=>{const r=await fetchImpl(`${medicationApiBase()}/v1/staff/content-submissions?limit=100`,{
        headers:{Authorization:`Bearer ${careCloudToken(session)}`},redirect:'error',signal:AbortSignal.timeout(8000)});
        if(!r.ok) throw Error('Patient responses unavailable'); const data=await r.json();
        if(!Array.isArray(data.submissions)) throw Error('Invalid response list');return data.submissions;})(),
      (async()=>{const r=await fetchImpl(`${medicationApiBase()}/v1/staff/content-assignments?limit=200`,{
        headers:{Authorization:`Bearer ${careCloudToken(session)}`},redirect:'error',signal:AbortSignal.timeout(8000)});
        if(!r.ok) throw Error('Response senders unavailable');const data=await r.json();
        if(!Array.isArray(data.assignments)) throw Error('Invalid assignment list');return data.assignments;})()]);
    const records = i => {
      const value=settled[i]; if(value.status!=='fulfilled') return null;
      const list=value.value?.requests || value.value?.patientRequests;
      return Array.isArray(list) ? list : null;
    };
    const workflowLists=[records(0),records(1)];
    const workflowReady=workflowLists.every(Boolean);
    const workflowRows=[...new Map(workflowLists.filter(Boolean).flat().filter(kind).map(r=>[idOf(r),r])).values()];
    const relevant=workflowRows.filter(r=>related(r,actor,isRoleRelevantRequest,{outgoing:true}));
    const own=workflowRows.filter(r=>owns(r.assignedTo||r.assignedToId,actor)||owns(r.createdBy,actor)||owns(r.updatedBy,actor));
    const limitReached=workflowLists.some(list=>list?.length>=500);
    const responseRows=records(2);
    const contentResult=settled[5];
    let care=unavailable('Care-plan responses could not be verified. Open Patient Materials & Feedback.');
    if(responseRows && contentResult.status==='fulfilled') {
      const routed=new Map(responseRows.map(r=>[clean(r.sourceReference || r.sourceMetadata?.sourceRecordId,128),r]));
      // The protected service records the actual sending staff ID separately
      // from the creator. Never infer a sender from a name or patient identity.
      const assignmentResult=settled[6];
      const assignments=new Map((assignmentResult.status==='fulfilled'?assignmentResult.value:[]).map(a=>[clean(a.id,128),a]));
      let senderUnknown=false;
      // Use fresh source responses without creating projection records. Unassigned
      // material responses use the same clinical-review role queue as the existing
      // projectPatientContent workflow; an existing exact assignment wins.
      const matches=contentResult.value.filter(s=>!['reviewed','closed'].includes(s.status) && s.contentPath!=='/bhw-medication-request.html')
        .map(s=>{const id=clean(s.id || s.submissionId,128);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(id))return null;
          const assignment=assignments.get(clean(s.assignmentId,128));
          const sent=Boolean(assignment && owns(assignment.sentBy || assignment.createdBy,actor));
          if(routed.has(id))return {row:routed.get(id),sent,knownSender:Boolean(assignment)};
          if(responseRows.length>=500 && !clean(s.assignedTo || s.assignedToId) && !sent){senderUnknown=true;return null;}
          return {sent,knownSender:Boolean(assignment),row:{id,source:'patient-content-html',requestType:'clinical_review',assignedTeam:'clinical',
            assignedTo:clean(s.assignedTo || s.assignedToId),assignedToName:clean(s.assignedToName),
            priority:s.priority==='same_day_review'?'time-sensitive':'routine',statusCategory:'received',
            updatedAt:clean(s.submittedAt || s.createdAt,40)}};})
        .filter(item=>{if(!item)return false;const included=item.sent || related(item.row,actor,isRoleRelevantRequest);
          if(!included && !item.knownSender)senderUnknown=true;return included;});
      care={available:!senderUnknown,count:senderUnknown?null:matches.length,items:matches.slice(0,10).map(({row:r,sent})=>({id:idOf(r),label:'Patient material / care-plan response',
        scope:owns(r.assignedTo||r.assignedToId,actor)?'Assigned to you':sent?'Reply to an item you sent':'Your role’s review queue',at:clean(r.updatedAt,40),
        href:'/bhw-patient-materials.html'})),
        message:senderUnknown?'Some response senders could not be verified. Known replies are shown; refresh or open Patient Materials & Feedback.'
          :'Responses needing review · your assignments, items you sent, and role queue',
        limited:responseRows.length>=500 || contentResult.value.length>=100 || assignments.size>=200};
    }
    let portal=unavailable('myBHW messaging is not available for this staff session.');
    const portalResult=settled[4];
    if(portalResult.status==='fulfilled') {
      const response=portalResult.value;let data;try{data=JSON.parse(response.body);}catch{}
      if(response.statusCode===200 && data?.ok===true && Array.isArray(data.threads)) {
        const portalActor=clean(data.actor?.id || data.actor?.staffId);
        // Inbox grants remain authoritative; show individually assigned unread threads only.
        const threads=data.threads.filter(t=>(owns(t.assignedTo,actor)||Boolean(portalActor&&clean(t.assignedTo)===portalActor)) && Number(t.unreadCount)>0);
        portal={available:true,count:threads.reduce((n,t)=>n+Number(t.unreadCount),0),
          items:threads.slice(0,10).map(t=>({id:clean(t.id,100),label:'New myBHW message',scope:'Assigned to you',href:'/bhw-portal-messages.html'})),
          message:'BHW0000 pilot inbox · unread messages assigned to you',limited:Boolean(data.nextBefore),pilot:true};
      } else if(response.statusCode===503) portal=unavailable('myBHW messaging remains limited to the controlled pilot; it is not enabled here.');
    }
    const projects=settled[3].status==='fulfilled' && Array.isArray(settled[3].value) ? settled[3].value : null;
    const goals=projects ? projects.filter(pg=>P.rel(pg.properties?.Staff).some(v=>owns(v,actor))).map(pg=>({
      id:clean(pg.id),title:P.title(pg.properties?.Project),status:P.sel(pg.properties?.Status),dueAt:P.date(pg.properties?.['Due Date']),href:'/crewos?view=myspace'})) : null;
    return {...json(200,{ok:true,user:actor,role,checkedAt:new Date(now()).toISOString(),
      notifications:{care,portal},handoffs:{available:workflowReady,partial:!workflowReady && workflowLists.some(Boolean),limited:limitReached,
        items:relevant.filter(r=>!finished(r)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,8).map(r=>handoff(r,actor)),
        recentClosed:relevant.filter(finished).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,5).map(r=>handoff(r,actor))},
      metrics:{available:workflowReady,limited:limitReached,period:'Last 7 days',items:workflowReady?personalMetrics(own,actor,role,now()):[]},
      goals:{available:goals!==null,items:goals||[]}}),headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}};
  };
}
exports.handler=createHomeHandler();
exports._test={createHomeHandler,related,personalMetrics,handoff,actorFrom};
