// Date rules shared by server and client (plan.md §5.8).
//
// CANONICAL form is an AD ISO string "YYYY-MM-DD" (what PostgreSQL DATE columns and the API use).
// Bikram Sambat (BS) exists only at the edges: converting user input and formatting for display.
// Nothing here uses the local timezone; all calendar math is on plain year/month/day values.
import DateConverter from '@remotemerge/nepali-date-converter';

export class DateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DateError';
  }
}

export const BS_MONTHS = Object.freeze([
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
]);

// Range covered by the conversion tables: 1975-01-01 BS .. 2099-12-30 BS.
export const MIN_AD = '1918-04-13';
export const MAX_AD = '2043-04-13';
export const MIN_BS_YEAR = 1975;
export const MAX_BS_YEAR = 2099;

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45; // UTC+05:45, no daylight saving

const pad = (n, width = 2) => String(n).padStart(width, '0');

// ----------------------------------------------------------------------------- AD helpers

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Adds (or subtracts) whole days to an ISO date. Pure calendar math, no timezones. */
export function addDays(iso, days) {
  assertIso(iso);
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a, b) {
  assertIso(a);
  assertIso(b);
  const toUtc = (iso) => Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Today's date in Nepal (UTC+05:45) as an ISO string. `now` is injectable for tests. */
export function todayInNepal(now = new Date()) {
  const shifted = new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

// ----------------------------------------------------------------------------- AD <-> BS

/** "2024-04-13" -> { year: 2081, month: 1, day: 1 } */
export function adToBs(iso) {
  assertIso(iso);
  if (iso < MIN_AD || iso > MAX_AD) {
    throw new DateError(`Date is outside the supported range (${MIN_AD} to ${MAX_AD})`);
  }
  try {
    const r = new DateConverter(iso).toBs();
    return { year: r.year, month: r.month, day: r.date };
  } catch {
    throw new DateError('Could not convert this date to Bikram Sambat');
  }
}

/** { year: 2081, month: 1, day: 1 } -> "2024-04-13". Rejects days that don't exist in that BS month. */
export function bsToAd({ year, month, day }) {
  if (![year, month, day].every(Number.isInteger)) throw new DateError('Enter a valid BS date');
  if (year < MIN_BS_YEAR || year > MAX_BS_YEAR) {
    throw new DateError(`BS year must be between ${MIN_BS_YEAR} and ${MAX_BS_YEAR}`);
  }
  if (month < 1 || month > 12) throw new DateError('BS month must be between 1 and 12');
  if (day < 1 || day > 32) throw new DateError('That day does not exist in this BS month');

  let ad;
  try {
    const r = new DateConverter(`${pad(year, 4)}-${pad(month)}-${pad(day)}`).toAd();
    ad = `${pad(r.year, 4)}-${pad(r.month)}-${pad(r.date)}`;
  } catch {
    throw new DateError('That day does not exist in this BS month');
  }
  // Belt and braces: the date must convert back to exactly what was entered.
  const back = adToBs(ad);
  if (back.year !== year || back.month !== month || back.day !== day) {
    throw new DateError('That day does not exist in this BS month');
  }
  return ad;
}

/** Number of days (29-32) in a BS month. */
export function bsMonthLength(year, month) {
  for (let day = 32; day >= 28; day -= 1) {
    try {
      bsToAd({ year, month, day });
      return day;
    } catch {
      // try a shorter month length
    }
  }
  throw new DateError('Unsupported BS month');
}

// ----------------------------------------------------------------------------- formatting & input

/** Formats an ISO (AD) date for display in the chosen calendar: "AD" -> 2024-04-13, "BS" -> 2081-01-01. */
export function formatDate(iso, calendar = 'AD') {
  if (calendar === 'AD') {
    assertIso(iso);
    return iso;
  }
  if (calendar === 'BS') {
    const { year, month, day } = adToBs(iso);
    return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  }
  throw new DateError('Calendar must be "AD" or "BS"');
}

/** "2081-01-01" style BS date in words: "1 Baisakh 2081". */
export function formatBsLong(iso) {
  const { year, month, day } = adToBs(iso);
  return `${day} ${BS_MONTHS[month - 1]} ${year}`;
}

/**
 * Parses what a user typed in the chosen calendar into a canonical AD ISO date.
 * Accepts YYYY-MM-DD with "-", "/" or "." separators and 1- or 2-digit month/day.
 */
export function parseDateInput(text, calendar = 'AD') {
  if (typeof text !== 'string') throw new DateError('Enter a date as YYYY-MM-DD');
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text.trim());
  if (!match) throw new DateError('Enter a date as YYYY-MM-DD');
  const [year, month, day] = match.slice(1).map(Number);

  if (calendar === 'BS') return bsToAd({ year, month, day });
  if (calendar === 'AD') {
    const iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
    if (!isValidIsoDate(iso)) throw new DateError('That date does not exist');
    return iso;
  }
  throw new DateError('Calendar must be "AD" or "BS"');
}

// ----------------------------------------------------------------------------- BS months & fiscal years

/** AD start/end (inclusive) of a BS calendar month, e.g. for "monthly sales" in BS. */
export function bsMonthRange(year, month) {
  const start = bsToAd({ year, month, day: 1 });
  const end = bsToAd({ year, month, day: bsMonthLength(year, month) });
  return { start, end };
}

/**
 * Nepal's fiscal year runs from Shrawan 1 to the last day of Ashadh the next BS year.
 * `startYear` is the BS year in which it begins: 2081 -> FY "2081/82".
 */
export function fiscalYear(startYear) {
  const start = bsToAd({ year: startYear, month: 4, day: 1 });
  const end = bsToAd({ year: startYear + 1, month: 3, day: bsMonthLength(startYear + 1, 3) });
  return { startYear, label: `${startYear}/${pad((startYear + 1) % 100)}`, start, end };
}

/** The fiscal year that contains an ISO (AD) date. */
export function fiscalYearOf(iso) {
  const { year, month } = adToBs(iso);
  return fiscalYear(month >= 4 ? year : year - 1);
}

// ----------------------------------------------------------------------------- internal

function assertIso(value) {
  if (!isValidIsoDate(value)) throw new DateError('Enter a valid date (YYYY-MM-DD)');
}
