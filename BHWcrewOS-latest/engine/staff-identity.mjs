export const DEFAULT_ENCOUNTER_OWNER = "Amaris Murray, CRNP/FNP — Medical Director";

const LEGACY_AMARIS_OWNER = /^(?:provider|amaris|a\.?\s+murray|murray,?\s*amaris(?:\s+crnp)?|amaris\s+murray(?:,?\s*(?:crnp|fnp|crnp\/fnp))?(?:\s*[·—-]\s*medical director)?)$/i;

export function normalizeEncounterOwner(value, fallback = DEFAULT_ENCOUNTER_OWNER) {
  const owner = String(value || "").trim();
  if (!owner) return fallback;
  return LEGACY_AMARIS_OWNER.test(owner) ? DEFAULT_ENCOUNTER_OWNER : owner;
}

export function ownerIdentityForStaff(staff = {}) {
  const suppliedName = String(staff.name || "").trim();
  const role = String(staff.role || "").trim();
  if (!suppliedName) return DEFAULT_ENCOUNTER_OWNER;
  if (/^(?:amaris|a\.?\s+murray|murray,?\s*amaris|amaris\s+murray)$/i.test(suppliedName)) {
    return DEFAULT_ENCOUNTER_OWNER;
  }
  const fullName = /^yahaira$/i.test(suppliedName) ? "Yahaira Matias" : suppliedName;
  return role ? `${fullName}, ${role}` : fullName;
}
