import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CrewOS returns signed-in staff to approved internal tools", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf("const SAFE_STANDALONE_NEXT");
  const end = html.indexOf("function redirectToRequestedPage", start);
  assert.ok(start >= 0 && end > start, "return-route policy is present");

  const routePolicy = html.slice(start, end);
  const getRequestedNext = new Function("search", `${routePolicy}\nreturn requestedNext(search);`);
  const encoded = (path) => `?next=${encodeURIComponent(path)}`;

  assert.equal(getRequestedNext(encoded("/bhw-patient-monitor-list")), "/bhw-patient-monitor-list");
  assert.equal(getRequestedNext(encoded("/bhw-patient-monitor-list.html")), "/bhw-patient-monitor-list.html");
  assert.equal(
    getRequestedNext(encoded("/bhw-patient-monitor.html?patient=BHW0000")),
    "/bhw-patient-monitor.html?patient=BHW0000",
  );
  assert.equal(getRequestedNext(encoded("/bhw-requests.html")), "/bhw-requests.html");
  assert.equal(getRequestedNext(encoded("/bhw-care-program-sop")), "/bhw-care-program-sop");
  assert.equal(getRequestedNext(encoded("/bhw-care-program-sop.html")), "/bhw-care-program-sop.html");
  assert.equal(
    getRequestedNext(encoded("/bhw-requests.html?request=REQ-synthetic-0001")),
    "/bhw-requests.html?request=REQ-synthetic-0001",
  );
  assert.equal(getRequestedNext(encoded("/provider/patient-registry.html")), "/provider/patient-registry.html");
  for(const path of [
    "/bhw-intel-connections.html",
    "/crewos-controls.html?section=staff",
    "/bhw-website-content.html?tab=drafts#review",
    "/hq.html",
    "/provider/patient-360.html?patient=BHW0000&view=care%20plan#history",
  ]) assert.equal(getRequestedNext(encoded(path)), path);
  assert.equal(getRequestedNext(encoded("https://example.com/collect")), "");
  assert.equal(getRequestedNext(encoded("//example.com/collect")), "");
  assert.equal(getRequestedNext(encoded("/bhw-patient-monitor-list/../index.html")), "");
  for(const path of ["/provider/../index.html", "/provider/%2e%2e/index.html", "/%2f%2fexample.com", "/\\example.com", "/provider//example.html", "/crewos", "/index.html?next=/hq.html", "/.netlify/functions/auth", "/assets/main.js", "/hq.html\n"]) assert.equal(getRequestedNext(encoded(path)), "", path);

  assert.match(html, /if\(redirectToRequestedPage\(\)\) return;/);
  assert.match(html, /resumeSignedInSession\(\)\.catch\(\(\)=>logout\(\)\)/);
});

test("successful login returns to the requested page including query and anchor", async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const policy=html.slice(html.indexOf('const SAFE_STANDALONE_NEXT'),html.indexOf('async function resumeSignedInSession'));
  const login=html.slice(html.indexOf('async function doLogin()'),html.indexOf('document.getElementById("loginPin").addEventListener'));
  const values={loginStaff:{value:'synthetic-staff'},loginPin:{value:'123456'},loginErr:{textContent:''}};
  const destinations=[];const stored=[];
  const destination='/crewos-controls.html?section=referralTemplates#editor';
  const execute=new Function('location','document','sessionStorage','fetch','API_AUTH','refresh',`let TOKEN='';${policy}\n${login}\nreturn doLogin();`);
  await execute({search:'?next='+encodeURIComponent(destination),replace:path=>destinations.push(path)}, {getElementById:id=>values[id]}, {setItem:(...args)=>stored.push(args)},async()=>({ok:true,json:async()=>({token:'synthetic-token'})}),'/auth',()=>{throw new Error('Dashboard should not load');});
  assert.deepEqual(destinations,[destination]);
  assert.deepEqual(stored,[['crewos_token','synthetic-token']]);
  assert.equal(values.loginErr.textContent,'');
});

test("a returning session verifies auth without loading dashboard data", async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const policy=html.slice(html.indexOf('const SAFE_STANDALONE_NEXT'),html.indexOf('async function api('));
  const calls=[];
  const execute=new Function('location','api','API_AUTH','refresh',`${policy}\nreturn resumeSignedInSession();`);
  await execute({search:'?next=%2Fbhw-intel-connections.html',replace:path=>calls.push(path)},async(url,body)=>{calls.push(body.action);},'/auth',()=>{throw new Error('Dashboard should not load');});
  assert.deepEqual(calls,['session','/bhw-intel-connections.html']);
  calls.length=0;
  await assert.rejects(execute({search:'?next=%2Fbhw-intel-connections.html',replace:path=>calls.push(path)},async()=>{throw new Error('Expired session');},'/auth',()=>{}),/Expired session/);
  assert.deepEqual(calls,[]);
});
