export function normalizeDecimalPunctuation(raw: string) {
  return raw.replace(/[。．]/g, '.');
}

export function sanitizeDecimalNumberInput(raw: string, { allowNegative = false } = {}) {
  const normalized = normalizeDecimalPunctuation(raw);
  const pattern = allowNegative ? /^-?\d*(?:\.\d*)?$/ : /^\d*(?:\.\d*)?$/;
  return pattern.test(normalized) ? normalized : null;
}
