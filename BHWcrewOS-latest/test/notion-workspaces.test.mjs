import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MemoryFirestore} from './helpers/firestore-memory.mjs';
import {WORKSPACES,prepareImport,parseCsv,NotionWorkspaceRepository} from '../cloud/operations-api/notion-workspaces.mjs';
import {createNotionWorkspaceApp} from '../cloud/operations-api/notion-workspace-app.mjs';
import proxy from '../netlify/functions/notion-workspaces.mjs';

const csv=(key,records)=>[WORKSPACES[key].columns,...records.map(record=>WORKSPACES[key].columns.map(column=>record[column]||''))].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');
const actor={staffId:'synthetic-admin',role:'operations-manager'};
test('CSV preserves escaped quotes, commas, multiline notes and a BOM',()=>{
  const result=parseCsv('\uFEFFName,Notes\r\n"Synthetic, item","line one\nline ""two"""\r\n');
  assert.deepEqual(result.rows,[{Name:'Synthetic, item',Notes:'line one\nline "two"'}]);
  assert.throws(()=>parseCsv('Name,Notes\n"broken,note'),/incomplete/);
});
test('all five schemas accept their exact fields and retain untitled rows',()=>{
  for(const key of Object.keys(WORKSPACES)){
    const title=WORKSPACES[key].title;
    const source=csv(key,[{[title]:'Synthetic record',Status:'Done'}, {[WORKSPACES[key].columns.at(-1)]:'Untitled source row',Status:'Not started'}]);
    const result=prepareImport(key,source);
    assert.equal(result.count,2);assert.equal(result.blankTitles,1);
    assert.equal(result.records[0].fields[title],'Synthetic record');
  }
  assert.throws(()=>prepareImport('healthcare','Name,Status\nSynthetic,Done'),/columns/);
});
test('duplicate occurrences are preserved while replay IDs stay deterministic',()=>{
  const source=csv('purchases',[{Name:'Synthetic duplicate'},{Name:'Synthetic duplicate'}]);
  const first=prepareImport('purchases',source),second=prepareImport('purchases',source);
  assert.notEqual(first.records[0].id,first.records[1].id);
  assert.deepEqual(first.records.map(record=>record.id),second.records.map(record=>record.id));
});
test('import verifies every original row, retains status and does not create patient workflows',async()=>{
  const db=new MemoryFirestore(),repo=new NotionWorkspaceRepository(db);
  const prepared=prepareImport('healthcare',csv('healthcare',[{'Task Name':'Synthetic historical task',Status:'Done'},{Status:'Not started'}]));
  const result=await repo.import('healthcare',prepared,actor);
  assert.equal(result.verifiedCount,2);assert.equal(result.createdCount,2);
  const rows=(await repo.list('healthcare')).records;
  assert.ok(rows.every(row=>row.reviewState==='needs-review'));
  assert.deepEqual(rows.map(row=>row.fields.Status).sort(),['Done','Not started']);
  assert.ok([...db.records.keys()].every(key=>key.startsWith('notionWorkspaceDatasets/')||key.startsWith('auditEvents/')));
  for(const [path,record] of db.records)if(path.startsWith('auditEvents/'))assert.doesNotMatch(JSON.stringify(record),/Synthetic historical task|Task Name/);
});
test('reimport does not duplicate rows or overwrite native edits and immutable originals',async()=>{
  const db=new MemoryFirestore(),repo=new NotionWorkspaceRepository(db);
  const prepared=prepareImport('healthcare',csv('healthcare',[{'Task Name':'Synthetic historical task',Status:'Not started'}]));
  await repo.import('healthcare',prepared,actor);
  const row=(await repo.list('healthcare')).records[0];
  const saved=await repo.save('healthcare',{id:row.id,expectedVersion:1,fields:{...row.fields,Status:'Done'},reviewState:'reviewed'},actor);
  assert.equal(saved.verified,true);
  const replay=await repo.import('healthcare',prepared,actor);
  assert.equal(replay.createdCount,0);assert.equal(replay.alreadyPresent,1);
  const current=(await repo.list('healthcare')).records[0];
  assert.equal(current.fields.Status,'Done');assert.equal(current.originalFields.Status,'Not started');
  await assert.rejects(repo.save('healthcare',{id:row.id,expectedVersion:1,fields:row.fields},actor),{status:409});
  await repo.save('healthcare',{id:current.id,expectedVersion:current.version,fields:current.fields},actor);
  assert.equal((await repo.list('healthcare')).records[0].reviewState,'needs-review');
});
test('listing paginates beyond 100 without omissions',async()=>{
  const repo=new NotionWorkspaceRepository(new MemoryFirestore());
  await repo.import('marketing',prepareImport('marketing',csv('marketing',Array.from({length:157},(_,i)=>({'Task name':'Synthetic task '+i,Status:'Done'})))),actor);
  const first=await repo.list('marketing'),second=await repo.list('marketing',first.nextCursor);
  assert.equal(first.records.length,100);assert.equal(second.records.length,57);
  assert.equal(new Set([...first.records,...second.records].map(row=>row.id)).size,157);
});
test('Cloud API requires authorized manager identity and current preview hash',async()=>{
  const secret='synthetic-test-secret',db=new MemoryFirestore();
  const app=createNotionWorkspaceApp({db,environment:{CREWOS_OPERATIONS_TOKEN_SECRET:secret},baseApp:async()=>new Response('base')});
  const token=role=>{const payload=Buffer.from(JSON.stringify({iss:'bhw-crewhq',aud:'bhw-operations-cloud',sub:'crew:synthetic',staffId:'synthetic',role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');};
  const request=(action,body,role='operations-manager')=>new Request('https://operations.example/v1/notion-workspaces/purchases'+(action?'/'+action:''),{method:body?'POST':'GET',headers:{authorization:'Bearer '+token(role),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await app(request('',null,'staff'))).status,403);
  const source=csv('purchases',[{Name:'Synthetic order'}]);
  const preview=await (await app(request('preview',{csv:source}))).json();
  assert.equal(preview.count,1);assert.equal(Object.hasOwn(preview,'records'),false);
  assert.equal((await app(request('import',{csv:source,confirmation:'IMPORT ALL RECORDS',exportHash:'changed'}))).status,409);
  const result=await (await app(request('import',{csv:source,confirmation:'IMPORT ALL RECORDS',exportHash:preview.exportHash}))).json();
  assert.equal(result.verifiedCount,1);
});
test('CrewOS proxy rejects unauthenticated access before contacting Cloud',async()=>{
  assert.equal((await proxy(new Request('https://crewos.example/.netlify/functions/notion-workspaces'))).status,401);
});
test('workspace browser scripts compile and never cache source data in browser storage',async()=>{
  const page=await readFile(new URL('../bhw-notion-workspaces.html',import.meta.url),'utf8');
  for(const script of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Function(script[1]);
  assert.doesNotMatch(page,/localStorage|sessionStorage\.setItem|indexedDB/);
});
