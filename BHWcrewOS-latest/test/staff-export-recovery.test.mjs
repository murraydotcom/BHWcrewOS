import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyRequest, recoverStaff } = require('../netlify/functions/staff-export-recovery')._test;
const store = require('../netlify/functions/lib/operational-store');
const pin = 'a'.repeat(32) + ':' + 'b'.repeat(128);
const page = {
  id: 'a'.repeat(32),
  properties: {
    Name: { title: [{ plain_text: 'Synthetic Admin' }] },
    Active: { checkbox: true },
    'Can Schedule': { checkbox: true },
    'Access Level': { select: { name: 'Admin' } },
    'PIN Hash': { rich_text: [{ plain_text: pin }] },
  },
};
const raw = JSON.stringify({format:'crewos-staff-recovery-v1',sourceDate:'2026-10-08',sourceDatabaseId:'23241ce30cba4b01adb858afbe95d11f',nonce:'c'.repeat(64),pages:[page]});
const digest = crypto.createHash('sha256').update(raw).digest('hex');
const bundle = verifyRequest({body:raw},digest);

test('recovery is disabled by default and only accepts the exact approved file',()=>{
  assert.throws(()=>verifyRequest({body:raw},''),{status:503});
  assert.throws(()=>verifyRequest({body:raw+' '},digest),{status:403});
  assert.deepEqual(verifyRequest({body:Buffer.from(raw).toString('base64'),isBase64Encoded:true},digest).pages,[page]);
});

function fakeDatabase({existing=[],corrupt=false,mode='notion',marker=null}={}) {
  const calls=[];
  let rows=existing.map(payload=>({payload}));
  const client={release(){calls.push('RELEASE');},async query(sql,params=[]){
    calls.push(sql);
    if(sql.startsWith('SELECT state_key'))return {rows:[{state_key:'notion-exit',mode},...(marker?[{state_key:'staff-export-recovery',mode:'database',finalized_by:marker}]:[])]};
    if(sql.startsWith('SELECT payload'))return {rows:corrupt&&calls.some(s=>s.startsWith('INSERT INTO crewos_operational_records'))?[]:rows};
    if(sql.startsWith('INSERT INTO crewos_operational_records'))rows.push({payload:JSON.parse(params[2])});
    return {rows:[]};
  }};
  return {calls,pool:{async connect(){return client;}}};
}

test('recovery atomically verifies records before activating staff routing',async()=>{
  const db=fakeDatabase();
  const result=await recoverStaff(bundle,db.pool);
  assert.equal(result.staffCount,1);
  assert.equal(result.fullCutoverComplete,false);
  assert.ok(db.calls.indexOf('COMMIT')>db.calls.findIndex(s=>s.startsWith('INSERT INTO crewos_cutover_state')));
  assert.ok(!db.calls.some(s=>s.startsWith('DELETE')));
});

test('recovery preserves newer accounts and rolls back failed read-back',async()=>{
  for(const config of [{existing:[{...page,properties:{...page.properties,Active:{checkbox:false}}}]},{corrupt:true},{mode:'cutover'},{mode:'database'}]){
    const db=fakeDatabase(config);
    await assert.rejects(recoverStaff(bundle,db.pool));
    assert.ok(db.calls.includes('ROLLBACK'));
    assert.ok(!db.calls.includes('COMMIT'));
  }
});

test('a retry after completion preserves subsequent staff edits',async()=>{
  const db=fakeDatabase({marker:`staff-export:${bundle.sourceDate}:${bundle.digest}`,existing:[{...page,properties:{}}]});
  const result=await recoverStaff(bundle,db.pool);
  assert.equal(result.alreadyRecovered,true);
  assert.ok(!db.calls.some(s=>s.startsWith('INSERT')));
});

test('staff routing reads the database while other controls retain their own authority',async()=>{
  let notionCalls=0;
  const dependencies={pool:{async query(sql,params){
    if(sql.startsWith('SELECT mode'))return {rows:[{mode:params[0]==='staff-export-recovery'?'database':'notion'}]};
    return {rows:[{payload:page}]};
  }},queryDbImpl:async()=>{notionCalls++;return []}};
  assert.deepEqual(await store.queryOperational('staff','staff-db',undefined,undefined,dependencies),[page]);
  assert.equal(notionCalls,0);
  await store.queryOperational('schedule','schedule-db',undefined,undefined,dependencies);
  assert.equal(notionCalls,1);
});
