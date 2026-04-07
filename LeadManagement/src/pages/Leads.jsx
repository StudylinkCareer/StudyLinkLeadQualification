// src/pages/Leads.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiSearch, FiChevronUp, FiChevronDown, FiFilter, FiX } from 'react-icons/fi';

const LEAD_STATUSES     = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];
const STONE_TIERS       = ['Diamond','Ruby','Sapphire','Agate','Quartz'];
const CONFIDENCE_OPTS   = ['Low (0-30%)','Medium (31-60%)','High (61-90%)','Committed (91-100%)'];
const STUDY_PLANS       = ['Study Abroad','Study in Vietnam','Language Course','Short Course'];
const ENGLISH_LEVELS    = ['IELTS 5.5','IELTS 6.0','IELTS 6.5','IELTS 7+','TOEFL','Other','None'];

const EMPTY_FILTERS = {
  search:         '',
  leadStatus:     '',
  stoneTier:      '',
  leadSource:     '',
  studyPlans:     '',
  englishLevel:   '',
  counselor:      '',
  seniorCounselor:'',
  presales:       '',
  marketingStaff: '',
  dateFrom:       '',
  dateTo:         '',
};

function statusBadge(status) {
  const map = {
    'New':'new','Contacted':'contacted','Qualified':'qualified',
    'Proposal':'proposal','Negotiation':'negotiation',
    'Won':'won','Lost':'lost','On Hold':'on-hold',
  };
  return <span className={`badge badge--${map[status] || 'new'}`}>{status || 'New'}</span>;
}

function getLeadAge(createdAt) {
  if (!createdAt) return '—';
  const days = Math.floor((Date.now() - new Date(createdAt)) / 86400000);
  return `${days}d`;
}

// Wildcard search: "Huy*" = starts with, "*Huy*" = contains, "Huy" = contains
function matchesSearch(value, pattern) {
  if (!pattern) return true;
  if (!value) return false;
  const v = String(value).toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*') && p.endsWith('*')) return v.includes(p.slice(1, -1));
  if (p.endsWith('*')) return v.startsWith(p.slice(0, -1));
  if (p.startsWith('*')) return v.endsWith(p.slice(1));
  return v.includes(p);
}

export default function Leads() {
  const [leads, setLeads]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filters, setFilters]     = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir]     = useState('desc');
  const [selected, setSelected]   = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [massField, setMassField] = useState('counselor');
  const [massValue, setMassValue] = useState('');
  const [page, setPage]           = useState(1);
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
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return <span style={{ opacity: 0.2, fontSize: '0.65rem' }}>↕</span>;
    return sortDir === 'asc' ? <FiChevronUp size={11} /> : <FiChevronDown size={11} />;
  }

  // Unique values for filter dropdowns
  const uniqueValues = useMemo(() => {
    const get = (key) => [...new Set(leads.map(l => l[key]).filter(Boolean))].sort();
    return {
      leadSource:  get('leadSource'),
      counselor:   get('counselor'),
      seniorCounselor: get('seniorCounselor'),
      presales:    get('presales'),
      marketingStaff: get('marketingStaff'),
    };
  }, [leads]);

  const filtered = useMemo(() => {
    let result = leads;

    // Global search across key fields
    if (filters.search) {
      result = result.filter(l =>
        matchesSearch(l.fullName,   filters.search) ||
        matchesSearch(l.email,      filters.search) ||
        matchesSearch(l.phone,      filters.search) ||
        matchesSearch(l.uniqueId,   filters.search)
      );
    }

    // Dropdown filters
    if (filters.leadStatus)      result = result.filter(l => (l.leadStatus || 'New') === filters.leadStatus);
    if (filters.stoneTier)       result = result.filter(l => l.stoneTier === filters.stoneTier);
    if (filters.leadSource)      result = result.filter(l => matchesSearch(l.leadSource, filters.leadSource));
    if (filters.studyPlans)      result = result.filter(l => matchesSearch(l.studyPlans, filters.studyPlans));
    if (filters.englishLevel)    result = result.filter(l => l.englishLevel === filters.englishLevel);
    if (filters.counselor)       result = result.filter(l => matchesSearch(l.counselor, filters.counselor));
    if (filters.seniorCounselor) result = result.filter(l => matchesSearch(l.seniorCounselor, filters.seniorCounselor));
    if (filters.presales)        result = result.filter(l => matchesSearch(l.presales, filters.presales));
    if (filters.marketingStaff)  result = result.filter(l => matchesSearch(l.marketingStaff, filters.marketingStaff));

    // Date range
    if (filters.dateFrom) result = result.filter(l => l.createdAt && new Date(l.createdAt) >= new Date(filters.dateFrom));
    if (filters.dateTo)   result = result.filter(l => l.createdAt && new Date(l.createdAt) <= new Date(filters.dateTo + 'T23:59:59'));

    // Role-based filter
    if (!isManager && staff?.role === 'Counselor') {
      result = result.filter(l =>
        l.counselor       === staff.fullName ||
        l.seniorCounselor === staff.fullName ||
        l.presales        === staff.fullName ||
        l.marketingStaff  === staff.fullName
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let av = a[sortField] || '';
      let bv = b[sortField] || '';
      if (sortDir === 'asc') return av > bv ? 1 : -1;
      return av < bv ? 1 : -1;
    });

    return result;
  }, [leads, filters, sortField, sortDir, isManager, staff]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  function toggleAll() {
    const pageIds = paginated.map(l => l.uniqueId);
    const allSelected = pageIds.every(id => selected.includes(id));
    setSelected(allSelected
      ? selected.filter(id => !pageIds.includes(id))
      : [...new Set([...selected, ...pageIds])]);
  }

  async function handleMassAssign() {
    if (!massValue || selected.length === 0) return;
    try {
      await staffAPI.massAssign(selected, massField, massValue);
      await loadLeads();
      setSelected([]);
    } catch (e) { alert(e.message); }
  }

  const FIELD_LABELS = {
    counselor:       'Counselor',
    seniorCounselor: 'Senior Counselor',
    presales:        'Pre-Sales',
    marketingStaff:  'Marketing Staff',
  };

  if (loading) return <div className="loading-center">Loading leads...</div>;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Leads ({filtered.length})</span>
      </div>

      <div className="page-body">
        {/* Toolbar */}
        <div className="table-toolbar">
          <div className="search-input-wrap">
            <FiSearch size={15} />
            <input
              className="search-input"
              placeholder="Search name, email, phone, ID... (use * as wildcard)"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
            />
            {filters.search && (
              <button style={{ background:'none', border:'none', cursor:'pointer', padding:'0 4px' }}
                onClick={() => setFilter('search', '')}>
                <FiX size={13} />
              </button>
            )}
          </div>

          <button
            className={`btn btn--sm ${showFilters ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setShowFilters(f => !f)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FiFilter size={13} />
            Filters
            {activeFilterCount > 0 && (
              <span style={{
                background: 'var(--danger)', color: '#fff', borderRadius: '999px',
                fontSize: '0.7rem', padding: '0 5px', minWidth: '16px', textAlign: 'center'
              }}>{activeFilterCount}</span>
            )}
          </button>

          {activeFilterCount > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters}>
              Clear all
            </button>
          )}
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: '10px', padding: '1rem', marginBottom: '1rem',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem'
          }}>
            {/* Status */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Status</label>
              <select className="form-select" value={filters.leadStatus} onChange={e => setFilter('leadStatus', e.target.value)}>
                <option value="">All</option>
                {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Stone Tier */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Stone Tier</label>
              <select className="form-select" value={filters.stoneTier} onChange={e => setFilter('stoneTier', e.target.value)}>
                <option value="">All</option>
                {STONE_TIERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Lead Source */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Lead Source</label>
              <select className="form-select" value={filters.leadSource} onChange={e => setFilter('leadSource', e.target.value)}>
                <option value="">All</option>
                {uniqueValues.leadSource.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Study Plans */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Study Plans</label>
              <select className="form-select" value={filters.studyPlans} onChange={e => setFilter('studyPlans', e.target.value)}>
                <option value="">All</option>
                {STUDY_PLANS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* English Level */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">English Level</label>
              <select className="form-select" value={filters.englishLevel} onChange={e => setFilter('englishLevel', e.target.value)}>
                <option value="">All</option>
                {ENGLISH_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Counselor */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Counselor</label>
              <select className="form-select" value={filters.counselor} onChange={e => setFilter('counselor', e.target.value)}>
                <option value="">All</option>
                {uniqueValues.counselor.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Senior Counselor */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Senior Counselor</label>
              <select className="form-select" value={filters.seniorCounselor} onChange={e => setFilter('seniorCounselor', e.target.value)}>
                <option value="">All</option>
                {uniqueValues.seniorCounselor.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Pre-Sales */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Pre-Sales</label>
              <select className="form-select" value={filters.presales} onChange={e => setFilter('presales', e.target.value)}>
                <option value="">All</option>
                {uniqueValues.presales.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Marketing Staff */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Marketing Staff</label>
              <select className="form-select" value={filters.marketingStaff} onChange={e => setFilter('marketingStaff', e.target.value)}>
                <option value="">All</option>
                {uniqueValues.marketingStaff.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Date From */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Created From</label>
              <input className="form-input" type="date" value={filters.dateFrom}
                onChange={e => setFilter('dateFrom', e.target.value)} />
            </div>

            {/* Date To */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Created To</label>
              <input className="form-input" type="date" value={filters.dateTo}
                onChange={e => setFilter('dateTo', e.target.value)} />
            </div>
          </div>
        )}

        <div className="table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isManager && (
                    <th className="checkbox-col">
                      <input type="checkbox"
                        checked={paginated.length > 0 && paginated.every(l => selected.includes(l.uniqueId))}
                        onChange={toggleAll} />
                    </th>
                  )}
                  <th onClick={() => toggleSort('fullName')} style={{ cursor:'pointer' }}>Name <SortIcon field="fullName" /></th>
                  <th onClick={() => toggleSort('leadStatus')} style={{ cursor:'pointer' }}>Status <SortIcon field="leadStatus" /></th>
                  <th onClick={() => toggleSort('createdAt')} style={{ cursor:'pointer' }}>Created <SortIcon field="createdAt" /></th>
                  <th>Age</th>
                  <th onClick={() => toggleSort('leadSource')} style={{ cursor:'pointer' }}>Lead Source <SortIcon field="leadSource" /></th>
                  <th onClick={() => toggleSort('interaction')} style={{ cursor:'pointer' }}>Interaction <SortIcon field="interaction" /></th>
                  <th onClick={() => toggleSort('studyPlans')} style={{ cursor:'pointer' }}>Study Plans <SortIcon field="studyPlans" /></th>
                  <th onClick={() => toggleSort('destinationCountry')} style={{ cursor:'pointer' }}>Destination <SortIcon field="destinationCountry" /></th>
                  <th onClick={() => toggleSort('timeline')} style={{ cursor:'pointer' }}>Timeline <SortIcon field="timeline" /></th>
                  <th onClick={() => toggleSort('englishLevel')} style={{ cursor:'pointer' }}>English <SortIcon field="englishLevel" /></th>
                  <th onClick={() => toggleSort('gpa')} style={{ cursor:'pointer' }}>GPA <SortIcon field="gpa" /></th>
                  <th onClick={() => toggleSort('budget')} style={{ cursor:'pointer' }}>Budget <SortIcon field="budget" /></th>
                  <th onClick={() => toggleSort('stoneTier')} style={{ cursor:'pointer' }}>Tier <SortIcon field="stoneTier" /></th>
                  <th onClick={() => toggleSort('riskScore')} style={{ cursor:'pointer' }}>Score <SortIcon field="riskScore" /></th>
                  <th onClick={() => toggleSort('counselor')} style={{ cursor:'pointer' }}>Counselor <SortIcon field="counselor" /></th>
                  <th onClick={() => toggleSort('seniorCounselor')} style={{ cursor:'pointer' }}>Sr. Counselor <SortIcon field="seniorCounselor" /></th>
                  <th onClick={() => toggleSort('presales')} style={{ cursor:'pointer' }}>Pre-Sales <SortIcon field="presales" /></th>
                  <th onClick={() => toggleSort('marketingStaff')} style={{ cursor:'pointer' }}>Marketing <SortIcon field="marketingStaff" /></th>
                  <th onClick={() => toggleSort('closeDate')} style={{ cursor:'pointer' }}>Close Date <SortIcon field="closeDate" /></th>
                  <th onClick={() => toggleSort('confidence')} style={{ cursor:'pointer' }}>Confidence <SortIcon field="confidence" /></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(lead => (
                  <tr key={lead.uniqueId} style={{ cursor:'pointer' }}
                    onClick={() => navigate(`/leads/${lead.uniqueId}`)}>
                    {isManager && (
                      <td onClick={e => { e.stopPropagation(); toggleSelect(lead.uniqueId); }}>
                        <input type="checkbox" checked={selected.includes(lead.uniqueId)} onChange={() => {}} />
                      </td>
                    )}
                    <td style={{ fontWeight: 500 }}>{lead.fullName || '—'}</td>
                    <td>{statusBadge(lead.leadStatus || 'New')}</td>
                    <td style={{ fontFamily:'DM Mono', fontSize:'0.8125rem' }}>
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
                    <td>{lead.budget || '—'}</td>
                    <td>{lead.stoneTier || '—'}</td>
                    <td style={{ fontFamily:'DM Mono' }}>{lead.riskScore || '—'}</td>
                    <td>{lead.counselor || '—'}</td>
                    <td>{lead.seniorCounselor || '—'}</td>
                    <td>{lead.presales || '—'}</td>
                    <td>{lead.marketingStaff || '—'}</td>
                    <td>{lead.closeDate ? new Date(lead.closeDate).toLocaleDateString() : '—'}</td>
                    <td>{lead.confidence || '—'}</td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={22} style={{ textAlign:'center', color:'var(--text-secondary)', padding:'2rem' }}>
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
            {staffList.map(s => <option key={s.id} value={s.fullName}>{s.fullName}</option>)}
          </select>
          <button className="btn btn--primary btn--sm" onClick={handleMassAssign} disabled={!massValue}>
            Assign
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setSelected([])} style={{ color:'#fff' }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
