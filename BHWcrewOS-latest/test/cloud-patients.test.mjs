import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  legacyPatient,
  parsePatientName,
  searchCloudPatients,
  resolveMedicareMbi,
  resolveMedicareCoverageOrder,
  isValidMedicareMbi,
} = require('../netlify/functions/lib/cloud-patients');

test('Cloud patient adapter exposes canonical picker fields without a legacy patient key', () => {
  const patient = legacyPatient({
    bhwPatientId: 'BHW0140', legalFirstName: 'Ella', legalLastName: 'Ballard', dateOfBirth: '1980-01-02',
    phone: '(443) 555-1212', primaryPayer: 'Medicare', memberId: 'MEM-1',
    programEnrollment: ['APCM'], source: { recordId: 'notion-row', recordUrl: 'https://notion.so/row' },
    sourceRelations: { carePlans: ['plan-1'], careProgramEnrollments: ['BHW0140:APCM'] }, clinicalSnapshot: { allergies: 'Penicillin' },
  });
  assert.equal(patient.id, 'BHW0140');
  assert.equal(patient.name, 'Ella Ballard');
  assert.equal(patient.dob, '1980-01-02');
  assert.equal(Object.hasOwn(patient, 'notionPageId'), false);
  assert.equal(Object.hasOwn(patient, 'pageId'), false);
  assert.equal(Object.hasOwn(patient, 'source'), false);
  assert.equal(Object.hasOwn(patient, 'patientPageUrl'), false);
  assert.equal(patient.payer, 'Medicare');
  assert.equal(patient.member, 'MEM-1');
  assert.deepEqual(patient.programs, ['APCM']);
  assert.deepEqual(patient.careProgramEnrollmentIds, ['BHW0140:APCM']);
  assert.equal(patient.allergies, 'Penicillin');
});

test('Cloud patient search supports BHW ID, name, and normalized phone', () => {
  const roster = [legacyPatient({ bhwPatientId:'BHW0140', legalFirstName:'Ella', legalLastName:'Ballard', nameSuffix:'III', phone:'443-555-1212', patientStatus:'transferred' })];
  assert.equal(searchCloudPatients(roster, 'BHW0140').length, 1);
  assert.equal(searchCloudPatients(roster, 'ballard').length, 1);
  assert.equal(searchCloudPatients(roster, 'III').length, 1);
  assert.equal(searchCloudPatients(roster, '(443) 555-1212').length, 1);
  assert.equal(roster[0].name, 'Ella Ballard III');
  assert.equal(roster[0].selectable, false);
});

test('new patient names store common suffixes separately from the legal last name', () => {
  assert.deepEqual(parsePatientName('Richard Bernard 3rd'), {
    legalFirstName: 'Richard', legalLastName: 'Bernard', nameSuffix: 'III', name: 'Richard Bernard III',
  });
  assert.deepEqual(parsePatientName('Aaron McCorkle', 'Jr.'), {
    legalFirstName: 'Aaron', legalLastName: 'McCorkle', nameSuffix: 'Jr', name: 'Aaron McCorkle Jr',
  });
});

test('Medicare MBI resolver reconciles canonical and coverage-record locations without guessing', () => {
  assert.equal(resolveMedicareMbi({ medicareMbi: '1EG4-TE5-MK73' }), '1EG4TE5MK73');
  assert.equal(resolveMedicareMbi({ coverageRecords: [{ payer: 'CMS Medicare', medicareMbi: '1EG4 TE5 MK73' }] }), '1EG4TE5MK73');
  assert.equal(resolveMedicareMbi({ primaryPayer: 'Original Medicare', memberId: '1EG4TE5MK73' }), '1EG4TE5MK73');
  assert.equal(resolveMedicareMbi({ primaryPayer: 'Commercial', memberId: '1EG4TE5MK73' }), '');
  assert.equal(resolveMedicareMbi({ primaryPayer: 'Medicare Advantage', memberId: '1EG4TE5MK73' }), '');
  assert.equal(resolveMedicareMbi({ primaryPayer: 'Medicare', memberId: 'INVALID12345' }), '');
  assert.equal(isValidMedicareMbi('1EG4-TE5-MK73'), true);
});

test('Cloud patient adapter promotes a nested Registry MBI for every directory consumer', () => {
  const patient = legacyPatient({
    bhwPatientId: 'BHW0141', legalFirstName: 'Synthetic', legalLastName: 'Medicare',
    primaryPayer: 'Commercial', coverageRecords: [{ coverageOrder: 'secondary', insuranceType: 'original-medicare', payer: 'CMS', medicareMbi: '1EG4-TE5-MK73' }],
  });
  assert.equal(patient.medicareMbi, '1EG4TE5MK73');
  assert.equal(patient.hasMbi, true);
  assert.equal(patient.medicareCoverageOrder, 'secondary');
  assert.equal(resolveMedicareCoverageOrder(patient), 'secondary');
});

test('Advantage and supplement policy numbers never seed an MBI even when they have MBI format', () => {
  for (const coverage of [
    { insuranceType: 'medicare-advantage', payerName: 'UnitedHealthcare Dual Complete' },
    { insuranceType: 'medicare-advantage', payerName: 'CIGNA HealthSpring' },
    { insuranceType: 'medicare-supplement', payerName: 'Medicare Supplement' },
    { insuranceType: 'commercial', payerName: 'Synthetic Medicare Named Employer Plan' },
  ]) {
    assert.equal(resolveMedicareMbi({ coverageRecords: [{ ...coverage, memberId: '1EG4TE5MK73' }] }), '');
  }
  assert.equal(resolveMedicareMbi({ primaryPayer: 'UnitedHealthcare Dual Complete', memberId: '1EG4TE5MK73' }), '');
  assert.equal(resolveMedicareMbi({ primaryPayer: 'Medicare Supplement', memberId: '1EG4TE5MK73' }), '');
});

test('structured primary coverage wins over stale legacy payer and plan projections', () => {
  const patient = legacyPatient({
    bhwPatientId: 'BHW9999', legalFirstName: 'Synthetic', legalLastName: 'Coverage',
    primaryPayer: 'Medicare', memberId: '1EG4TE5MK73', insurancePlanName: 'Original Medicare',
    coverageRecords: [{ coverageOrder: 'primary', insuranceType: 'commercial', payerName: 'CareFirst BCBS', memberId: 'PRIMARY-1', planName: 'Verified Employer Plan', coverageStatus: 'verified' }],
  });
  assert.equal(patient.payer, 'CareFirst BCBS');
  assert.equal(patient.primaryPayer, 'CareFirst BCBS');
  assert.equal(patient.memberId, 'PRIMARY-1');
  assert.equal(patient.insurance, 'Verified Employer Plan');
  assert.equal(patient.hasMbi, false);
  assert.equal(patient.medicareCoverageOrder, '');
});
