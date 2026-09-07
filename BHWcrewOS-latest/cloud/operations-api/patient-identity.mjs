import crypto from "node:crypto";
import { apiError, cleanText } from "./schema.mjs";

export const PATIENT_PORTAL_ACCESS_STATUSES = Object.freeze([
  "not-invited",
  "approved",
  "invited",
  "active",
  "paused",
  "revoked",
]);
export const PATIENT_PORTAL_PILOT_COHORT = "primary-care-adult-v1";
export const PATIENT_PORTAL_CONSENT_VERSION = "bhw-care-connect-pilot-v1";
const PORTAL_CHANNELS = new Set(["email", "sms"]);
const STAFF_SETTABLE_STATUSES = new Set(["not-invited", "approved", "invited", "paused", "revoked"]);
const PORTAL_APPROVER_ROLES = new Set(["admin", "executive", "operations-manager", "provider", "physician", "pmhnp", "crnp", "care-manager"]);

function isoDateTime(value) {
  const parsed = new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function pastOrPresentIsoDateTime(value, now = new Date()) {
  const parsed = new Date(value || "");
  const clock = now instanceof Date ? now : new Date(now);
  return Number.isFinite(parsed.getTime())
    && Number.isFinite(clock.getTime())
    && parsed.getTime() <= clock.getTime()
    ? parsed.toISOString()
    : "";
}

function exactReferenceMatches(left, right) {
  const a = Buffer.from(cleanText(left, 128));
  const b = Buffer.from(cleanText(right, 128));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ageAt(dateOfBirth, now = new Date()) {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const clock = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(dob.getTime()) || !Number.isFinite(clock.getTime())) return null;
  let age = clock.getUTCFullYear() - dob.getUTCFullYear();
  const month = clock.getUTCMonth() - dob.getUTCMonth();
  if (month < 0 || (month === 0 && clock.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

export function requirePatientPortalApprover(actor = {}) {
  const role = cleanText(actor.role, 80).toLowerCase();
  if (!PORTAL_APPROVER_ROLES.has(role)) {
    throw apiError(403, "portal_access_denied", "patient portal pilot access requires an approved BHW role");
  }
  return actor;
}

export function sanitizePatientPortalAccess(input = {}, {
  patient,
  existing = {},
  actor = {},
  verifiedContactReference = "",
  now = new Date(),
} = {}) {
  if (!patient?.bhwPatientId) throw apiError(404, "patient_not_found", "patient was not found in the protected registry");
  const clock = now instanceof Date ? now : new Date(now);
  const nowIso = clock.toISOString();
  const requestedStatus = cleanText(input.portalAccessStatus || existing.portalAccessStatus || "not-invited", 40).toLowerCase();
  if (!STAFF_SETTABLE_STATUSES.has(requestedStatus) && !(requestedStatus === "active" && existing.portalAccessStatus === "active")) {
    throw apiError(400, "validation_error", "portal access status is not supported");
  }
  const preferredChannel = cleanText(input.preferredChannel ?? existing.preferredChannel, 20).toLowerCase();
  if (preferredChannel && !PORTAL_CHANNELS.has(preferredChannel)) {
    throw apiError(400, "validation_error", "preferred channel must be email or sms");
  }
  const consentStatus = cleanText(input.consentStatus ?? existing.consentStatus, 20).toLowerCase();
  const requestedConsentedAt = input.consentedAt ?? existing.consentedAt;
  const consentedAt = pastOrPresentIsoDateTime(requestedConsentedAt, clock);
  if (requestedConsentedAt && !consentedAt) {
    throw apiError(400, "validation_error", "consent time must be a valid time that is not in the future");
  }
  const consentEvidenceReference = cleanText(input.consentEvidenceReference ?? existing.consentEvidenceReference, 500);
  const contactVerificationConfirmed = input.contactVerificationConfirmed === true;
  const contactVerifiedAt = contactVerificationConfirmed ? nowIso : isoDateTime(existing.contactVerifiedAt);
  const contactVerifiedBy = contactVerificationConfirmed ? cleanText(actor.id || actor.staffId || actor.sub, 180) : cleanText(existing.contactVerifiedBy, 180);
  const contactVerifiedChannel = contactVerificationConfirmed ? preferredChannel : cleanText(existing.contactVerifiedChannel, 20).toLowerCase();
  const exactContactReference = contactVerificationConfirmed
    ? cleanText(verifiedContactReference, 128)
    : cleanText(existing.verifiedContactReference, 128);
  const allowlisted = input.allowlisted === true || (input.allowlisted === undefined && existing.allowlisted === true);
  const adultAge = ageAt(patient.dateOfBirth, clock);
  const protectedStatus = ["paused", "revoked"].includes(requestedStatus);

  if (!protectedStatus && requestedStatus !== "not-invited") {
    if (patient.patientStatus !== "active") throw apiError(409, "patient_not_active", "only active patients can join the portal pilot");
    if (adultAge === null || adultAge < 18) throw apiError(409, "adult_only", "the first portal pilot is limited to adult patients using self access");
    if (!allowlisted) throw apiError(409, "allowlist_required", "the patient must be explicitly allowlisted for the pilot");
    if (!preferredChannel) throw apiError(409, "verified_channel_required", "choose the verified invitation channel");
    if (!contactVerifiedAt || !contactVerifiedBy || !exactContactReference || contactVerifiedChannel !== preferredChannel) {
      throw apiError(409, "contact_verification_required", "verify exactly one current Patient Registry contact before approval");
    }
    if (consentStatus !== "current" || !consentedAt || !consentEvidenceReference) {
      throw apiError(409, "consent_required", "current portal consent and its protected evidence reference are required");
    }
  }

  let portalInvitedAt = isoDateTime(existing.portalInvitedAt);
  let invitedBy = cleanText(existing.invitedBy, 180);
  if (requestedStatus === "invited" && !portalInvitedAt) {
    if (input.invitationDeliveryConfirmed !== true) {
      throw apiError(409, "invitation_confirmation_required", "confirm the invitation was delivered before marking this patient invited");
    }
    portalInvitedAt = nowIso;
    invitedBy = cleanText(actor.id || actor.staffId || actor.sub, 180);
  }

  return {
    schemaVersion: "bhw.patient-portal-access.v1",
    bhwPatientId: patient.bhwPatientId,
    portalAccessStatus: requestedStatus,
    pilotCohort: PATIENT_PORTAL_PILOT_COHORT,
    programs: ["primary"],
    accessType: "self",
    allowlisted,
    proxyAccessAllowed: false,
    preferredChannel,
    contactVerifiedAt,
    contactVerifiedBy,
    contactVerifiedChannel,
    verifiedContactReference: exactContactReference,
    consentStatus,
    consentedAt,
    consentEvidenceReference,
    consentVersion: PATIENT_PORTAL_CONSENT_VERSION,
    portalInvitedAt,
    invitedBy,
    activatedAt: isoDateTime(existing.activatedAt),
    lastAuthenticatedAt: isoDateTime(existing.lastAuthenticatedAt),
    disabledAt: protectedStatus ? nowIso : "",
    disabledBy: protectedStatus ? cleanText(actor.id || actor.staffId || actor.sub, 180) : "",
    disableReason: protectedStatus ? cleanText(input.disableReason || requestedStatus, 240) : "",
    adultEligibilityConfirmedAt: adultAge !== null && adultAge >= 18 && requestedStatus !== "not-invited" ? nowIso : "",
    adultEligibilityConfirmedBy: adultAge !== null && adultAge >= 18 && requestedStatus !== "not-invited" ? cleanText(actor.id || actor.staffId || actor.sub, 180) : "",
    updatedAt: nowIso,
    updatedBy: cleanText(actor.id || actor.staffId || actor.sub, 180),
  };
}

export function evaluatePatientPortalAccess(access = {}, patient = {}, verifiedChannel = "", now = new Date(), identityReference = "") {
  if (!patient?.bhwPatientId || patient.patientStatus !== "active") return { eligible: false, reason: "patient-not-active" };
  if ((ageAt(patient.dateOfBirth, now) ?? -1) < 18) return { eligible: false, reason: "adult-only" };
  if (access.bhwPatientId !== patient.bhwPatientId) return { eligible: false, reason: "access-record-mismatch" };
  if (!access.allowlisted) return { eligible: false, reason: "not-allowlisted" };
  if (!["invited", "active"].includes(access.portalAccessStatus)) return { eligible: false, reason: "not-invited-or-disabled" };
  if (access.pilotCohort !== PATIENT_PORTAL_PILOT_COHORT || !Array.isArray(access.programs) || !access.programs.includes("primary")) return { eligible: false, reason: "pilot-cohort-mismatch" };
  if (access.accessType !== "self" || access.proxyAccessAllowed !== false) return { eligible: false, reason: "self-access-only" };
  if (!PORTAL_CHANNELS.has(verifiedChannel) || access.preferredChannel !== verifiedChannel) return { eligible: false, reason: "verified-channel-mismatch" };
  if (!pastOrPresentIsoDateTime(access.contactVerifiedAt, now)
    || !cleanText(access.contactVerifiedBy, 180)
    || access.contactVerifiedChannel !== verifiedChannel
    || !exactReferenceMatches(access.verifiedContactReference, identityReference)) return { eligible: false, reason: "contact-not-verified" };
  if (access.consentStatus !== "current" || !pastOrPresentIsoDateTime(access.consentedAt, now) || !cleanText(access.consentEvidenceReference, 500)) return { eligible: false, reason: "consent-not-current" };
  if (!pastOrPresentIsoDateTime(access.portalInvitedAt, now) || !cleanText(access.invitedBy, 180)) return { eligible: false, reason: "invitation-not-recorded" };
  return { eligible: true, reason: "eligible" };
}

export function activatePatientPortalAccess(access = {}, now = new Date()) {
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    ...access,
    portalAccessStatus: "active",
    activatedAt: isoDateTime(access.activatedAt) || nowIso,
    lastAuthenticatedAt: nowIso,
    disabledAt: "",
    disabledBy: "",
    disableReason: "",
    updatedAt: nowIso,
    updatedBy: "care-connect",
  };
}

export function patientPortalAuthorization(access = {}, verifiedChannel = "") {
  return {
    schemaVersion: access.schemaVersion,
    accessType: "self",
    proxyAccessAllowed: false,
    pilotCohort: access.pilotCohort,
    programs: ["primary"],
    portalAccessStatus: access.portalAccessStatus,
    preferredChannel: access.preferredChannel,
    verifiedChannel,
    contactVerifiedAt: access.contactVerifiedAt,
    consentedAt: access.consentedAt,
    portalInvitedAt: access.portalInvitedAt,
    authorizationUpdatedAt: access.updatedAt,
  };
}

export function patientPortalAccessForStaff(access = null) {
  if (!access) return null;
  const { verifiedContactReference, ...safe } = access;
  return { ...safe, exactContactBound: Boolean(verifiedContactReference) };
}

export function patientPortalInvitationPreview() {
  return {
    deliveryStatus: "not-sent",
    emailSubject: "Your secure BHW Medical patient portal",
    message: "BHW Medical: You have been invited to use your secure patient portal. Open https://mybhw.com/patient/ and sign in with the contact method you verified with BHW. For help, call the office.",
  };
}

export function normalizePatientEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function normalizePatientPhone(value) {
  const raw = cleanText(value, 80);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

export function sanitizePatientIdentity(input = {}) {
  const email = normalizePatientEmail(input.verifiedEmail);
  const phone = normalizePatientPhone(input.verifiedPhone);
  if ((email ? 1 : 0) + (phone ? 1 : 0) !== 1) {
    throw apiError(400, "validation_error", "exactly one verified email or phone number is required");
  }
  const dateOfBirth = cleanText(input.dateOfBirth, 40);
  const parsed = new Date(`${dateOfBirth}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== dateOfBirth
    || parsed > new Date()) {
    throw apiError(400, "validation_error", "valid date of birth is required");
  }
  return { email, phone, dateOfBirth };
}

export function patientIdentityReference(identity, secret) {
  if (!secret) throw apiError(503, "patient_identity_not_configured", "patient identity matching is not configured");
  const contact = identity.email || identity.phone;
  return crypto.createHmac("sha256", secret).update(`care-connect:${contact}`).digest("hex");
}

export function selectUniqueActivePatient(candidates, dateOfBirth) {
  const matches = (Array.isArray(candidates) ? candidates : []).filter((patient) => (
    patient?.bhwPatientId
    && patient.patientStatus === "active"
    && patient.dateOfBirth === dateOfBirth
  ));
  return matches.length === 1 ? matches[0] : null;
}
