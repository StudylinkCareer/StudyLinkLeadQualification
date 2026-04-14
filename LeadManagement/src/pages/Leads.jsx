// src/pages/Leads.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { studentAPI, staffAPI, columnConfigAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Watermark from '../components/Watermark';
import { FiSearch, FiChevronUp, FiChevronDown, FiFilter, FiX, FiSettings, FiEye, FiEyeOff } from 'react-icons/fi';

// ── Default column definitions ────────────────────────────────
const DEFAULT_COLUMNS = [
  { key:'fullName',          label:'Name',           visible:true,  width:160 },
  { key:'leadStatus',        label:'Status',         visible:true,  width:110 },
  { key:'createdAt',         label:'Created',        visible:true,  width:100 },
  { key:'age',               label:'Age',            visible:true,  width:55  },
  { key:'leadSource',        label:'Lead Source',    visible:true,  width:120 },
  { key:'interaction',       label:'Interaction',    visible:true,  width:110 },
  { key:'studyPlans',        label:'Study Plans',    visible:true,  width:120 },
  { key:'destinationCountry',label:'Destination',    visible:true,  width:130 },
  { key:'timeline',          label:'Timeline',       visible:true,  width:110 },
  { key:'englishLevel',      label:'English',        visible:true,  width:100 },
  { key:'gpa',               label:'GPA',            visible:true,  width:70  },
  { key:'budget',            label:'Budget',         visible:true,  width:130 },
  { key:'stoneTier',         label:'Stone',          visible:true,  width:90  },
  { key:'riskScore',         label:'Score',          visible:true,  width:70  },
  { key:'counselor',         label:'Counselor',      visible:true,  width:130 },
  { key:'seniorCounselor',   label:'Sr. Counselor',  visible:false, width:130 },
  { key:'presales',          label:'Pre-Sales',      visible:false, width:120 },
  { key:'marketingStaff',    label:'Marketing',      visible:false, width:120 },
  { key:'closeDate',         label:'Close Date',     visible:true,  width:100 },
  { key:'confidence',        label:'Confidence',     visible:false, width:130 },
];

const LEAD_STATUSES = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];
const MULTI_KEYS = [
  'leadStatus','stoneTier','leadSource','studyPlans','englishLevel','timeline',
  'interaction','destinationCountry','gpa','budget','confidence',
  'counselor','seniorCounselor','presales','marketingStaff',
];
const EMPTY_FILTERS = {
  search:'',
  leadStatus:[], stoneTier:[], leadSource:[], studyPlans:[],
  englishLevel:[], timeline:[], interaction:[], destinationCountry:[],
  gpa:[], budget:[], confidence:[], counselor:[], seniorCounselor:[],
  presales:[], marketingStaff:[],
  dateFrom:'', dateTo:'', closeDateFrom:'', closeDateTo:'',
};

function statusBadge(status) {
  const map = { 'New':'new','Contacted':'contacted','Qualified':'qualified',
    'Proposal':'proposal','Negotiation':'negotiation','Won':'won','Lost':'lost','On Hold':'on-hold' };
  return <span className={`badge badge--${map[status]||'new'}`}>{status||'New'}</span>;
}

function getLeadAge(createdAt) {
  if (!createdAt) return '—';
  return `${Math.floor((Date.now()-new Date(createdAt))/86400000)}d`;
}

function matchesSearch(value, pattern) {
  if (!pattern) return true;
  if (!value) return false;
  const v = String(value).toLowerCase(), p = pattern.toLowerCase();
  if (p.startsWith('*') && p.endsWith('*')) return v.includes(p.slice(1,-1));
  if (p.endsWith('*')) return v.startsWith(p.slice(0,-1));
  if (p.startsWith('*')) return v.endsWith(p.slice(1));
  return v.includes(p);
}

// ── Multi-select filter pill ──────────────────────────────────
function MultiFilter({ label, selected, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const toggle = v => onChange(selected.includes(v) ? selected.filter(x=>x!==v) : [...selected,v]);
  const count = selected.length;
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        display:'flex',alignItems:'center',gap:'0.3rem',padding:'0.3rem 0.6rem',
        border:'1px solid var(--border)',borderRadius:'20px',cursor:'pointer',
        background: count>0 ? 'var(--primary)' : 'var(--bg-primary)',
        color: count>0 ? '#fff' : 'var(--text-secondary)',
        fontSize:'0.775rem',whiteSpace:'nowrap',
      }}>
        {count>0 ? `${label} (${count})` : label}
        <FiChevronDown size={10} style={{transform:open?'rotate(180deg)':'none',transition:'0.15s'}}/>
      </button>
      {open && (
        <div style={{
          position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:200,
          background:'var(--bg-primary)',border:'1px solid var(--border)',
          borderRadius:'8px',boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
          minWidth:'180px',maxHeight:'240px',overflowY:'auto',padding:'0.4rem 0',
        }}>
          {count>0 && (
            <div style={{padding:'0.2rem 0.6rem 0.4rem'}}>
              <button onClick={()=>onChange([])} style={{fontSize:'0.7rem',color:'var(--danger)',background:'none',border:'none',cursor:'pointer',padding:0}}>
                Clear
              </button>
            </div>
          )}
          {options.length===0 && <div style={{padding:'0.4rem 0.6rem',color:'var(--text-secondary)',fontSize:'0.775rem'}}>No values</div>}
          {options.map(opt=>(
            <label key={opt} style={{
              display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.3rem 0.6rem',
              cursor:'pointer',fontSize:'0.775rem',
              background:selected.includes(opt)?'var(--bg-secondary)':'transparent',
            }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={()=>toggle(opt)} style={{cursor:'pointer'}}/>
              <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Column settings panel ─────────────────────────────────────
function ColumnSettings({ columns, onUpdate, onClose, isAdmin }) {
  const [local, setLocal] = useState(columns.map(c=>({...c})));
  const dragIdx = useRef(null);

  function toggleVisible(key) {
    setLocal(cols => cols.map(c => c.key===key ? {...c, visible:!c.visible} : c));
  }

  function onDragStart(e, idx) { dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; }

  function onDragOver(e, idx) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const newCols = [...local];
    const [moved] = newCols.splice(dragIdx.current, 1);
    newCols.splice(idx, 0, moved);
    dragIdx.current = idx;
    setLocal(newCols);
  }

  function onDragEnd() { dragIdx.current = null; }
  function handleSave() { onUpdate(local); onClose(); }

  return (
    <div style={{
      position:'fixed',top:0,right:0,bottom:0,width:'320px',zIndex:300,
      background:'var(--bg-primary)',borderLeft:'1px solid var(--border)',
      boxShadow:'-4px 0 20px rgba(0,0,0,0.1)',display:'flex',flexDirection:'column',
    }}>
      <div style={{padding:'1rem',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontWeight:600,fontSize:'0.9375rem'}}>Column Settings</span>
        <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX size={16}/></button>
      </div>
      <div style={{padding:'0.75rem',borderBottom:'1px solid var(--border)',fontSize:'0.8rem',color:'var(--text-secondary)'}}>
        {isAdmin ? 'Drag to reorder • Toggle to show/hide • Changes apply to all users' : 'View only — Admin can change column settings'}
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'0.5rem 0'}}>
        {local.map((col, idx) => (
          <div key={col.key}
            draggable={isAdmin}
            onDragStart={e=>onDragStart(e,idx)}
            onDragOver={e=>onDragOver(e,idx)}
            onDragEnd={onDragEnd}
            style={{
              display:'flex',alignItems:'center',gap:'0.75rem',
              padding:'0.625rem 1rem',cursor:isAdmin?'grab':'default',
              borderBottom:'1px solid var(--border)',
              opacity: col.visible ? 1 : 0.45,
              background:'var(--bg-primary)',
            }}>
            {isAdmin && <span style={{color:'var(--text-secondary)',fontSize:'0.75rem',cursor:'grab'}}>⠿</span>}
            <span style={{flex:1,fontSize:'0.875rem'}}>{col.label}</span>
            {isAdmin ? (
              <button onClick={()=>toggleVisible(col.key)}
                style={{background:'none',border:'none',cursor:'pointer',color: col.visible ? 'var(--primary)' : 'var(--text-secondary)'}}>
                {col.visible ? <FiEye size={15}/> : <FiEyeOff size={15}/>}
              </button>
            ) : (
              <span style={{color: col.visible ? 'var(--primary)' : 'var(--text-secondary)'}}>
                {col.visible ? <FiEye size={15}/> : <FiEyeOff size={15}/>}
              </span>
            )}
          </div>
        ))}
      </div>
      {isAdmin && (
        <div style={{padding:'1rem',borderTop:'1px solid var(--border)',display:'flex',gap:'0.5rem'}}>
          <button className="btn btn--primary btn--sm" style={{flex:1}} onClick={handleSave}>Save for all users</button>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function Leads() {
  const [leads, setLeads]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filters, setFilters]         = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [columns, setColumns]         = useState(DEFAULT_COLUMNS);
  const [sortField, setSortField]     = useState('createdAt');
  const [sortDir, setSortDir]         = useState('desc');
  const [selected, setSelected]       = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [massField, setMassField]     = useState('counselor');
  const [massValue, setMassValue]     = useState('');
  const [page, setPage]               = useState(1);
  const colWidths = useRef({});
  const resizing  = useRef(null);
  const PER_PAGE  = 25;

  const { isManager, isAdmin, staff } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [drillIds, setDrillIds] = useState([]);

  useEffect(() => {
    loadLeads();
    staffAPI.listActive().then(d=>setStaffList(d.data||[])).catch(()=>{});
    columnConfigAPI.get('leads').then(d => {
      if (d.data) {
        setColumns(d.data);
        const widths = {};
        d.data.forEach(c => { widths[c.key] = c.width; });
        colWidths.current = widths;
      }
    }).catch(()=>{});
  }, []);

  // ── Apply drill-down filter from Dashboard ──────────────────
  useEffect(() => {
    const drill = location.state?.drillFilter;
    if (!drill) return;
    const { key, value } = drill;
    if (key === '_ids' && Array.isArray(value)) {
      setDrillIds(value);
    } else if (key === 'leadStatus' && value === 'active') {
      setFilters(f => ({
        ...f,
        leadStatus: ['New','Contacted','Qualified','Proposal','Negotiation','On Hold'],
      }));
    } else if (MULTI_KEYS.includes(key)) {
      setFilters(f => ({ ...f, [key]: [value] }));
    }
    setShowFilters(true);
    setPage(1);
    window.history.replaceState({}, '');
  }, [location.state]);

  async function loadLeads() {
    setLoading(true);
    try { const data = await studentAPI.search(''); setLeads(data.data||[]); }
    catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  function setFilter(key, value) { setFilters(f=>({...f,[key]:value})); setPage(1); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setPage(1); }

  const activeFilterCount = useMemo(() => {
    let n = filters.search ? 1 : 0;
    MULTI_KEYS.forEach(k => { if (filters[k]?.length>0) n++; });
    if (filters.dateFrom||filters.dateTo) n++;
    if (filters.closeDateFrom||filters.closeDateTo) n++;
    return n;
  }, [filters]);

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
      leadStatus:LEAD_STATUSES, stoneTier:get('stoneTier'), leadSource:get('leadSource'),
      studyPlans:get('studyPlans'), englishLevel:get('englishLevel'), timeline:get('timeline'),
      interaction:get('interaction'), destinationCountry:get('destinationCountry'),
      gpa:get('gpa'), budget:get('budget'), confidence:get('confidence'),
      counselor:get('counselor'), seniorCounselor:get('seniorCounselor'),
      presales:get('presales'), marketingStaff:get('marketingStaff'),
    };
  }, [leads]);

  const filtered = useMemo(() => {
    let r = leads;

    // ── Drill-down by specific IDs (from pipeline stats) ──────
    if (drillIds.length > 0) {
      r = r.filter(l => drillIds.includes(l.uniqueId));
    }

    // ── Role-based scoping — ALL non-manager staff ──────────
    if (!isManager) {
      r = r.filter(l =>
        l.counselor       === staff?.fullName ||
        l.seniorCounselor === staff?.fullName ||
        l.presales        === staff?.fullName ||
        l.marketingStaff  === staff?.fullName
      );
    }

    // ── Text search ─────────────────────────────────────────
    if (filters.search) r = r.filter(l =>
      matchesSearch(l.fullName,filters.search) || matchesSearch(l.email,filters.search) ||
      matchesSearch(l.phone,filters.search)    || matchesSearch(l.uniqueId,filters.search)
    );

    // ── Multi-select filters ────────────────────────────────
    const mf = (arr, val) => !arr?.length || arr.includes(val);
    if (filters.leadStatus?.length)         r = r.filter(l => mf(filters.leadStatus, l.leadStatus||'New'));
    if (filters.stoneTier?.length)          r = r.filter(l => mf(filters.stoneTier, l.stoneTier));
    if (filters.leadSource?.length)         r = r.filter(l => mf(filters.leadSource, l.leadSource));
    if (filters.studyPlans?.length)         r = r.filter(l => mf(filters.studyPlans, l.studyPlans));
    if (filters.englishLevel?.length)       r = r.filter(l => mf(filters.englishLevel, l.englishLevel));
    if (filters.timeline?.length)           r = r.filter(l => mf(filters.timeline, l.timeline));
    if (filters.interaction?.length)        r = r.filter(l => mf(filters.interaction, l.interaction));
    if (filters.destinationCountry?.length) r = r.filter(l => mf(filters.destinationCountry, l.destinationCountry));
    if (filters.gpa?.length)                r = r.filter(l => mf(filters.gpa, l.gpa));
    if (filters.budget?.length)             r = r.filter(l => mf(filters.budget, l.budget));
    if (filters.confidence?.length)         r = r.filter(l => mf(filters.confidence, l.confidence));
    if (filters.counselor?.length)          r = r.filter(l => mf(filters.counselor, l.counselor));
    if (filters.seniorCounselor?.length)    r = r.filter(l => mf(filters.seniorCounselor, l.seniorCounselor));
    if (filters.presales?.length)           r = r.filter(l => mf(filters.presales, l.presales));
    if (filters.marketingStaff?.length)     r = r.filter(l => mf(filters.marketingStaff, l.marketingStaff));

    // ── Date filters ────────────────────────────────────────
    if (filters.dateFrom)      r = r.filter(l => l.createdAt && new Date(l.createdAt)>=new Date(filters.dateFrom));
    if (filters.dateTo)        r = r.filter(l => l.createdAt && new Date(l.createdAt)<=new Date(filters.dateTo+'T23:59:59'));
    if (filters.closeDateFrom) r = r.filter(l => l.closeDate && new Date(l.closeDate)>=new Date(filters.closeDateFrom));
    if (filters.closeDateTo)   r = r.filter(l => l.closeDate && new Date(l.closeDate)<=new Date(filters.closeDateTo+'T23:59:59'));

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
    try { await staffAPI.massAssign(selected,massField,massValue); await loadLeads(); setSelected([]); }
    catch(e) { alert(e.message); }
  }

  // ── Column resize ──────────────────────────────────────────
  function startResize(e, key) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths.current[key] || 120;
    resizing.current = { key, startX, startW };

    function onMove(ev) {
      if (!resizing.current) return;
      const { key, startX, startW } = resizing.current;
      const newW = Math.max(60, startW + (ev.clientX - startX));
      colWidths.current = { ...colWidths.current, [key]: newW };
      const th = document.querySelector(`th[data-col="${key}"]`);
      if (th) th.style.width = newW + 'px';
    }

    function onUp() {
      if (!resizing.current) return;
      const { key } = resizing.current;
      const newW = colWidths.current[key];
      resizing.current = null;
      setColumns(cols => {
        const updated = cols.map(c => c.key===key ? {...c, width:newW} : c);
        if (isAdmin) columnConfigAPI.save('leads', updated).catch(()=>{});
        return updated;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function handleColumnUpdate(newCols) {
    setColumns(newCols);
    try { await columnConfigAPI.save('leads', newCols); }
    catch(e) { alert('Failed to save column settings'); }
  }

  function renderCell(col, lead) {
    switch(col.key) {
      case 'fullName':    return <td key={col.key} style={{fontWeight:500}}>{lead.fullName||'—'}</td>;
      case 'leadStatus':  return <td key={col.key}>{statusBadge(lead.leadStatus||'New')}</td>;
      case 'createdAt':   return <td key={col.key} style={{fontFamily:'DM Mono',fontSize:'0.8125rem'}}>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'}</td>;
      case 'age':         return <td key={col.key}>{getLeadAge(lead.createdAt)}</td>;
      case 'riskScore':   return <td key={col.key} style={{fontFamily:'DM Mono'}}>{lead.riskScore||'—'}</td>;
      case 'closeDate':   return <td key={col.key}>{lead.closeDate ? new Date(lead.closeDate).toLocaleDateString() : '—'}</td>;
      default:            return <td key={col.key}>{lead[col.key]||'—'}</td>;
    }
  }

  const visibleCols = columns.filter(c=>c.visible);
  const FIELD_LABELS = { counselor:'Counselor', seniorCounselor:'Senior Counselor', presales:'Pre-Sales', marketingStaff:'Marketing Staff' };

  if (loading) return <div className="loading-center">Loading leads...</div>;

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">Leads ({filtered.length})</span>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {!isManager && (
            <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
              Your assigned leads
            </span>
          )}
          <button className="btn btn--ghost btn--icon" onClick={()=>setShowSettings(s=>!s)} title="Column settings">
            <FiSettings size={16}/>
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Toolbar */}
        <div className="table-toolbar">
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
          <div className="search-input-wrap" style={{flex:1}}>
            <FiSearch size={15}/>
            <input className="search-input"
              placeholder="Search name, email, phone, ID... (* wildcard)"
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
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div style={{
            background:'var(--bg-secondary)',border:'1px solid var(--border)',
            borderRadius:'10px',padding:'0.75rem',marginBottom:'1rem',
          }}>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.4rem',marginBottom:'0.5rem'}}>
              <MultiFilter label="Status"        selected={filters.leadStatus}         onChange={v=>setFilter('leadStatus',v)}         options={uniqueValues.leadStatus}/>
              <MultiFilter label="Stone"         selected={filters.stoneTier}          onChange={v=>setFilter('stoneTier',v)}          options={uniqueValues.stoneTier}/>
              <MultiFilter label="Source"        selected={filters.leadSource}         onChange={v=>setFilter('leadSource',v)}         options={uniqueValues.leadSource}/>
              <MultiFilter label="Interaction"   selected={filters.interaction}        onChange={v=>setFilter('interaction',v)}        options={uniqueValues.interaction}/>
              <MultiFilter label="Study Plans"   selected={filters.studyPlans}         onChange={v=>setFilter('studyPlans',v)}         options={uniqueValues.studyPlans}/>
              <MultiFilter label="Destination"   selected={filters.destinationCountry} onChange={v=>setFilter('destinationCountry',v)} options={uniqueValues.destinationCountry}/>
              <MultiFilter label="Timeline"      selected={filters.timeline}           onChange={v=>setFilter('timeline',v)}           options={uniqueValues.timeline}/>
              <MultiFilter label="English"       selected={filters.englishLevel}       onChange={v=>setFilter('englishLevel',v)}       options={uniqueValues.englishLevel}/>
              <MultiFilter label="GPA"           selected={filters.gpa}                onChange={v=>setFilter('gpa',v)}                options={uniqueValues.gpa}/>
              <MultiFilter label="Budget"        selected={filters.budget}             onChange={v=>setFilter('budget',v)}             options={uniqueValues.budget}/>
              <MultiFilter label="Confidence"    selected={filters.confidence}         onChange={v=>setFilter('confidence',v)}         options={uniqueValues.confidence}/>
              <MultiFilter label="Counselor"     selected={filters.counselor}          onChange={v=>setFilter('counselor',v)}          options={uniqueValues.counselor}/>
              <MultiFilter label="Sr. Counselor" selected={filters.seniorCounselor}    onChange={v=>setFilter('seniorCounselor',v)}    options={uniqueValues.seniorCounselor}/>
              <MultiFilter label="Pre-Sales"     selected={filters.presales}           onChange={v=>setFilter('presales',v)}           options={uniqueValues.presales}/>
              <MultiFilter label="Marketing"     selected={filters.marketingStaff}     onChange={v=>setFilter('marketingStaff',v)}     options={uniqueValues.marketingStaff}/>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'0.5rem',alignItems:'center'}}>
              <span style={{fontSize:'0.75rem',color:'var(--text-secondary)'}}>Created:</span>
              <input className="form-input" type="date" value={filters.dateFrom}
                onChange={e=>setFilter('dateFrom',e.target.value)}
                style={{width:'140px',padding:'0.25rem 0.5rem',fontSize:'0.775rem'}}/>
              <span style={{fontSize:'0.75rem',color:'var(--text-secondary)'}}>→</span>
              <input className="form-input" type="date" value={filters.dateTo}
                onChange={e=>setFilter('dateTo',e.target.value)}
                style={{width:'140px',padding:'0.25rem 0.5rem',fontSize:'0.775rem'}}/>
              <span style={{fontSize:'0.75rem',color:'var(--text-secondary)',marginLeft:'0.5rem'}}>Close:</span>
              <input className="form-input" type="date" value={filters.closeDateFrom}
                onChange={e=>setFilter('closeDateFrom',e.target.value)}
                style={{width:'140px',padding:'0.25rem 0.5rem',fontSize:'0.775rem'}}/>
              <span style={{fontSize:'0.75rem',color:'var(--text-secondary)'}}>→</span>
              <input className="form-input" type="date" value={filters.closeDateTo}
                onChange={e=>setFilter('closeDateTo',e.target.value)}
                style={{width:'140px',padding:'0.25rem 0.5rem',fontSize:'0.775rem'}}/>
            </div>
          </div>
        )}

        <div className="table-card">
          <div className="table-wrap" id="leads-table-wrap" style={{overflowX:"auto"}}>
            <table style={{tableLayout:'fixed'}}>
              <colgroup>
                {isManager && <col style={{width:'40px'}}/>}
                {visibleCols.map(c => (
                  <col key={c.key} style={{width:(colWidths.current[c.key]||c.width)+'px'}}/>
                ))}
              </colgroup>
              <thead>
                <tr>
                  {isManager && (
                    <th className="checkbox-col" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={paginated.length>0 && paginated.every(l=>selected.includes(l.uniqueId))}
                        onChange={e => { e.stopPropagation(); toggleAll(); }}
                        onClick={e => e.stopPropagation()}
                      />
                    </th>
                  )}
                  {visibleCols.map(col => (
                    <th key={col.key} data-col={col.key}
                      style={{
                        width:(colWidths.current[col.key]||col.width)+'px',
                        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                        position:'relative',userSelect:'none',
                      }}>
                      <span onClick={()=>col.key!=='age' && toggleSort(col.key)}
                        style={{cursor:col.key!=='age'?'pointer':'default',display:'inline-flex',alignItems:'center',gap:'3px'}}>
                        {col.label}
                        {col.key!=='age' && <SortIcon field={col.key}/>}
                      </span>
                      <span
                        onMouseDown={e=>startResize(e,col.key)}
                        style={{
                          position:'absolute',right:0,top:0,bottom:0,width:'5px',
                          cursor:'col-resize',background:'transparent',
                          borderRight:'2px solid transparent',
                        }}
                        onMouseEnter={e=>e.target.style.borderRightColor='var(--border)'}
                        onMouseLeave={e=>e.target.style.borderRightColor='transparent'}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(lead => (
                  <tr key={lead.uniqueId} style={{cursor:'pointer'}}
                    onClick={e => {
                      if (e.target.type === 'checkbox' || e.target.closest('td')?.classList.contains('checkbox-cell')) return;
                      navigate(`/leads/${lead.uniqueId}`);
                    }}>
                    {isManager && (
                      <td className="checkbox-cell" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.includes(lead.uniqueId)}
                          onChange={() => toggleSelect(lead.uniqueId)}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                    )}
                    {visibleCols.map(col => renderCell(col, lead))}
                  </tr>
                ))}
                {paginated.length===0 && (
                  <tr>
                    <td colSpan={visibleCols.length+(isManager?1:0)}
                      style={{textAlign:'center',color:'var(--text-secondary)',padding:'2rem'}}>
                      No leads found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{overflowX:'auto',padding:'2px 0'}}>
            <div style={{height:'8px',minWidth:'100%'}}/>
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

      {/* Mass assign bar */}
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
          {isAdmin && (
            <button className="btn btn--sm" onClick={handleMassDelete}
              style={{background:'var(--danger)',color:'#fff',border:'none'}}>
              🗑 Delete
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={()=>setSelected([])} style={{color:'#fff'}}>Clear</button>
        </div>
      )}

      {/* Column settings panel */}
      {showSettings && (
        <ColumnSettings
          columns={columns}
          onUpdate={handleColumnUpdate}
          onClose={()=>setShowSettings(false)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
