// Optional acceptance perimeter; application/session authorization still runs for allowed routes.
const allowed=/^\/v1\/blueprint-tasks(?:\/(?:commands|patient))?$/;
export function syntheticAcceptanceBoundary(request,environment) {
  if(environment.BHW0000_ACCEPTANCE_ONLY!=='true')return null;
  const response=(status,error)=>new Response(JSON.stringify({ok:false,error}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(environment.SYNTHETIC_ONLY!=='true')return response(503,'Synthetic acceptance configuration is invalid.');
  const path=new URL(request.url).pathname;
  if(['/health','/healthz','/ready'].includes(path)||allowed.test(path))return null;
  return response(403,'This protected candidate accepts only BHW0000 integration routes.');
}
