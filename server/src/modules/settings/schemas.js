import { z } from 'zod';
import { optionalText, rateField } from '../../lib/zodFields.js';

// Document-number prefixes: short, upper-case letters and digits ("SI", "INV").
const prefix = (label) =>
  z
    .string({ error: `${label} prefix must be text` })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, `${label} prefix must be 1 to 6 letters or digits`);

export const updateSettingsBody = z
  .strictObject({
    dateDisplay: z.enum(['BS', 'AD'], { error: 'Choose BS or AD' }).optional(),
    // Whether the business is registered for VAT. Without it, no line can carry VAT.
    isVatRegistered: z.boolean({ error: 'Choose yes or no' }).optional(),
    // No rate is assumed anywhere: this is the business's own default, and each line may use another.
    defaultVatRate: rateField('Default VAT rate').nullable().optional(),
    defaultCreditDays: z.number({ error: 'Credit days must be a whole number' }).int('Credit days must be a whole number').min(0, 'Credit days cannot be negative').max(365, 'Credit days cannot be more than 365').nullable().optional(),
    prefixes: z
      .strictObject({
        sale: prefix('Sales invoice').optional(),
        purchase: prefix('Purchase bill').optional(),
        receipt: prefix('Receipt').optional(),
        payment: prefix('Payment').optional(),
        ledgerEntry: prefix('Ledger entry').optional(),
        openingBalance: prefix('Opening balance').optional(),
      })
      .optional(),
    invoiceFooter: optionalText('Invoice footer', 500),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one setting to change' });

const profileText = (label, max) => optionalText(label, max);

export const updateBusinessBody = z
  .strictObject({
    name: z.string({ error: 'Business name is required' }).trim().min(1, 'Business name is required').max(150, 'Business name must be at most 150 characters').optional(),
    legalName: profileText('Legal name', 150),
    address: profileText('Address', 300),
    phone: profileText('Phone number', 30),
    email: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().toLowerCase().max(254).pipe(z.email({ error: 'Enter a valid email address' })).nullable().optional(),
    ),
    panNumber: profileText('PAN number', 20),
    vatNumber: profileText('VAT number', 20),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to change' });
