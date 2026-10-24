import { z } from 'zod';
import { isValidIsoDate } from '@ledgernepal/shared/dates';
import { fromPaisa, toPaisa } from '@ledgernepal/shared/money';

// Dates the books accept. The fiscal-year logic needs the BS tables, which stop shortly after 2042.
export const BOOKS_DATE_MIN = '1990-01-01';
export const BOOKS_DATE_MAX = '2042-01-01';

/** A calendar date as YYYY-MM-DD (AD), inside the supported range. */
export const isoDate = (label = 'Date') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine(isValidIsoDate, { message: `${label} must be a real date as YYYY-MM-DD` })
    .refine((d) => d >= BOOKS_DATE_MIN && d <= BOOKS_DATE_MAX, { message: `${label} must be between ${BOOKS_DATE_MIN} and ${BOOKS_DATE_MAX}` });

/**
 * A positive NPR amount with at most two decimals, accepted as text or number and normalised to "1250.50".
 * Zero and negative amounts are refused: the direction of an entry carries the sign.
 */
export const positiveAmount = (label = 'Amount') =>
  z.union([z.string(), z.number()], { error: `${label} is required` }).transform((value, ctx) => {
    try {
      const paisa = toPaisa(value);
      if (paisa <= 0n) throw new Error(`${label} must be greater than zero`);
      return fromPaisa(paisa);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: err.message.startsWith('Enter an amount') ? `${label}: ${err.message}` : err.message });
      return z.NEVER;
    }
  });

/** Optional free text: "" and null both mean "no value"; absent means "leave as is". */
export const optionalText = (label, max) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string({ error: `${label} must be text` }).trim().max(max, `${label} must be at most ${max} characters`).nullable().optional(),
  );
