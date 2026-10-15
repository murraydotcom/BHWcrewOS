const crypto = require('crypto');
const { canonicalJson } = require('./operational-store');

// These are operational configuration fields only. Patient workflows remain
// in their existing protected Cloud services. PIN hashes never leave this API.
const DEFINITIONS = {
  staff: { label: 'Employees and codes', fields: [['Name','title'],['Role','select'],['Divisions','multi_select'],['Landing Page','select'],['Access Level','select'],['Can Schedule','checkbox'],['Active','checkbox']] },
  referralTemplates: { label: 'Referral templates', fields: [['Name','title'],['Destination','select'],['Type','select'],['Body','rich_text'],['Priority','select'],['Needed By','select'],['Sort','number'],['Active','checkbox']] },
  rooms: { label: 'Rooms and rules', fields: [['Room','title'],['Allowed Services','multi_select'],['Capacity','number'],['Active','checkbox'],['Equipment','multi_select'],['Floor','select'],['Notes','rich_text']] },
  resources: { label: 'Staff resources', fields: [['Resource','title'],['Division','select'],['Category','select'],['Link','url'],['Notes','rich_text'],['Pinned','checkbox']] },
  crewProjects: { label: 'Crew projects', fields: [['Project','title'],['Staff','relation'],['Status','select'],['Due Date','date'],['Summary','rich_text']] },
  specialistDirectory: { label: 'Specialist directory', fields: [['Specialist','title'],['Specialty','select'],['Practice / Institution','rich_text'],['Address','rich_text'],['Phone','phone_number'],['Fax','phone_number'],['Networks Accepted','multi_select'],['⭐ Preferred','checkbox'],['Accepting New Patients','checkbox'],['Typical Wait','select'],['Notes','rich_text']] },
};

function fieldType(property, fallback) {
  return ['title','rich_text','select','status','multi_select','checkbox','number','url','phone_number','date','relation'].find(type => Object.hasOwn(property || {}, type)) || fallback;
}
function readValue(property, type) {
  if (['title','rich_text'].includes(type)) return (property?.[type] || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
  if (['select','status'].includes(type)) return property?.[type]?.name || '';
  if (type === 'multi_select') return (property?.multi_select || []).map(item => item.name);
  if (type === 'relation') return (property?.relation || []).map(item => item.id);
  if (type === 'date') return property?.date?.start || '';
  if (type === 'checkbox') return Boolean(property?.checkbox);
  return property?.[type] ?? '';
}
function writeValue(value, type) {
  if (type === 'checkbox') {
    if (typeof value !== 'boolean') throw Object.assign(new Error('Checkbox values must be true or false.'), {status:400});
    return {checkbox:value};
  }
  if (type === 'multi_select' || type === 'relation') {
    if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 200)) throw Object.assign(new Error('Invalid selection.'), {status:400});
    return {[type]: [...new Set(value)].filter(Boolean).map(item => type === 'relation' ? {id:item} : {name:item})};
  }
  if (type === 'number') {
    if (value === '') return {number:null};
    if (typeof value !== 'number' || !Number.isFinite(value)) throw Object.assign(new Error('Enter a valid number.'), {status:400});
    return {number:value};
  }
  if (typeof value !== 'string' || value.length > 1900) throw Object.assign(new Error('Text must contain at most 1,900 characters.'), {status:400});
  if (['title','rich_text'].includes(type)) return {[type]: value ? [{plain_text:value,text:{content:value}}] : []};
  if (['select','status'].includes(type)) return {[type]:value ? {name:value} : null};
  if (type === 'url' && value && !/^https:\/\/[^\s]+$/i.test(value)) throw Object.assign(new Error('Links must use HTTPS.'), {status:400});
  if (type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error('Use a calendar date.'), {status:400});
  return {[type]: type === 'date' ? (value ? {start:value} : null) : (value || null)};
}
async function listControls(pool, namespace) {
  const definition = DEFINITIONS[namespace];
  if (!definition) throw Object.assign(new Error('Unknown control.'), {status:400});
  const result = await pool.query('SELECT record_id, payload, version FROM crewos_operational_records WHERE namespace = $1 ORDER BY created_at, record_id', [namespace]);
  const fields = definition.fields.map(([name,fallback]) => {
    const sample = result.rows.find(row => row.payload.properties?.[name]);
    const type = fieldType(sample?.payload.properties?.[name], fallback);
    const options = ['select','status','multi_select'].includes(type)
      ? [...new Set(result.rows.flatMap(row => {const value=readValue(row.payload.properties?.[name],type);return Array.isArray(value)?value:[value];}).filter(Boolean))].sort() : [];
    return {name,type,options};
  });
  return {namespace,label:definition.label,fields,records:result.rows.map(row => ({id:row.record_id,version:row.version,values:Object.fromEntries(fields.map(field => [field.name,readValue(row.payload.properties?.[field.name],field.type)])),...(namespace==='staff'?{pinConfigured:Boolean(readValue(row.payload.properties?.['PIN Hash'],'rich_text'))}:{})}))};
}
async function saveControl(pool, namespace, body, actor) {
  const definition = DEFINITIONS[namespace];
  if (!definition || !body.values || Array.isArray(body.values)) throw Object.assign(new Error('Invalid control.'), {status:400});
  const allowed = new Set(definition.fields.map(([name])=>name));
  if (Object.keys(body.values).some(name => !allowed.has(name))) throw Object.assign(new Error('Unexpected field.'), {status:400});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const state=await client.query('SELECT mode FROM crewos_cutover_state WHERE state_key = $1 FOR SHARE',['notion-exit']);
    if(state.rows[0]?.mode!=='database') throw Object.assign(new Error('Finish the verified Notion import before editing operational controls.'),{status:409});
    const id=body.id || `crew-${crypto.randomUUID()}`;
    const found=await client.query('SELECT payload, version FROM crewos_operational_records WHERE namespace=$1 AND record_id=$2 FOR UPDATE',[namespace,id]);
    const current=found.rows[0];
    const samples=current ? [current] : (await client.query('SELECT payload FROM crewos_operational_records WHERE namespace=$1 ORDER BY created_at LIMIT 100',[namespace])).rows;
    if(body.id && !current) throw Object.assign(new Error('Record not found.'),{status:404});
    if(current && body.expectedVersion!==current.version) throw Object.assign(new Error('This record changed. Reload before saving.'),{status:409});
    if(namespace==='staff' && id===actor.staffId && (body.values.Active===false || (Object.hasOwn(body.values,'Access Level') && body.values['Access Level']!=='Admin'))) throw Object.assign(new Error('You cannot disable your own administrator account.'),{status:409});
    const properties={...current?.payload.properties};
    for(const [name,fallback] of definition.fields) if(Object.hasOwn(body.values,name)) {
      const sample=samples.find(row=>row.payload.properties?.[name]);
      properties[name]=writeValue(body.values[name],fieldType(properties[name] || sample?.payload.properties?.[name],fallback));
    }
    const title=definition.fields.find(([,type])=>type==='title')[0];
    if(!readValue(properties[title],'title').trim()) throw Object.assign(new Error(`${title} is required.`),{status:400});
    if(namespace==='crewProjects' && properties.Staff?.relation?.length) {
      const staff=await client.query("SELECT record_id FROM crewos_operational_records WHERE namespace='staff'");
      if(properties.Staff.relation.some(item=>!staff.rows.some(row=>row.record_id===item.id))) throw Object.assign(new Error('Choose employees from the current roster.'),{status:400});
    }
    if(body.pin) {
      if(namespace!=='staff' || !/^\d{4,8}$/.test(body.pin)) throw Object.assign(new Error('Employee PIN must contain 4–8 digits.'),{status:400});
      const salt=crypto.randomBytes(16).toString('hex');
      properties['PIN Hash']=writeValue(`${salt}:${crypto.scryptSync(body.pin,salt,64).toString('hex')}`,'rich_text');
    }
    const payload={id,properties};
    const saved=current
      ? await client.query('UPDATE crewos_operational_records SET payload=$3::jsonb,version=version+1,updated_at=NOW() WHERE namespace=$1 AND record_id=$2 RETURNING version',[namespace,id,JSON.stringify(payload)])
      : await client.query('INSERT INTO crewos_operational_records (namespace,record_id,payload) VALUES ($1,$2,$3::jsonb) RETURNING version',[namespace,id,JSON.stringify(payload)]);
    const check=await client.query('SELECT payload FROM crewos_operational_records WHERE namespace=$1 AND record_id=$2',[namespace,id]);
    if(canonicalJson(check.rows[0]?.payload)!==canonicalJson(payload)) throw new Error('Saved record could not be verified.');
    await client.query('COMMIT');
    return {id,version:saved.rows[0].version,verified:true};
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
module.exports={DEFINITIONS,readValue,writeValue,listControls,saveControl};
