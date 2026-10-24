// Every function takes `businessId` first and EVERY query filters on it. That is the rule that
// keeps businesses apart; a contact id from another business simply does not match.

const COLUMNS = `id, name, is_customer, is_supplier, is_partner, phone, email, address,
                 pan_number, vat_number, notes, archived_at, created_at, updated_at`;

// camelCase API field -> database column. Update statements are built only from this map,
// so request keys can never become SQL.
const UPDATABLE = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  panNumber: 'pan_number',
  vatNumber: 'vat_number',
  notes: 'notes',
};

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

export async function insertContact(db, businessId, userId, data) {
  const { rows } = await db.query(
    `INSERT INTO contacts (business_id, name, is_customer, is_supplier, is_partner,
                           phone, email, address, pan_number, vat_number, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${COLUMNS}`,
    [
      businessId,
      data.name,
      data.types.includes('customer'),
      data.types.includes('supplier'),
      data.types.includes('partner'),
      data.phone ?? null,
      data.email ?? null,
      data.address ?? null,
      data.panNumber ?? null,
      data.vatNumber ?? null,
      data.notes ?? null,
      userId,
    ],
  );
  return rows[0];
}

export async function findContact(db, businessId, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM contacts WHERE business_id = $1 AND id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [businessId, id],
  );
  return rows[0] ?? null;
}

export async function listContacts(db, businessId, { q, type, archived, page, pageSize }) {
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const filter = `
    c.business_id = $1
    AND ($2::text IS NULL OR c.name ILIKE $2 ESCAPE '\\' OR c.phone ILIKE $2 ESCAPE '\\'
         OR c.email::text ILIKE $2 ESCAPE '\\' OR c.pan_number ILIKE $2 ESCAPE '\\'
         OR c.vat_number ILIKE $2 ESCAPE '\\')
    AND ($3::text IS NULL OR CASE $3::text WHEN 'customer' THEN c.is_customer
                                           WHEN 'supplier' THEN c.is_supplier
                                           WHEN 'partner' THEN c.is_partner END)
    AND ($4::text = 'all' OR ($4::text = 'true') = (c.archived_at IS NOT NULL))`;
  const params = [businessId, pattern, type ?? null, archived];

  const [list, count] = await Promise.all([
    db.query(
      `SELECT ${COLUMNS} FROM contacts c WHERE ${filter}
       ORDER BY lower(c.name), c.id LIMIT $5 OFFSET $6`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    db.query(`SELECT count(*)::int AS total FROM contacts c WHERE ${filter}`, params),
  ]);
  return { rows: list.rows, total: count.rows[0].total };
}

export async function updateContact(db, businessId, userId, id, data) {
  const sets = [];
  const values = [businessId, id, userId];
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (data[field] !== undefined) {
      values.push(data[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (data.types !== undefined) {
    values.push(data.types.includes('customer'), data.types.includes('supplier'), data.types.includes('partner'));
    sets.push(`is_customer = $${values.length - 2}`, `is_supplier = $${values.length - 1}`, `is_partner = $${values.length}`);
  }
  const { rows } = await db.query(
    `UPDATE contacts SET ${sets.join(', ')}, updated_by = $3
      WHERE business_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    values,
  );
  return rows[0] ?? null;
}

export async function setArchived(db, businessId, userId, id, archived) {
  const { rows } = await db.query(
    `UPDATE contacts
        SET archived_at = CASE WHEN $4 THEN now() END,
            archived_by = CASE WHEN $4 THEN $3::uuid END,
            updated_by = $3
      WHERE business_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    [businessId, id, userId, archived],
  );
  return rows[0] ?? null;
}
