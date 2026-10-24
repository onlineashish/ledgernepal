import { z } from 'zod';

export const CONTACT_TYPES = ['customer', 'supplier', 'partner'];

// Optional free-text field: "" and null both mean "no value". Absent means "leave as is" on update.
const optionalText = (label, max) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string({ error: `${label} must be text` }).trim().max(max, `${label} must be at most ${max} characters`).nullable().optional(),
  );

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string({ error: 'Email must be text' })
    .trim()
    .toLowerCase()
    .max(254, 'Email is too long')
    .pipe(z.email({ error: 'Enter a valid email address' }))
    .nullable()
    .optional(),
);

const types = z
  .array(z.enum(CONTACT_TYPES, { error: 'Contact type must be customer, supplier or partner' }), {
    error: 'Choose at least one contact type',
  })
  .min(1, 'Choose at least one contact type')
  .transform((list) => [...new Set(list)]);

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(150, 'Name must be at most 150 characters');

// Only these fields are accepted. Anything else (business_id, createdBy, archivedAt ...) is a 400.
const fields = {
  phone: optionalText('Phone number', 30),
  email: optionalEmail,
  address: optionalText('Address', 300),
  panNumber: optionalText('PAN number', 20),
  vatNumber: optionalText('VAT number', 20),
  notes: optionalText('Notes', 2000),
};

export const createContactBody = z.strictObject({ name, types, ...fields });

export const updateContactBody = z
  .strictObject({ name: name.optional(), types: types.optional(), ...fields })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to change' });

export const contactIdParams = z.strictObject({ id: z.uuid({ error: 'Invalid contact id' }) });

export const listContactsQuery = z.strictObject({
  q: z.string().trim().max(100, 'Search text is too long').optional(),
  type: z.enum(CONTACT_TYPES).optional(),
  archived: z.enum(['false', 'true', 'all']).default('false'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
