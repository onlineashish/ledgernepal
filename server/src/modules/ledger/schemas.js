import { z } from 'zod';
import { DIRECTION_KEYS, OPENING_SIDE_KEYS } from '@ledgernepal/shared/ledger';
import { isoDate, optionalText, positiveAmount } from '../../lib/zodFields.js';

const direction = z.enum(DIRECTION_KEYS, { error: 'Choose "You gave" or "You got"' });
const reason = z
  .string({ error: 'Give a reason' })
  .trim()
  .min(3, 'Give a reason (at least 3 characters)')
  .max(300, 'The reason must be at most 300 characters');

const description = optionalText('Description', 500);
const externalRef = optionalText('Reference number', 60);
const notes = optionalText('Notes', 2000);

export const createEntryBody = z.strictObject({
  contactId: z.uuid({ error: 'Choose a contact' }),
  txnDate: isoDate('Transaction date'),
  direction,
  amount: positiveAmount('Amount'),
  description,
  externalRef,
});

// Everything optional: whatever is left out keeps the original entry's value.
export const correctEntryBody = z.strictObject({
  txnDate: isoDate('Transaction date').optional(),
  direction: direction.optional(),
  amount: positiveAmount('Amount').optional(),
  description,
  externalRef,
  reason,
});

export const voidEntryBody = z.strictObject({ reason });

// Posted entries keep their amounts and dates forever; only these descriptive fields may be edited.
export const updateEntryTextBody = z
  .strictObject({ description, externalRef, notes })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to change' });

export const openingBalanceBody = z.strictObject({
  amount: positiveAmount('Opening balance'),
  side: z.enum(OPENING_SIDE_KEYS, { error: 'Say who owes whom: "they owe me" or "I owe them"' }),
  asOfDate: isoDate('As-of date').optional(),
});

export const entryIdParams = z.strictObject({ id: z.uuid({ error: 'Invalid entry id' }) });
export const contactIdParams = z.strictObject({ contactId: z.uuid({ error: 'Invalid contact id' }) });

const pagination = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

export const contactLedgerQuery = z
  .strictObject({
    from: isoDate('From date').optional(),
    to: isoDate('To date').optional(),
    q: z.string().trim().max(100, 'Search text is too long').optional(),
    ...pagination,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { message: 'The "from" date must not be after the "to" date', path: ['from'] });

export const listEntriesQuery = z
  .strictObject({
    contactId: z.uuid({ error: 'Invalid contact id' }).optional(),
    from: isoDate('From date').optional(),
    to: isoDate('To date').optional(),
    status: z.enum(['posted', 'voided', 'all']).default('posted'),
    type: z.enum(['ledger_entry', 'opening_balance', 'sale', 'purchase', 'receipt', 'payment', 'all']).default('all'),
    q: z.string().trim().max(100, 'Search text is too long').optional(),
    ...pagination,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { message: 'The "from" date must not be after the "to" date', path: ['from'] });
