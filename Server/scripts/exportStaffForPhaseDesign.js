// scripts/exportStaffForPhaseDesign.js — READ-ONLY. Dumps staff + positions +
// roles + phase mapping as JSON for the phase-design workbook.
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const { POSITION_PHASE, phaseForPosition } = require('../src/utils/orderPhase');

const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
const OUT = process.argv[2] || 'staff_phase_export.json';

(async () => {
  const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';

  // 1. Staff rows (all, incl. synthetic event rows flagged via staff_type).
  const staff = (await pool.query(
    `SELECT full_name, email, position, role, is_active, COALESCE(staff_type,'') AS staff_type
       FROM staff ORDER BY COALESCE(position,'~'), full_name`
  )).rows.map(r => ({
    ...r,
    mapped_phase: r.position && POSITION_PHASE[r.position] ? POSITION_PHASE[r.position] : null,
    resolved_phase: phaseForPosition(r.position),   // includes the Pool fallback
  }));

  // 2. Positions summary: count + mapped phase (or UNMAPPED → Pool fallback).
  const posAgg = (await pool.query(
    `SELECT COALESCE(position,'(blank)') AS position, COUNT(*)::int AS staff_count,
            COUNT(*) FILTER (WHERE is_active)::int AS active_count
       FROM staff GROUP BY 1 ORDER BY staff_count DESC`
  )).rows.map(r => ({
    ...r,
    mapped_phase: POSITION_PHASE[r.position] || null,
    status: POSITION_PHASE[r.position] ? 'mapped' : 'UNMAPPED → Pool fallback',
  }));

  // 3. Roles summary: count + the leads scopes each role grants.
  const roleCounts = (await pool.query(
    `SELECT COALESCE(role,'(blank)') AS role, COUNT(*)::int AS staff_count,
            COUNT(*) FILTER (WHERE is_active)::int AS active_count
       FROM staff GROUP BY 1 ORDER BY staff_count DESC`
  )).rows;
  const perms = (await pool.query(
    `SELECT role, resource, operation, scope FROM role_permissions
      WHERE resource='leads' ORDER BY role, operation`
  )).rows;
  const permByRole = {};
  for (const p of perms) { (permByRole[p.role] ||= {})[p.operation] = p.scope; }
  const roles = roleCounts.map(r => ({
    role: r.role, staff_count: r.staff_count, active_count: r.active_count,
    leads_view_list: permByRole[r.role]?.view_list || '(none)',
    leads_view_detail: permByRole[r.role]?.view_detail || '(none)',
    leads_edit: permByRole[r.role]?.edit || '(none)',
    leads_assign: permByRole[r.role]?.assign || '(none)',
    leads_delete: permByRole[r.role]?.delete || '(none)',
  }));

  // 4. Phases summary: mapped positions + order_phase distribution.
  const orderPhase = (await pool.query(
    `SELECT COALESCE(order_phase,'(null)') AS phase, COUNT(*)::int AS orders
       FROM students GROUP BY 1 ORDER BY orders DESC`
  )).rows;
  const positionsByPhase = {};
  for (const [pos, ph] of Object.entries(POSITION_PHASE)) { (positionsByPhase[ph] ||= []).push(pos); }

  const data = { meta: { host, exported_from: 'PROD read-only' }, positionPhaseMap: POSITION_PHASE, staff, positions: posAgg, roles, orderPhase, positionsByPhase };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`Host: ${host}`);
  console.log(`staff=${staff.length}  positions=${posAgg.length}  roles=${roles.length}  order_phase buckets=${orderPhase.length}`);
  console.log('order_phase distribution:', JSON.stringify(orderPhase));
  console.log('positions:', JSON.stringify(posAgg.map(p => `${p.position}(${p.staff_count})→${p.mapped_phase||'UNMAPPED'}`)));
  console.log('roles:', JSON.stringify(roles.map(r => `${r.role}(${r.staff_count}) view_list=${r.leads_view_list}`)));
  console.log(`\nWrote ${OUT}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
