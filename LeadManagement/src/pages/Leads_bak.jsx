// LeadManagement/src/pages/Leads.jsx
// CHANGES (Apr 18, 2026):
//   - Imported LEAD_STATUSES, labelFor, LEAD_STATUS_CSS_CLASS, ACTIVE_LEAD_STATUSES
//   - statusBadge() renders translated label + new CSS class
//   - Drill-down "active" filter uses ACTIVE_LEAD_STATUSES
//
// CHANGES (i18n Phase 2b):
//   - All UI chrome (headers, filter pill labels, buttons, search placeholder,
//     pagination, mass-assign controls) uses t(key, language).
//   - Column headers in the table use t('leads.col.<key>', language).
//   - Filter pill labels use t('filter.<key>', language).
//   - Dropdown option values (stoneTier, studyPlans, budget, etc.) show
//     bilingual labels via optLabelBilingual() — the Vietnamese label with
//     the English canonical value in parens for data clarity.
//   - Stone filter values translate via stoneLabel().
//   - Lead status badges + status filter values translate via labelFor().
//   - Lead source options translate via optLabelBilingual('leadSource', ...).
//   - DB values (the English canonical strings) are never translated —
//     filters, sorts, and searches all continue to work in English.
//
// CHANGES (Apr 30, 2026 — Item #2 filter persistence):
//   - On row click → save filters/page/sort/showFilters/drillIds to sessionStorage
//     before navigating to LeadDetail.
//   - On mount → if location.state.fromLeadDetail, hydrate state from sessionStorage.
//   - Direct visits (sidebar nav, fresh URL) get a clean slate as before.

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { studentAPI, staffAPI, columnConfigAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { t, en as enStrings } from '../i18n';
import { optLabelBilingual } from '../utils/optionLabels';
import { stoneLabel } from '../utils/stoneLabels';
import Watermark from '../components/Watermark';
import { FiSearch, FiChevronUp, FiChevronDown, FiFilter, FiX } from 'react-icons/fi';
import { LEAD_STATUSES, labelFor, LEAD_STATUS_CSS_CLASS, ACTIVE_LEAD_STATUSES } from '../utils/leadStatusLabels';

// ── All possible columns (master list) ────────────────────────
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

// sessionStorage key for filter persistence on back-nav from LeadDetail
const FILTERS_STORAGE_KEY = 'studylink_lm_leads_filter_state';

const ROLE_KEY_MAP = {
  Admin:     'admin',
  Manager:   'manager',
  Director:  'director',
  Counselor: 'counselor',
};

const MULTI_KEYS = [
  'leadStatus','stoneTier','leadSource','studyPlans','englishLevel','timeline',
  'interaction','destinationCountry','gpa','budget','confidence',
  'counselor','seniorCounselor','presales','marketingStaff',
  'yearOfBirth','residency','schoolEvent','preferredSocial','socialConsent',
  'scholarshipDemand','immigrationHistory','sponsorIncome','incomeEvidence',
  'studyPlanGap','ultimateObjective',
  'motherContactMedium','fatherContactMedium',
  'campaignType','campaignName',
];

const EMPTY_FILTERS = {
  search:'',
  leadStatus:[], stoneTier:[], leadSource:[], studyPlans:[],
  englishLevel:[], timeline:[], interaction:[], destinationCountry:[],
  gpa:[], budget:[], confidence:[], counselor:[], seniorCounselor:[],
  presales:[], marketingStaff:[],
  yearOfBirth:[], residency:[], schoolEvent:[], preferredSocial:[], socialConsent:[],
  scholarshipDemand:[], immigrationHistory:[], sponsorIncome:[],
  incomeEvidence:[], studyPlanGap:[], ultimateObjective:[],
  motherContactMedium:[], fatherContactMedium:[],
  campaignType:[], campaignName:[],
  dateFrom:'', dateTo:'', closeDateFrom:'', closeDateTo:'',
  campStartFrom:'', campStartTo:'', campEndFrom:'', campEndTo:'',
};

// FILTER_CONFIG now uses translation keys for labels.
// optionGroup tells MultiFilter how to render each dropdown value in bilingual form.
const FILTER_CONFIG = [
  { colKey:'leadStatus',         labelKey:'filter.status',          type:'multi', filterKey:'leadStatus',         optionGroup:'leadStatus' },
  { colKey:'stoneTier',          labelKey:'filter.stone',           type:'multi', filterKey:'stoneTier',          optionGroup:'stoneTier' },
  { colKey:'leadSource',         labelKey:'filter.source',          type:'multi', filterKey:'leadSource',         optionGroup:'leadSource' },
  { colKey:'interaction',        labelKey:'filter.interaction',     type:'multi', filterKey:'interaction',        optionGroup:'interaction' },
  { colKey:'studyPlans',         labelKey:'filter.studyPlans',      type:'multi', filterKey:'studyPlans',         optionGroup:'studyPlans' },
  { colKey:'destinationCountry', labelKey:'filter.destination',     type:'multi', filterKey:'destinationCountry' },
  { colKey:'timeline',           labelKey:'filter.timeline',        type:'multi', filterKey:'timeline',           optionGroup:'timeline' },
  { colKey:'englishLevel',       labelKey:'filter.english',         type:'multi', filterKey:'englishLevel',       optionGroup:'englishLevel' },
  { colKey:'gpa',                labelKey:'filter.gpa',             type:'multi', filterKey:'gpa',                optionGroup:'gpa' },
  { colKey:'budget',             labelKey:'filter.budget',          type:'multi', filterKey:'budget',             optionGroup:'budget' },
  { colKey:'confidence',         labelKey:'filter.confidence',      type:'multi', filterKey:'confidence',         optionGroup:'confidence' },
  { colKey:'counselor',          labelKey:'filter.counselor',       type:'multi', filterKey:'counselor' },
  { colKey:'seniorCounselor',    labelKey:'filter.seniorCounselor', type:'multi', filterKey:'seniorCounselor' },
  { colKey:'presales',           labelKey:'filter.presales',        type:'multi', filterKey:'presales' },
  { colKey:'marketingStaff',     labelKey:'filter.marketing',       type:'multi', filterKey:'marketingStaff' },
  { colKey:'yearOfBirth',        labelKey:'filter.yearOfBirth',     type:'multi', filterKey:'yearOfBirth' },
  { colKey:'residency',          labelKey:'filter.residency',       type:'multi', filterKey:'residency' },
  { colKey:'schoolEvent',        labelKey:'filter.schoolEvent',     type:'multi', filterKey:'schoolEvent' },
  { colKey:'preferredSocial',    labelKey:'filter.socialPlatform',  type:'multi', filterKey:'preferredSocial' },
  { colKey:'socialConsent',      labelKey:'filter.connectWithUs',   type:'multi', filterKey:'socialConsent' },
  { colKey:'scholarshipDemand',  labelKey:'filter.scholarship',     type:'multi', filterKey:'scholarshipDemand',  optionGroup:'scholarshipDemand' },
  { colKey:'immigrationHistory', labelKey:'filter.immigration',     type:'multi', filterKey:'immigrationHistory', optionGroup:'immigrationHistory' },
  { colKey:'sponsorIncome',      labelKey:'filter.sponsorIncome',   type:'multi', filterKey:'sponsorIncome',      optionGroup:'sponsorIncome' },
  { colKey:'incomeEvidence',     labelKey:'filter.incomeEvidence',  type:'multi', filterKey:'incomeEvidence',     optionGroup:'incomeEvidence' },
  { colKey:'studyPlanGap',       labelKey:'filter.studyPlanGap',    type:'multi', filterKey:'studyPlanGap',       optionGroup:'studyPlanGap' },
  { colKey:'ultimateObjective',  labelKey:'filter.objective',       type:'multi', filterKey:'ultimateObjective',  optionGroup:'ultimateObjective' },
  { colKey:'motherContactMedium', labelKey:'filter.motherMedium',   type:'multi', filterKey:'motherContactMedium' },
  { colKey:'fatherContactMedium', labelKey:'filter.fatherMedium',   type:'multi', filterKey:'fatherContactMedium' },
  { colKey:'campaignType',       labelKey:'filter.campaignType',    type:'multi', filterKey:'campaignType' },
  { colKey:'campaignName',       labelKey:'filter.campaign',        type:'multi', filterKey:'campaignName' },
  { colKey:'createdAt',          labelKey:'filter.created',         type:'daterange', fromKey:'dateFrom',      toKey:'dateTo' },
  { colKey:'closeDate',          labelKey:'filter.closeDate',       type:'daterange', fromKey:'closeDateFrom', toKey:'closeDateTo' },
  { colKey:'campaignStart',      labelKey:'filter.campStart',       type:'daterange', fromKey:'campStartFrom', toKey:'campStartTo' },
  { colKey:'campaignEnd',        labelKey:'filter.campEnd',         type:'daterange', fromKey:'campEndFrom',   toKey:'campEndTo' },
];

// Simple {placeholder} substitution for translation strings with {n}, {page} etc.
function fmt(str, params) {
  if (!params) return str;
  return Object.keys(params).reduce(
    (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]),
    str
  );
}

// Return translated column label if a key exists in en.js, else fallback to master label.
function colLabel(col, language) {
  const key = `leads.col.${col.key}`;
  if (enStrings[key] !== undefined) return t(key, language);
  return col.label;
}

// ── Helpers ───────────────────────────────────────────────────
function statusBadge(status, language) {
  const cls = LEAD_STATUS_CSS_CLASS[status] || 'new';
  const txt = labelFor(status, language) || labelFor('New', language);
  return <span className={`badge badge--${cls}`}>{txt}</span>;
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
function MultiFilter({ label, selected, onChange, options, optionLabelFn, noValuesLabel, clearLabel }) {
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
              }}>{clearLabel}</button>
            </div>
          )}
          {options.length === 0 && (
            <div style={{ padding:'0.4rem 0.6rem', color:'var(--text-secondary)', fontSize:'0.775rem' }}>
              {noValuesLabel}
            </div>
          )}
          {options.map(opt => (
            <label key={opt} style={{
              display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.3rem 0.6rem',
              cursor:'pointer', fontSize:'0.775rem',
              background: selected.includes(opt) ? 'var(--bg-secondary)' : 'transparent',
            }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} style={{ cursor:'pointer' }}/>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={optionLabelFn ? optionLabelFn(opt) : opt}>
                {optionLabelFn ? optionLabelFn(opt) : opt}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function Leads() {
  const navigate = useNavigate();
  const location = useLocation();

  // Item #2: when arriving via Back button from LeadDetail, read saved state once.
  // This runs every render but the state initialisers below only use it on mount.
  const restored = (() => {
    if (location.state?.fromLeadDetail) {
      try {
        const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* ignore parse errors, fall through to defaults */ }
    }
    return null;
  })();

  const [leads, setLeads]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filters, setFilters]         = useState(restored?.filters     ?? EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(restored?.showFilters ?? false);
  const [columns, setColumns]         = useState(MASTER_COLUMNS);
  const [sortField, setSortField]     = useState(restored?.sortField   ?? 'createdAt');
  const [sortDir, setSortDir]         = useState(restored?.sortDir     ?? 'desc');
  const [selected, setSelected]       = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [massField, setMassField]     = useState('counselor');
  const [massValue, setMassValue]     = useState('');
  const [page, setPage]               = useState(restored?.page        ?? 1);
  const [drillIds, setDrillIds]       = useState(restored?.drillIds    ?? []);
  const colWidths = useRef({});
  const resizing  = useRef(null);
  const PER_PAGE  = 25;

  const { isManager, isAdmin, staff } = useAuth();
  const { language }                  = useLanguage();

  const roleKey = useMemo(() => {
    const r = staff?.role || 'Counselor';
    return ROLE_KEY_MAP[r] || 'counselor';
  }, [staff]);

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
          const savedKeys = new Set(d.data.map(c => c.key));
          const merged = [
            ...d.data.map(c => ({ ...c, visible: true })),
            ...MASTER_COLUMNS.filter(c => !savedKeys.has(c.key)).map(c => ({ ...c, visible: true })),
          ];
          setColumns(merged);
          const widths = {};
          merged.forEach(c => { widths[c.key] = c.width; });
          colWidths.current = widths;
        } else {
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
        if (isAdmin) {
          const allVisible = MASTER_COLUMNS.map(c => ({ ...c, visible: true }));
          setColumns(allVisible);
          const widths = {};
          allVisible.forEach(c => { widths[c.key] = c.width; });
          colWidths.current = widths;
        }
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
        leadStatus: ACTIVE_LEAD_STATUSES,
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

  const visibleColKeys = useMemo(
    () => new Set(columns.filter(c => c.visible).map(c => c.key)),
    [columns]
  );

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

  const uniqueValues = useMemo(() => {
    const get = key => [...new Set(leads.map(l => l[key]).filter(Boolean))].sort();
    return {
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
      yearOfBirth:        get('yearOfBirth'),
      residency:          get('residency'),
      schoolEvent:        get('schoolEvent'),
      preferredSocial:    get('preferredSocial'),
      socialConsent:      get('socialConsent'),
      scholarshipDemand:  get('scholarshipDemand'),
      immigrationHistory: get('immigrationHistory'),
      sponsorIncome:      get('sponsorIncome'),
      incomeEvidence:     get('incomeEvidence'),
      studyPlanGap:       get('studyPlanGap'),
      ultimateObjective:  get('ultimateObjective'),
      motherContactMedium: get('motherContactMedium'),
      fatherContactMedium: get('fatherContactMedium'),
      campaignType:       get('campaignType'),
      campaignName:       get('campaignName'),
    };
  }, [leads]);

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

    const mf = (arr, val) => !arr?.length || arr.includes(val);
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
    if (filters.yearOfBirth?.length)         r = r.filter(l => mf(filters.yearOfBirth,         l.yearOfBirth));
    if (filters.residency?.length)           r = r.filter(l => mf(filters.residency,           l.residency));
    if (filters.schoolEvent?.length)         r = r.filter(l => mf(filters.schoolEvent,         l.schoolEvent));
    if (filters.preferredSocial?.length)     r = r.filter(l => mf(filters.preferredSocial,     l.preferredSocial));
    if (filters.socialConsent?.length)       r = r.filter(l => mf(filters.socialConsent,       l.socialConsent));
    if (filters.scholarshipDemand?.length)   r = r.filter(l => mf(filters.scholarshipDemand,   l.scholarshipDemand));
    if (filters.immigrationHistory?.length)  r = r.filter(l => mf(filters.immigrationHistory,  l.immigrationHistory));
    if (filters.sponsorIncome?.length)       r = r.filter(l => mf(filters.sponsorIncome,       l.sponsorIncome));
    if (filters.incomeEvidence?.length)      r = r.filter(l => mf(filters.incomeEvidence,      l.incomeEvidence));
    if (filters.studyPlanGap?.length)        r = r.filter(l => mf(filters.studyPlanGap,        l.studyPlanGap));
    if (filters.ultimateObjective?.length)   r = r.filter(l => mf(filters.ultimateObjective,   l.ultimateObjective));
    if (filters.motherContactMedium?.length) r = r.filter(l => mf(filters.motherContactMedium, l.motherContactMedium));
    if (filters.fatherContactMedium?.length) r = r.filter(l => mf(filters.fatherContactMedium, l.fatherContactMedium));
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

  function toggleSelect(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }
  function toggleAll() {
    const pageIds = paginated.map(l => l.uniqueId);
    const allSel  = pageIds.every(id => selected.includes(id));
    setSelected(allSel ? selected.filter(id => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])]);
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
    const plural = language === 'vi' ? '' : (selected.length !== 1 ? 's' : '');
    const msg = fmt(t('leads.mass.confirmDelete', language), { n: selected.length, plural });
    if (!confirm(msg)) return;
    try {
      await studentAPI.deleteRecords(selected);
      await loadLeads();
      setSelected([]);
    } catch(e) { alert(e.message); }
  }

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

  // Translate a cell value for display — leaves DB value untouched.
  function cellDisplay(col, lead) {
    const raw = lead[col.key];
    if (raw == null || raw === '') return '—';
    switch(col.key) {
      case 'stoneTier':    return stoneLabel(raw, language);
      case 'leadStatus':   return null; // handled separately (badge)
      default:             return raw;
    }
  }

  function renderCell(col, lead) {
    switch(col.key) {
      case 'fullName':              return <td key={col.key} style={{ fontWeight:500 }}>{lead.fullName || '—'}</td>;
      case 'leadStatus':            return <td key={col.key}>{statusBadge(lead.leadStatus || 'New', language)}</td>;
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
      case 'stoneTier':             return <td key={col.key}>{cellDisplay(col, lead)}</td>;
      default:                      return <td key={col.key}>{lead[col.key] || '—'}</td>;
    }
  }

  const visibleCols = columns.filter(c => c.visible);

  // Mass-assign field dropdown labels (translated)
  const FIELD_LABELS = {
    counselor:       t('leads.massField.counselor',       language),
    seniorCounselor: t('leads.massField.seniorCounselor', language),
    presales:        t('leads.massField.presales',        language),
    marketingStaff:  t('leads.massField.marketingStaff',  language),
  };

  if (loading) return <div className="loading-center">{t('leads.loading', language)}</div>;

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">{t('leads.title', language)} ({filtered.length})</span>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {!isManager && (
            <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
              {t('leads.yourAssigned', language)}
            </span>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="table-toolbar">
          <button
            className={`btn btn--sm ${showFilters ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setShowFilters(f => !f)}
            style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <FiFilter size={13}/> {t('leads.toolbar.filters', language)}
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
            <button className="btn btn--ghost btn--sm" onClick={clearFilters}>{t('common.clearAll', language)}</button>
          )}
          <div className="search-input-wrap" style={{ flex:1 }}>
            <FiSearch size={15}/>
            <input
              className="search-input"
              placeholder={t('leads.toolbar.searchPlaceholder', language)}
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
        </div>

        {showFilters && (
          <div style={{
            background:'var(--bg-secondary)', border:'1px solid var(--border)',
            borderRadius:'10px', padding:'0.75rem', marginBottom:'1rem',
          }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem', marginBottom:'0.5rem' }}>
              {FILTER_CONFIG
                .filter(fc => fc.type === 'multi' && visibleColKeys.has(fc.colKey))
                .map(fc => {
                  // Build the per-option label function based on the filter group.
                  let optionLabelFn;
                  if (fc.filterKey === 'leadStatus') {
                    optionLabelFn = v => labelFor(v, language);
                  } else if (fc.filterKey === 'stoneTier') {
                    optionLabelFn = v => stoneLabel(v, language);
                  } else if (fc.optionGroup) {
                    optionLabelFn = v => optLabelBilingual(v, fc.optionGroup, language);
                  }
                  return (
                    <MultiFilter
                      key={fc.colKey}
                      label={t(fc.labelKey, language)}
                      selected={filters[fc.filterKey]}
                      onChange={v => setFilter(fc.filterKey, v)}
                      options={uniqueValues[fc.filterKey] || []}
                      optionLabelFn={optionLabelFn}
                      noValuesLabel={t('leads.filter.noValues', language)}
                      clearLabel={t('common.clear', language)}
                    />
                  );
                })}
            </div>

            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.75rem', alignItems:'center' }}>
              {FILTER_CONFIG
                .filter(fc => fc.type === 'daterange' && visibleColKeys.has(fc.colKey))
                .map(fc => (
                  <div key={fc.colKey} style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                    <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{t(fc.labelKey, language)}:</span>
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

        <div className="table-card">
          <div className="table-wrap" id="leads-table-wrap" style={{ overflowX:'auto' }}>
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
                        {colLabel(col, language)}
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
                {paginated.map(lead => (
                  <tr key={lead.uniqueId} style={{ cursor:'pointer' }}
                    onClick={() => {
                      // Item #2: persist filter state so Back from LeadDetail restores it
                      try {
                        sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
                          filters, page, sortField, sortDir, showFilters, drillIds,
                        }));
                      } catch (e) { /* sessionStorage unavailable — non-fatal */ }
                      navigate(`/leads/${lead.uniqueId}`);
                    }}>
                    {isManager && (
                      <td onClick={e => { e.stopPropagation(); toggleSelect(lead.uniqueId); }}>
                        <input type="checkbox" checked={selected.includes(lead.uniqueId)} onChange={() => {}}/>
                      </td>
                    )}
                    {visibleCols.map(col => renderCell(col, lead))}
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleCols.length + (isManager ? 1 : 0)}
                      style={{ textAlign:'center', color:'var(--text-secondary)', padding:'2rem' }}>
                      {t('leads.empty', language)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ overflowX:'auto', padding:'2px 0' }}>
            <div style={{ height:'8px', minWidth:'100%' }}/>
          </div>
          <div className="table-pagination">
            <span>{fmt(t('leads.pagination.leads', language), { n: filtered.length })}</span>
            <div className="pagination-controls">
              <button className="btn btn--ghost btn--sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>{t('leads.pagination.prev', language)}</button>
              <span>{fmt(t('leads.pagination.page', language), { page, total: totalPages || 1 })}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>{t('leads.pagination.next', language)}</button>
            </div>
          </div>
        </div>
      </div>

      {isManager && selected.length > 0 && (
        <div className="mass-assign-bar">
          <span>{selected.length} {t('common.selected', language)}</span>
          <select value={massField} onChange={e => setMassField(e.target.value)}>
            {Object.entries(FIELD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={massValue} onChange={e => setMassValue(e.target.value)}>
            <option value="">{t('leads.mass.selectStaff', language)}</option>
            {staffList.map(s => (
              <option key={s.id} value={s.fullName}>{s.fullName}</option>
            ))}
          </select>
          <button className="btn btn--primary btn--sm" onClick={handleMassAssign} disabled={!massValue}>{t('leads.mass.assign', language)}</button>
          {isAdmin && (
            <button
              className="btn btn--sm"
              onClick={handleMassDelete}
              style={{ background:'var(--danger)', color:'#fff', border:'none' }}>
              🗑 {t('leads.mass.delete', language)}
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => setSelected([])} style={{ color:'#fff' }}>{t('leads.mass.clear', language)}</button>
        </div>
      )}
    </div>
  );
}
