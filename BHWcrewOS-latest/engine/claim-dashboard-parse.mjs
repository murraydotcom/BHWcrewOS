const clean = (value = "") => String(value)
  .replace(/<br\s*\/?\s*>/gi, " ")
  .replace(/\*\*/g, "")
  .replace(/\u00a0/g, " ")
  .trim();

const uniq = (values) => [...new Set(values.map(clean).filter(Boolean))];

function cells(line) {
  if (!/^\s*\|/.test(line)) return [];
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(clean);
}

function isDivider(values) {
  return values.length > 1 && values.every((value) => !value || /^:?-{2,}:?$/.test(value));
}

function parsePatient(value) {
  const match = clean(value).match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return match ? { name: match[1].trim(), bhwId: match[2].trim() } : { name: clean(value), bhwId: "" };
}

function parsePayer(value) {
  const match = clean(value).match(/^(.*?)(?:\(([^()]*)\))?\s*$/);
  return { payer: (match?.[1] || "").trim(), payerId: (match?.[2] || "").trim() };
}

function stageFor(claimStatus, transactionStatus) {
  const value = `${claimStatus} ${transactionStatus}`.toLowerCase();
  if (/reject|deni|error|fail/.test(value)) return "rejected";
  if (/acknowledged|accepted by payer/.test(value)) return "acknowledged";
  if (/clearing house|gateway/.test(value)) return "clearinghouse";
  if (/paid|remit/.test(value)) return "paid";
  if (/submit/.test(value)) return "clearinghouse";
  return "unknown";
}

function finish(claim) {
  if (!claim) return null;
  const serviceLines = claim.serviceLines || [];
  claim.cpt = uniq(serviceLines.map((line) => line.cpt)).join(", ");
  claim.diagnoses = uniq(serviceLines.flatMap((line) => line.diagnoses || [])).join(", ");
  claim.pos = uniq(serviceLines.map((line) => line.pos)).join(", ");
  claim.modifiers = uniq(serviceLines.flatMap((line) => line.modifiers || [])).join(", ");
  return claim;
}

/** Parse the Charm claim-dashboard markdown export into the shared cloud claim shape. */
export function parseClaimDashboard(text = "") {
  const claims = [];
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const values = cells(rawLine);
    if (!values.length || isDivider(values)) continue;

    const invoiceIndex = values.findIndex((value) => /^INV[\w-]+$/i.test(value));
    if (invoiceIndex >= 2 && values.length >= invoiceIndex + 7) {
      if (current) claims.push(finish(current));
      const patient = parsePatient(values[invoiceIndex - 1]);
      const payer = parsePayer(values[invoiceIndex + 1]);
      const claimStatus = values[invoiceIndex + 5] || "";
      const transactionStatus = values[invoiceIndex + 6] || "";
      const stage = stageFor(claimStatus, transactionStatus);
      current = {
        invoice: values[invoiceIndex],
        name: patient.name,
        bhwId: patient.bhwId,
        payer: payer.payer,
        payerId: payer.payerId,
        provider: values[invoiceIndex + 3] || "",
        encounterDate: values[invoiceIndex - 2] || "",
        updatedDate: values[invoiceIndex + 2] || "",
        amount: Number(String(values[invoiceIndex + 4] || "0").replace(/[$,]/g, "")) || 0,
        claimStatus,
        transactionStatus,
        stage,
        latestStage: stage,
        wasRejected: stage === "rejected",
        needsAction: stage === "rejected",
        reason: stage === "rejected" ? transactionStatus || claimStatus : "",
        source: "Charm claims dashboard",
        serviceLines: [],
      };
      continue;
    }

    if (current && /^[A-Z0-9]{4,7}$/i.test(values[0] || "") && /^\d{2}$/.test(values[1] || "")) {
      current.serviceLines.push({
        cpt: values[0].toUpperCase(),
        pos: values[1],
        modifiers: uniq(String(values[2] || "").split(/[\s,]+/)).map((value) => value.toUpperCase()),
        diagnoses: uniq(String(values[3] || "").split(",")).map((value) => value.toUpperCase()),
      });
    }
  }
  if (current) claims.push(finish(current));
  return claims.filter((claim) => claim?.invoice);
}

