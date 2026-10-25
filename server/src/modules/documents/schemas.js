import { z } from 'zod';
import { MAX_LINES } from '@ledgernepal/shared/invoice';
import { amountField, isoDate, optionalText, quantityField, rateField } from '../../lib/zodFields.js';

const reason = z.string({ error: 'Give a reason' }).trim().min(3, 'Give a reason (at least 3 characters)').max(300, 'The reason must be at most 300 characters');

const line = z.strictObject({
  description: z.string({ error: 'Describe the item' }).trim().min(1, 'Describe the item').max(300, 'The description must be at most 300 characters'),
  quantity: quantityField('Quantity'),
  unit: optionalText('Unit', 20),
  unitPrice: amountField('Unit price'),
  discount: amountField('Discount').optional(), // a discount on this line, in rupees
  // Does VAT apply to this line? Needs the business to be VAT-registered. The rate is the line's own,
  // or the business default; nothing is assumed.
  taxable: z.boolean({ error: 'Choose whether VAT applies' }).default(false),
  taxRate: rateField('VAT rate').nullable().optional(),
});

const header = {
  contactId: z.uuid({ error: 'Choose a contact' }),
  txnDate: isoDate('Date'),
  dueDate: isoDate('Due date').nullable().optional(),
  externalRef: optionalText('Reference', 60), // supplier's bill number, customer's PO number ...
  notes: optionalText('Notes', 2000),
  lines: z.array(line, { error: 'Add at least one line' }).min(1, 'Add at least one line').max(MAX_LINES, `A document can have at most ${MAX_LINES} lines`),
  invoiceDiscount: amountField('Invoice discount').optional(), // spread over the lines before VAT
};

export const createDocumentBody = z.strictObject({ ...header, post: z.boolean().default(false) });

// Everything optional. Drafts accept any of it; a posted document only accepts notes and externalRef
// (the service refuses the rest with an explanation).
export const updateDocumentBody = z
  .strictObject({
    contactId: header.contactId.optional(),
    txnDate: header.txnDate.optional(),
    dueDate: header.dueDate,
    externalRef: header.externalRef,
    notes: header.notes,
    lines: header.lines.optional(),
    invoiceDiscount: header.invoiceDiscount,
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to change' });

export const voidDocumentBody = z.strictObject({ reason });
export const documentIdParams = z.strictObject({ id: z.uuid({ error: 'Invalid id' }) });

export const listDocumentsQuery = z
  .strictObject({
    contactId: z.uuid({ error: 'Invalid contact id' }).optional(),
    from: isoDate('From date').optional(),
    to: isoDate('To date').optional(),
    status: z.enum(['draft', 'posted', 'voided', 'all']).default('all'),
    // How much has been paid (posted documents only): not at all, in part, in full, not yet in full, or past the due date.
    payment: z.enum(['all', 'unpaid', 'partial', 'paid', 'open', 'overdue']).default('all'),
    q: z.string().trim().max(100, 'Search text is too long').optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { message: 'The "from" date must not be after the "to" date', path: ['from'] });
