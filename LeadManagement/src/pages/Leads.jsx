// src/pages/Leads.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiSearch, FiChevronUp, FiChevronDown, FiFilter, FiX } from 'react-icons/fi';

const LEAD_STATUSES   = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];
const STONE_TIERS     = ['Diamond','Ruby','Sapphire','Agate','Quartz'];
const CONFIDENCE_OPTS = ['Low (0-30%)','Medium (31-60%)','High (61-90%)','Committed (91-100%)'];
const STUDY_PLANS     = ['Study Abroad','Study in Vietnam','Language Course','Short Course'];
const ENGLISH_LEVELS  = ['IELTS 5.5','IELTS 6.0','IELTS 6.5','IELTS 7+','TOEFL','Other','None'];
const TIMELINES       = ['0-3 months','3-6 months','6-12 months','12-24 months','24-36 months','36+ months'];
const INTERACTIONS    = ['Walk-in','Referral','Online','Event','Cold Call','Social Media','Other'];

const EMPTY_FILTERS = {
  search:'', leadStatus:'', stoneTier:'', leadSource:'', studyPlans:'',
  englishLevel:'', timeline:'', interaction:'', destinationCountry:'',
  gpa:'', budget:'', confidence:'', counselor:'', seniorCounselor:'',
  presales:'', marketingStaff:'', dateFrom:'', dateTo:'',
  closeDateFrom:'', closeDateTo:'',
};

function statusBadge(status) {
  const map = {
    'New':'new','Contacted':'contacted','Qualified':'qualified',
    'Proposal':'proposal','Negotiation':'negotiation',
    'Won':'won','Lost':'lost','On Hold':'on-hold',
  };
  return <span className={`badge badge--${map[status]||'new'}`}>{status||'New'}</span>;
}

function getLeadAge(createdAt) {
  if (!createdAt) return '—';
  return `${Math.floor((Date.now()-new Date(createdAt))/86400000)}d`;
}

function matchesSearch(value, pattern) {
  if (!pattern) return true;
  if (!value) return false;
  const v = String(value).toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*') && p.endsWith('*')) return v.includes(p.slice(1,-1));
  if (p.endsWith('*')) return v.startsWith(p.slice(0,-1));
  if (p.startsWith('*')) return v.endsWith(p.slice(1));
  return v.includes(p);
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="form-group" style={{ margin:0 }}>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FilterDate({ label, value, onChange }) {
  return (
    <div className="form-group" style={{ margin:0 }}>
      <label className="form-label">{label}</label>
      <input className="form-input" type="date" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

export default function Leads() {
  const [leads, setLeads]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filters, setFilters]         = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField]     = useState('createdAt');
  const [sortDir, setSortDir]         = useState('desc');
  const [selected, setSelected]       = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [massField, setMassField]     = useState('counselor');
  const [massValue, setMassValue]     = useState('');
  const [page, setPage]               = useState(1);
  const PER_PAGE = 25;

  const { isManager, staff } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadLeads();
    staffAPI.listActive().then(d => setStaffList(d.data||[])).catch(()=>{});
  }, []);

  async function loadLeads() {
    setLoading(true);
    try {
      const data = await studentAPI.search('');
      setLeads(data.data||[]);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  function setFilter(key, value) { setFilters(f=>({...f,[key]:value})); setPage(1); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setPage(1); }
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function toggleSort(field) {
    if (sortField===field) setSortDir(d=>d==='asc'?'desc':'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }) {
    if (sortField!==field) return <span style={{opacity:0.2,fontSize:'0.65rem'}}>↕</span>;
    return sortDir==='asc' ? <FiChevronUp size={11}/> : <FiChevronDown size={11}/>;
  }

  const uniqueValues = useMemo(() => {
    const get = key => [...new Set(leads.map(l=>l[key]).filter(Boolean))].sort();
    return {
      leadSource: get('leadSource'), destinationCountry: get('destinationCountry'),
      gpa: get('gpa'), budget: get('budget'), counselor: get('counselor'),
      seniorCounselor: get('seniorCounselor'), presales: get('presales'),
      marketingStaff: get('marketingStaff'),
    };
  }, [leads]);

  const filtered = useMemo(() => {
    let r = leads;
    if (filters.search) r = r.filter(l =>
      matchesSearch(l.fullName,filters.search) || matchesSearch(l.email,filters.search) ||
      matchesSearch(l.phone,filters.search)    || matchesSearch(l.uniqueId,filters.search)
    );
    if (filters.leadStatus)         r = r.filter(l => (l.leadStatus||'New')===filters.leadStatus);
    if (filters.stoneTier)          r = r.filter(l => l.stoneTier===filters.stoneTier);
    if (filters.leadSource)         r = r.filter(l => matchesSearch(l.leadSource,filters.leadSource));
    if (filters.studyPlans)         r = r.filter(l => matchesSearch(l.studyPlans,filters.studyPlans));
    if (filters.englishLevel)       r = r.filter(l => l.englishLevel===filters.englishLevel);
    if (filters.timeline)           r = r.filter(l => matchesSearch(l.timeline,filters.timeline));
    if (filters.interaction)        r = r.filter(l => matchesSearch(l.interaction,filters.interaction));
    if (filters.destinationCountry) r = r.filter(l => matchesSearch(l.destinationCountry,filters.destinationCountry));
    if (filters.gpa)                r = r.filter(l => matchesSearch(l.gpa,filters.gpa));
    if (filters.budget)             r = r.filter(l => matchesSearch(l.budget,filters.budget));
    if (filters.confidence)         r = r.filter(l => l.confidence===filters.confidence);
    if (filters.counselor)          r = r.filter(l => matchesSearch(l.counselor,filters.counselor));
    if (filters.seniorCounselor)    r = r.filter(l => matchesSearch(l.seniorCounselor,filters.seniorCounselor));
    if (filters.presales)           r = r.filter(l => matchesSearch(l.presales,filters.presales));
    if (filters.marketingStaff)     r = r.filter(l => matchesSearch(l.marketingStaff,filters.marketingStaff));
    if (filters.dateFrom)           r = r.filter(l => l.createdAt && new Date(l.createdAt)>=new Date(filters.dateFrom));
    if (filters.dateTo)             r = r.filter(l => l.createdAt && new Date(l.createdAt)<=new Date(filters.dateTo+'T23:59:59'));
    if (filters.closeDateFrom)      r = r.filter(l => l.closeDate && new Date(l.closeDate)>=new Date(filters.closeDateFrom));
    if (filters.closeDateTo)        r = r.filter(l => l.closeDate && new Date(l.closeDate)<=new Date(filters.closeDateTo+'T23:59:59'));
    if (!isManager && staff?.role==='Counselor') {
      r = r.filter(l =>
        l.counselor===staff.fullName || l.seniorCounselor===staff.fullName ||
        l.presales===staff.fullName  || l.marketingStaff===staff.fullName
      );
    }
    return [...r].sort((a,b) => {
      const av=a[sortField]||'', bv=b[sortField]||'';
      return sortDir==='asc' ? (av>bv?1:-1) : (av<bv?1:-1);
    });
  }, [leads,filters,sortField,sortDir,isManager,staff]);

  const totalPages = Math.ceil(filtered.length/PER_PAGE);
  const paginated  = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);

  function toggleSelect(id) { setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]); }
  function toggleAll() {
    const pageIds = paginated.map(l=>l.uniqueId);
    const allSel  = pageIds.every(id=>selected.includes(id));
    setSelected(allSel ? selected.filter(id=>!pageIds.includes(id)) : [...new Set([...selected,...pageIds])]);
  }

  async function handleMassAssign() {
    if (!massValue||selected.length===0) return;
    try {
      await staffAPI.massAssign(selected,massField,massValue);
      await loadLeads(); setSelected([]);
    } catch(e) { alert(e.message); }
  }

  const FIELD_LABELS = {
    counselor:'Counselor', seniorCounselor:'Senior Counselor',
    presales:'Pre-Sales',  marketingStaff:'Marketing Staff',
  };

  if (loading) return <div className="loading-center">Loading leads...</div>;

  const th = (label, field) => (
    <th onClick={()=>toggleSort(field)} style={{cursor:'pointer',whiteSpace:'nowrap'}}>
      {label} <SortIcon field={field}/>
    </th>
  );

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Leads ({filtered.length})</span>
      </div>

      <div className="page-body">
        <div className="table-toolbar">
          <div className="search-input-wrap">
            <FiSearch size={15}/>
            <input className="search-input"
              placeholder="Search name, email, phone, ID... (use * as wildcard)"
              value={filters.search}
              onChange={e=>setFilter('search',e.target.value)}
            />
            {filters.search && (
              <button style={{background:'none',border:'none',cursor:'pointer',padding:'0 4px'}}
                onClick={()=>setFilter('search','')}>
                <FiX size={13}/>
              </button>
            )}
          </div>

          <button className={`btn btn--sm ${showFilters?'btn--primary':'btn--secondary'}`}
            onClick={()=>setShowFilters(f=>!f)}
            style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
            <FiFilter size={13}/> Filters
            {activeFilterCount>0 && (
              <span style={{background:'var(--danger)',color:'#fff',borderRadius:'999px',
                fontSize:'0.7rem',padding:'0 5px',minWidth:'16px',textAlign:'center'}}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {activeFilterCount>0 && (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear all</button>
          )}
        </div>

        {showFilters && (
          <div style={{
            background:'var(--bg-secondary)',border:'1px solid var(--border)',
            borderRadius:'10px',padding:'1rem',marginBottom:'1rem',
            display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))',gap:'0.75rem'
          }}>
            <FilterSelect label="Status"           value={filters.leadStatus}         onChange={v=>setFilter('leadStatus',v)}         options={LEAD_STATUSES}/>
            <FilterSelect label="Stone Tier"        value={filters.stoneTier}          onChange={v=>setFilter('stoneTier',v)}          options={STONE_TIERS}/>
            <FilterSelect label="Lead Source"       value={filters.leadSource}         onChange={v=>setFilter('leadSource',v)}         options={uniqueValues.leadSource}/>
            <FilterSelect label="Interaction"       value={filters.interaction}        onChange={v=>setFilter('interaction',v)}        options={INTERACTIONS}/>
            <FilterSelect label="Study Plans"       value={filters.studyPlans}         onChange={v=>setFilter('studyPlans',v)}         options={STUDY_PLANS}/>
            <FilterSelect label="Destination"       value={filters.destinationCountry} onChange={v=>setFilter('destinationCountry',v)} options={uniqueValues.destinationCountry}/>
            <FilterSelect label="Timeline"          value={filters.timeline}           onChange={v=>setFilter('timeline',v)}           options={TIMELINES}/>
            <FilterSelect label="English Level"     value={filters.englishLevel}       onChange={v=>setFilter('englishLevel',v)}       options={ENGLISH_LEVELS}/>
            <FilterSelect label="GPA"               value={filters.gpa}                onChange={v=>setFilter('gpa',v)}                options={uniqueValues.gpa}/>
            <FilterSelect label="Budget"            value={filters.budget}             onChange={v=>setFilter('budget',v)}             options={uniqueValues.budget}/>
            <FilterSelect label="Confidence"        value={filters.confidence}         onChange={v=>setFilter('confidence',v)}         options={CONFIDENCE_OPTS}/>
            <FilterSelect label="Counselor"         value={filters.counselor}          onChange={v=>setFilter('counselor',v)}          options={uniqueValues.counselor}/>
            <FilterSelect label="Senior Counselor"  value={filters.seniorCounselor}    onChange={v=>setFilter('seniorCounselor',v)}    options={uniqueValues.seniorCounselor}/>
            <FilterSelect label="Pre-Sales"         value={filters.presales}           onChange={v=>setFilter('presales',v)}           options={uniqueValues.presales}/>
            <FilterSelect label="Marketing Staff"   value={filters.marketingStaff}     onChange={v=>setFilter('marketingStaff',v)}     options={uniqueValues.marketingStaff}/>
            <FilterDate   label="Created From"      value={filters.dateFrom}           onChange={v=>setFilter('dateFrom',v)}/>
            <FilterDate   label="Created To"        value={filters.dateTo}             onChange={v=>setFilter('dateTo',v)}/>
            <FilterDate   label="Close Date From"   value={filters.closeDateFrom}      onChange={v=>setFilter('closeDateFrom',v)}/>
            <FilterDate   label="Close Date To"     value={filters.closeDateTo}        onChange={v=>setFilter('closeDateTo',v)}/>
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
                        checked={paginated.length>0 && paginated.every(l=>selected.includes(l.uniqueId))}
                        onChange={toggleAll}/>
                    </th>
                  )}
                  {th('Name','fullName')}
                  {th('Status','leadStatus')}
                  {th('Created','createdAt')}
                  <th style={{whiteSpace:'nowrap'}}>Age</th>
                  {th('Lead Source','leadSource')}
                  {th('Interaction','interaction')}
                  {th('Study Plans','studyPlans')}
                  {th('Destination','destinationCountry')}
                  {th('Timeline','timeline')}
                  {th('English','englishLevel')}
                  {th('GPA','gpa')}
                  {th('Budget','budget')}
                  {th('Tier','stoneTier')}
                  {th('Score','riskScore')}
                  {th('Counselor','counselor')}
                  {th('Sr. Counselor','seniorCounselor')}
                  {th('Pre-Sales','presales')}
                  {th('Marketing','marketingStaff')}
                  {th('Close Date','closeDate')}
                  {th('Confidence','confidence')}
                </tr>
              </thead>
              <tbody>
                {paginated.map(lead => (
                  <tr key={lead.uniqueId} style={{cursor:'pointer'}}
                    onClick={()=>navigate(`/leads/${lead.uniqueId}`)}>
                    {isManager && (
                      <td onClick={e=>{e.stopPropagation();toggleSelect(lead.uniqueId);}}>
                        <input type="checkbox" checked={selected.includes(lead.uniqueId)} onChange={()=>{}}/>
                      </td>
                    )}
                    <td style={{fontWeight:500}}>{lead.fullName||'—'}</td>
                    <td>{statusBadge(lead.leadStatus||'New')}</td>
                    <td style={{fontFamily:'DM Mono',fontSize:'0.8125rem'}}>
                      {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td>{getLeadAge(lead.createdAt)}</td>
                    <td>{lead.leadSource||'—'}</td>
                    <td>{lead.interaction||'—'}</td>
                    <td>{lead.studyPlans||'—'}</td>
                    <td>{lead.destinationCountry||'—'}</td>
                    <td>{lead.timeline||'—'}</td>
                    <td>{lead.englishLevel||'—'}</td>
                    <td>{lead.gpa||'—'}</td>
                    <td>{lead.budget||'—'}</td>
                    <td>{lead.stoneTier||'—'}</td>
                    <td style={{fontFamily:'DM Mono'}}>{lead.riskScore||'—'}</td>
                    <td>{lead.counselor||'—'}</td>
                    <td>{lead.seniorCounselor||'—'}</td>
                    <td>{lead.presales||'—'}</td>
                    <td>{lead.marketingStaff||'—'}</td>
                    <td>{lead.closeDate ? new Date(lead.closeDate).toLocaleDateString() : '—'}</td>
                    <td>{lead.confidence||'—'}</td>
                  </tr>
                ))}
                {paginated.length===0 && (
                  <tr>
                    <td colSpan={22} style={{textAlign:'center',color:'var(--text-secondary)',padding:'2rem'}}>
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
              <button className="btn btn--ghost btn--sm" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>← Prev</button>
              <span>Page {page} of {totalPages||1}</span>
              <button className="btn btn--ghost btn--sm" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {isManager && selected.length>0 && (
        <div className="mass-assign-bar">
          <span>{selected.length} selected</span>
          <select value={massField} onChange={e=>setMassField(e.target.value)}>
            {Object.entries(FIELD_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
          <select value={massValue} onChange={e=>setMassValue(e.target.value)}>
            <option value="">Select staff...</option>
            {staffList.map(s=><option key={s.id} value={s.fullName}>{s.fullName}</option>)}
          </select>
          <button className="btn btn--primary btn--sm" onClick={handleMassAssign} disabled={!massValue}>Assign</button>
          <button className="btn btn--ghost btn--sm" onClick={()=>setSelected([])} style={{color:'#fff'}}>Clear</button>
        </div>
      )}
    </div>
  );
}
