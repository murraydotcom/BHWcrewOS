import crypto from 'node:crypto';
import {apiError} from './schema.mjs';

export const WORKSPACES = Object.freeze({
  purchases:{label:'Purchasing and deliveries',title:'Name',columns:['Name','Delivered','Delivery date','Notes','Order date','Order total ($)','Paid','Quantity ordered']},
  library:{label:'Resource library',title:'Name',columns:['Name','Archive','Creation date','Files','Sub-category(ies)','URL']},
  marketing:{label:'Marketing and website tasks',title:'Task name',columns:['Task name','Assignee','Completed on','Due','Priority','Status','Tags']},
  invoices:{label:'Invoices and estimates',title:'Name',columns:['Name','Amount','Date','Estimate','Status','Taxes']},
  healthcare:{label:'Healthcare Operations Dashboard',title:'Task Name',columns:['Task Name','Assignee','Category','Due Date','Follow-up Required','Operational Focus','Priority','Related System','Status','Task Category']},
});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=fields=>JSON.stringify(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)));
export function workspaceDefinition(key){if(!Object.hasOwn(WORKSPACES,key))throw apiError(400,'unknown_workspace','Choose a supported workspace.');return WORKSPACES[key];}

export function parseCsv(input){
  if(typeof input!=='string' || Buffer.byteLength(input,'utf8')>55000)throw apiError(400,'invalid_csv','Choose a CSV file smaller than 55 KB.');
  const text=input.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,afterQuote=false;
  const finishCell=()=>{row.push(cell);cell='';afterQuote=false;};
  const finishRow=()=>{finishCell();if(row.some(value=>value!==''))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;afterQuote=true;}else cell+=c;continue;}
    if(afterQuote&&!['\r','\n',','].includes(c))throw apiError(400,'invalid_csv','Unexpected characters after a quoted CSV field.');
    if(c==='"'){if(cell)throw apiError(400,'invalid_csv','Invalid CSV quoting.');quoted=true;}
    else if(c===',')finishCell();
    else if(c==='\n'||c==='\r'){finishRow();if(c==='\r'&&text[i+1]==='\n')i++;}
    else cell+=c;
  }
  if(quoted)throw apiError(400,'invalid_csv','A quoted CSV field is incomplete.');
  if(cell||row.length||afterQuote)finishRow();
  if(rows.length<2||rows.length>201)throw apiError(400,'invalid_csv','Import between 1 and 200 data rows at a time.');
  const [headers,...values]=rows;
  if(new Set(headers).size!==headers.length)throw apiError(400,'invalid_csv','CSV column names must be unique.');
  if(values.some(row=>row.length!==headers.length))throw apiError(400,'invalid_csv','Every CSV row must have the same number of fields.');
  return {headers,rows:values.map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]])))};
}
export function prepareImport(key,csv){
  const definition=workspaceDefinition(key);const parsed=parseCsv(csv);
  if(parsed.headers.length!==definition.columns.length||definition.columns.some(column=>!parsed.headers.includes(column)))throw apiError(400,'schema_mismatch','The CSV columns do not match the selected workspace.');
  const occurrences=new Map();
  const records=parsed.rows.map((fields,index)=>{
    validateFields(key,fields,false);
    const sourceHash=digest(canonical(fields));const occurrence=occurrences.get(sourceHash)||0;occurrences.set(sourceHash,occurrence+1);
    return {id:digest(`${key}:${sourceHash}:${occurrence}`),fields,sourceHash,sourceRow:index+2};
  });
  const statusCounts={};for(const record of records){const status=record.fields.Status||'(No status)';statusCounts[status]=(statusCounts[status]||0)+1;}
  return {key,records,exportHash:digest(csv),count:records.length,blankTitles:records.filter(record=>!record.fields[definition.title].trim()).length,statusCounts};
}
export function validateFields(key,fields,requireTitle=true){
  const definition=workspaceDefinition(key);
  if(!fields||Array.isArray(fields)||typeof fields!=='object'||Object.keys(fields).some(column=>!definition.columns.includes(column)))throw apiError(400,'invalid_fields','Only the workspace columns may be saved.');
  for(const column of definition.columns)if(typeof fields[column]!=='string'||fields[column].length>8000)throw apiError(400,'invalid_fields','Each field must be text containing at most 8,000 characters.');
  if(requireTitle&&!fields[definition.title].trim())throw apiError(400,'title_required','Enter a record title.');
  return fields;
}
const actorId=actor=>actor.staffId||actor.id;
export class NotionWorkspaceRepository{
  constructor(db){this.db=db;this.root=db.collection('notionWorkspaceDatasets');this.audit=db.collection('auditEvents');}
  records(key){workspaceDefinition(key);return this.root.doc(key).collection('records');}
  async list(key,cursor=''){
    let query=this.records(key).orderBy('id').limit(101);if(cursor)query=query.startAfter(cursor);
    const rows=(await query.get()).docs.map(doc=>doc.data());
    return {records:rows.slice(0,100),nextCursor:rows.length>100?rows[99].id:''};
  }
  async import(key,prepared,actor){
    const collection=this.records(key),at=new Date().toISOString();
    const refs=prepared.records.map(record=>collection.doc(record.id));
    let created=0;
    await this.db.runTransaction(async tx=>{
      created=0;const existing=await tx.getAll(...refs);
      for(const [index,record] of prepared.records.entries()){
        if(existing[index].exists)continue;
        tx.create(refs[index],{...record,workspace:key,originalFields:record.fields,origin:'notion-csv',importedAt:at,importedBy:actorId(actor),exportHash:prepared.exportHash,version:1,reviewState:key==='healthcare'?'needs-review':'retained',createdAt:at,updatedAt:at});created++;
      }
      tx.set(this.root.doc(key),{key,label:workspaceDefinition(key).label,lastImportAt:at,lastImportCount:prepared.count,lastExportHash:prepared.exportHash},{merge:true});
      tx.create(this.audit.doc(crypto.randomUUID()),{type:'notion-workspace.imported',workspace:key,actorId:actorId(actor),sourceCount:prepared.count,createdCount:created,exportHash:prepared.exportHash,at});
    });
    const verified=await this.db.getAll(...refs);
    if(verified.some((doc,index)=>!doc.exists||doc.data().sourceHash!==prepared.records[index].sourceHash||canonical(doc.data().originalFields)!==canonical(prepared.records[index].fields)))throw apiError(502,'verification_failed','The import was not fully verified. Retry the same file safely.');
    return {sourceCount:prepared.count,createdCount:created,alreadyPresent:prepared.count-created,verifiedCount:verified.length,verified:true};
  }
  async save(key,input,actor){
    validateFields(key,input.fields);const id=input.id||`crew-${crypto.randomUUID()}`;
    if(!/^(?:[a-f0-9]{64}|crew-[a-f0-9-]{36})$/.test(id))throw apiError(400,'invalid_id','Invalid record identifier.');
    const ref=this.records(key).doc(id);const at=new Date().toISOString();let saved;
    await this.db.runTransaction(async tx=>{
      const snapshot=await tx.get(ref);const current=snapshot.exists?snapshot.data():null;
      if(input.id&&!current)throw apiError(404,'record_not_found','The record no longer exists.');
      if(current&&input.expectedVersion!==current.version)throw apiError(409,'version_conflict','This record changed. Reload before saving.');
      const reviewed=input.reviewState==='reviewed';
      saved={...(current||{id,workspace:key,origin:'crewos',createdAt:at}),fields:input.fields,version:(current?.version||0)+1,updatedAt:at,updatedBy:actorId(actor),reviewState:reviewed?'reviewed':key==='healthcare'?'needs-review':current?.reviewState||'retained',reviewedBy:reviewed?actorId(actor):null,reviewedAt:reviewed?at:null};
      tx.set(ref,saved);
      tx.create(this.audit.doc(crypto.randomUUID()),{type:'notion-workspace.saved',workspace:key,recordId:id,actorId:actorId(actor),version:saved.version,at});
    });
    const check=await ref.get();if(!check.exists||canonical(check.data().fields)!==canonical(saved.fields))throw apiError(502,'verification_failed','Saved contents could not be verified. Reload the record.');
    return {record:saved,verified:true};
  }
}
