import { z } from 'zod';
import { isoDate } from '../../lib/zodFields.js';

// A period is optional; the service fills in the current fiscal year.
const period = {
  from: isoDate('From date').optional(),
  to: isoDate('To date').optional(),
};
const orderedPeriod = (query) => !query.from || !query.to || query.from <= query.to;
const periodError = { message: 'The "from" date must not be after the "to" date', path: ['from'] };

const side = z.enum(['receivable', 'payable'], { error: 'Choose receivable or payable' });
const format = z.enum(['json', 'csv']).default('json');

export const dashboardQuery = z.strictObject(period).refine(orderedPeriod, periodError);

export const activityQuery = z
  .strictObject({ ...period, group: z.enum(['day', 'month']).default('month'), format })
  .refine(orderedPeriod, periodError);

export const outstandingQuery = z.strictObject({ side, q: z.string().trim().max(100).optional(), format });

export const overdueQuery = z.strictObject({ side, format });
