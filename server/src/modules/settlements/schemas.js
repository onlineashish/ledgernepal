import { z } from 'zod';
import { isoDate, optionalText, positiveAmount } from '../../lib/zodFields.js';

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'esewa', 'khalti', 'other'];

const allocation = z.strictObject({
  invoiceId: z.uuid({ error: 'Choose a document' }),
  amount: positiveAmount('Allocated amount'),
});
const allocations = z.array(allocation, { error: 'Allocations must be a list' }).max(200, 'At most 200 documents at once');

const reason = z.string({ error: 'Give a reason' }).trim().min(3, 'Give a reason (at least 3 characters)').max(300, 'The reason must be at most 300 characters');

export const createSettlementBody = z
  .strictObject({
    contactId: z.uuid({ error: 'Choose a contact' }),
    txnDate: isoDate('Date'),
    amount: positiveAmount('Amount'),
    method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid: cash, bank transfer, cheque, eSewa, Khalti or other' }),
    externalRef: optionalText('Reference', 60), // cheque number, bank or eSewa transaction id ...
    description: optionalText('Description', 500),
    notes: optionalText('Notes', 2000),
    // Either name the documents it settles, or ask to apply it oldest-first, or leave it as an advance.
    allocations: allocations.optional(),
    autoAllocate: z.boolean({ error: 'autoAllocate must be true or false' }).optional(),
  })
  .refine((body) => !(body.autoAllocate && body.allocations?.length), {
    message: 'Choose either specific documents or "apply oldest first", not both',
    path: ['allocations'],
  });

export const setAllocationsBody = z.strictObject({ allocations });

export const updateTextBody = z
  .strictObject({ description: optionalText('Description', 500), notes: optionalText('Notes', 2000), externalRef: optionalText('Reference', 60) })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to change' });

export const voidBody = z.strictObject({ reason });
export const idParams = z.strictObject({ id: z.uuid({ error: 'Invalid id' }) });

export const listSettlementsQuery = z
  .strictObject({
    contactId: z.uuid({ error: 'Invalid contact id' }).optional(),
    from: isoDate('From date').optional(),
    to: isoDate('To date').optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    status: z.enum(['posted', 'voided', 'all']).default('posted'),
    allocation: z.enum(['all', 'unallocated']).default('all'), // "unallocated" = advances
    q: z.string().trim().max(100, 'Search text is too long').optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { message: 'The "from" date must not be after the "to" date', path: ['from'] });

export const openDocumentsQuery = z.strictObject({ contactId: z.uuid({ error: 'Choose a contact' }) });
