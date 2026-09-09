import {checkboxPositions} from './fmla-checkboxes.mjs';
// Coordinates are PDF points from the top-left of DOL's 2029-expiration forms.
// [key, label, page, x, top, width, height, sourceIntakeKey, kind]
export function certificationFields(type) {
 const family=type==='WH-380-F';
 const fields=[
 ['employeeName','Employee name',0,108,296,480,15,'employeeName'],
 ['employer','Employer',0,108,332,303,16,'employer'],
 ['deadline','Employer deadline',0,250,370,286,15,'deadline'],
 ...[1,2,3].map(page=>['employeeName'+page,'Employee name (continued)',page,100,27,490,15,'employeeName']),
 ['provider','Certifying provider name',1,195,family?394:61,395,15],
 ['providerAddress','Provider business address',1,195,family?421:88,395,15],
 ['specialty','Practice / specialty',1,195,family?448:115,395,15],
 ['providerPhone','Provider telephone',1,72,family?475:142,104,15],
 ['providerFax','Provider fax',1,216,family?475:142,95,15],
 ['providerEmail','Provider email',1,360,family?475:142,230,15],
 ['onset','Clinician-confirmed condition onset (MM/DD/YYYY)',1,280,family?626:267,228,15],
 ['duration','Clinician estimate of condition duration',1,320,family?653:295,270,15],
 ['medicalFacts','Relevant medical facts (diagnosis optional; exclude unrelated/genetic history)',2,21,family?366:77,569,family?42:44],
 ['scheduledVisits','Planned treatment dates',2,302,family?516:232,288,14],
 ['referralTreatment','Referred treatment type',2,311,family?570:288,279,14],
 ['treatmentStart','Treatment start (MM/DD/YYYY)',2,220,family?591:304,83,15],
 ['treatmentEnd','Treatment end (MM/DD/YYYY)',2,418,family?591:304,83,15],
 ['treatmentDuration','Treatment frequency/duration including recovery',2,21,family?647:363,569,29],
 ['continuousStart','Continuous incapacity start (MM/DD/YYYY)',family?3:2,220,family?90:509,83,15],
 ['continuousEnd','Continuous incapacity end (MM/DD/YYYY)',family?3:2,418,family?90:509,83,15],
 ['episodeFrequency','Intermittent episodes: number',family?3:2,307,family?170:590,229,15],
 ['episodeDuration','Intermittent episodes: duration number',family?3:2,310,family?189:610,128,14],
 ];
 if(family) fields.push(
 ['carePatient','Name of patient receiving care',0,280,511,310,15],
 ['patientName','Patient name (provider section)',1,109,599,481,15],
 ['requestedCareAmount','Employee estimate of care time',1,21,130,569,22,'careAmount'],
 ['requestedReducedStart','Employee requested reduced schedule start',1,156,173,80,13,'reducedStart'],
 ['requestedReducedEnd','Employee requested reduced schedule end',1,308,173,65,13,'reducedEnd'],
 ['requestedHours','Employee requested hours/day',1,39,189,46,13],
 ['requestedDays','Employee requested days/week',1,156,189,51,13],
 ['careOther','Other care described by employee',1,349,91,234,13],
 ['careNeeded','Clinician-confirmed medically necessary care',1,21,709,569,30]);
 else fields.push(
 ['jobTitle','Employee job title',0,119,406,291,16,'jobTitle'],
 ['workSchedule','Regular work schedule',0,179,436,411,15,'workSchedule'],
 ['jobDuties','Essential job functions supplied by employee/employer',0,21,480,569,41,'jobDuties'],
 ['reducedStart','Clinician reduced schedule start',2,380,421,83,14],
 ['reducedEnd','Clinician reduced schedule end',2,37,437,85,14],
 ['reducedSchedule','Clinician estimate of working hours/day and days/week',2,21,456,569,14],
 ['unableJobFunctions','Clinician-confirmed essential functions employee cannot perform',3,21,165,569,46]);
 const criteriaPage=family?2:1, shift=family? -269:0;
 for(const [key,label,x,top] of [
 ['inpatient','Inpatient overnight care',35,344],['inpatientPast','Has been admitted',170,344],['inpatientFuture','Expected admission',233,344],
 ['incapacityTreatment','Incapacity plus treatment',35,377],['incapacityPast','Has been incapacitated',190,395],['incapacityFuture','Expected incapacity',253,395],
 ['visitPast','Was seen',107,427],['visitFuture','Will be seen',151,427],['continuingYes','Continuing treatment: has',115,459],['continuingNo','Continuing treatment: has not',161,459],
 ['pregnancy','Pregnancy',35,487],['chronic','Chronic condition',35,509],['longTerm','Permanent or long-term condition',35,531],['multipleTreatments','Multiple treatments',35,563],['none','None of the listed conditions',35,590]
 ]) fields.push([key,label,criteriaPage,x,top+shift,10,10,'','checkbox']);
 fields.push(['admissionDates','Overnight admission dates',criteriaPage,325,355+shift,265,14],['incapacityFrom','Incapacity plus treatment: start date',criteriaPage,209,404+shift,73,14],['incapacityTo','Incapacity plus treatment: end date',criteriaPage,355,404+shift,75,14],['seenDates','Treatment visit dates',criteriaPage,324,425+shift,266,26],['deliveryDate','Expected delivery date',criteriaPage,357,482+shift,84,14]);
 const episodePage=family?3:2, epY=family?194:614;
 [['perDay','Episodes per day',28],['perWeek','Episodes per week',68],['perMonth','Episodes per month',115],['durationHours','Episode duration in hours',family?451:453],['durationDays','Episode duration in days',497]].forEach(([key,label,x])=>fields.push([key,label,episodePage,x,epY,10,10,'','checkbox']));
 // Temporal qualifiers are independent of the condition-category checkboxes.
 for(const [key,label,page,x,y] of (family?[
 ['plannedPast','Had planned treatment',2,171,506],['plannedFuture','Will have planned treatment',2,214,506],['referredPast','Was referred',2,171,560],['referredFuture','Will be referred',2,214,560],
 ['continuousPast','Was continuously incapacitated',3,171,58],['continuousFuture','Will be continuously incapacitated',3,214,58],
 ['intermittentPast','Care intermittently necessary: was',3,138,130],['intermittentPresent','Care intermittently necessary: is',3,183,130],['intermittentFuture','Care intermittently necessary: will be',3,216,130],
 ['spouse','Relationship: spouse',0,57,560],['parent','Relationship: parent / in loco parentis',0,185,560],['minorChild','Relationship: child under 18',0,309,560],['adultChild','Relationship: adult child incapable of self-care due to disability',0,57,578],
 ['basicCare','Employee care: basic medical/hygiene/nutrition/safety',1,57,76],['transport','Employee care: transportation',1,362,76],['physicalCare','Employee care: physical',1,57,94],['comfort','Employee care: psychological comfort',1,161,94],['otherCare','Employee care: other',1,300,94]
 ]:[
 ['jobAttached','Job description attached',0,479,413],['jobNotAttached','Job description not attached',0,513,413],
 ['plannedPast','Had planned treatment',2,171,223],['plannedFuture','Will have planned treatment',2,214,223],['referredPast','Was referred',2,171,275],['referredFuture','Will be referred',2,214,275],
 ['continuousPast','Was continuously incapacitated',2,171,479],['continuousFuture','Will be continuously incapacitated',2,214,479],['intermittentPast','Intermittently necessary: was',2,130,550],['intermittentPresent','Intermittently necessary: is',2,173,550],['intermittentFuture','Intermittently necessary: will be',2,207,550],
 ['unablePast','Unable to perform functions: was',3,189,130],['unablePresent','Unable to perform functions: is',3,264,130],['unableFuture','Unable to perform functions: will be',3,331,130]
 ])) fields.push([key,label,page,x,y,10,10,'','checkbox']);
 return fields.map(field=>{const position=checkboxPositions[type]?.[field[0]];if(position){field[3]=position[0];field[4]=position[1];}return field;});
}
export function validateCertification(values) {
 const issues=[];
 const categories=['inpatient','incapacityTreatment','pregnancy','chronic','longTerm','multipleTreatments'];
 if(values.none && categories.some(key=>values[key])) issues.push('“None” cannot be selected with another serious-condition category.');
 for(const group of [['perDay','perWeek','perMonth'],['durationHours','durationDays'],['continuingYes','continuingNo'],['spouse','parent','minorChild','adultChild'],['jobAttached','jobNotAttached']]) {
  if(group.filter(key=>values[key]).length>1) issues.push('Choose only one option: '+group.join(', '));
 }
 if(values.episodeFrequency && !['perDay','perWeek','perMonth'].some(key=>values[key])) issues.push('Choose the episode frequency unit.');
 if(values.episodeDuration && !['durationHours','durationDays'].some(key=>values[key])) issues.push('Choose the episode duration unit.');
 return issues;
}
