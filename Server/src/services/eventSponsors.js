// Server/src/services/eventSponsors.js
// ─────────────────────────────────────────────────────────────────────
// CRUD + CSV import for the per-institution sponsorship breakdown behind an
// event's Total Sponsorship figure. See addEventInstitutionSponsors.js for
// the schema note on why events.total_sponsorship stays as a fallback.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
const { parseSponsorCsv } = require('./sponsorCsvImport');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function camelItem(row) {
  return {
    id: row.id,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    country: row.country,
    amountOriginal: row.amount_original != null ? Number(row.amount_original) : null,
    currency: row.currency,
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : null,
    amountVnd: Number(row.amount_vnd),
    isFree: row.is_free,
    standeeProvided: row.standee_provided,
    note: row.note,
  };
}

// getSponsors(eventId) -> { items, totalVnd }
async function getSponsors(eventId) {
  const r = await pool.query(
    `SELECT s.id, s.institution_id, i.name AS institution_name, i.country,
            s.amount_original, s.currency, s.exchange_rate, s.amount_vnd, s.is_free, s.standee_provided, s.note
       FROM event_institution_sponsors s
       JOIN institutions i ON i.id = s.institution_id
      WHERE s.event_id = $1
      ORDER BY i.country NULLS LAST, i.name`,
    [eventId]
  );
  const items = r.rows.map(camelItem);
  const totalVnd = items.reduce((sum, it) => sum + it.amountVnd, 0);
  return { items, totalVnd };
}

// Resolve an institution by name (case-insensitive), creating it if it
// doesn't exist yet — mirrors POST /institutions in eventConsole.js.
async function resolveInstitutionId(client, name, country) {
  const existing = await client.query(`SELECT id FROM institutions WHERE LOWER(name) = LOWER($1)`, [name]);
  if (existing.rowCount > 0) return existing.rows[0].id;
  const ins = await client.query(
    `INSERT INTO institutions (name, country) VALUES ($1, $2) RETURNING id`,
    [name, country || null]
  );
  return ins.rows[0].id;
}

async function addItem(eventId, item) {
  const { institutionName, country, amountOriginal, currency, exchangeRate, amountVnd, isFree, standeeProvided, note } = item;
  if (!institutionName) throw new Error('institutionName is required');
  const client = await pool.connect();
  try {
    const institutionId = await resolveInstitutionId(client, institutionName, country);
    const r = await client.query(
      `INSERT INTO event_institution_sponsors
         (event_id, institution_id, amount_original, currency, exchange_rate, amount_vnd, is_free, standee_provided, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, institution_id`,
      [eventId, institutionId, isFree ? null : amountOriginal ?? null, isFree ? null : currency || null,
       isFree ? null : exchangeRate ?? null, isFree ? 0 : amountVnd ?? 0, !!isFree, !!standeeProvided, note || null]
    );
    return r.rows[0].id;
  } finally {
    client.release();
  }
}

async function updateItem(eventId, itemId, item) {
  const { amountOriginal, currency, exchangeRate, amountVnd, isFree, standeeProvided, note } = item;
  const r = await pool.query(
    `UPDATE event_institution_sponsors
        SET amount_original = $3, currency = $4, exchange_rate = $5, amount_vnd = $6,
            is_free = $7, standee_provided = $8, note = $9, updated_at = NOW()
      WHERE id = $1 AND event_id = $2
      RETURNING id`,
    [itemId, eventId, isFree ? null : amountOriginal ?? null, isFree ? null : currency || null,
     isFree ? null : exchangeRate ?? null, isFree ? 0 : amountVnd ?? 0, !!isFree, !!standeeProvided, note || null]
  );
  return r.rowCount > 0;
}

async function deleteItem(eventId, itemId) {
  const r = await pool.query(`DELETE FROM event_institution_sponsors WHERE id = $1 AND event_id = $2`, [itemId, eventId]);
  return r.rowCount > 0;
}

// importSponsorsCsv(eventId, csvText) — REPLACES the full sponsor list for
// this event with what's in the file (matches the budget importer's
// replace-on-upload behavior for the same reason: this is a full snapshot
// export of "who's sponsoring this event", not an incremental diff).
async function importSponsorsCsv(eventId, csvText) {
  const parsedItems = parseSponsorCsv(csvText);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM event_institution_sponsors WHERE event_id = $1`, [eventId]);
    for (const item of parsedItems) {
      const institutionId = await resolveInstitutionId(client, item.school, item.country);
      await client.query(
        `INSERT INTO event_institution_sponsors
           (event_id, institution_id, amount_original, currency, exchange_rate, amount_vnd, is_free, standee_provided, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [eventId, institutionId, item.amountOriginal, item.currency, item.exchangeRate,
         item.amountVnd, item.isFree, item.standeeProvided, item.note]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { count: parsedItems.length, sponsors: await getSponsors(eventId) };
}

module.exports = { getSponsors, addItem, updateItem, deleteItem, importSponsorsCsv };
