import assert from "node:assert/strict";
import test from "node:test";
import {parseMedicationExport} from "../assets/charm-medication-review.mjs";
import matcher from "../netlify/functions/charm-medication-match.js";
import auth from "../netlify/functions/_lib.js";

test("reads the identity and medication columns from a CSV with a report header", () => {
  const input = 'Report\r\nMRN,DOB,Drug Name,Strength,Medication Status\r\nCH-1,1/2/1980,"Example, XR",10 mg,Active\r\n';
  assert.deepEqual(parseMedicationExport(input), [
    {patientId:"CH-1",birthDate:"1/2/1980",medication:"Example, XR",strength:"10 mg",status:"Active",row:3},
  ]);
  assert.throws(() => parseMedicationExport("Patient Name,Drug Name\nExample,Example"), /Patient ID or MRN/);
});

test("patient matches require unique IDs and exact DOB on active, nonsynthetic Registry records", () => {
  const p = {bhwPatientId:"BHW1234",chart:"CH-1",dob:"1980-01-02",status:"active",name:"Example"};
  const rows = [
    {patientId:"CH-1",dob:"1/2/1980"},
    {patientId:"BHW1234",dob:"1980-01-03"},
    {patientId:"CH-2",dob:"1980-01-02"},
    {patientId:"CH-3",dob:"1980-01-02"},
    {patientId:"CH-4",dob:"1980-01-02"},
  ];
  const matches = matcher._test.matchRows(rows, [
    p, {...p,chart:"CH-2",bhwPatientId:"BHW1235"}, {...p,chart:"CH-2",bhwPatientId:"BHW1236"},
    {...p,chart:"CH-3",bhwPatientId:"BHW0000"}, {...p,chart:"CH-4",bhwPatientId:"BHW1237",status:"inactive"},
  ]);
  assert.equal(matches[0].bhwPatientId,"BHW1234");
  assert.match(matches[1].reason,/differs/);
  assert.match(matches[2].reason,/ambiguous/);
  assert.match(matches[3].reason,/not eligible/);
  assert.match(matches[4].reason,/not eligible/);
});

test("only the two Admin Master accounts can call the matcher", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "synthetic-medication-match";
  try {
    const call = staffId => matcher._test.handle({
      httpMethod:"POST", headers:staffId ? {authorization:`Bearer ${auth.sign({staffId,exp:Date.now()+60000})}`} : {},
      body:JSON.stringify({rows:[{patientId:"CH-1",dob:"1980-01-02"}]}),
    }, async () => []);
    assert.equal((await call()).statusCode,401);
    assert.equal((await call("unapproved-admin")).statusCode,403);
    for (const id of ["39358075-8d30-81a2-9d5a-d2fbca3cf4b5","39358075-8d30-8125-93b0-d54f9e1fb69b"]) {
      assert.equal((await call(id)).statusCode,200);
    }
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
