export const CEND_ROSTER_HEADERS = [
  "LastName",
  "FirstName",
  "DOB",
  "Gender",
  "Address1",
  "City",
  "State",
  "Zip",
  "MRN",
  "MemberID",
  "PanelID",
];

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeCendSubscriberCode(value) {
  return clean(value).replace(/[^A-Za-z0-9_-]/g, "");
}

export function activeCendPatients(patients) {
  return (Array.isArray(patients) ? patients : []).filter((patient) => {
    const bhwPatientId = clean(patient?.bhwPatientId).toUpperCase();
    return patient?.patientStatus === "active"
      && /^BHW\d{4}$/.test(bhwPatientId)
      && bhwPatientId !== "BHW0000";
  });
}

function cendValues(patient, subscriberCode) {
  return [
    clean(patient.legalLastName),
    clean(patient.legalFirstName),
    clean(patient.dateOfBirth),
    clean(patient.gender),
    clean(patient.address1 || patient.address),
    clean(patient.city),
    clean(patient.state),
    clean(patient.postalCode || patient.zip),
    clean(patient.bhwPatientId).toUpperCase(),
    clean(patient.memberId),
    subscriberCode,
  ];
}

function csvCell(value) {
  const text = clean(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid export date is required");
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${date.getFullYear()}`;
}

export function buildCendRosterFile(patients, { subscriberCode = "", now = new Date() } = {}) {
  const panelId = normalizeCendSubscriberCode(subscriberCode);
  if (!panelId) return { ok: false, reason: "subscriber-required", activeCount: 0, incompleteCount: 0 };

  const active = activeCendPatients(patients);
  if (!active.length) return { ok: false, reason: "no-active-patients", activeCount: 0, incompleteCount: 0 };

  const incomplete = active.filter((patient) => cendValues(patient, panelId).slice(0, 8).some((value) => !value));
  if (incomplete.length) {
    return {
      ok: false,
      reason: "incomplete-demographics",
      activeCount: active.length,
      incompleteCount: incomplete.length,
    };
  }

  const rows = active.map((patient) => cendValues(patient, panelId));
  const csv = [CEND_ROSTER_HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  return {
    ok: true,
    activeCount: active.length,
    incompleteCount: 0,
    subscriberCode: panelId,
    filename: `${panelId}-1-z-${exportDate(now)}.csv`,
    csv,
  };
}
