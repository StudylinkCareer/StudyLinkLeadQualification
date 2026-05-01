// LeadManagement/src/pages/Leads.jsx
// CHANGES:
//   - MASTER_COLUMNS replaces DEFAULT_COLUMNS — includes 4 campaign fields
//   - Column config loaded per role: leads_admin / leads_manager / leads_director / leads_counselor
//   - Admin always sees all columns
//   - FILTER_CONFIG drives dynamic filter pills — only shown for visible columns
//   - Inline ColumnSettings panel removed (now a separate Admin-only settings page)

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { studentAPI, staffAPI, columnConfigAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Watermark from '../components/Watermark';
import { FiSearch, FiChevronUp, FiChevronDown, FiFilter, FiX, FiPrinter } from 'react-icons/fi';

// ── All possible columns (master list) ────────────────────────
// Grouped by section for Admin column settings readability
const MASTER_COLUMNS = [
  // ── Personal Details ──
  { key:'fullName',               label:'Name',                   visible:true,  width:160 },
  { key:'email',                  label:'Email',                  visible:false, width:190 },
  { key:'phone',                  label:'Phone',                  visible:false, width:130 },
  { key:'yearOfBirth',            label:'Year of Birth',          visible:false, width:110 },
  { key:'residency',              label:'Residency',              visible:false, width:140 },
  { key:'schoolEvent',            label:'School / Event',         visible:false, width:150 },
  { key:'preferredSocial',        label:'Social Platform',        visible:false, width:130 },
  { key:'socialConsent',          label:'Connect With Us',        visible:false, width:120 },
  // ── Lead Management ──
  { key:'leadStatus',             label:'Status',                 visible:true,  width:110 },
  { key:'createdAt',              label:'Created',                visible:true,  width:100 },
  { key:'age',                    label:'Age',                    visible:true,  width:55  },
  { key:'leadSource',             label:'Lead Source',            visible:true,  width:120 },
  { key:'interaction',            label:'Interaction',            visible:true,  width:110 },
  { key:'studyPlans',             label:'Study Plans',            visible:true,  width:120 },
  { key:'destinationCountry',     label:'Destination',            visible:true,  width:130 },
  { key:'timeline',               label:'Timeline',               visible:true,  width:110 },
  { key:'stoneTier',              label:'Stone',                  visible:true,  width:90  },
  { key:'riskScore',              label:'Score',                  visible:true,  width:70  },
  { key:'counselor',              label:'Counselor',              visible:true,  width:130 },
  { key:'seniorCounselor',        label:'Sr. Counselor',          visible:false, width:130 },
  { key:'presales',               label:'Pre-Sales',              visible:false, width:120 },
  { key:'marketingStaff',         label:'Marketing',              visible:false, width:120 },
  { key:'closeDate',              label:'Close Date',             visible:true,  width:100 },
  { key:'confidence',             label:'Confidence',             visible:false, width:130 },
  // ── Self Assessment ──
  { key:'budget',                 label:'Budget',                 visible:true,  width:130 },
  { key:'scholarshipDemand',      label:'Scholarship',            visible:false, width:130 },
  { key:'englishLevel',           label:'English',                visible:true,  width:100 },
  { key:'gpa',                    label:'GPA',                    visible:true,  width:70  },
  { key:'immigrationHistory',     label:'Immigration',            visible:false, width:160 },
  { key:'sponsorIncome',          label:'Sponsor Income',         visible:false, width:130 },
  { key:'incomeEvidence',         label:'Income Evidence',        visible:false, width:130 },
  { key:'studyPlanGap',           label:'Study Plan Gap',         visible:false, width:150 },
  { key:'ultimateObjective',      label:'Objective',              visible:false, width:150 },
  // ── Family Contacts ──
  { key:'motherFullName',         label:'Mother Name',            visible:false, width:140 },
  { key:'motherEmail',            label:'Mother Email',           visible:false, width:180 },
  { key:'motherPhone',            label:'Mother Phone',           visible:false, width:130 },
  { key:'motherContactMedium',    label:'Mother Medium',          visible:false, width:130 },
  { key:'fatherFullName',         label:'Father Name',            visible:false, width:140 },
  { key:'fatherEmail',            label:'Father Email',           visible:false, width:180 },
  { key:'fatherPhone',            label:'Father Phone',           visible:false, width:130 },
  { key:'fatherContactMedium',    label:'Father Medium',          visible:false, width:130 },
  // ── OCEAN Profile ──
  { key:'oceanExtraversion',      label:'OCEAN: Extraversion',    visible:false, width:150 },
  { key:'oceanAgreeableness',     label:'OCEAN: Agreeableness',   visible:false, width:155 },
  { key:'oceanConscientiousness', label:'OCEAN: Conscientious.',  visible:false, width:165 },
  { key:'oceanNeuroticism',       label:'OCEAN: Neuroticism',     visible:false, width:150 },
  { key:'oceanOpenness',          label:'OCEAN: Openness',        visible:false, width:140 },
  // ── Campaign / Event ──
  { key:'campaignType',           label:'Campaign Type',          visible:false, width:140 },
  { key:'campaignName',           label:'Campaign Name',          visible:false, width:160 },
  { key:'campaignStart',          label:'Camp. Start',            visible:false, width:120 },
  { key:'campaignEnd',            label:'Camp. End',              visible:false, width:120 },
];

// Maps staff role → config key suffix
const ROLE_KEY_MAP = {
  Admin:     'admin',
  Manager:   'manager',
  Director:  'director',
  Counselor: 'counselor',
};

// Sentinel for the "(none)" filter option — matches leads with empty/null value
// for that field. Stored as this string in the selected[] array; rendered as "(none)".
const NONE_VALUE = '__NONE__';

const LEAD_STATUSES = [
  'New',
  'Not contactable',
  'Engaged',
  'Vetted',
  'Met with customer and family',
  'Proposal',
  'Family negotiation/review',
  'Contracted',
  'Lost',
  'Nurturing',
  'Archived',
];

const MULTI_KEYS = [
  // Lead management
  'leadStatus','stoneTier','leadSource','studyPlans','englishLevel','timeline',
  'interaction','destinationCountry','gpa','budget','confidence',
  'counselor','seniorCounselor','presales','marketingStaff',
  // Personal
  'yearOfBirth','residency','schoolEvent','preferredSocial','socialConsent',
  // Self assessment
  'scholarshipDemand','immigrationHistory','sponsorIncome','incomeEvidence',
  'studyPlanGap','ultimateObjective',
  // Family
  'motherContactMedium','fatherContactMedium',
  // Campaign
  'campaignType','campaignName',
];

const EMPTY_FILTERS = {
  search:'',
  // Lead management
  leadStatus:[], stoneTier:[], leadSource:[], studyPlans:[],
  englishLevel:[], timeline:[], interaction:[], destinationCountry:[],
  gpa:[], budget:[], confidence:[], counselor:[], seniorCounselor:[],
  presales:[], marketingStaff:[],
  // Personal
  yearOfBirth:[], residency:[], schoolEvent:[], preferredSocial:[], socialConsent:[],
  // Self assessment
  scholarshipDemand:[], immigrationHistory:[], sponsorIncome:[],
  incomeEvidence:[], studyPlanGap:[], ultimateObjective:[],
  // Family
  motherContactMedium:[], fatherContactMedium:[],
  // Campaign
  campaignType:[], campaignName:[],
  // Date ranges
  dateFrom:'', dateTo:'', closeDateFrom:'', closeDateTo:'',
  campStartFrom:'', campStartTo:'', campEndFrom:'', campEndTo:'',
};

// ── Filter config — drives which filter controls render and for which column ──
const FILTER_CONFIG = [
  // Lead management
  { colKey:'leadStatus',         label:'Status',          type:'multi',     filterKey:'leadStatus' },
  { colKey:'stoneTier',          label:'Stone',           type:'multi',     filterKey:'stoneTier' },
  { colKey:'leadSource',         label:'Source',          type:'multi',     filterKey:'leadSource' },
  { colKey:'interaction',        label:'Interaction',     type:'multi',     filterKey:'interaction' },
  { colKey:'studyPlans',         label:'Study Plans',     type:'multi',     filterKey:'studyPlans' },
  { colKey:'destinationCountry', label:'Destination',     type:'multi',     filterKey:'destinationCountry' },
  { colKey:'timeline',           label:'Timeline',        type:'multi',     filterKey:'timeline' },
  { colKey:'englishLevel',       label:'English',         type:'multi',     filterKey:'englishLevel' },
  { colKey:'gpa',                label:'GPA',             type:'multi',     filterKey:'gpa' },
  { colKey:'budget',             label:'Budget',          type:'multi',     filterKey:'budget' },
  { colKey:'confidence',         label:'Confidence',      type:'multi',     filterKey:'confidence' },
  { colKey:'counselor',          label:'Counselor',       type:'multi',     filterKey:'counselor' },
  { colKey:'seniorCounselor',    label:'Sr. Counselor',   type:'multi',     filterKey:'seniorCounselor' },
  { colKey:'presales',           label:'Pre-Sales',       type:'multi',     filterKey:'presales' },
  { colKey:'marketingStaff',     label:'Marketing',       type:'multi',     filterKey:'marketingStaff' },
  // Personal
  { colKey:'yearOfBirth',        label:'Year of Birth',   type:'multi',     filterKey:'yearOfBirth' },
  { colKey:'residency',          label:'Residency',       type:'multi',     filterKey:'residency' },
  { colKey:'schoolEvent',        label:'School/Event',    type:'multi',     filterKey:'schoolEvent' },
  { colKey:'preferredSocial',    label:'Social Platform', type:'multi',     filterKey:'preferredSocial' },
  { colKey:'socialConsent',      label:'Connect With Us', type:'multi',     filterKey:'socialConsent' },
  // Self assessment
  { colKey:'scholarshipDemand',  label:'Scholarship',     type:'multi',     filterKey:'scholarshipDemand' },
  { colKey:'immigrationHistory', label:'Immigration',     type:'multi',     filterKey:'immigrationHistory' },
  { colKey:'sponsorIncome',      label:'Sponsor Income',  type:'multi',     filterKey:'sponsorIncome' },
  { colKey:'incomeEvidence',     label:'Income Evidence', type:'multi',     filterKey:'incomeEvidence' },
  { colKey:'studyPlanGap',       label:'Study Plan Gap',  type:'multi',     filterKey:'studyPlanGap' },
  { colKey:'ultimateObjective',  label:'Objective',       type:'multi',     filterKey:'ultimateObjective' },
  // Family
  { colKey:'motherContactMedium', label:'Mother Medium',  type:'multi',     filterKey:'motherContactMedium' },
  { colKey:'fatherContactMedium', label:'Father Medium',  type:'multi',     filterKey:'fatherContactMedium' },
  // Campaign
  { colKey:'campaignType',       label:'Campaign Type',   type:'multi',     filterKey:'campaignType' },
  { colKey:'campaignName',       label:'Campaign',        type:'multi',     filterKey:'campaignName' },
  // Date ranges
  { colKey:'createdAt',          label:'Created',         type:'daterange', fromKey:'dateFrom',      toKey:'dateTo' },
  { colKey:'closeDate',          label:'Close Date',      type:'daterange', fromKey:'closeDateFrom', toKey:'closeDateTo' },
  { colKey:'campaignStart',      label:'Camp. Start',     type:'daterange', fromKey:'campStartFrom', toKey:'campStartTo' },
  { colKey:'campaignEnd',        label:'Camp. End',       type:'daterange', fromKey:'campEndFrom',   toKey:'campEndTo' },
];

// ── Helpers ───────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    'New':'new','Contacted':'contacted','Qualified':'qualified',
    'Proposal':'proposal','Negotiation':'negotiation','Won':'won',
    'Lost':'lost','On Hold':'on-hold',
  };
  return <span className={`badge badge--${map[status]||'new'}`}>{status||'New'}</span>;
}

function getLeadAge(createdAt) {
  if (!createdAt) return '—';
  return `${Math.floor((Date.now() - new Date(createdAt)) / 86400000)}d`;
}

function matchesSearch(value, pattern) {
  if (!pattern) return true;
  if (!value) return false;
  const v = String(value).toLowerCase(), p = pattern.toLowerCase();
  if (p.startsWith('*') && p.endsWith('*')) return v.includes(p.slice(1, -1));
  if (p.endsWith('*')) return v.startsWith(p.slice(0, -1));
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

  const toggle = v => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const count = selected.length;

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display:'flex', alignItems:'center', gap:'0.3rem', padding:'0.3rem 0.6rem',
        border:'1px solid var(--border)', borderRadius:'20px', cursor:'pointer',
        background: count > 0 ? 'var(--primary)' : 'var(--bg-primary)',
        color: count > 0 ? '#fff' : 'var(--text-secondary)',
        fontSize:'0.775rem', whiteSpace:'nowrap',
      }}>
        {count > 0 ? `${label} (${count})` : label}
        <FiChevronDown size={10} style={{ transform:open ? 'rotate(180deg)' : 'none', transition:'0.15s' }}/>
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200,
          background:'var(--bg-primary)', border:'1px solid var(--border)',
          borderRadius:'8px', boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
          minWidth:'180px', maxHeight:'240px', overflowY:'auto', padding:'0.4rem 0',
        }}>
          {count > 0 && (
            <div style={{ padding:'0.2rem 0.6rem 0.4rem' }}>
              <button onClick={() => onChange([])} style={{
                fontSize:'0.7rem', color:'var(--danger)', background:'none',
                border:'none', cursor:'pointer', padding:0,
              }}>Clear</button>
            </div>
          )}
          {options.length === 0 && (
            <div style={{ padding:'0.4rem 0.6rem', color:'var(--text-secondary)', fontSize:'0.775rem' }}>
              No values
            </div>
          )}
          {/* (none) — match leads where this field is empty */}
          <label style={{
            display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.3rem 0.6rem',
            cursor:'pointer', fontSize:'0.775rem',
            background: selected.includes(NONE_VALUE) ? 'var(--bg-secondary)' : 'transparent',
            borderBottom:'1px solid var(--border)',
            fontStyle:'italic', color:'var(--text-secondary)',
          }}>
            <input type="checkbox" checked={selected.includes(NONE_VALUE)} onChange={() => toggle(NONE_VALUE)} style={{ cursor:'pointer' }}/>
            <span>(none)</span>
          </label>
          {options.map(opt => (
            <label key={opt} style={{
              display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.3rem 0.6rem',
              cursor:'pointer', fontSize:'0.775rem',
              background: selected.includes(opt) ? 'var(--bg-secondary)' : 'transparent',
            }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} style={{ cursor:'pointer' }}/>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{opt}</span>
            </label>
          ))}
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
  const [columns, setColumns]         = useState(MASTER_COLUMNS);
  const [sortField, setSortField]     = useState('createdAt');
  const [sortDir, setSortDir]         = useState('desc');
  const [selected, setSelected]       = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [massField, setMassField]     = useState('counselor');
  const [massValue, setMassValue]     = useState('');
  const [page, setPage]               = useState(1);
  const [printMode, setPrintMode]     = useState(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const colWidths = useRef({});
  const resizing  = useRef(null);
  const PER_PAGE  = 25;

  const { isManager, isAdmin, staff } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drillIds, setDrillIds] = useState([]);

  // Derive config key from role
  const roleKey = useMemo(() => {
    const r = staff?.role || 'Counselor';
    return ROLE_KEY_MAP[r] || 'counselor';
  }, [staff]);

  // ── Load leads + staff + role-based column config ──────────
  useEffect(() => {
    loadLeads();
    staffAPI.listActive()
      .then(d => setStaffList(
        (d.data || []).filter(s =>
          s.role === 'Counselor' && ['Quality','PreSales','Counselor'].includes(s.position)
        )
      ))
      .catch(() => {});

    columnConfigAPI.get(`leads_${roleKey}`).then(d => {
      if (d.data && d.data.length > 0) {
        if (isAdmin) {
          // Admin: merge saved config with master to ensure any new columns appear
          const savedKeys = new Set(d.data.map(c => c.key));
          const merged = [
            ...d.data.map(c => ({ ...c, visible: true })),     // admin always sees all
            ...MASTER_COLUMNS.filter(c => !savedKeys.has(c.key)).map(c => ({ ...c, visible: true })),
          ];
          setColumns(merged);
          const widths = {};
          merged.forEach(c => { widths[c.key] = c.width; });
          colWidths.current = widths;
        } else {
          // Non-admin: use saved config, merge in any new master columns at the end (hidden by default)
          const savedKeys = new Set(d.data.map(c => c.key));
          const merged = [
            ...d.data,
            ...MASTER_COLUMNS.filter(c => !savedKeys.has(c.key)).map(c => ({ ...c, visible: false })),
          ];
          setColumns(merged);
          const widths = {};
          merged.forEach(c => { widths[c.key] = c.width; });
          colWidths.current = widths;
        }
      } else {
        // No saved config — use defaults. Admin gets all visible.
        if (isAdmin) {
          const allVisible = MASTER_COLUMNS.map(c => ({ ...c, visible: true }));
          setColumns(allVisible);
          const widths = {};
          allVisible.forEach(c => { widths[c.key] = c.width; });
          colWidths.current = widths;
        }
        // Non-admin: keep MASTER_COLUMNS defaults (defined above with default visibility)
      }
    }).catch(() => {});
  }, [roleKey, isAdmin]);

  // ── Apply drill-down filter from Dashboard ─────────────────
  useEffect(() => {
    const drill = location.state?.drillFilter;
    if (!drill) return;
    const { key, value } = drill;
    if (key === '_ids' && Array.isArray(value)) {
      setDrillIds(value);
    } else if (key === 'leadStatus' && value === 'active') {
      setFilters(f => ({
        ...f,
        leadStatus: ['New','Not contactable','Engaged','Vetted','Met with customer and family','Proposal','Family negotiation/review','Nurturing'],
      }));
    } else if (MULTI_KEYS.includes(key)) {
      // Dashboard treats empty-stoneTier leads as the literal string 'Unscored';
      // map that to our NONE_VALUE sentinel so the filter actually matches them.
      const filterValue = (key === 'stoneTier' && value === 'Unscored') ? NONE_VALUE : value;
      setFilters(f => ({ ...f, [key]: [filterValue] }));
    }
    setShowFilters(true);
    setPage(1);
    window.history.replaceState({}, '');
  }, [location.state]);

  // ── Restore filter/sort/page state on mount ──
  // Only fires when arriving with the restoreFilters flag (back-arrow from a Lead detail).
  // Clicking "Leads" in the sidebar navigates without this flag, so filters reset.
  useEffect(() => {
    if (location.state?.drillFilter) return;
    if (!location.state?.restoreFilters) return;
    const saved = sessionStorage.getItem('leadsListState');
    if (!saved) return;
    try {
      const s = JSON.parse(saved);
      if (s.filters)              setFilters(s.filters);
      if (s.sortField)            setSortField(s.sortField);
      if (s.sortDir)              setSortDir(s.sortDir);
      if (typeof s.page === 'number') setPage(s.page);
      if (s.showFilters)          setShowFilters(true);
    } catch (e) {
      console.error('Failed to restore leads list state:', e);
    }
    window.history.replaceState({}, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist filter/sort/page state on change ──
  // Skip the first render so we don't overwrite saved state with empty initial values.
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    sessionStorage.setItem('leadsListState', JSON.stringify({
      filters, sortField, sortDir, page, showFilters,
    }));
  }, [filters, sortField, sortDir, page, showFilters]);

  async function loadLeads() {
    setLoading(true);
    try {
      const data = await studentAPI.search('');
      setLeads(data.data || []);
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function setFilter(key, value) { setFilters(f => ({ ...f, [key]: value })); setPage(1); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setPage(1); }

  // ── Visible columns set (O(1) lookup for filter rendering) ──
  const visibleColKeys = useMemo(
    () => new Set(columns.filter(c => c.visible).map(c => c.key)),
    [columns]
  );

  // ── Active filter count (for badge) ───────────────────────
  const activeFilterCount = useMemo(() => {
    let n = filters.search ? 1 : 0;
    MULTI_KEYS.forEach(k => { if (filters[k]?.length > 0) n++; });
    if (filters.dateFrom       || filters.dateTo)        n++;
    if (filters.closeDateFrom  || filters.closeDateTo)   n++;
    if (filters.campStartFrom  || filters.campStartTo)   n++;
    if (filters.campEndFrom    || filters.campEndTo)     n++;
    return n;
  }, [filters]);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return <span style={{ opacity:0.2, fontSize:'0.65rem' }}>↕</span>;
    return sortDir === 'asc' ? <FiChevronUp size={11}/> : <FiChevronDown size={11}/>;
  }

  // ── Unique values for multi-select filter options ──────────
  const uniqueValues = useMemo(() => {
    const get = key => [...new Set(leads.map(l => l[key]).filter(Boolean))].sort();
    return {
      // Lead management
      leadStatus:         LEAD_STATUSES,
      stoneTier:          get('stoneTier'),
      leadSource:         get('leadSource'),
      studyPlans:         get('studyPlans'),
      englishLevel:       get('englishLevel'),
      timeline:           get('timeline'),
      interaction:        get('interaction'),
      destinationCountry: get('destinationCountry'),
      gpa:                get('gpa'),
      budget:             get('budget'),
      confidence:         get('confidence'),
      counselor:          get('counselor'),
      seniorCounselor:    get('seniorCounselor'),
      presales:           get('presales'),
      marketingStaff:     get('marketingStaff'),
      // Personal
      yearOfBirth:        get('yearOfBirth'),
      residency:          get('residency'),
      schoolEvent:        get('schoolEvent'),
      preferredSocial:    get('preferredSocial'),
      socialConsent:      get('socialConsent'),
      // Self assessment
      scholarshipDemand:  get('scholarshipDemand'),
      immigrationHistory: get('immigrationHistory'),
      sponsorIncome:      get('sponsorIncome'),
      incomeEvidence:     get('incomeEvidence'),
      studyPlanGap:       get('studyPlanGap'),
      ultimateObjective:  get('ultimateObjective'),
      // Family
      motherContactMedium: get('motherContactMedium'),
      fatherContactMedium: get('fatherContactMedium'),
      // Campaign
      campaignType:       get('campaignType'),
      campaignName:       get('campaignName'),
    };
  }, [leads]);

  // ── Filtering + sorting ────────────────────────────────────
  const filtered = useMemo(() => {
    let r = leads;

    if (drillIds.length > 0) {
      r = r.filter(l => drillIds.includes(l.uniqueId));
    }

    if (!isManager) {
      r = r.filter(l =>
        l.counselor       === staff?.fullName ||
        l.seniorCounselor === staff?.fullName ||
        l.presales        === staff?.fullName ||
        l.marketingStaff  === staff?.fullName
      );
    }

    if (filters.search) r = r.filter(l =>
      matchesSearch(l.fullName,  filters.search) ||
      matchesSearch(l.email,     filters.search) ||
      matchesSearch(l.phone,     filters.search) ||
      matchesSearch(l.uniqueId,  filters.search)
    );

    // Multi-select match. Supports the (none) sentinel: a lead matches if its value
    // is empty AND the filter has the sentinel selected, OR its value is in the
    // selected list. Empty filter array = no constraint.
    const mf = (arr, val) => {
      if (!arr?.length) return true;
      if (!val && arr.includes(NONE_VALUE)) return true;
      return arr.includes(val);
    };
    if (filters.leadStatus?.length)          r = r.filter(l => mf(filters.leadStatus,          l.leadStatus  || 'New'));
    if (filters.stoneTier?.length)           r = r.filter(l => mf(filters.stoneTier,           l.stoneTier));
    if (filters.leadSource?.length)          r = r.filter(l => mf(filters.leadSource,          l.leadSource));
    if (filters.studyPlans?.length)          r = r.filter(l => mf(filters.studyPlans,          l.studyPlans));
    if (filters.englishLevel?.length)        r = r.filter(l => mf(filters.englishLevel,        l.englishLevel));
    if (filters.timeline?.length)            r = r.filter(l => mf(filters.timeline,            l.timeline));
    if (filters.interaction?.length)         r = r.filter(l => mf(filters.interaction,         l.interaction));
    if (filters.destinationCountry?.length)  r = r.filter(l => mf(filters.destinationCountry,  l.destinationCountry));
    if (filters.gpa?.length)                 r = r.filter(l => mf(filters.gpa,                 l.gpa));
    if (filters.budget?.length)              r = r.filter(l => mf(filters.budget,              l.budget));
    if (filters.confidence?.length)          r = r.filter(l => mf(filters.confidence,          l.confidence));
    if (filters.counselor?.length)           r = r.filter(l => mf(filters.counselor,           l.counselor));
    if (filters.seniorCounselor?.length)     r = r.filter(l => mf(filters.seniorCounselor,     l.seniorCounselor));
    if (filters.presales?.length)            r = r.filter(l => mf(filters.presales,            l.presales));
    if (filters.marketingStaff?.length)      r = r.filter(l => mf(filters.marketingStaff,      l.marketingStaff));
    // Personal
    if (filters.yearOfBirth?.length)         r = r.filter(l => mf(filters.yearOfBirth,         l.yearOfBirth));
    if (filters.residency?.length)           r = r.filter(l => mf(filters.residency,           l.residency));
    if (filters.schoolEvent?.length)         r = r.filter(l => mf(filters.schoolEvent,         l.schoolEvent));
    if (filters.preferredSocial?.length)     r = r.filter(l => mf(filters.preferredSocial,     l.preferredSocial));
    if (filters.socialConsent?.length)       r = r.filter(l => mf(filters.socialConsent,       l.socialConsent));
    // Self assessment
    if (filters.scholarshipDemand?.length)   r = r.filter(l => mf(filters.scholarshipDemand,   l.scholarshipDemand));
    if (filters.immigrationHistory?.length)  r = r.filter(l => mf(filters.immigrationHistory,  l.immigrationHistory));
    if (filters.sponsorIncome?.length)       r = r.filter(l => mf(filters.sponsorIncome,       l.sponsorIncome));
    if (filters.incomeEvidence?.length)      r = r.filter(l => mf(filters.incomeEvidence,      l.incomeEvidence));
    if (filters.studyPlanGap?.length)        r = r.filter(l => mf(filters.studyPlanGap,        l.studyPlanGap));
    if (filters.ultimateObjective?.length)   r = r.filter(l => mf(filters.ultimateObjective,   l.ultimateObjective));
    // Family
    if (filters.motherContactMedium?.length) r = r.filter(l => mf(filters.motherContactMedium, l.motherContactMedium));
    if (filters.fatherContactMedium?.length) r = r.filter(l => mf(filters.fatherContactMedium, l.fatherContactMedium));
    // Campaign
    if (filters.campaignType?.length)        r = r.filter(l => mf(filters.campaignType,        l.campaignType));
    if (filters.campaignName?.length)        r = r.filter(l => mf(filters.campaignName,        l.campaignName));

    if (filters.dateFrom)      r = r.filter(l => l.createdAt    && new Date(l.createdAt)    >= new Date(filters.dateFrom));
    if (filters.dateTo)        r = r.filter(l => l.createdAt    && new Date(l.createdAt)    <= new Date(filters.dateTo        + 'T23:59:59'));
    if (filters.closeDateFrom) r = r.filter(l => l.closeDate    && new Date(l.closeDate)    >= new Date(filters.closeDateFrom));
    if (filters.closeDateTo)   r = r.filter(l => l.closeDate    && new Date(l.closeDate)    <= new Date(filters.closeDateTo   + 'T23:59:59'));
    if (filters.campStartFrom) r = r.filter(l => l.campaignStart && new Date(l.campaignStart) >= new Date(filters.campStartFrom));
    if (filters.campStartTo)   r = r.filter(l => l.campaignStart && new Date(l.campaignStart) <= new Date(filters.campStartTo + 'T23:59:59'));
    if (filters.campEndFrom)   r = r.filter(l => l.campaignEnd   && new Date(l.campaignEnd)   >= new Date(filters.campEndFrom));
    if (filters.campEndTo)     r = r.filter(l => l.campaignEnd   && new Date(l.campaignEnd)   <= new Date(filters.campEndTo   + 'T23:59:59'));

    return [...r].sort((a, b) => {
      const av = a[sortField] || '', bv = b[sortField] || '';
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [leads, filters, sortField, sortDir, isManager, staff, drillIds]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Keep the bottom scrollbar's inner spacer in sync with the table's full width ──
  // Re-measures whenever rows or visible columns change, plus on window resize.
  useEffect(() => {
    function measure() {
      const el = document.getElementById('leads-table-wrap');
      if (el) setTableScrollWidth(el.scrollWidth);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [columns, paginated.length]);

  function toggleSelect(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }
  function toggleAll() {
    const pageIds = paginated.map(l => l.uniqueId);
    const allSel  = pageIds.every(id => selected.includes(id));
    setSelected(allSel ? selected.filter(id => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])]);
  }

  // ── Print to PDF ─────────────────────────────────────────────
  // Renders all filtered rows (no pagination) for the duration of the print dialog,
  // then reverts. The user can choose "Save as PDF" in the browser print dialog.
  function handlePrint() {
    setPrintMode(true);
    // Wait for React to render all rows, then trigger the print dialog
    setTimeout(() => {
      window.print();
      // Revert after the dialog closes (sync in most browsers)
      setPrintMode(false);
    }, 100);
  }

  async function handleMassAssign() {
    if (!massValue || selected.length === 0) return;
    try {
      await staffAPI.massAssign(selected, massField, massValue);
      await loadLeads();
      setSelected([]);
    } catch(e) { alert(e.message); }
  }

  async function handleMassDelete() {
    if (selected.length === 0) return;
    const msg = `Permanently delete ${selected.length} lead${selected.length !== 1 ? 's' : ''}?\n\n` +
                `Any notes attached will be archived to the lead's Google Drive folder before deletion.\n\n` +
                `This action cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      const result = await studentAPI.deleteRecords(selected);
      const archived = (result.data?.archives || []).filter(a => a.status === 'archived').length;
      if (archived > 0) {
        alert(`Deleted ${selected.length} lead${selected.length !== 1 ? 's' : ''}. ${archived} notes archive${archived !== 1 ? 's' : ''} saved to Google Drive.`);
      }
      await loadLeads();
      setSelected([]);
    } catch(e) { alert(e.message); }
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
        const updated = cols.map(c => c.key === key ? { ...c, width: newW } : c);
        // Save resize for Admin only — non-admin resizes are session-only
        if (isAdmin) {
          columnConfigAPI.save(`leads_${roleKey}`, updated).catch(() => {});
        }
        return updated;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Cell renderer ──────────────────────────────────────────
  function renderCell(col, lead) {
    switch(col.key) {
      case 'fullName':              return <td key={col.key} style={{ fontWeight:500 }}>{lead.fullName || '—'}</td>;
      case 'leadStatus':            return <td key={col.key}>{statusBadge(lead.leadStatus || 'New')}</td>;
      case 'createdAt':             return <td key={col.key} style={{ fontFamily:'DM Mono', fontSize:'0.8125rem' }}>{lead.createdAt ? String(lead.createdAt).slice(0,10) : '—'}</td>;
      case 'age':                   return <td key={col.key}>{getLeadAge(lead.createdAt)}</td>;
      case 'riskScore':             return <td key={col.key} style={{ fontFamily:'DM Mono' }}>{lead.riskScore || '—'}</td>;
      case 'closeDate':             return <td key={col.key}>{lead.closeDate   ? String(lead.closeDate).slice(0,10)   : '—'}</td>;
      case 'campaignStart':         return <td key={col.key} style={{ fontFamily:'DM Mono', fontSize:'0.8125rem' }}>{lead.campaignStart ? String(lead.campaignStart).slice(0,10) : '—'}</td>;
      case 'campaignEnd':           return <td key={col.key} style={{ fontFamily:'DM Mono', fontSize:'0.8125rem' }}>{lead.campaignEnd   ? String(lead.campaignEnd).slice(0,10)   : '—'}</td>;
      case 'oceanExtraversion':     return <td key={col.key} style={{ fontFamily:'DM Mono' }}>{lead.oceanExtraversion      != null ? `${lead.oceanExtraversion}/15`      : '—'}</td>;
      case 'oceanAgreeableness':    return <td key={col.key} style={{ fontFamily:'DM Mono' }}>{lead.oceanAgreeableness     != null ? `${lead.oceanAgreeableness}/15`     : '—'}</td>;
      case 'oceanConscientiousness':return <td key={col.key} style={{ fontFamily:'DM Mono' }}>{lead.oceanConscientiousness != null ? `${lead.oceanConscientiousness}/15` : '—'}</td>;
      case 'oceanNeuroticism':      return <td key={col.key} style={{ fontFamily:'DM Mono' }}>{lead.oceanNeuroticism       != null ? `${lead.oceanNeuroticism}/15`       : '—'}</td>;
      case 'oceanOpenness':         return <td key={col.key} style={{ fontFamily:'DM Mono' }}>{lead.oceanOpenness          != null ? `${lead.oceanOpenness}/15`          : '—'}</td>;
      default:                      return <td key={col.key}>{lead[col.key] || '—'}</td>;
    }
  }

  const visibleCols = columns.filter(c => c.visible);
  const FIELD_LABELS = {
    counselor:'Counselor', seniorCounselor:'Senior Counselor',
    presales:'Pre-Sales', marketingStaff:'Marketing Staff',
  };

  if (loading) return <div className="loading-center">Loading leads...</div>;

  return (
    <div>
      <Watermark />

      {/* ── Print stylesheet — hides chrome, shows only the table for clean PDF output ── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          /* Print table tweaks */
          .print-area table { width: 100% !important; font-size: 9pt; table-layout: auto !important; }
          .print-area th, .print-area td { padding: 4px 6px !important; border: 1px solid #999; white-space: normal !important; }
          .print-area tr { page-break-inside: avoid; }
          .print-area thead { display: table-header-group; }
          /* Hide scroll wrappers — let it just flow */
          .print-area .table-wrap { overflow: visible !important; }
          @page { margin: 12mm; }
        }
        .print-only { display: none; }
      `}</style>
      <div className="page-header no-print">
        <span className="page-title">Leads ({filtered.length})</span>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {!isManager && (
            <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
              Your assigned leads
            </span>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* Toolbar */}
        <div className="table-toolbar no-print">
          <button
            className={`btn btn--sm ${showFilters ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setShowFilters(f => !f)}
            style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <FiFilter size={13}/> Filters
            {activeFilterCount > 0 && (
              <span style={{
                background:'var(--danger)', color:'#fff', borderRadius:'999px',
                fontSize:'0.7rem', padding:'0 5px', minWidth:'16px', textAlign:'center',
              }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear all</button>
          )}
          <div className="search-input-wrap" style={{ flex:1 }}>
            <FiSearch size={15}/>
            <input
              className="search-input"
              placeholder="Search name, email, phone, ID... (* wildcard)"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
            />
            {filters.search && (
              <button
                style={{ background:'none', border:'none', cursor:'pointer', padding:'0 4px' }}
                onClick={() => setFilter('search', '')}>
                <FiX size={13}/>
              </button>
            )}
          </div>
          {isAdmin && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={handlePrint}
              style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}
              title="Print the current filtered list (use 'Save as PDF' in the print dialog)">
              <FiPrinter size={13}/> Print
            </button>
          )}
        </div>

        {/* ── Dynamic filter panel ─────────────────────────────── */}
        {showFilters && (
          <div className="no-print" style={{
            background:'var(--bg-secondary)', border:'1px solid var(--border)',
            borderRadius:'10px', padding:'0.75rem', marginBottom:'1rem',
          }}>
            {/* Multi-select filters — only for visible columns */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem', marginBottom:'0.5rem' }}>
              {FILTER_CONFIG
                .filter(fc => fc.type === 'multi' && visibleColKeys.has(fc.colKey))
                .map(fc => (
                  <MultiFilter
                    key={fc.colKey}
                    label={fc.label}
                    selected={filters[fc.filterKey]}
                    onChange={v => setFilter(fc.filterKey, v)}
                    options={uniqueValues[fc.filterKey] || []}
                  />
                ))}
            </div>

            {/* Date range filters — only for visible columns */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.75rem', alignItems:'center' }}>
              {FILTER_CONFIG
                .filter(fc => fc.type === 'daterange' && visibleColKeys.has(fc.colKey))
                .map(fc => (
                  <div key={fc.colKey} style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                    <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{fc.label}:</span>
                    <input
                      className="form-input" type="date"
                      value={filters[fc.fromKey]}
                      onChange={e => setFilter(fc.fromKey, e.target.value)}
                      style={{ width:'140px', padding:'0.25rem 0.5rem', fontSize:'0.775rem' }}
                    />
                    <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>→</span>
                    <input
                      className="form-input" type="date"
                      value={filters[fc.toKey]}
                      onChange={e => setFilter(fc.toKey, e.target.value)}
                      style={{ width:'140px', padding:'0.25rem 0.5rem', fontSize:'0.775rem' }}
                    />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────── */}
        <div className="table-card print-area">
          {/* ── Print-only header (visible only when printing) ── */}
          <div className="print-only" style={{ marginBottom:'12px', borderBottom:'2px solid #333', paddingBottom:'8px' }}>
            <div style={{ fontSize:'14pt', fontWeight:700 }}>StudyLink — Leads Report</div>
            <div style={{ fontSize:'9pt', color:'#555', marginTop:'4px' }}>
              Generated: {new Date().toLocaleString()} • {filtered.length} record{filtered.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 && ` • ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} applied`}
            </div>
          </div>
          <div
            className="table-wrap"
            id="leads-table-wrap"
            style={{ overflowX:'auto' }}
            onScroll={(e) => {
              const bot = document.getElementById('leads-bottom-scroll');
              if (bot && bot.scrollLeft !== e.currentTarget.scrollLeft) {
                bot.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
          >
            <table style={{ tableLayout:'fixed' }}>
              <colgroup>
                {isManager && <col style={{ width:'40px' }}/>}
                {visibleCols.map(c => (
                  <col key={c.key} style={{ width:(colWidths.current[c.key] || c.width) + 'px' }}/>
                ))}
              </colgroup>
              <thead>
                <tr>
                  {isManager && (
                    <th className="checkbox-col">
                      <input
                        type="checkbox"
                        checked={paginated.length > 0 && paginated.every(l => selected.includes(l.uniqueId))}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  {visibleCols.map(col => (
                    <th key={col.key} data-col={col.key} style={{
                      width:(colWidths.current[col.key] || col.width) + 'px',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                      position:'relative', userSelect:'none',
                    }}>
                      <span
                        onClick={() => col.key !== 'age' && toggleSort(col.key)}
                        style={{ cursor: col.key !== 'age' ? 'pointer' : 'default', display:'inline-flex', alignItems:'center', gap:'3px' }}>
                        {col.label}
                        {col.key !== 'age' && <SortIcon field={col.key}/>}
                      </span>
                      <span
                        onMouseDown={e => startResize(e, col.key)}
                        style={{
                          position:'absolute', right:0, top:0, bottom:0, width:'5px',
                          cursor:'col-resize', background:'transparent',
                          borderRight:'2px solid transparent',
                        }}
                        onMouseEnter={e => e.target.style.borderRightColor = 'var(--border)'}
                        onMouseLeave={e => e.target.style.borderRightColor = 'transparent'}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(printMode ? filtered : paginated).map(lead => (
                  <tr key={lead.uniqueId} style={{ cursor:'pointer' }}
                    onClick={() => navigate(`/leads/${lead.uniqueId}`)}>
                    {isManager && (
                      <td onClick={e => { e.stopPropagation(); toggleSelect(lead.uniqueId); }}>
                        <input type="checkbox" checked={selected.includes(lead.uniqueId)} onChange={() => {}}/>
                      </td>
                    )}
                    {visibleCols.map(col => renderCell(col, lead))}
                  </tr>
                ))}
                {(printMode ? filtered : paginated).length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleCols.length + (isManager ? 1 : 0)}
                      style={{ textAlign:'center', color:'var(--text-secondary)', padding:'2rem' }}>
                      No leads found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Synced bottom horizontal scrollbar — mirrors the table-wrap above */}
          <div
            id="leads-bottom-scroll"
            className="no-print"
            style={{ overflowX:'auto', padding:'2px 0' }}
            onScroll={(e) => {
              const top = document.getElementById('leads-table-wrap');
              if (top && top.scrollLeft !== e.currentTarget.scrollLeft) {
                top.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
          >
            <div
              id="leads-bottom-scroll-inner"
              style={{ height:'10px', width: `${tableScrollWidth}px` }}
            />
          </div>
          <div className="table-pagination no-print">
            <span>{filtered.length} leads</span>
            <div className="pagination-controls">
              <button className="btn btn--ghost btn--sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
              <span>Page {page} of {totalPages || 1}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mass assign / delete bar ────────────────────────── */}
      {isManager && selected.length > 0 && (
        <div className="mass-assign-bar no-print">
          <span>{selected.length} selected</span>
          <select value={massField} onChange={e => setMassField(e.target.value)}>
            {Object.entries(FIELD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={massValue} onChange={e => setMassValue(e.target.value)}>
            <option value="">Select staff...</option>
            {staffList.map(s => (
              <option key={s.id} value={s.fullName}>{s.fullName}</option>
            ))}
          </select>
          <button className="btn btn--primary btn--sm" onClick={handleMassAssign} disabled={!massValue}>Assign</button>
          {isAdmin && (
            <button
              className="btn btn--sm"
              onClick={handleMassDelete}
              style={{ background:'var(--danger)', color:'#fff', border:'none' }}>
              🗑 Delete
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => setSelected([])} style={{ color:'#fff' }}>Clear</button>
        </div>
      )}
    </div>
  );
}
