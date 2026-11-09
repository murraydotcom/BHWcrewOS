import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ICAP=require('../assets/positive-ana-icap.js');
test('every ICAP AC-0 through AC-31 has a dated official source and clinical context',()=>{
  assert.equal(Object.keys(ICAP.catalog).length,32);
  for(let n=0;n<=31;n++){
    const entry=ICAP.catalog[`AC-${n}`];
    assert.equal(entry.sourceUrl,`https://anapatterns.org/view_pattern.php?pattern=${n}`);
    for(const key of ['name','associations','antigens','followUp','limitation','reviewedOn','version'])assert.ok(entry[key]);
    assert.ok((ICAP.context([entry]).join(' ').match(/\S+/g)||[]).length<200);
  }
});
test('mixed patterns retain individual titers and independent associations without ranking',()=>{
  const results=ICAP.review([{code:'AC-1',titer:160},{k:'AC-3',titer:640}]);
  assert.deepEqual(results.map(r=>[r.code,r.titer]),[['AC-1',160],['AC-3',640]]);
  assert.match(results[0].associations,/lupus/);
  assert.match(results[1].associations,/systemic sclerosis/);
  assert.deepEqual(Object.keys(results[0]).filter(k=>/score|rank|probability|diagnosis/i.test(k)),[]);
});
test('negative, conflicting and unknown results do not generate positive disease associations',()=>{
  const result=ICAP.review([{code:'AC-0',titer:0},{code:'AC-1',titer:0},{code:'other',titer:160}]);
  assert.equal(result[0].status,'negative');
  assert.equal(result[1].status,'conflicting-result');
  assert.equal(result[2].status,'unmapped');
  for(const r of result.slice(1)){assert.equal(r.associations,undefined);assert.equal(r.sourceUrl,undefined);}
  assert.equal(ICAP.review([{code:'AC-0',titer:160}])[0].status,'conflicting-result');
});
test('DFS70 is not a disease exclusion and newer patterns remain distinct',()=>{
  assert.match(ICAP.catalog['AC-2'].limitation,/Do not exclude disease/);
  assert.match(ICAP.catalog['AC-30'].limitation,/Not equivalent to isolated DFS70/);
  assert.match(ICAP.catalog['AC-31'].antigens,/Ro60/);
  assert.match(ICAP.catalog['AC-31'].limitation,/Ro52/);
  assert.match(ICAP.catalog['AC-7'].associations,/Low disease predictive value/);
  assert.match(ICAP.catalog['AC-29'].followUp,/anti-topoisomerase I/);
});
test('browser and server share the exact reference implementation',async()=>{
  const src=await readFile(new URL('../assets/positive-ana-icap.js',import.meta.url),'utf8');
  const context=vm.createContext({});vm.runInContext(src,context);
  const input=[{code:'AC-2',titer:320},{code:'AC-19',titer:null}];
  assert.equal(JSON.stringify(context.BHW_ICAP.review(input)),JSON.stringify(ICAP.review(input)));
  const page=await readFile(new URL('../bhw-positive-ana.html',import.meta.url),'utf8');
  assert.ok(page.indexOf('src="/assets/positive-ana-icap.js"')<page.indexOf('function analyze()'));
  assert.match(page,/ICAP pattern-to-disease associations · enabled/);
  assert.match(page,/BHW_ICAP\.context\(BHW_ICAP\.review\(window\._analysisRecord/);
  assert.doesNotMatch(page,/AC-specific ICAP pattern-to-disease associations are not provided/);
  for(const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
    if(match[1].trim())new vm.Script(match[1]);
  }
});

test('Patient 360 renders ICAP provenance and limits source links to official pattern pages',async()=>{
  const source=await readFile(new URL('../provider/patient-360-app.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function positiveAnaAnalysisPanel(');
  const end=source.indexOf('\n}\n',start)+2;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const render=vm.runInNewContext(`(${source.slice(start,end)})`,{esc,dateText:()=> 'synthetic date'});
  const references=ICAP.references(ICAP.review([{code:'AC-3',titer:160}]));
  references.push({title:'Untrusted link',url:'javascript:alert(1)'});
  const html=render({positiveAnaConnection:{connected:true,analyses:[{analysis:{review:{sourceReferences:references,sourceSupportedContext:['ICAP AC-3: clinical association']}}}]}},{full:true});
  assert.match(html,/href="https:\/\/anapatterns.org\/view_pattern.php\?pattern=3"/);
  assert.match(html,/icap-clinical-associations-2026-11-09/);
  assert.doesNotMatch(html,/javascript:/);
});
