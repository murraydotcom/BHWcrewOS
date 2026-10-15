import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import handler from '../netlify/functions/operational-controls.mjs';
const require=createRequire(import.meta.url);
const {listControls,saveControl,writeValue}=require('../netlify/functions/lib/operational-controls');
const {P,W,sign}=require('../netlify/functions/_lib');

function database({mode='database',version=2}={}) {
  let payload={id:'staff-1',properties:{Name:writeValue('Synthetic Staff','title'),'PIN Hash':writeValue('never-return-this-hash','rich_text'),Active:{checkbox:true},'Access Level':{select:{name:'Admin'}}}};
  let pending;
  const query=async(sql,args=[])=>{
    if(sql==='BEGIN'){pending=structuredClone(payload);return {rows:[]};}
    if(sql==='ROLLBACK'){payload=pending;return {rows:[]};}
    if(sql==='COMMIT')return {rows:[]};
    if(sql.includes('SELECT mode'))return {rows:[{mode}]};
    if(sql.startsWith('SELECT record_id, payload'))return {rows:[{record_id:payload.id,payload,version}]};
    if(sql.startsWith('SELECT payload, version'))return {rows:args[1]===payload.id?[{payload,version}]:[]};
    if(sql.startsWith('INSERT INTO crewos_operational_records')){payload=JSON.parse(args[2]);version=1;return {rows:[{version}]};}
    if(sql.startsWith('UPDATE crewos_operational_records')){payload=JSON.parse(args[2]);version++;return {rows:[{version}]};}
    if(sql.startsWith('SELECT payload FROM'))return {rows:[{payload}]};
    throw new Error('Unexpected SQL: '+sql);
  };
  return {query,connect:async()=>({query,release(){}})};
}
test('employee listing exposes only PIN readiness, never the hash',async()=>{
  const result=await listControls(database(),'staff');
  assert.equal(result.records[0].pinConfigured,true);
  assert.doesNotMatch(JSON.stringify(result),/never-return-this-hash|PIN Hash/);
});
test('employee update verifies persisted data and preserves an unchanged PIN',async()=>{
  const pool=database();
  const result=await saveControl(pool,'staff',{id:'staff-1',expectedVersion:2,values:{Name:'Updated Synthetic Staff'}},{staffId:'other-admin'});
  assert.equal(result.verified,true);
  assert.equal(result.version,3);
  const persisted=(await pool.query('SELECT payload FROM crewos_operational_records')).rows[0].payload;
  assert.equal(P.title(persisted.properties.Name),'Updated Synthetic Staff');
  assert.equal(P.text(persisted.properties['PIN Hash']),'never-return-this-hash');
});
test('concurrent edits are rejected before writing',async()=>{
  await assert.rejects(saveControl(database(),'staff',{id:'staff-1',expectedVersion:1,values:{Name:'Stale'}},{staffId:'admin'}),{status:409});
});
test('new employees are created with readable names and hashed codes',async()=>{
  const pool=database();
  const result=await saveControl(pool,'staff',{values:{Name:'New Synthetic Employee',Active:true,'Access Level':'Staff'},pin:'482619'},{staffId:'admin'});
  assert.equal(result.version,1);
  assert.match(result.id,/^crew-/);
  const persisted=(await pool.query('SELECT payload FROM crewos_operational_records')).rows[0].payload;
  assert.equal(P.title(persisted.properties.Name),'New Synthetic Employee');
  assert.equal(P.check(persisted.properties.Active),true);
});
test('editing is blocked until database cutover, with no writes to Notion',async()=>{
  await assert.rejects(saveControl(database({mode:'notion'}),'staff',{values:{Name:'Blocked'}},{staffId:'admin'}),{status:409});
});
test('administrators cannot disable or demote their own account',async()=>{
  for(const values of [{Active:false},{'Access Level':'Staff'}])await assert.rejects(saveControl(database(),'staff',{id:'staff-1',expectedVersion:2,values},{staffId:'staff-1'}),{status:409});
});
test('PIN reset uses the existing scrypt authentication format',async()=>{
  const pool=database();
  await saveControl(pool,'staff',{id:'staff-1',expectedVersion:2,values:{Name:'Synthetic'},pin:'482619'},{staffId:'admin'});
  const payload=(await pool.query('SELECT payload FROM crewos_operational_records')).rows[0].payload;
  assert.match(P.text(payload.properties['PIN Hash']),/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.doesNotMatch(JSON.stringify(payload),/482619/);
});
test('unknown fields, unsafe links and invalid numbers are rejected',async()=>{
  await assert.rejects(saveControl(database(),'staff',{values:{Name:'Synthetic','PIN Hash':'forged'}},{staffId:'admin'}),{status:400});
  assert.throws(()=>writeValue('javascript:alert(1)','url'),{status:400});
  assert.throws(()=>writeValue('NaN','number'),{status:400});
});
test('native database writes remain readable by the CrewOS property adapters',()=>{
  assert.equal(P.text(W.text('saved text')),'saved text');
  assert.equal(P.title(W.title('saved title')),'saved title');
});
test('operational endpoint rejects unauthenticated and non-admin sessions',async()=>{
  process.env.SESSION_SECRET='synthetic-controls-test';
  const url='https://crewos.example/.netlify/functions/operational-controls';
  assert.equal((await handler(new Request(url))).status,401);
  const token=sign({staffId:'staff',access:'Staff',exp:Date.now()+10000});
  assert.equal((await handler(new Request(url,{headers:{authorization:'Bearer '+token}}))).status,403);
});
test('operational controls browser scripts compile',async()=>{
  const page=await readFile(new URL('../crewos-controls.html',import.meta.url),'utf8');
  for(const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Function(match[1]);
});
