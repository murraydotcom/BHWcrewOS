export const PROGRAMS=['ssa','ssa-ce','private','other'];
export const REFERENCES=[
 ['SSA evidence requirements','https://www.ssa.gov/disability/professionals/greenbook/ce-evidence.htm'],
 ['SSA adult CE report guidance','https://www.ssa.gov/disability/professionals/greenbook/ce-adult.htm'],
 ['SSA CE scope','https://www.ssa.gov/disability/professionals/greenbook/ce-guidelines.htm'],
 ['Medical opinion supportability and consistency','https://www.ssa.gov/OP_Home/cfr20/404/404-1520c.htm']
];
export function baselineQuestions(program){
 const entries=[
 ['patient','Describe the condition, onset, progression, symptoms, and how symptoms vary over time in your own words.'],
 ['patient','Describe a typical day, what you can still do, what requires help or breaks, and the recovery needed afterward.'],
 ['patient','What are the actual job duties, hours, physical demands, cognitive demands, and attempted accommodations or return-to-work attempts?'],
 ['patient','How long can you sit, stand, or walk at one time and over a day? What can you lift, carry, reach, handle, or manipulate? Include examples and units; do not guess.'],
 ['patient','How do symptoms affect remembering instructions, concentrating, maintaining pace, interacting with others, and managing changes? Give specific examples.'],
 ['patient','How often do symptoms interrupt activities, how long do episodes and recovery last, and what help, unscheduled breaks, or missed days have actually occurred?'],
 ['patient','What treatments, doses, therapies, or assistive devices have you tried? Describe benefits, adverse effects, barriers to treatment, and remaining limitations.'],
 ['clinician','Document diagnoses and longitudinal evidence with dates and sources, relevant examination findings, diagnostic results, and pertinent negative findings.'],
 ['clinician','Explain the medically supported functional restrictions, retained abilities, expected duration, prognosis, and the evidence supporting each estimate. Separate observed findings from reported limitations.'],
 ['clinician','Reconcile apparent inconsistencies, good and bad days, isolated examination findings versus sustained function, and effects of multiple conditions together.'],
 ['staff','Verify the exact form/version, requested assessment period, recipient, deadline, claim reference, required attachments, signatures, and disclosure authorization.'],
 ['staff','Check every original packet page and applicable instruction. Add questions for any items missing from this checklist.']
 ];
 if(program==='ssa-ce')entries.push(['clinician','For the DDS-requested examination, verify identity and history sources, complete the requested specialty examination, and provide a narrative medical opinion. Confirm any additional DDS requirements and authorization for tests.']);
 if(program==='private')entries.push(['staff','Enter the insurer’s supplied definition and assessment dates, including own-occupation or any-occupation criteria if stated. Identify the source and version; do not substitute SSA criteria.']);
 return entries.map(([audience,question],i)=>({id:`core-${i}`,question,audience,origin:'Visit checklist',answer:'',status:'unanswered',reviewed:false}));
}
export function readiness(rows,coverage){
 const pending=rows.filter(r=>!r.answer?.trim()||!['answered','not-applicable'].includes(r.status)||!r.reviewed);
 return {pending:pending.length,total:rows.length,ready:rows.length>0&&pending.length===0&&coverage===true};
}
export function cleanAnalysis(raw,input){
 const strings=(v,max=4000)=>typeof v==='string'?v.slice(0,max):'';
 const questions=new Map(input.questions.map(q=>[q.id,q]));
 const sources={'clinical-note':input.notes,'patient-report':input.patientReport,'visit-answer':input.questions.map(q=>`${q.id}: ${q.answer||''}`).join('\n')};
 const extracted=(Array.isArray(raw.requirements)?raw.requirements:[]).filter(q=>q&&typeof q.quote==='string'&&q.quote.trim().length>2&&typeof q.question==='string'&&q.question.trim()&&['packet','guideline'].includes(q.source)&&input[q.source==='packet'?'packetText':'guidelines'].includes(q.quote)).slice(0,100).map((q,i)=>({id:`packet-${i}`,question:strings(q.question,1000),audience:['patient','clinician','staff'].includes(q.audience)?q.audience:'clinician',origin:q.source,quote:strings(q.quote,2000),location:strings(q.location,150),answer:'',status:'unanswered',reviewed:false}));
 const suggestions=(Array.isArray(raw.suggestions)?raw.suggestions:[]).filter(s=>s&&questions.has(s.id)&&typeof s.answer==='string'&&s.answer.trim()&&Array.isArray(s.evidence)&&s.evidence.length&&s.evidence.every(e=>e&&typeof e.quote==='string'&&e.quote.trim().length>2&&sources[e.source]?.includes(e.quote))).slice(0,100).map(s=>({id:s.id,answer:strings(s.answer),evidence:s.evidence.map(e=>({source:e.source,quote:strings(e.quote,2000)}))}));
 const followups=(Array.isArray(raw.followups)?raw.followups:[]).filter(q=>q&&typeof q.question==='string'&&q.question.trim()).slice(0,50).map(q=>({question:strings(q.question,1000),audience:['patient','clinician','staff'].includes(q.audience)?q.audience:'clinician'}));
 return {summary:strings(raw.summary),strengths:strings(raw.strengths),gaps:strings(raw.gaps),conflicts:strings(raw.conflicts),requirements:extracted,suggestions,followups,requiresClinicianReview:true};
}
