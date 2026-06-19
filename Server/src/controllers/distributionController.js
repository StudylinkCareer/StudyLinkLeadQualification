// Server/src/controllers/distributionController.js
//
// HTTP layer over distributionService (the validated engine), plus in-console
// Excel/CSV upload (template download + parse) and dynamic office-coverage
// management. Gated to the 'distribution' RBAC resource.

const { Pool } = require('pg');
const XLSX = require('xlsx');
const distributionService = require('../services/distributionService');
const permissionService   = require('../services/permissionService');

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
        WHERE table_name='students'
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
        const sres = await client.query(`SELECT id FROM students WHERE unique_id=$1`, [uid]);
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
      ? await pool.query(`UPDATE students SET distribution_status='review', updated_at=NOW() WHERE distribution_status='pool' AND office=$1`, [office])
      : await pool.query(`UPDATE students SET distribution_status='review', updated_at=NOW() WHERE distribution_status='pool'`);
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
const SKIP_COLS = new Set(['id', 'distribution_status', 'prev_counselor']); // never set from the sheet

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
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='students'`);
    const colType = {};
    for (const c of colRes.rows) colType[c.column_name] = c.data_type;

    const coerce = (col, val) => {
      if (val == null) return null;
      let s = (val instanceof Date) ? val : (typeof val === 'string' ? val.trim() : val);
      if (typeof s === 'string' && PLACEHOLDERS.has(s.toLowerCase())) return null;
      if (s === '') return null;
      const t = colType[col] || 'text';
      if (/int/.test(t)) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
      if (/numeric|real|double|decimal/.test(t)) { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }
      if (/bool/.test(t)) { const v = String(s).toLowerCase(); if (['true', '1', 'yes', 'y'].includes(v)) return true; if (['false', '0', 'no', 'n'].includes(v)) return false; return null; }
      if (/date|timestamp/.test(t)) { const d = (s instanceof Date) ? s : new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
      return String(s);
    };

    let inserted = 0, skipped = 0, failed = 0, review = 0, owned = 0, untagged = 0, firstError = null;
    const client = await pool.connect();
    try {
      for (const r of rows) {
        const nr = normalizeRow(r);                       // tolerant header mapping
        const uid = String(nr.unique_id || '').trim();
        if (!uid) { failed++; continue; }

        const cols = [], vals = [];
        for (const [col, rawVal] of Object.entries(nr)) {
          if (col === 'unique_id' || SKIP_COLS.has(col) || !colType[col]) continue;
          if (cols.includes(col)) continue;
          cols.push(col); vals.push(coerce(col, rawVal));
        }

        // Office: row value wins, else the form default.
        const oi = cols.indexOf('office');
        if (oi === -1) { cols.push('office'); vals.push(office || null); }
        else if (!vals[oi]) vals[oi] = office || null;
        const finalOffice = vals[cols.indexOf('office')];

        // Owned (has a counsellor) -> NULL; otherwise stage for review.
        const ci = cols.indexOf('counselor');
        const hasCounsellor = ci >= 0 && vals[ci] && String(vals[ci]).trim();
        cols.push('distribution_status'); vals.push(hasCounsellor ? null : 'review');

        if (!cols.includes('status')) { cols.push('status'); vals.push('Active'); }
        if (!cols.includes('created_at')) { cols.push('created_at'); vals.push(new Date().toISOString()); }
        if (!cols.includes('updated_at')) { cols.push('updated_at'); vals.push(new Date().toISOString()); }

        const allCols = ['unique_id', ...cols];
        const allVals = [uid, ...vals];
        const ph = allCols.map((_, i) => `$${i + 1}`).join(',');
        const quoted = allCols.map((c) => `"${c}"`).join(',');
        try {
          const result = await client.query(
            `INSERT INTO students (${quoted}) VALUES (${ph}) ON CONFLICT (unique_id) DO NOTHING`, allVals);
          if (result.rowCount === 1) {
            inserted++;
            if (hasCounsellor) owned++;
            else { review++; if (!finalOffice) untagged++; }
          } else skipped++;
        } catch (e) { failed++; if (!firstError) firstError = e.message; }
      }
    } finally { client.release(); }

    res.json({ success: true, data: { total: rows.length, inserted, skipped, failed, review, owned, untagged, firstError } });
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
      `SELECT COALESCE(NULLIF(TRIM(residency),''),'(no province)') AS residency,
              COUNT(*)::int AS cnt
         FROM students
        WHERE COALESCE(counselor,'') = ''
          AND distribution_status IS NULL
          AND COALESCE(status,'Active') = 'Active'
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
    const where = noProv ? `COALESCE(NULLIF(TRIM(residency),''),'') = ''` : `TRIM(residency) = $2`;
    const params = noProv ? [office] : [office, residency];
    const r = await pool.query(
      `UPDATE students SET distribution_status='review', office=$1, updated_at=NOW()
        WHERE COALESCE(counselor,'') = '' AND distribution_status IS NULL
          AND COALESCE(status,'Active') = 'Active' AND ${where}`,
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
      `SELECT unique_id, full_name, office, stone_tier, prev_counselor
         FROM students
        WHERE distribution_status='review'
        ORDER BY office NULLS LAST, prev_counselor NULLS FIRST, unique_id`);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// Manually assign selected review leads to one counsellor (item 2 + audit item 3).
async function assignManual(req, res, next) {
  const { uniqueIds, counselor } = req.body;
  if (!Array.isArray(uniqueIds) || uniqueIds.length === 0 || !counselor)
    return res.status(400).json({ success: false, error: 'uniqueIds (array) and counselor are required' });
  const by = req.session.staffName || 'system';
  const batchId = `manual-${Date.now()}`;
  const client = await pool.connect();
  let assigned = 0;
  try {
    await client.query('BEGIN');
    for (const uid of uniqueIds) {
      const sel = await client.query(
        `SELECT office, stone_tier, prev_counselor FROM students
          WHERE unique_id=$1 AND distribution_status='review'`, [uid]);
      if (sel.rowCount === 0) continue;
      const row = sel.rows[0];
      await client.query(
        `UPDATE students SET counselor=$1, distribution_status='assigned', prev_counselor=NULL, updated_at=NOW()
          WHERE unique_id=$2`, [counselor, uid]);
      await client.query(
        `INSERT INTO lead_distribution_log
           (unique_id, office, stone_tier, counselor, source, batch_id, assigned_by, from_counselor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uid, row.office, row.stone_tier, counselor,
         row.prev_counselor ? 'manual-reassign' : 'manual', batchId, by, row.prev_counselor || null]);
      assigned++;
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); client.release(); return next(err); }
  client.release();
  res.json({ success: true, data: { assigned, batchId } });
}

// Commit everything still in review (i.e. NOT manually assigned) into the pool (item 4).
// Only leads with an office can be pooled; the rest are reported as blocked.
async function commitToPool(req, res, next) {
  try {
    const r = await pool.query(
      `UPDATE students SET distribution_status='pool', updated_at=NOW()
        WHERE distribution_status='review' AND COALESCE(office,'') <> ''`);
    const blocked = await pool.query(
      `SELECT COUNT(*)::int AS c FROM students WHERE distribution_status='review' AND COALESCE(office,'')=''`);
    res.json({ success: true, data: { committed: r.rowCount, blockedNoOffice: blocked.rows[0].c } });
  } catch (err) { next(err); }
}

module.exports = {
  requireDistribution, listOffices, poolSummary, preview, release, recall,
  downloadTemplate, uploadLeads, listStaff, listCoverage, addCoverage, updateCoverageWeight, removeCoverage,
  listUnassigned, poolExisting,
  listReview, assignManual, commitToPool,
  poolToReview, downloadNotesTemplate, uploadNotes,
};
