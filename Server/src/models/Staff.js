// server/src/models/Staff.js

const { Pool } = require('pg');
const crypto = require('crypto');
const { objectToCamelCase } = require('../utils/caseConvert');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function findAll() {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role, is_active, view_threshold, target, target_set_by, target_set_at, created_at, email_client, contact_mobile, platform_sms, platform_zalo, platform_whatsapp, platform_messenger, zalo_number, zalo_qr_code, whatsapp_qr_code, messenger_username, messenger_qr_code, lq_selectable
     FROM staff WHERE COALESCE(staff_type,'') <> 'event' ORDER BY full_name ASC`
  );
  return result.rows.map(objectToCamelCase);
}

async function findById(id) {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role, is_active, view_threshold, target, target_set_by, target_set_at, created_at, email_client, contact_mobile, platform_sms, platform_zalo, platform_whatsapp, platform_messenger, zalo_number, zalo_qr_code, whatsapp_qr_code, messenger_username, messenger_qr_code, lq_selectable
     FROM staff WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT * FROM staff WHERE email = $1`,
    [email.toLowerCase()]
  );
  // NOTE: intentionally returns raw row — staffController.login needs
  // snake_case fields (is_active, password_hash, full_name) for its own
  // logic before the session is set. Do not convert here.
  return result.rows[0] || null;
}

async function findActiveByRole(role) {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role
     FROM staff WHERE role = $1 AND is_active = true ORDER BY full_name ASC`,
    [role]
  );
  return result.rows.map(objectToCamelCase);
}

async function findAllActive() {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role, is_active, view_threshold, target, target_set_by, target_set_at, created_at, email_client, contact_mobile, platform_sms, platform_zalo, platform_whatsapp, platform_messenger, zalo_number, zalo_qr_code, whatsapp_qr_code, messenger_username, messenger_qr_code, lq_selectable
     FROM staff WHERE is_active = true AND COALESCE(staff_type,'') <> 'event' ORDER BY full_name ASC`
  );
  return result.rows.map(objectToCamelCase);
}

async function create({ fullName, email, position, role, password,
  emailClient, contactMobile, platformSms, platformZalo, platformWhatsapp, platformMessenger,
  zaloNumber, zaloQrCode, whatsappQrCode, messengerUsername, messengerQrCode }) {
  const passwordHash = password ? crypto.createHash('sha256').update(password).digest('hex') : null;
  const result = await pool.query(
    `INSERT INTO staff (full_name, email, position, role, password_hash, is_active,
       email_client, contact_mobile, platform_sms, platform_zalo, platform_whatsapp,
       platform_messenger, zalo_number, zalo_qr_code, whatsapp_qr_code,
       messenger_username, messenger_qr_code)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, full_name, email, position, role, is_active, view_threshold, target, target_set_by, target_set_at, created_at, email_client, contact_mobile, platform_sms, platform_zalo, platform_whatsapp, platform_messenger, zalo_number, zalo_qr_code, whatsapp_qr_code, messenger_username, messenger_qr_code, lq_selectable`,
    [fullName, email.toLowerCase(), position, role, passwordHash,
     emailClient || 'outlook', contactMobile || null,
     !!platformSms, !!platformZalo, !!platformWhatsapp, !!platformMessenger,
     zaloNumber || null, zaloQrCode || null,
     whatsappQrCode || null, messengerUsername || null, messengerQrCode || null]
  );
  return objectToCamelCase(result.rows[0]);
}

async function update(id, { fullName, email, position, role, isActive, viewThreshold,
  emailClient, contactMobile, platformSms, platformZalo, platformWhatsapp, platformMessenger,
  zaloNumber, zaloQrCode, whatsappQrCode, messengerUsername, messengerQrCode, lqSelectable }) {
  const result = await pool.query(
    `UPDATE staff
     SET full_name          = COALESCE($1,  full_name),
         email              = COALESCE($2,  email),
         position           = COALESCE($3,  position),
         role               = COALESCE($4,  role),
         is_active          = COALESCE($5,  is_active),
         view_threshold     = COALESCE($6,  view_threshold),
         email_client       = COALESCE($7,  email_client),
         contact_mobile     = COALESCE($8,  contact_mobile),
         platform_sms       = COALESCE($9,  platform_sms),
         platform_zalo      = COALESCE($10, platform_zalo),
         platform_whatsapp  = COALESCE($11, platform_whatsapp),
         platform_messenger = COALESCE($12, platform_messenger),
         zalo_number        = COALESCE($13, zalo_number),
         zalo_qr_code       = COALESCE($14, zalo_qr_code),
         whatsapp_qr_code   = COALESCE($15, whatsapp_qr_code),
         messenger_username = COALESCE($16, messenger_username),
         messenger_qr_code  = COALESCE($17, messenger_qr_code),
         lq_selectable      = COALESCE($18, lq_selectable)
     WHERE id = $19
     RETURNING id, full_name, email, position, role, is_active, view_threshold, target, target_set_by, target_set_at, created_at, email_client, contact_mobile, platform_sms, platform_zalo, platform_whatsapp, platform_messenger, zalo_number, zalo_qr_code, whatsapp_qr_code, messenger_username, messenger_qr_code, lq_selectable`,
    [fullName,
     email ? email.toLowerCase() : null,
     position, role, isActive, viewThreshold ?? null,
     emailClient        ?? null, contactMobile      ?? null,
     platformSms        ?? null, platformZalo       ?? null,
     platformWhatsapp   ?? null, platformMessenger  ?? null,
     zaloNumber         ?? null, zaloQrCode         ?? null,
     whatsappQrCode     ?? null, messengerUsername  ?? null,
     messengerQrCode    ?? null,
     lqSelectable       ?? null,
     id]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}

async function updatePassword(id, newPassword) {
  const passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  await pool.query(
    `UPDATE staff SET password_hash = $1 WHERE id = $2`,
    [passwordHash, id]
  );
}

async function verifyPassword(staff, password) {
  if (!staff.password_hash) return false;
  return crypto.createHash('sha256').update(password).digest('hex') === staff.password_hash;
}

async function deactivate(id) {
  const result = await pool.query(
    `UPDATE staff SET is_active = false WHERE id = $1
     RETURNING id, full_name, email, position, role, is_active`,
    [id]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}

async function setTarget(id, target, setterName) {
  const result = await pool.query(
    `UPDATE staff
     SET target = $1, target_set_by = $2, target_set_at = NOW()
     WHERE id = $3
     RETURNING id, full_name, email, position, role, is_active,
               view_threshold, target, target_set_by, target_set_at, created_at`,
    [target, setterName, id]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}
// Add setTarget to module.exports

module.exports = {
  findAll, findById, findByEmail, findActiveByRole, findAllActive,
  create, update, updatePassword, verifyPassword, deactivate, setTarget,
};
