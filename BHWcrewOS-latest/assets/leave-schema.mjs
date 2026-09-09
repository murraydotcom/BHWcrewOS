// Shared patient-reported intake contract. Never constitutes clinical certification.
export const LEAVE_VERSION = 'bhw.leave-intake.v1';
// id, patient-facing label, section, applicable form (blank = both)
export const LEAVE_FIELDS = [
 ['employeeName','Employee requesting time off','About the employee'],
 ['phone','Best phone number','About the employee'],
 ['email','Email address','About the employee'],
 ['contactMethod','Preferred contact: call, text, or portal','About the employee'],
 ['employer','Employer','About the employee'],
 ['jobTitle','Job title','About the employee'],
 ['employmentStart','Date employment started, if known','About the employee'],
 ['workSchedule','Usual days and hours worked','About the employee'],
 ['jobDuties','Essential job duties (or describe the attached job description)','About the employee'],
 ['relationship','The patient receiving care is the employee’s spouse, parent, or child (including a parental relationship without biological or legal ties)','Caregiving','WH-380-F'],
 ['adultChildSupport','If caring for an adult child: what daily self-care help do they need? Otherwise write not applicable.','Caregiving','WH-380-F'],
 ['careNeeds','Care you will provide: medical, hygiene, nutrition, safety, transport, physical help, or emotional support','Caregiving','WH-380-F'],
 ['careAmount','How much time do you need to provide this care?','Caregiving','WH-380-F'],
 ['formTypes','Forms supplied: FMLA, employer, disability, paid leave, renewal, return to work, other','Paperwork and destination'],
 ['pageCount','Number of pages supplied','Paperwork and destination'],
 ['claimNumber','Case or claim number','Paperwork and destination'],
 ['destination','Company or leave office to receive the finished form','Paperwork and destination'],
 ['deadline','Date the employer needs the form','Paperwork and destination'],
 ['destinationFax','Destination fax','Paperwork and destination'],
 ['destinationEmail','Destination email','Paperwork and destination'],
 ['destinationAddress','Destination mailing address','Paperwork and destination'],
 ['leaveContact','Leave contact name and phone number','Paperwork and destination'],
 ['deliveryPreferences','Copy for you, pickup, or employer website upload (do not share passwords)','Paperwork and destination'],
 ['leaveStart','First day of requested leave','Time off requested'],
 ['leaveEnd','Expected return date, or not sure','Time off requested'],
 ['priorAbsences','Days already missed for this condition','Time off requested'],
 ['leavePattern','Continuous, intermittent, reduced schedule, or a combination','Time off requested'],
 ['episodeFrequency','Flare-ups: how often, with units (for example, 2 times per month)','Time off requested'],
 ['episodeDuration','Flare-ups: how long each time, in hours or days','Time off requested'],
 ['reducedSchedule','Hours per day and days per week you expect to work','Time off requested'],
 ['reducedStart','Reduced schedule start date','Time off requested'],
 ['reducedEnd','Reduced schedule end date','Time off requested'],
 ['treatmentNeeded','Time off for treatment: yes, no, or expected soon','Treatment visits'],
 ['treatmentType','Treatment type (infusion, dialysis, counseling, therapy, injections, tests, specialist, other)','Treatment visits'],
 ['treatmentOffice','Treating office and city','Treatment visits'],
 ['treatmentFrequency','How often are treatment visits? Include units.','Treatment visits'],
 ['treatmentSchedule','Usual treatment days and times','Treatment visits'],
 ['treatmentTime','Length of each treatment visit','Treatment visits'],
 ['travelTime','Travel time for each visit','Treatment visits'],
 ['recoveryTime','Rest or recovery time needed before returning to work','Treatment visits'],
 ['treatmentDuration','How long will treatment continue?','Treatment visits'],
 ['treatmentStart','Treatment start date','Treatment visits'],
 ['treatmentEnd','Treatment end date, or not sure','Treatment visits'],
 ['outsideWork','Can visits be scheduled outside work hours?','Treatment visits'],
 ['scheduledVisits','Dates of visits already scheduled','Treatment visits'],
 ['healthProblem','Describe the selected patient’s health problem related to this leave','Health and function'],
 ['conditionOnset','When did it start or get worse?','Health and function'],
 ['conditionDuration','How long has it lasted or is it expected to last?','Health and function'],
 ['currentTreatment','Medicines or other treatment for this problem','Health and function'],
 ['otherClinicians','Other treating clinicians and offices','Health and function'],
 ['lastVisit','Most recent visit for this condition','Health and function'],
 ['hospitalDates','Hospital or ER dates; say whether there was an overnight admission','Health and function'],
 ['procedureDate','Planned surgery or procedure and date','Health and function'],
 ['unableJobFunctions','Which essential job duties can you not perform?','Health and function','WH-380-E'],
 ['requestedChanges','Requested limits or changes at work','Health and function','WH-380-E'],
 ['priorLeave','Leave already used this year','Health and function'],
 ['lighterWork','Is lighter work available? Yes, no, or not sure','Health and function','WH-380-E'],
 ['omitDiagnosis','Would you prefer a general description instead of the diagnosis on the employer form?','Review and permission'],
 ['additionalAnswers','Additional information or answers to care-team questions','Review and permission'],
];
export function leaveQuestions(answers = {}, formType) {
 const required = ['employeeName','employer','deadline','leaveStart','leaveEnd','leavePattern','conditionOnset','conditionDuration','healthProblem'];
 required.push(...(formType === 'WH-380-F' ? ['relationship','careNeeds','careAmount'] : ['jobDuties','workSchedule','unableJobFunctions']));
 if (/intermittent|combination/i.test(answers.leavePattern || '')) required.push('episodeFrequency','episodeDuration');
 if (/reduced|combination/i.test(answers.leavePattern || '')) required.push('reducedSchedule','reducedStart','reducedEnd');
 if (/yes|soon/i.test(answers.treatmentNeeded || '')) required.push('treatmentType','treatmentFrequency','treatmentTime','travelTime','recoveryTime','treatmentDuration');
 return [...new Set(required)].filter(key => !String(answers[key] || '').trim()).map(key => ({key, audience:'patient', question:LEAVE_FIELDS.find(f => f[0] === key)[1]}));
}
export function leaveTranscript(record) {
 return [`Patient-reported leave intake; not clinician-certified. ${record.formType}.`,
  ...LEAVE_FIELDS.filter(([key,,,form]) => (!form || form === record.formType) && record.answers?.[key]).map(([key,label]) => `${label}: ${record.answers[key]}`)].join('\n');
}
