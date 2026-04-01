export function normalizeLocale(locale?: string) {
  if (!locale) return undefined;
  if (locale === 'pt-PT') return 'pt-PT';
  if (locale === 'pt-BR') return 'pt-BR';
  if (locale === 'es') return 'es-ES';
  return locale;
}

export function formatDateOnly(value: string | Date, locale?: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date, locale?: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatCurrencyCents(
  cents: number,
  options?: { locale?: string; currency?: string },
) {
  const { locale, currency = 'EUR' } = options || {};
  return new Intl.NumberFormat(normalizeLocale(locale), {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export function formatDecimal(value: number, options?: { locale?: string; digits?: number }) {
  const { locale, digits = 2 } = options || {};
  return new Intl.NumberFormat(normalizeLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCentsAsDecimal(cents: number, options?: { locale?: string; digits?: number }) {
  return formatDecimal(cents / 100, options);
}

/** Dot-based fixed decimal string for numeric inputs. */
export function formatFixedInput(value: number, digits = 2) {
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  return value.toFixed(digits);
}
