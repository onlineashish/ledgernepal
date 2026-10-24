import { describe, expect, it } from 'vitest';
import {
  BS_MONTHS,
  DateError,
  MAX_AD,
  MIN_AD,
  addDays,
  adToBs,
  bsMonthLength,
  bsMonthRange,
  bsToAd,
  daysBetween,
  fiscalYear,
  fiscalYearOf,
  formatBsLong,
  formatDate,
  isValidIsoDate,
  parseDateInput,
  todayInNepal,
} from '../dates.js';

// Nepali New Year (1 Baisakh) as published in the official calendar. These anchor the
// conversion library to the real calendar; everything else is checked for consistency against them.
const NEW_YEAR_AD = {
  2075: '2018-04-14',
  2076: '2019-04-14',
  2077: '2020-04-13',
  2078: '2021-04-14',
  2079: '2022-04-14',
  2080: '2023-04-14',
  2081: '2024-04-13',
  2082: '2025-04-14',
};

describe('known reference dates', () => {
  it.each(Object.entries(NEW_YEAR_AD))('1 Baisakh %s BS = %s AD (both directions)', (bsYear, ad) => {
    expect(bsToAd({ year: Number(bsYear), month: 1, day: 1 })).toBe(ad);
    expect(adToBs(ad)).toEqual({ year: Number(bsYear), month: 1, day: 1 });
  });

  it('the day before New Year is the last day of Chaitra', () => {
    expect(adToBs('2024-04-12')).toEqual({ year: 2080, month: 12, day: bsMonthLength(2080, 12) });
    expect(adToBs('2025-04-13')).toEqual({ year: 2081, month: 12, day: bsMonthLength(2081, 12) });
  });

  it('BS year lengths match the real gap between published New Year dates', () => {
    for (let y = 2075; y < 2082; y += 1) {
      let days = 0;
      for (let m = 1; m <= 12; m += 1) days += bsMonthLength(y, m);
      expect(days, `BS ${y}`).toBe(daysBetween(NEW_YEAR_AD[y], NEW_YEAR_AD[y + 1]));
      expect([365, 366]).toContain(days);
    }
  });
});

describe('every supported day', () => {
  it('round-trips AD -> BS -> AD and advances one BS day per AD day, across the whole range', () => {
    let iso = MIN_AD;
    let prev = null;
    let count = 0;
    while (iso <= MAX_AD) {
      const bs = adToBs(iso);
      expect(bsToAd(bs)).toBe(iso);

      if (prev) {
        const sameMonth = bs.year === prev.year && bs.month === prev.month && bs.day === prev.day + 1;
        const nextMonth = bs.year === prev.year && bs.month === prev.month + 1 && bs.day === 1;
        const nextYear = bs.year === prev.year + 1 && bs.month === 1 && prev.month === 12 && bs.day === 1;
        if (!(sameMonth || nextMonth || nextYear)) {
          throw new Error(`Calendar jumped from ${JSON.stringify(prev)} to ${JSON.stringify(bs)} at ${iso}`);
        }
      }
      prev = bs;
      iso = addDays(iso, 1);
      count += 1;
    }
    expect(count).toBeGreaterThan(45_000);
  });

  it('every BS month has 29 to 32 days', () => {
    for (let y = 1975; y <= 2099; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const len = bsMonthLength(y, m);
        expect(len, `${y}-${m}`).toBeGreaterThanOrEqual(29);
        expect(len, `${y}-${m}`).toBeLessThanOrEqual(32);
      }
    }
  });
});

describe('invalid and out-of-range dates', () => {
  it('rejects BS days that do not exist', () => {
    const len = bsMonthLength(2081, 2);
    expect(() => bsToAd({ year: 2081, month: 2, day: len + 1 })).toThrow(DateError);
    expect(() => bsToAd({ year: 2081, month: 2, day: 0 })).toThrow(DateError);
    expect(() => bsToAd({ year: 2081, month: 13, day: 1 })).toThrow(DateError);
    expect(() => bsToAd({ year: 2081, month: 0, day: 1 })).toThrow(DateError);
    expect(() => bsToAd({ year: 2081.5, month: 1, day: 1 })).toThrow(DateError);
  });

  it('rejects BS years outside the supported tables', () => {
    expect(() => bsToAd({ year: 1974, month: 12, day: 1 })).toThrow(/between 1975 and 2099/);
    expect(() => bsToAd({ year: 2100, month: 1, day: 1 })).toThrow(/between 1975 and 2099/);
  });

  it('rejects AD dates that do not exist or are outside the range', () => {
    expect(() => adToBs('2023-02-30')).toThrow(DateError);
    expect(() => adToBs('2023-02-29')).toThrow(DateError); // 2023 is not a leap year
    expect(() => adToBs('2023-13-01')).toThrow(DateError);
    expect(() => adToBs('1918-04-12')).toThrow(/supported range/);
    expect(() => adToBs('2043-04-14')).toThrow(/supported range/);
    expect(() => adToBs('not-a-date')).toThrow(DateError);
    expect(() => adToBs(null)).toThrow(DateError);
  });

  it('knows leap days: 29 Feb 2024 exists, 29 Feb 2023 and 2100 do not', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(adToBs('2024-02-29')).toEqual({ year: 2080, month: 11, day: 17 });
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('2100-02-29')).toBe(false); // century rule
    expect(isValidIsoDate('2000-02-29')).toBe(true);
  });
});

describe('formatting and parsing user input', () => {
  it('formats ISO dates in the chosen calendar', () => {
    expect(formatDate('2024-04-13', 'AD')).toBe('2024-04-13');
    expect(formatDate('2024-04-13', 'BS')).toBe('2081-01-01');
    expect(formatBsLong('2024-04-13')).toBe('1 Baisakh 2081');
    expect(() => formatDate('2024-04-13', 'XX')).toThrow(DateError);
  });

  it('has the twelve BS month names in order', () => {
    expect(BS_MONTHS).toHaveLength(12);
    expect(BS_MONTHS[0]).toBe('Baisakh');
    expect(BS_MONTHS[3]).toBe('Shrawan');
    expect(BS_MONTHS[11]).toBe('Chaitra');
  });

  it.each([
    ['2081-01-01', 'BS', '2024-04-13'],
    ['2081/1/1', 'BS', '2024-04-13'],
    ['2081.01.01', 'BS', '2024-04-13'],
    ['  2081-01-01 ', 'BS', '2024-04-13'],
    ['2024-04-13', 'AD', '2024-04-13'],
    ['2024/4/3', 'AD', '2024-04-03'],
  ])('parses %j as %s -> %s', (text, calendar, expected) => {
    expect(parseDateInput(text, calendar)).toBe(expected);
  });

  it.each([
    ['', 'AD'], ['13/04/2024', 'AD'], ['2024-4', 'AD'], ['2023-02-29', 'AD'], ['2024-13-01', 'AD'],
    ['2081-02-33', 'BS'], ['2081-13-01', 'BS'], ['2100-01-01', 'BS'], ['abcd-ef-gh', 'BS'],
  ])('rejects %j (%s)', (text, calendar) => {
    expect(() => parseDateInput(text, calendar)).toThrow(DateError);
  });

  it('refuses to guess the calendar', () => {
    expect(() => parseDateInput('2081-01-01', 'bs')).toThrow(DateError);
  });

  it('round-trips what the user sees: format then parse', () => {
    for (const iso of ['2020-02-29', '2024-04-13', '2025-04-13', '2026-07-16', '2030-12-31']) {
      for (const cal of ['AD', 'BS']) {
        expect(parseDateInput(formatDate(iso, cal), cal)).toBe(iso);
      }
    }
  });
});

describe('plain date arithmetic', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDays('2024-05-10', 30)).toBe('2024-06-09');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2024-01-01', '2024-01-01')).toBe(0);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(daysBetween('2025-01-01', '2024-01-01')).toBe(-366);
  });
});

describe('todayInNepal (UTC+05:45)', () => {
  it.each([
    ['2026-10-24T12:00:00Z', '2026-10-24'],
    ['2026-10-24T18:14:59Z', '2026-10-24'], // 23:59:59 in Kathmandu
    ['2026-10-24T18:15:00Z', '2026-10-25'], // midnight in Kathmandu
    ['2026-12-31T18:15:00Z', '2027-01-01'], // year rollover
    ['2024-02-28T18:15:00Z', '2024-02-29'], // leap day
  ])('%s -> %s', (utc, expected) => {
    expect(todayInNepal(new Date(utc))).toBe(expected);
  });
});

describe('BS months', () => {
  it('returns the AD range of a BS month, inclusive', () => {
    const { start, end } = bsMonthRange(2081, 1);
    expect(start).toBe('2024-04-13');
    expect(adToBs(end)).toEqual({ year: 2081, month: 1, day: bsMonthLength(2081, 1) });
    expect(adToBs(addDays(end, 1))).toEqual({ year: 2081, month: 2, day: 1 });
  });

  it('months of a year tile the year with no gaps or overlaps', () => {
    let expectedStart = NEW_YEAR_AD[2080];
    for (let m = 1; m <= 12; m += 1) {
      const { start, end } = bsMonthRange(2080, m);
      expect(start).toBe(expectedStart);
      expectedStart = addDays(end, 1);
    }
    expect(expectedStart).toBe(NEW_YEAR_AD[2081]);
  });
});

describe('fiscal year (Shrawan 1 to Ashadh end)', () => {
  it('starts on Shrawan 1 and ends on the last day of Ashadh the next BS year', () => {
    const fy = fiscalYear(2081);
    expect(fy.label).toBe('2081/82');
    expect(adToBs(fy.start)).toEqual({ year: 2081, month: 4, day: 1 });
    expect(adToBs(fy.end)).toEqual({ year: 2082, month: 3, day: bsMonthLength(2082, 3) });
    expect(adToBs(addDays(fy.end, 1))).toEqual({ year: 2082, month: 4, day: 1 });
  });

  it('consecutive fiscal years are contiguous with no gap or overlap', () => {
    for (let y = 2070; y < 2095; y += 1) {
      expect(addDays(fiscalYear(y).end, 1), `FY ${y}`).toBe(fiscalYear(y + 1).start);
    }
  });

  it('each fiscal year is 365 or 366 days', () => {
    for (let y = 2070; y < 2095; y += 1) {
      const fy = fiscalYear(y);
      expect([365, 366]).toContain(daysBetween(fy.start, fy.end) + 1);
    }
  });

  it('finds the fiscal year containing a date, including both sides of the boundary', () => {
    const fy = fiscalYear(2081);
    expect(fiscalYearOf(fy.start).label).toBe('2081/82');
    expect(fiscalYearOf(fy.end).label).toBe('2081/82');
    expect(fiscalYearOf(addDays(fy.start, -1)).label).toBe('2080/81');
    expect(fiscalYearOf(addDays(fy.end, 1)).label).toBe('2082/83');
    // Baisakh-Ashadh belong to the fiscal year that began the previous BS year
    expect(fiscalYearOf('2024-04-13').label).toBe('2080/81'); // 1 Baisakh 2081
    expect(fiscalYearOf('2024-10-01').label).toBe('2081/82'); // Ashwin 2081
  });

  it('labels the century boundary correctly', () => {
    expect(fiscalYear(2099 - 1).label).toBe('2098/99');
  });

  it('reports a clear error when the year is beyond the supported tables', () => {
    expect(() => fiscalYear(2099)).toThrow(DateError);
  });
});
