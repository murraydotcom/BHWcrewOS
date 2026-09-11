const POUNDS_PER_KILOGRAM = 2.2046226218;
const CENTIMETERS_PER_INCH = 2.54;

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function rounded(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function poundsToKilograms(value) {
  const pounds = positiveNumber(value);
  return pounds === null ? null : rounded(pounds / POUNDS_PER_KILOGRAM, 1);
}

export function kilogramsToPounds(value) {
  const kilograms = positiveNumber(value);
  return kilograms === null ? null : rounded(kilograms * POUNDS_PER_KILOGRAM, 1);
}

export function inchesToCentimeters(value) {
  const inches = positiveNumber(value);
  return inches === null ? null : rounded(inches * CENTIMETERS_PER_INCH, 1);
}

export function centimetersToInches(value) {
  const centimeters = positiveNumber(value);
  return centimeters === null ? null : rounded(centimeters / CENTIMETERS_PER_INCH, 1);
}

export function waistToHipRatio(waistCm, hipCm) {
  const waist = positiveNumber(waistCm);
  const hip = positiveNumber(hipCm);
  return waist === null || hip === null ? null : rounded(waist / hip, 3);
}
