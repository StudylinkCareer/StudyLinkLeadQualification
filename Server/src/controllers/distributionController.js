// Server/src/controllers/distributionController.js
//
// HTTP layer over distributionService (the validated engine), plus in-console
// Excel/CSV upload (template download + parse) and dynamic office-coverage
// management. Gated to the 'distribution' RBAC resource.

const { Pool } = require('pg');
const XLSX = require('xlsx');
const distributionService = require('../services/distributionService');
const permissionService   = require('../services/permissionService');
const { syncOrderPhase, phaseForPosition }  = require('../utils/orderPhase');
const OrderAssignment = require('../models/OrderAssignment');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TEMPLATE_HEADERS = ['unique_id', 'full_name', 'phone', 'email', 'Office', 'lead_source', 'year_of_birth', 'stone_tier'];

async function requireDistribution(req, res, next) {
  try {
    const role = req.session.staffRole;
    if (!role) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const scope = await permissionService.getResourceScope(role, 'distribution', 'manage');
    if (scope !== 'all') return res.status(403).json({ success: false, error: 'Distribution access required' });
    next();
  } catch (err) { next(err); }
}

async function listOffices(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT code, COALESCE(label_en, code) AS label FROM lookup_values
        WHERE category='office' AND is_active=TRUE ORDER BY sort_order, code`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function poolSummary(req, res, next) {
  try { res.json({ success: true, data: await distributionService.getPoolSummary() }); }
  catch (err) { next(err); }
}

async function preview(req, res, next) {
  try {
    const { office, perHead } = req.body;
    if (!office) return res.status(400).json({ success: false, error: 'office is required' });
    res.json({ success: true, data: await distributionService.releaseTranche({ office, perHead: Number(perHead) || 50, dryRun: true }) });
  } catch (err) { next(err); }
}

async function release(req, res, next) {
  try {
    const { office, perHead } = req.body;
    if (!office) return res.status(400).json({ success: false, error: 'office is required' });
    res.json({ success: true, data: await distributionService.releaseTranche({
      office, perHead: Number(perHead) || 50, dryRun: false, source: 'upload', assignedBy: req.session.staffName || 'system' }) });
  } catch (err) { next(err); }
}

async function recall(req, res, next) {
  try {
    const { counsellor, dryRun } = req.body;
    if (!counsellor) return res.status(400).json({ success: false, error: 'counsellor is required' });
    res.json({ success: true, data: await distributionService.recallCounsellorLeads(counsellor, { dryRun: !!dryRun }) });
  } catch (err) { next(err); }
}

// ── Template download (GET /template) — full student schema, from the live table ──
async function downloadTemplate(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='students' AND table_schema='public'
          AND column_name NOT LIKE '\\_raw\\_%'
          AND column_name NOT IN ('id','distribution_status','prev_counselor')
        ORDER BY ordinal_position`);
    const headers = rows.map((r) => r.column_name);
    if (!headers.includes('office')) headers.push('office');   // ensure office for distribution
    const ws = XLSX.utils.json_to_sheet([{}], { header: headers });  // header row only
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="lead_upload_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) { next(err); }
}

// ── Notes template + bulk upload (GET /notes-template, POST /upload-notes) ──
const NOTE_HEADERS = ['unique_id', 'full_name', 'note_type', 'content', 'author_name', 'author_id', 'created_at'];

async function downloadNotesTemplate(req, res, next) {
  try {
    const example = [{ unique_id: '20260314-005', full_name: 'Nguyen Van A', note_type: 'PreSales',
      content: 'First contact — interested in Australia.', author_name: 'Tran Nhat Vy', author_id: 15, created_at: '2026-03-14' }];
    const ws = XLSX.utils.json_to_sheet(example, { header: NOTE_HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Notes');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="notes_upload_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) { next(err); }
}

async function uploadNotes(req, res, next) {
  try {
    const { fileBase64 } = req.body;
    if (!fileBase64) return res.status(400).json({ success: false, error: 'No file received' });

    let rows;
    try {
      const buf = Buffer.from(fileBase64, 'base64');
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
      // Pick the sheet that actually holds notes (a 'content' or 'note_type' header, any casing).
      let chosen = null;
      for (const name of wb.SheetNames) {
        const js = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
        if (js.length) {
          const hdr = new Set(Object.keys(js[0]).map(normHeader));
          if (hdr.has('content') || hdr.has('note_type')) { chosen = js; break; }
        }
      }
      rows = chosen || XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Could not read file: ${e.message}` });
    }

    // Guard: must look like the notes template (unique_id + content columns present).
    if (!rows.length)
      return res.status(400).json({ success: false, error: 'The file has no note rows. Please use the Download Notes Template button.' });
    const hdr = new Set(Object.keys(rows[0]).map(normHeader));
    if (!hdr.has('unique_id') || !hdr.has('content'))
      return res.status(400).json({ success: false, error: "This doesn't look like the notes template — it needs 'unique_id' and 'content' columns. Please start from the Download Notes Template button." });

    let inserted = 0, unmatched = 0, failed = 0;
    const errorRows = [];   // notes that couldn't be saved, for the downloadable error log
    const client = await pool.connect();
    try {
      for (const r of rows) {
        const nr = normalizeRow(r);
        const uid = String(nr.unique_id || '').trim();
        const content = (nr.content ?? '').toString().trim();
        const cdRaw = (nr.created_at instanceof Date) ? nr.created_at.toISOString().slice(0, 10) : (nr.created_at ?? '');
        const base = { unique_id: uid, note_type: (nr.note_type ?? ''), content,
          author_name: (nr.author_name ?? ''), author_id: (nr.author_id ?? ''), created_at: cdRaw };
        if (!uid || !content) { failed++; errorRows.push({ ...base, error_reason: 'Missing unique_id or content' }); continue; }
        const sres = await client.query(`SELECT id FROM students WHERE student_id=$1`, [uid]);
        if (sres.rowCount === 0) { unmatched++; errorRows.push({ ...base, error_reason: 'Lead not found for this unique_id' }); continue; }
        const studentId = sres.rows[0].id;
        const noteType = (nr.note_type ?? '').toString().trim() || 'General';
        const authorName = (nr.author_name ?? '').toString().trim() || null;
        const aid = nr.author_id != null && String(nr.author_id).trim() !== '' ? parseInt(nr.author_id, 10) : NaN;
        const authorId = Number.isFinite(aid) ? aid : null;
        const cd = (nr.created_at instanceof Date) ? nr.created_at : (nr.created_at ? new Date(nr.created_at) : null);
        const createdAt = cd && !isNaN(cd.getTime()) ? cd.toISOString() : null;
        try {
          if (createdAt) {
            await client.query(
              `INSERT INTO student_notes (student_id, note_type, content, author_id, author_name, created_at)
               VALUES ($1,$2,$3,$4,$5,$6)`, [studentId, noteType, content, authorId, authorName, createdAt]);
          } else {
            await client.query(
              `INSERT INTO student_notes (student_id, note_type, content, author_id, author_name)
               VALUES ($1,$2,$3,$4,$5)`, [studentId, noteType, content, authorId, authorName]);
          }
          inserted++;
        } catch (e) { failed++; errorRows.push({ ...base, error_reason: `Save failed: ${e.message}` }); }
      }
    } finally { client.release(); }

    // Build a downloadable Excel error log of every row that didn't save.
    let errorFileBase64 = null;
    if (errorRows.length) {
      const ws = XLSX.utils.json_to_sheet(errorRows, {
        header: ['unique_id', 'note_type', 'content', 'author_name', 'author_id', 'created_at', 'error_reason'] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Unmatched notes');
      errorFileBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    }

    res.json({ success: true, data: { total: rows.length, inserted, unmatched, failed, errorFileBase64 } });
  } catch (err) { next(err); }
}

// ── Pull pooled leads back into review (formal action button) ──────
async function poolToReview(req, res, next) {
  try {
    const { office } = req.body || {};
    const r = office
      ? await pool.query(`UPDATE leads SET distribution_status='review', updated_at=NOW() WHERE distribution_status='pool' AND office=$1`, [office])
      : await pool.query(`UPDATE leads SET distribution_status='review', updated_at=NOW() WHERE distribution_status='pool'`);
    res.json({ success: true, data: { moved: r.rowCount } });
  } catch (err) { next(err); }
}

// ── Upload (POST /upload) — accepts the FULL student template (Excel/CSV) ──
// Body: { fileBase64, office }. Generic + type-aware: any column whose header
// matches a real students column is imported; numeric/date columns coerce bad
// values to NULL; common placeholder text is treated as blank. Leads WITHOUT a
// counsellor go to 'review'; leads that already name a counsellor import as
// owned (distribution_status left NULL, so they skip the distribution queue).
const PLACEHOLDERS = new Set(['not provided', 'n/a', 'na', 'not calculated', 'not calcaluated', 'none', 'null', '-', '']);
const SKIP_COLS = new Set(['id', 'distribution_status', 'prev_counselor', 'created_at', 'updated_at']); // never set from the sheet (timestamps are added by buildRowInsert)
// Columns that belong to the engagement (leads) row, not the person (students) row.
const ENGAGEMENT_COLS = new Set([
  'counselor', 'senior_counselor', 'presales', 'marketing_staff', 'lead_status',
  'distribution_status', 'close_date', 'confidence', 'office', 'prev_counselor',
  'destination_country', 'timeline', 'study_plans', 'process_application', 'major',
  'intake', 'degree_level', 'target_institution', 'rationale',
]);

// Normalise a spreadsheet header to snake_case so 'Full Name', 'FULL_NAME',
// 'UniqueId', ' unique_id ' all map to the real DB column 'full_name'/'unique_id'.
const normHeader = (h) => String(h ?? '').trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')   // camelCase -> snake
  .replace(/[\s\-]+/g, '_')                  // spaces / hyphens -> underscore
  .replace(/_+/g, '_')                       // collapse repeats
  .replace(/^_+|_+$/g, '')                   // trim edge underscores
  .toLowerCase();

// Build { normalisedHeader: value } for one sheet row (first occurrence wins).
const normalizeRow = (r) => {
  const out = {};
  for (const [k, v] of Object.entries(r)) { const nk = normHeader(k); if (nk && !(nk in out)) out[nk] = v; }
  return out;
};

// Coerce a raw cell to the target column type (numeric / date / bool aware).
function coerceVal(val, t0) {
  if (val == null) return null;
  let s = (val instanceof Date) ? val : (typeof val === 'string' ? val.trim() : val);
  if (typeof s === 'string' && PLACEHOLDERS.has(s.toLowerCase())) return null;
  if (s === '') return null;
  const t = t0 || 'text';
  if (/int/.test(t)) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
  if (/numeric|real|double|decimal/.test(t)) { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }
  if (/bool/.test(t)) { const v = String(s).toLowerCase(); if (['true','1','yes','y'].includes(v)) return true; if (['false','0','no','n'].includes(v)) return false; return null; }
  if (/date|timestamp/.test(t)) { const d = (s instanceof Date) ? s : new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
  return String(s);
}

// Split a normalized upload row into person (students) + engagement (leads) column
// sets, applying office default, owned-vs-review staging, and lead_status='New'.
function splitPersonLead(nr, office, colType, leadColType) {
  const sCols = [], sVals = [], lCols = [], lVals = [];
  for (const [col, rawVal] of Object.entries(nr)) {
    if (col === 'unique_id' || SKIP_COLS.has(col)) continue;
    if (ENGAGEMENT_COLS.has(col) && leadColType[col]) {
      if (lCols.includes(col)) continue;
      lCols.push(col); lVals.push(coerceVal(rawVal, leadColType[col]));
    } else if (colType[col]) {
      if (sCols.includes(col)) continue;
      sCols.push(col); sVals.push(coerceVal(rawVal, colType[col]));
    }
  }
  // Order-driven ownership: the person (Sales Order) is the owner of record, so
  // mirror any named staff onto the students row too — not just the lead.
  const STAFF_COLS = ['counselor', 'senior_counselor', 'presales', 'marketing_staff'];
  for (const sc of STAFF_COLS) {
    const li = lCols.indexOf(sc);
    if (li >= 0 && lVals[li] != null && String(lVals[li]).trim() !== '' && colType[sc] && !sCols.includes(sc)) {
      sCols.push(sc); sVals.push(lVals[li]);
    }
  }
  const oi = lCols.indexOf('office');
  if (oi === -1) { lCols.push('office'); lVals.push(office || null); }
  else if (!lVals[oi]) lVals[oi] = office || null;
  const finalOffice = lVals[lCols.indexOf('office')];
  const ci = lCols.indexOf('counselor');
  const hasCounsellor = !!(ci >= 0 && lVals[ci] && String(lVals[ci]).trim());
  lCols.push('distribution_status'); lVals.push(hasCounsellor ? null : 'review');
  if (!lCols.includes('lead_status')) { lCols.push('lead_status'); lVals.push('New'); }
  if (!sCols.includes('status'))      { sCols.push('status');      sVals.push('Active'); }
  return { sCols, sVals, lCols, lVals, hasCounsellor, finalOffice };
}

// Parameterised INSERT for one row: leading key col + given cols + timestamps.
function buildRowInsert(table, keyCol, keyVal, cols, vals, nowISO, returning = '') {
  const allCols = [keyCol, ...cols, 'created_at', 'updated_at'];
  const allVals = [keyVal, ...vals, nowISO, nowISO];
  const ph = allCols.map((_, i) => `$${i + 1}`).join(',');
  const quoted = allCols.map((c) => `"${c}"`).join(',');
  return { text: `INSERT INTO ${table} (${quoted}) VALUES (${ph})${returning}`, values: allVals };
}

// Learn the live students/leads column types (used by the row split).
async function loadSchemas(db) {
  const [c, l] = await Promise.all([
    db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='students' AND table_schema='public'`),
    db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='leads' AND table_schema='public'`),
  ]);
  const colType = {}, leadColType = {};
  for (const x of c.rows) colType[x.column_name] = x.data_type;
  for (const x of l.rows) leadColType[x.column_name] = x.data_type;
  return { colType, leadColType };
}

async function uploadLeads(req, res, next) {
  try {
    const { fileBase64, office } = req.body;
    if (!fileBase64) return res.status(400).json({ success: false, error: 'No file received' });

    let rows;
    try {
      const buf = Buffer.from(fileBase64, 'base64');
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });   // reads .xlsx/.xls/.csv
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Could not read file: ${e.message}` });
    }

    // Guard: must look like the lead template (has a unique_id column with data).
    if (!rows.length)
      return res.status(400).json({ success: false, error: 'The file has no rows. Please use the Download Template button and fill in at least one lead.' });
    const headerNorms = new Set(Object.keys(rows[0]).map(normHeader));
    if (!headerNorms.has('unique_id'))
      return res.status(400).json({ success: false, error: "This doesn't look like the lead template — no 'unique_id' column found. Please start from the Download Template button." });

    // Learn the real students columns + types so we adapt to the schema.
    const colRes = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='students' AND table_schema='public'`);
    const colType = {};
    for (const c of colRes.rows) colType[c.column_name] = c.data_type;
    const leadColRes = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='leads' AND table_schema='public'`);
    const leadColType = {};
    for (const c of leadColRes.rows) leadColType[c.column_name] = c.data_type;

    let inserted = 0, skipped = 0, failed = 0, review = 0, owned = 0, untagged = 0, parked = 0, firstError = null;
    const nowISO = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        const nr = normalizeRow(r);                       // tolerant header mapping
        const uid = String(nr.unique_id || '').trim();
        if (!uid) { failed++; continue; }
        try {
          await client.query('SAVEPOINT row');

          // Duplicate check: a DIFFERENT existing person sharing this email/phone.
          // Such rows are parked for human review instead of creating a second person.
          const email = String(nr.email || '').trim();
          const phone = String(nr.phone || '').trim();
          let dup = { rows: [] };
          if (email || phone) {
            dup = await client.query(
              `SELECT student_id, email, phone FROM students
                WHERE student_id <> $3
                  AND ( ($1 <> '' AND LOWER(email) = LOWER($1)) OR ($2 <> '' AND phone = $2) )
                LIMIT 10`, [email, phone, uid]);
          }
          if (dup.rows.length) {
            const mE = !!email && dup.rows.some(d => (d.email || '').toLowerCase() === email.toLowerCase());
            const mP = !!phone && dup.rows.some(d => (d.phone || '') === phone);
            const matchType = mE && mP ? 'email+phone' : mE ? 'email' : 'phone';
            await client.query(
              `INSERT INTO duplicate_reviews (incoming_uid, email, phone, match_type, matched_ids, payload, office, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
              [uid, email || null, phone || null, matchType, dup.rows.map(d => d.student_id), JSON.stringify(nr), office || null]);
            parked++;
            await client.query('RELEASE SAVEPOINT row');
            continue;
          }

          // No collision -> create the person (FK target), then its lead.
          const { sCols, sVals, lCols, lVals, hasCounsellor, finalOffice } = splitPersonLead(nr, office, colType, leadColType);
          const sIns = buildRowInsert('students', 'student_id', uid, sCols, sVals, nowISO);
          const sResult = await client.query(`${sIns.text} ON CONFLICT (student_id) DO NOTHING`, sIns.values);
          if (sResult.rowCount === 1) {
            const lIns = buildRowInsert('leads', 'person_id', uid, lCols, lVals, nowISO);
            await client.query(lIns.text, lIns.values);
            // Set the new Order's phase from its owner (named counsellor →
            // Counselling; no counsellor → Pool holding state).
            await syncOrderPhase(client, uid);
            inserted++;
            if (hasCounsellor) owned++;
            else { review++; if (!finalOffice) untagged++; }
          } else skipped++;
          await client.query('RELEASE SAVEPOINT row');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT row');
          failed++; if (!firstError) firstError = e.message;
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally { client.release(); }

    res.json({ success: true, data: { total: rows.length, inserted, skipped, failed, review, owned, untagged, parked, firstError } });
  } catch (err) { next(err); }
}

// ── Coverage management ─────────────────────────────────────────────
async function listStaff(req, res, next) {
  try {
    const { rows } = await pool.query(`SELECT id, full_name FROM staff WHERE is_active=TRUE ORDER BY full_name`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function listCoverage(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT soa.id, soa.office, soa.weight, soa.staff_id, s.full_name
         FROM staff_office_assignments soa JOIN staff s ON s.id=soa.staff_id
        WHERE soa.effective_from <= CURRENT_DATE
          AND (soa.effective_to IS NULL OR soa.effective_to >= CURRENT_DATE)
          AND s.is_active=TRUE
        ORDER BY soa.office, s.full_name`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function addCoverage(req, res, next) {
  try {
    const { staffId, office, weight } = req.body;
    if (!staffId || !office) return res.status(400).json({ success: false, error: 'staffId and office are required' });
    await pool.query(`INSERT INTO staff_office_assignments (staff_id, office, weight) VALUES ($1,$2,$3)`,
      [staffId, office, Number(weight) || 1.0]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function updateCoverageWeight(req, res, next) {
  try {
    await pool.query(`UPDATE staff_office_assignments SET weight=$1 WHERE id=$2`, [Number(req.body.weight) || 1.0, req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function removeCoverage(req, res, next) {
  try {
    await pool.query(`DELETE FROM staff_office_assignments WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ── Existing unassigned leads (item 3) ──────────────────────────────
// Leads already in the system with no counsellor and not yet in the pool.
async function listUnassigned(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(s.residency),''),'(no province)') AS residency,
              COUNT(*)::int AS cnt
         FROM leads l JOIN students s ON s.student_id = l.person_id
        WHERE COALESCE(l.counselor,'') = ''
          AND l.distribution_status IS NULL
          AND l.lead_status NOT IN ('Contracted','Lost','Archived')
        GROUP BY 1 ORDER BY cnt DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// Move a province-group of unassigned leads into the pool with a chosen office.
async function poolExisting(req, res, next) {
  try {
    const { residency, office } = req.body;
    if (!office) return res.status(400).json({ success: false, error: 'office is required' });
    const noProv = !residency || residency === '(no province)';
    const where = noProv ? `COALESCE(NULLIF(TRIM(s.residency),''),'') = ''` : `TRIM(s.residency) = $2`;
    const params = noProv ? [office] : [office, residency];
    const r = await pool.query(
      `UPDATE leads l SET distribution_status='review', office=$1, updated_at=NOW()
         FROM students s
        WHERE s.student_id = l.person_id
          AND COALESCE(l.counselor,'') = '' AND l.distribution_status IS NULL
          AND COALESCE(l.status,'Active') = 'Active'
          AND l.lead_status NOT IN ('Contracted','Lost','Archived')
          AND ${where}`,
      params);
    res.json({ success: true, data: { pooled: r.rowCount } });
  } catch (err) { next(err); }
}

// ── Review staging (items 1, 2, 4) ──────────────────────────────────
// Leads sitting in 'review' after upload / recall / sweep, before they hit
// the pool. prev_counselor (if any) is the "reassigned from" owner.
async function listReview(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT l.lead_id, l.person_id AS student_id, s.full_name, l.office, s.stone_tier, l.prev_counselor
         FROM leads l
         JOIN students s ON s.student_id = l.person_id
        WHERE l.distribution_status='review'
        ORDER BY l.office NULLS LAST, l.prev_counselor NULLS FIRST, l.lead_id`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// Manually assign selected review leads to one counsellor (item 2 + audit item 3).
async function assignManual(req, res, next) {
  const { leadIds, counselor } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !counselor)
    return res.status(400).json({ success: false, error: 'leadIds (array) and counselor are required' });
  const by = req.session.staffName || 'system';
  const batchId = `manual-${Date.now()}`;
  const client = await pool.connect();
  let assigned = 0, blocked = 0;
  try {
    await client.query('BEGIN');
    // Target phase = the department of the chosen counsellor's position.
    const posRow = (await client.query(`SELECT position FROM staff WHERE full_name=$1 AND COALESCE(role,'') <> 'Event staff' LIMIT 1`, [counselor])).rows[0];
    const targetPhase = phaseForPosition(posRow ? posRow.position : null);
    for (const lid of leadIds) {
      const sel = await client.query(
        `SELECT l.person_id, l.office, s.stone_tier, l.prev_counselor, l.counselor AS old_counselor,
                COALESCE(s.order_phase,'Pool') AS order_phase
           FROM leads l JOIN students s ON s.student_id = l.person_id
          WHERE l.lead_id=$1 AND l.distribution_status='review'`, [lid]);
      if (sel.rowCount === 0) continue;
      const row = sel.rows[0];
      // Guardrail: block + log any transfer that isn't an approved route.
      if (row.order_phase !== targetPhase &&
          !(await OrderAssignment.isTransitionAllowed(row.order_phase, targetPhase, client))) {
        await OrderAssignment.logTransferException(client, {
          studentId: row.person_id, leadId: lid, fromPhase: row.order_phase, toPhase: targetPhase,
          owner: counselor, source: 'assign_manual', batchId,
          reason: `"${row.order_phase}" → "${targetPhase}" is not an approved route`,
        });
        blocked++;
        continue;
      }
      await client.query(
        `UPDATE leads SET counselor=$1, distribution_status='assigned', prev_counselor=NULL, updated_at=NOW()
          WHERE lead_id=$2`, [counselor, lid]);
      // Order-driven ownership: stamp the counsellor onto the Sales Order (person) too.
      await client.query(
        `UPDATE students SET counselor=$1, updated_at=NOW() WHERE student_id=$2`,
        [counselor, row.person_id]);
      // Phase follows the new owner (a counsellor → Counselling).
      await syncOrderPhase(client, row.person_id);
      await client.query(
        `INSERT INTO audit_log (student_id, lead_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
         VALUES ($1,$2,$3,NOW(),'counselor',$4,$5,'distribution')`,
        [row.person_id, lid, by, row.old_counselor || '', counselor]);
      await client.query(
        `INSERT INTO lead_distribution_log
           (unique_id, office, stone_tier, counselor, source, batch_id, assigned_by, from_counselor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.person_id, row.office, row.stone_tier, counselor,
         row.prev_counselor ? 'manual-reassign' : 'manual', batchId, by, row.prev_counselor || null]);
      assigned++;
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); client.release(); return next(err); }
  client.release();
  res.json({ success: true, data: { assigned, blocked, batchId } });
}

// Commit everything still in review (i.e. NOT manually assigned) into the pool (item 4).
// Only leads with an office can be pooled; the rest are reported as blocked.
async function commitToPool(req, res, next) {
  try {
    const r = await pool.query(
      `UPDATE leads SET distribution_status='pool', updated_at=NOW()
        WHERE distribution_status='review' AND COALESCE(office,'') <> ''`);
    const blocked = await pool.query(
      `SELECT COUNT(*)::int AS c FROM leads WHERE distribution_status='review' AND COALESCE(office,'')=''`);
    res.json({ success: true, data: { committed: r.rowCount, blockedNoOffice: blocked.rows[0].c } });
  } catch (err) { next(err); }
}

// ── Duplicates to review ────────────────────────────────────────────
// Upload rows whose email/phone collided with an existing person are parked here.
async function listDuplicates(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.incoming_uid, d.email, d.phone, d.match_type, d.matched_ids, d.payload, d.office, d.created_at,
              COALESCE(
                json_agg(json_build_object('studentId', s.student_id, 'fullName', s.full_name)
                         ORDER BY s.student_id) FILTER (WHERE s.student_id IS NOT NULL),
                '[]') AS matches
         FROM duplicate_reviews d
         LEFT JOIN students s ON s.student_id = ANY(d.matched_ids)
        WHERE d.status = 'pending'
        GROUP BY d.id
        ORDER BY d.created_at DESC, d.id DESC`);
    const data = rows.map(r => ({
      id: r.id,
      incomingUid: r.incoming_uid,
      fullName: (r.payload && (r.payload.full_name || r.payload.name)) || null,
      email: r.email,
      phone: r.phone,
      matchType: r.match_type,
      office: r.office,
      createdAt: r.created_at,
      matches: r.matches,
    }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// Resolve one parked row. action: 'link' (new lead for an existing person) |
// 'new_person' (create as a separate person anyway) | 'dismiss'.
async function resolveDuplicate(req, res, next) {
  const id = parseInt(req.params.id, 10);
  const action = (req.body && req.body.action) || '';
  const studentId = req.body && req.body.studentId;
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  if (!['link', 'new_person', 'dismiss'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action' });
  }
  const resolvedBy = req.session.staffName || req.session.staffEmail || 'unknown';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dr = (await client.query(
      `SELECT * FROM duplicate_reviews WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id])).rows[0];
    if (!dr) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Not found or already resolved' }); }

    const nr = dr.payload || {};
    const nowISO = new Date().toISOString();
    let createdLeadId = null;
    const resolution = action === 'dismiss' ? 'dismissed' : (action === 'link' ? 'linked' : 'new_person');

    if (action === 'link') {
      const targetId = (studentId || (dr.matched_ids || [])[0] || '').toString();
      const ok = targetId && (await client.query(`SELECT 1 FROM students WHERE student_id = $1`, [targetId])).rowCount;
      if (!ok) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Target student not found' }); }
      const { colType, leadColType } = await loadSchemas(client);
      const { lCols, lVals } = splitPersonLead(nr, dr.office, colType, leadColType);
      const lIns = buildRowInsert('leads', 'person_id', targetId, lCols, lVals, nowISO, ' RETURNING lead_id');
      createdLeadId = (await client.query(lIns.text, lIns.values)).rows[0].lead_id;
    } else if (action === 'new_person') {
      const uid = String(nr.unique_id || '').trim();
      if (!uid) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Row has no unique_id' }); }
      const { colType, leadColType } = await loadSchemas(client);
      const { sCols, sVals, lCols, lVals } = splitPersonLead(nr, dr.office, colType, leadColType);
      const sIns = buildRowInsert('students', 'student_id', uid, sCols, sVals, nowISO);
      await client.query(`${sIns.text} ON CONFLICT (student_id) DO NOTHING`, sIns.values);
      const lIns = buildRowInsert('leads', 'person_id', uid, lCols, lVals, nowISO, ' RETURNING lead_id');
      createdLeadId = (await client.query(lIns.text, lIns.values)).rows[0].lead_id;
    }

    await client.query(
      `UPDATE duplicate_reviews
          SET status = $2, resolution = $3, created_lead_id = $4, resolved_at = NOW(), resolved_by = $5
        WHERE id = $1`,
      [id, action === 'dismiss' ? 'dismissed' : 'resolved', resolution, createdLeadId, resolvedBy]);
    await client.query('COMMIT');
    res.json({ success: true, data: { id, resolution, createdLeadId } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
}

// Phase-transfer exceptions report (blocked batch transfers, for post-processing).
async function listTransferExceptions(req, res, next) {
  try {
    const resolved = req.query.resolved === 'true';
    const rows = await OrderAssignment.listTransferExceptions({ resolved }, pool);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

module.exports = {
  requireDistribution, listOffices, poolSummary, preview, release, recall,
  downloadTemplate, uploadLeads, listStaff, listCoverage, addCoverage, updateCoverageWeight, removeCoverage,
  listUnassigned, poolExisting,
  listReview, assignManual, commitToPool,
  poolToReview, downloadNotesTemplate, uploadNotes,
  listDuplicates, resolveDuplicate,
  listTransferExceptions,
};
