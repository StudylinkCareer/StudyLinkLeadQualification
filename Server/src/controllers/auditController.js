// server/src/controllers/auditController.js

const { Pool } = require('pg');
const { objectToCamelCase } = require('../utils/caseConvert');
const nodemailer = require('nodemailer');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Email transporter ────────────────────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Get alert recipients from system_config ──────────────────────────────────
async function getAlertRecipients() {
  try {
    const result = await pool.query(
      `SELECT value FROM system_config WHERE key = 'alert_recipients'`
    );
    if (result.rows.length === 0) return [];
    return result.rows[0].value;
  } catch {
    return [];
  }
}

// ── Send unusual activity alert ──────────────────────────────────────────────
async function sendActivityAlert({ staffName, staffEmail, studentId, viewCount, threshold }) {
  try {
    const recipients = await getAlertRecipients();
    if (!recipients.length) return;

    const transporter = getTransporter();
    await transporter.sendMail({
      from:    process.env.SMTP_USER,
      to:      recipients.join(', '),
      subject: `⚠️ Unusual Activity Alert — ${staffName}`,
      html: `
        <h2>Unusual Data Access Alert</h2>
        <p>A staff member has exceeded their view threshold.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Staff Member</strong></td><td style="padding:8px;border:1px solid #ddd">${staffName} (${staffEmail})</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Records Viewed</strong></td><td style="padding:8px;border:1px solid #ddd">${viewCount}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Threshold</strong></td><td style="padding:8px;border:1px solid #ddd">${threshold}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Last Record Accessed</strong></td><td style="padding:8px;border:1px solid #ddd">${studentId}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Time</strong></td><td style="padding:8px;border:1px solid #ddd">${new Date().toLocaleString('en-GB')}</td></tr>
        </table>
        <p>Please review this activity in the audit log.</p>
      `,
    });
  } catch (err) {
    console.error('[AUDIT] Failed to send activity alert:', err.message);
  }
}

// ── Log a view event ─────────────────────────────────────────────────────────
async function logView({ studentId, viewedBy, req }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (student_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
      [studentId, viewedBy, 'record_viewed', '', studentId, 'view']
    );

    // Increment session view count
    if (req && req.session) {
      req.session.viewCount = (req.session.viewCount || 0) + 1;

      // Check threshold for this staff member
      const staffId = req.session.staffId;
      if (staffId) {
        const staffResult = await pool.query(
          `SELECT view_threshold, full_name, email FROM staff WHERE id = $1`,
          [staffId]
        );
        if (staffResult.rows.length > 0) {
          const { view_threshold, full_name, email } = staffResult.rows[0];
          const threshold = view_threshold || 20;

          // Alert exactly at threshold — not on every view after
          if (req.session.viewCount === threshold) {
            await sendActivityAlert({
              staffName:  full_name,
              staffEmail: email,
              studentId,
              viewCount:  req.session.viewCount,
              threshold,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[AUDIT] logView failed:', err.message);
    // Don't throw — view logging failure should never block the main request
  }
}

// ── Log a batch of field changes ─────────────────────────────────────────────
// leadId is optional: set when the change is to a specific lead (engagement),
// NULL for person-level (identity) changes. Reports key the engagement trail by lead_id.
async function logChanges({ studentId, leadId = null, changedBy, oldData, newData, source = 'staff_app' }) {
  const entries = [];
  for (const key of Object.keys(newData)) {
    const oldVal = String(oldData[key] ?? '');
    const newVal = String(newData[key] ?? '');
    if (oldVal === newVal) continue;
    entries.push({ field: key, oldVal, newVal });
  }
  if (entries.length === 0) return;

  const values = [];
  const placeholders = entries.map((e, i) => {
    const base = i * 7;
    values.push(studentId, leadId, changedBy, e.field, e.oldVal, e.newVal, source);
    return `($${base+1}, $${base+2}, $${base+3}, NOW(), $${base+4}, $${base+5}, $${base+6}, $${base+7})`;
  });

  await pool.query(
    `INSERT INTO audit_log (student_id, lead_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

// ── Get audit log for a student ───────────────────────────────────────────────
async function getAuditLog(req, res, next) {
  try {
    const { studentId } = req.params;
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(
      `SELECT * FROM audit_log WHERE student_id = $1 ORDER BY changed_at DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    );
    res.json({ success: true, data: result.rows.map(objectToCamelCase) });
  } catch (err) { next(err); }
}

// ── Get audit log for date range ─────────────────────────────────────────────
async function getAuditLogRange(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from and to date parameters are required' });
    }
    const result = await pool.query(
      `SELECT * FROM audit_log WHERE changed_at >= $1 AND changed_at <= $2 ORDER BY changed_at DESC`,
      [new Date(from), new Date(to + 'T23:59:59')]
    );
    res.json({ success: true, data: result.rows.map(objectToCamelCase) });
  } catch (err) { next(err); }
}

// ── Get/update alert recipients ───────────────────────────────────────────────
async function getRecipients(req, res, next) {
  try {
    const recipients = await getAlertRecipients();
    res.json({ success: true, data: recipients });
  } catch (err) { next(err); }
}

async function updateRecipients(req, res, next) {
  try {
    const { recipients } = req.body;
    if (!Array.isArray(recipients)) {
      return res.status(400).json({ success: false, error: 'recipients must be an array' });
    }
    await pool.query(
      `INSERT INTO system_config (key, value, updated_by, updated_at)
       VALUES ('alert_recipients', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
      [JSON.stringify(recipients), req.session.staffName]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  logView, logChanges,
  getAuditLog, getAuditLogRange,
  getRecipients, updateRecipients,
};
