// src/pages/NoteDraftsDashboard.jsx
// Admin dashboard for the cross-device note-drafts feature (confirmed
// 2026-08) — CEO + Manager, Technical Support only (gated server-side on
// note_drafts_dashboard.view; this page also self-gates so a denied user
// sees a plain message instead of an empty/broken table). Shows every
// draft ever created, any staffer, any status, with macro stats and a
// click-through to the actual note content once one's been completed.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { noteDraftsAPI } from '../services/api';
import { usePermissions } from '../contexts/PermissionsContext';

const STATUS_COLORS = { pending: '#f59e0b', completed: '#16a34a', discarded: '#6b7280' };
const METHOD_LABELS = { call: 'Phone Call', sms: 'SMS', zalo: 'Zalo', whatsapp: 'WhatsApp', messenger: 'Messenger', email: 'Email' };

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const statTile = { background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem' };
const statLabel = { fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' };
const statValue = { fontSize: '1.75rem', fontWeight: 700, marginTop: '0.25rem' };

export default function NoteDraftsDashboard() {
  const { canDo, loading: permsLoading } = usePermissions();
  const allowed = canDo('note_drafts_dashboard', 'view');

  const [drafts, setDrafts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (permsLoading || !allowed) return;
    setLoading(true);
    Promise.all([noteDraftsAPI.listAllForAdmin(), noteDraftsAPI.getAdminStats()])
      .then(([d, s]) => { setDrafts(d.data || []); setStats(s.data || null); })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [permsLoading, allowed]);

  const totals = useMemo(() => {
    if (!stats) return null;
    const byStatus = Object.fromEntries(stats.byStatus.map(s => [s.status, s.count]));
    const total = (byStatus.pending || 0) + (byStatus.completed || 0) + (byStatus.discarded || 0);
    const completionRate = total ? Math.round(((byStatus.completed || 0) / total) * 1000) / 10 : 0;
    return { ...byStatus, total, completionRate };
  }, [stats]);

  const shown = useMemo(() => {
    let rows = drafts;
    if (statusFilter) rows = rows.filter(d => d.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(d =>
        (d.staffName || '').toLowerCase().includes(q) ||
        (d.studentFullName || '').toLowerCase().includes(q) ||
        (d.contactName || '').toLowerCase().includes(q) ||
        (d.studentId || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [drafts, statusFilter, search]);

  const maxDay = useMemo(() => (stats ? Math.max(1, ...stats.byDay.map(d => d.count)) : 1), [stats]);
  const maxStaff = useMemo(() => (stats ? Math.max(1, ...stats.byStaff.map(s => s.total)) : 1), [stats]);

  if (permsLoading) return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Loading…</div>;
  if (!allowed) return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>You don't have access to this page.</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ fontSize: '1.375rem', fontWeight: 700, marginBottom: '0.25rem' }}>Pending Notes — Dashboard</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
        Every cross-device note draft ever created, across all staff — locked the moment someone clicks a
        platform action button (Make phone call / Open Zalo / etc.), resolved once they write up the note.
      </p>

      {error && <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', marginBottom: '1rem' }}>{error}</div>}
      {loading ? (
        <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
      ) : (
        <>
          {/* ── Macro stats ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.875rem', marginBottom: '1.5rem' }}>
            <div style={statTile}><div style={statLabel}>Total drafts</div><div style={statValue}>{totals?.total ?? 0}</div></div>
            <div style={statTile}><div style={statLabel}>Completion rate</div><div style={{ ...statValue, color: '#16a34a' }}>{totals?.completionRate ?? 0}%</div></div>
            <div style={statTile}><div style={statLabel}>Pending now</div><div style={{ ...statValue, color: (totals?.pending || 0) > 0 ? '#f59e0b' : 'inherit' }}>{totals?.pending ?? 0}</div></div>
            <div style={statTile}><div style={statLabel}>Discarded</div><div style={statValue}>{totals?.discarded ?? 0}</div></div>
            <div style={statTile}><div style={statLabel}>Avg. time to finish</div><div style={statValue}>{formatDuration(stats?.avgCompletionSeconds)}</div></div>
          </div>

          {/* ── By staff + by day ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={statTile}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.75rem' }}>By staff</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 260, overflowY: 'auto' }}>
                {stats?.byStaff.map(s => (
                  <div key={s.staffId} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <span style={{ fontSize: '0.8125rem', width: 150, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.staffName}>{s.staffName}</span>
                    <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                      <div style={{ width: `${(s.total / maxStaff) * 100}%`, background: 'var(--primary)', height: '100%' }} />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', width: 90, textAlign: 'right' }}>
                      {s.total} ({s.pending > 0 ? `${s.pending} pending` : `${Math.round((s.completed / s.total) * 100)}%`})
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div style={statTile}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.75rem' }}>By day</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 200 }}>
                {stats?.byDay.map(d => (
                  <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{ width: '100%', height: `${(d.count / maxDay) * 160}px`, background: 'var(--primary)', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                    <span style={{ fontSize: '0.625rem', color: 'var(--text-secondary)', marginTop: '4px', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Full list ── */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ padding: '0.4rem 0.625rem', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.8125rem' }}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="discarded">Discarded</option>
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff or student…"
              style={{ padding: '0.4rem 0.625rem', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.8125rem', minWidth: 220 }} />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{shown.length} of {drafts.length}</span>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Staff</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Student</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Method</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Status</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Created</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(d => {
                  const resolvedAt = d.completedAt || d.discardedAt;
                  const isExpanded = expandedId === d.id;
                  const canExpand = d.status === 'completed';
                  return (
                    <Fragment key={d.id}>
                      <tr
                        onClick={() => canExpand && setExpandedId(isExpanded ? null : d.id)}
                        style={{ borderTop: '1px solid var(--border)', cursor: canExpand ? 'pointer' : 'default', background: isExpanded ? 'var(--bg-secondary)' : 'transparent' }}>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{d.staffName}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{d.studentFullName || d.studentId}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{METHOD_LABELS[d.method] || d.method}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, borderRadius: '4px', padding: '1px 7px',
                            background: STATUS_COLORS[d.status] + '22', color: STATUS_COLORS[d.status], border: `1px solid ${STATUS_COLORS[d.status]}44` }}>
                            {d.status}
                          </span>
                          {canExpand && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--primary)' }}>{isExpanded ? '▲ hide' : '▼ view note'}</span>}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>{formatDate(d.createdAt)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>{formatDate(resolvedAt)}</td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <td colSpan={6} style={{ padding: '0.75rem 1.5rem', whiteSpace: 'pre-wrap', fontSize: '0.8125rem', borderTop: '1px solid var(--border)' }}>
                            {d.completedNoteContent || <span style={{ color: 'var(--text-secondary)' }}>No content found.</span>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No drafts match.</div>}
          </div>
        </>
      )}
    </div>
  );
}
