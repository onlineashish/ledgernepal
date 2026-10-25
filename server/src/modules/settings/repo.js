// Business profile and settings. Scoped by business_id like everything else.

export async function getAll(db, businessId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT b.name, b.legal_name, b.address, b.phone, b.email, b.pan_number, b.vat_number, b.is_vat_registered,
            s.date_display, s.default_vat_rate, s.default_credit_days, s.invoice_footer,
            s.sale_prefix, s.purchase_prefix, s.receipt_prefix, s.payment_prefix, s.ledger_prefix, s.opening_prefix
       FROM businesses b JOIN business_settings s ON s.business_id = b.id
      WHERE b.id = $1 ${forUpdate ? 'FOR UPDATE OF b, s' : ''}`,
    [businessId],
  );
  return rows[0] ?? null;
}

// API field -> column. Statements are built only from these maps, so request keys can never become SQL.
const SETTINGS_COLUMNS = {
  dateDisplay: 'date_display',
  defaultVatRate: 'default_vat_rate',
  defaultCreditDays: 'default_credit_days',
  invoiceFooter: 'invoice_footer',
};
const PREFIX_COLUMNS = {
  sale: 'sale_prefix',
  purchase: 'purchase_prefix',
  receipt: 'receipt_prefix',
  payment: 'payment_prefix',
  ledgerEntry: 'ledger_prefix',
  openingBalance: 'opening_prefix',
};
const PROFILE_COLUMNS = {
  name: 'name',
  legalName: 'legal_name',
  address: 'address',
  phone: 'phone',
  email: 'email',
  panNumber: 'pan_number',
  vatNumber: 'vat_number',
};

export async function updateSettings(db, businessId, userId, changes) {
  const sets = [];
  const values = [businessId, userId];
  const add = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  for (const [field, column] of Object.entries(SETTINGS_COLUMNS)) if (changes[field] !== undefined) add(column, changes[field]);
  for (const [field, column] of Object.entries(PREFIX_COLUMNS)) if (changes.prefixes?.[field] !== undefined) add(column, changes.prefixes[field]);
  if (sets.length > 0) {
    await db.query(`UPDATE business_settings SET ${sets.join(', ')}, updated_by = $2 WHERE business_id = $1`, values);
  }
  if (changes.isVatRegistered !== undefined) {
    await db.query('UPDATE businesses SET is_vat_registered = $2 WHERE id = $1', [businessId, changes.isVatRegistered]);
  }
}

export async function updateProfile(db, businessId, changes) {
  const sets = [];
  const values = [businessId];
  for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
    if (changes[field] !== undefined) {
      values.push(changes[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  await db.query(`UPDATE businesses SET ${sets.join(', ')} WHERE id = $1`, values);
}
