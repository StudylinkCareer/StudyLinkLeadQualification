// src/pages/Leads.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiSearch, FiFilter, FiChevronUp, FiChevronDown } from 'react-icons/fi';

const LEAD_STATUSES = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];

function statusBadge(status) {
  const map = {
    'New': 'new', 'Contacted': 'contacted', 'Qualified': 'qualified',
    'Proposal': 'proposal', 'Negotiation': 'negotiation',
    'Won': 'won', 'Lost': 'lost', 'On Hold': 'on-hold',
  };
  const cls = map[status] || 'new';
  return <span className={`badge badge--${cls}`}>{status || 'New'}</span>;
}

function getLeadAge(createdAt) {
  if (!createdAt) return '—';
  const days = Math.floor((Date.now() - new Date(createdAt)) / (1000 * 60 * 60 * 24));
  return `${days}d`;
}

export default function Leads() {
  const [leads, setLeads]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterStatus, setFilter]   = useState('');
  const [sortField, setSortField]   = useState('createdAt');
  const [sortDir, setSortDir]       = useState('desc');
  const [selected, setSelected]     = useState([]);
  const [staffList, setStaffList]   = useState([]);
  const [massField, setMassField]   = useState('counselor');
  const [massValue, setMassValue]   = useState('');
  const [page, setPage]             = useState(1);
  const PER_PAGE = 25;

  const { isManager, staff } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadLeads();
    staffAPI.listActive().then(d => setStaffList(d.data || [])).catch(() => {});
  }, []);

  async function loadLeads() {
    setLoading(true);
    try {
      const data = await studentAPI.search('');
      setLeads(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />;
  }

  const filtered = useMemo(() => {
    let result = leads;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        (l.fullName || '').toLowerCase().includes(q) ||
        (l.email    || '').toLowerCase().includes(q) ||
        (l.phone    || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus) result = result.filter(l => (l.lead_status || l.leadStatus || 'New') === filterStatus);

    // Role-based filter: counselors see only their assigned leads
    if (!isManager && staff?.role === 'Counselor') {
      result = result.filter(l =>
        l.counselor === staff.fullName ||
        l.senior_counselor === staff.fullName ||
        l.presales === staff.fullName ||
        l.marketing_staff === staff.fullName
      );
    }

    result = [...result].sort((a, b) => {
      let av = a[sortField] || '';
      let bv = b[sortField] || '';
      if (sortDir === 'asc') return av > bv ? 1 : -1;
      return av < bv ? 1 : -1;
    });

    return result;
  }, [leads, search, filterStatus, sortField, sortDir, isManager, staff]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  function toggleAll() {
    const pageIds = paginated.map(l => l.uniqueId);
    const allSelected = pageIds.every(id => selected.includes(id));
    setSelected(allSelected ? selected.filter(id => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])]);
  }

  async function handleMassAssign() {
    if (!massValue || selected.length === 0) return;
    try {
      await staffAPI.massAssign(selected, massField, massValue);
      await loadLeads();
      setSelected([]);
    } catch (e) {
      alert(e.message);
    }
  }

  const FIELD_LABELS = {
    counselor: 'Counselor', senior_counselor: 'Senior Counselor',
    presales: 'PreSales', marketing_staff: 'Marketing Staff',
  };

  if (loading) return <div className="loading-center">Loading leads...</div>;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Leads ({filtered.length})</span>
      </div>

      <div className="page-body">
        <div className="table-toolbar">
          <div className="search-input-wrap">
            <FiSearch size={15} />
            <input
              className="search-input"
              placeholder="Search name, email, phone..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <select className="form-select" value={filterStatus} onChange={e => { setFilter(e.target.value); setPage(1); }}
            style={{ width: 'auto' }}>
            <option value="">All Statuses</option>
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isManager && (
                    <th className="checkbox-col">
                      <input type="checkbox"
                        checked={paginated.length > 0 && paginated.every(l => selected.includes(l.uniqueId))}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  <th onClick={() => toggleSort('fullName')}>Name <SortIcon field="fullName" /></th>
                  <th onClick={() => toggleSort('lead_status')}>Status <SortIcon field="lead_status" /></th>
                  <th onClick={() => toggleSort('createdAt')}>Created <SortIcon field="createdAt" /></th>
                  <th>Age</th>
                  <th onClick={() => toggleSort('leadSource')}>Lead Source <SortIcon field="leadSource" /></th>
                  <th onClick={() => toggleSort('interaction')}>Interaction <SortIcon field="interaction" /></th>
                  <th onClick={() => toggleSort('studyPlans')}>Study Plans <SortIcon field="studyPlans" /></th>
                  <th>Destination</th>
                  <th onClick={() => toggleSort('timeline')}>Timeline <SortIcon field="timeline" /></th>
                  <th onClick={() => toggleSort('englishLevel')}>English <SortIcon field="englishLevel" /></th>
                  <th onClick={() => toggleSort('gpa')}>GPA <SortIcon field="gpa" /></th>
                  <th onClick={() => toggleSort('preferredSocial')}>Social <SortIcon field="preferredSocial" /></th>
                  <th onClick={() => toggleSort('schoolEvent')}>School/Event <SortIcon field="schoolEvent" /></th>
                  <th onClick={() => toggleSort('stoneTier')}>Tier <SortIcon field="stoneTier" /></th>
                  <th onClick={() => toggleSort('riskScore')}>Score <SortIcon field="riskScore" /></th>
                  <th onClick={() => toggleSort('counselor')}>Counselor <SortIcon field="counselor" /></th>
                  <th onClick={() => toggleSort('close_date')}>Close Date <SortIcon field="close_date" /></th>
                  <th onClick={() => toggleSort('confidence')}>Confidence <SortIcon field="confidence" /></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(lead => (
                  <tr key={lead.uniqueId}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/leads/${lead.uniqueId}`)}>
                    {isManager && (
                      <td onClick={e => { e.stopPropagation(); toggleSelect(lead.uniqueId); }}>
                        <input type="checkbox" checked={selected.includes(lead.uniqueId)} onChange={() => {}} />
                      </td>
                    )}
                    <td style={{ fontWeight: 500 }}>{lead.fullName || '—'}</td>
                    <td>{statusBadge(lead.lead_status || lead.leadStatus || 'New')}</td>
                    <td style={{ fontFamily: 'DM Mono', fontSize: '0.8125rem' }}>
                      {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td>{getLeadAge(lead.createdAt)}</td>
                    <td>{lead.leadSource || '—'}</td>
                    <td>{lead.interaction || '—'}</td>
                    <td>{lead.studyPlans || '—'}</td>
                    <td>{lead.destinationCountry || '—'}</td>
                    <td>{lead.timeline || '—'}</td>
                    <td>{lead.englishLevel || '—'}</td>
                    <td>{lead.gpa || '—'}</td>
                    <td>{lead.preferredSocial || '—'}</td>
                    <td>{lead.schoolEvent || '—'}</td>
                    <td>{lead.stoneTier || '—'}</td>
                    <td style={{ fontFamily: 'DM Mono' }}>{lead.riskScore || '—'}</td>
                    <td>{lead.counselor || '—'}</td>
                    <td>{lead.close_date || '—'}</td>
                    <td>{lead.confidence || '—'}</td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={20} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                      No leads found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-pagination">
            <span>{filtered.length} leads</span>
            <div className="pagination-controls">
              <button className="btn btn--ghost btn--sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>← Prev</button>
              <span>Page {page} of {totalPages || 1}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page >= totalPages}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {/* Mass assign bar */}
      {isManager && selected.length > 0 && (
        <div className="mass-assign-bar">
          <span>{selected.length} selected</span>
          <select value={massField} onChange={e => setMassField(e.target.value)}>
            {Object.entries(FIELD_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={massValue} onChange={e => setMassValue(e.target.value)}>
            <option value="">Select staff...</option>
            {staffList.map(s => <option key={s.id} value={s.full_name}>{s.full_name}</option>)}
          </select>
          <button className="btn btn--primary btn--sm" onClick={handleMassAssign} disabled={!massValue}>
            Assign
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setSelected([])}
            style={{ color: '#fff' }}>Clear</button>
        </div>
      )}
    </div>
  );
}
