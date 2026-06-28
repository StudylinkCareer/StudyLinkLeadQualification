// src/pages/LeadsList.jsx
// -----------------------------------------------------------------------------
// The Leads list at the LEAD level — one row per lead, with a Student column
// that links back to the person. Route: /leads.
// Row click → Lead Detail (/lead/:leadId); Student cell → Student Detail.
//
// First pass: search + the core columns + status chips. The legacy per-student
// page's column-config / saved-variants / export / mass-assign are not carried
// over here yet.
// -----------------------------------------------------------------------------

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { leadAPI } from '../services/api';
import { statusColor } from '../utils/fieldOptions';
import { FiSearch } from 'react-icons/fi';

const th  = { textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '0.55rem 0.75rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-primary)' };
const td  = { fontSize: '0.875rem', color: 'var(--text-primary)', padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const inp = { width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.75rem 0.55rem 2.1rem', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.9rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit' };

function Chip({ status }) {
  if (!status) return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
  return <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: statusColor(status), padding: '2px 10px', borderRadius: 20 }}>{status}</span>;
}

function fmtDate(v) { if (!v) return '—'; try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v); } }

export default function LeadsList() {
  const navigate = useNavigate();
  const [leads, setLeads]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [q, setQ]             = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try { const res = await leadAPI.listAll(); if (alive) setLeads(res.data || []); }
      catch (e) { if (alive) setError(e.message || 'Failed to load leads'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = !s ? leads : leads.filter(l =>
      [l.studentName, l.studentId, String(l.leadId), l.targetInstitution, l.leadStatus, l.counselor, l.major, l.intake, l.degreeLevel]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(s))
    );
    // Default sort: group every lead under its student (by name, then student id),
    // oldest→newest lead within a student.
    return [...base].sort((a, b) => {
      const na = (a.studentName || '').toLowerCase(), nb = (b.studentName || '').toLowerCase();
      if (na !== nb) return na.localeCompare(nb);
      const sa = String(a.studentId || ''), sb = String(b.studentId || '');
      if (sa !== sb) return sa.localeCompare(sb);
      return (a.leadId || 0) - (b.leadId || 0);
    });
  }, [leads, q]);

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          Leads <span style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1rem' }}>({filtered.length})</span>
        </h1>
        <div style={{ position: 'relative', width: 320, maxWidth: '100%' }}>
          <FiSearch size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input style={inp} placeholder="Search student, institution, status, counsellor…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
       : error ? <div style={{ color: '#dc2626' }}>{error}</div>
       : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-primary)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Student</th><th style={th}>Lead ID</th><th style={th}>Intake</th><th style={th}>Degree</th>
              <th style={th}>Institution</th><th style={th}>Major</th><th style={th}>Status</th><th style={th}>Counsellor</th><th style={th}>Created</th>
            </tr></thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.leadId} onClick={() => navigate(`/lead/${l.leadId}`)} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={td}>
                    <button onClick={e => { e.stopPropagation(); navigate(`/students/${l.studentId}`); }}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
                      {l.studentName || '(no name)'}
                    </button>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{l.studentId}</div>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{l.leadId}</td>
                  <td style={td}>{l.intake || '—'}</td>
                  <td style={td}>{l.degreeLevel || '—'}</td>
                  <td style={td}>{l.targetInstitution || '—'}</td>
                  <td style={td}>{l.major || '—'}</td>
                  <td style={td}><Chip status={l.leadStatus} /></td>
                  <td style={td}>{l.counselor || '—'}</td>
                  <td style={td}>{fmtDate(l.createdAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td style={{ ...td, color: 'var(--text-secondary)' }} colSpan={9}>No leads match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
