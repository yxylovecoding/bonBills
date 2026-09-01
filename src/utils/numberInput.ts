export function normalizeDecimalPunctuation(raw: string) {
  return raw.replace(/[。．]/g, '.');
}

export const SITE_DECIMAL_PLACES = 2;

function roundToPrecision(value: number, decimalPlaces: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimalPlaces;
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
  return value < 0 ? -rounded : rounded;
}

export function roundToSitePrecision(value: number) {
  return roundToPrecision(value, SITE_DECIMAL_PLACES);
}

export function normalizeSitePrecisionForDisplay(raw: string, decimalPlaces = SITE_DECIMAL_PLACES) {
  const normalized = normalizeDecimalPunctuation(raw);
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return normalized;
  const fraction = normalized.split('.')[1] ?? '';
  return fraction.length > decimalPlaces
    ? String(roundToPrecision(Number(normalized), decimalPlaces))
    : normalized;
}

export function sanitizeDecimalNumberInput(raw: string, { allowNegative = false } = {}) {
  const normalized = normalizeDecimalPunctuation(raw);
  const pattern = allowNegative
    ? new RegExp(`^-?\\d*(?:\\.\\d{0,${SITE_DECIMAL_PLACES}})?$`)
    : new RegExp(`^\\d*(?:\\.\\d{0,${SITE_DECIMAL_PLACES}})?$`);
  return pattern.test(normalized) ? normalized : null;
}
