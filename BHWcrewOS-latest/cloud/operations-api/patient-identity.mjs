import crypto from "node:crypto";
import { apiError, cleanText } from "./schema.mjs";

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
