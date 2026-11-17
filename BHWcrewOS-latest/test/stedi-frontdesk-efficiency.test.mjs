import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync(new URL('../bhw-front-desk.html',import.meta.url),'utf8');
function harness(fetcher){
  const fields=new Map(),get=id=>{if(!fields.has(id))fields.set(id,{value:id==='verify-kind'?'coverage':'',disabled:false,textContent:'',handlers:{},addEventListener(type,handler){this.handlers[type]=handler;}});return fields.get(id);};
  const context={document:{getElementById:get},window:{lastPatient:{ctl:'BHW0999',name:'Synthetic Patient',payer:'Medicare',dob:'1950-01-02'}},crewFetch:fetcher};
  vm.runInNewContext(page.slice(page.indexOf('const VERIFY_API ='),page.indexOf('/* patient lookup */')),context);return {get,context,run:()=>get('verify-run').handlers.click(),refresh:()=>get('verify-refresh').handlers.click()};
}
test('coverage and wellness share one dated response; only an explicit refresh makes another request',async()=>{
  const requests=[],ui=harness(async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({active:true,awvStatus:'Unknown',checkedAt:'2026-11-17T15:00:00Z',dateOfService:'2026-11-17'});});
  await ui.run();assert.equal(requests.length,1);ui.get('verify-kind').value='wellness';ui.get('verify-kind').handlers.change();
  assert.match(ui.get('verify-result').textContent,/AWV: Unknown/);assert.match(ui.get('verify-result').textContent,/Existing response; no new request/);assert.doesNotMatch(ui.get('verify-result').textContent,/just now/);
  await ui.run();assert.equal(requests.length,1);await ui.refresh();assert.equal(requests.length,2);
  ui.get('verify-dos').value='2026-12-01';ui.get('verify-dos').handlers.change();await ui.run();assert.equal(requests[2].dos,'2026-12-01');
});
test('patient changes during a request discard its display and do not reuse another patient response',async()=>{
  let calls=0;const ui=harness(async()=>{calls++;ui.context.window.lastPatient={ctl:'BHW0998',payer:'Medicare'};return Response.json({active:true});});
  await ui.run();assert.equal(calls,1);assert.match(ui.get('verify-result').textContent,/Patient or service date changed/);
});
