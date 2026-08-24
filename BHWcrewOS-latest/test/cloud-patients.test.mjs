import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { legacyPatient, searchCloudPatients } = require('../netlify/functions/lib/cloud-patients');

test('Cloud patient adapter preserves legacy picker and source-relation keys', () => {
  const patient = legacyPatient({
    bhwPatientId: 'BHW0140', legalFirstName: 'Ella', legalLastName: 'Ballard', dateOfBirth: '1980-01-02',
    phone: '(443) 555-1212', primaryPayer: 'Medicare', memberId: 'MEM-1',
    programEnrollment: ['APCM'], source: { recordId: 'notion-row', recordUrl: 'https://notion.so/row' },
    sourceRelations: { carePlans: ['plan-1'] }, clinicalSnapshot: { allergies: 'Penicillin' },
  });
  assert.equal(patient.id, 'BHW0140');
  assert.equal(patient.name, 'Ella Ballard');
  assert.equal(patient.dob, '1980-01-02');
  assert.equal(patient.notionPageId, 'notion-row');
  assert.equal(patient.payer, 'Medicare');
  assert.equal(patient.member, 'MEM-1');
  assert.deepEqual(patient.programs, ['APCM']);
  assert.equal(patient.allergies, 'Penicillin');
});

test('Cloud patient search supports BHW ID, name, and normalized phone', () => {
  const roster = [legacyPatient({ bhwPatientId:'BHW0140', legalFirstName:'Ella', legalLastName:'Ballard', phone:'443-555-1212' })];
  assert.equal(searchCloudPatients(roster, 'BHW0140').length, 1);
  assert.equal(searchCloudPatients(roster, 'ballard').length, 1);
  assert.equal(searchCloudPatients(roster, '(443) 555-1212').length, 1);
});
