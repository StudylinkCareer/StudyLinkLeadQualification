// LeadManagement/src/pages/Leads.jsx
// CHANGES (table-driven RBAC + column catalog):
//   - Column catalog (labels, widths, order) no longer hardcoded in this
//     file. Fetched on mount from GET /api/staff/columns, which reads from
//     the permission_fields table. Single source of truth.
//   - Column visibility per role driven by RBAC via fieldList(); no
//     hardcoded role checks remain in this file.
//   - Row click checks canDoOnLead('leads', 'view_detail', lead) before
//     navigating; unauthorized clicks show a toast on the list, no nav.
//   - Bulk-select column, action bar, delete button, print button all
//     gated on permissions from usePermissions().
// CHANGES (phone + masking):
//   - Added notesAPI import.
//   - maskField() helper: respects fieldList() RBAC value 'view_masked'.
//     Counselors see full data for their OWN assigned leads; masked partial
//     values (e.g. "09****12") for leads assigned to others.
//   - handleCallClick(): fires a background notesAPI.add() counselor note
//     when a phone number is clicked, so every call attempt is recorded.
//   - renderCellInner now has explicit 'email' and 'phone' cases:
//     email shows masked text when applicable;
//     phone renders as a tel: hyperlink (unmasked only) with auto-note on click.
// CHANGES (search always uses raw data):
//   - The global search filter now always runs against the raw lead data,
//     never masked values. Counselors can search by full phone/email even
//     when those fields display as masked in the list.
//   - contactDetails (Zalo, Facebook, social handles) is now flattened one
//     level and included in the search candidates, so social media accounts
//     are fully searchable.
// CHANGES (search normalisation — fixes phone/email not matching):
//   - matchesSearch() now normalises both the search term and the stored value
//     by collapsing whitespace and stripping punctuation (spaces, dashes,
//     brackets, dots, +) before comparing. This means "093 6187919" matches
//     "0936187919", "+84 93 618 7919" matches "0936187919", and email
//     searches work regardless of how the user spaces/punctuates the input.
// CHANGES (search uses _raw_ fields from server):
//   - The server now returns masked fields (e.g. 'b...n@psb-academy.edu.sg')
//     for display AND the real value under a '_raw_email' / '_raw_phone' key
//     for search. The search block now includes all keys including '_raw_*'
//     in its candidates, so users can find records by typing either the
//     masked or real contact value. '_raw_*' fields never appear as columns.

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { studentAPI, leadAPI, staffAPI, columnConfigAPI, variantsAPI, notesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLookup } from '../contexts/LookupContext';
import { useLanguage } from '../contexts/LanguageContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import Watermark from '../components/Watermark';
import { FiSearch, FiChevronUp, FiChevronDown, FiFilter, FiX, FiPrinter, FiDownload, FiSave, FiTrash2, FiStar } from 'react-icons/fi';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';

// Column catalog (label, width, order) comes from the DB. See the
// staffAPI.listColumns() call in the useEffect below.

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
  'counselor','presales','marketingStaff','caseOfficer','quality','techSupport','businessDevelopment',
  // Personal
  //  'yearOfBirth','residency','schoolEvent','preferredSocial','socialConsent',
  'yearOfBirth','residency','referralSource','preferredSocial','socialConsent','ward',
  // Self assessment
  'scholarshipDemand','immigrationHistory','sponsorIncome','incomeEvidence',
  'studyPlanGap','ultimateObjective',
  // Family
  'motherContactMedium','fatherContactMedium',
  // Campaign
  'campaignType','campaignName',
  // Source / academic / phase (catalog columns 64-73)
  'source','sourceDetail','major','schoolAttended','intake',
  'degreeLevel','targetInstitution','rationale','orderPhase',
];

const EMPTY_FILTERS = {
  search:'',
  // Lead management
  leadStatus:[], stoneTier:[], leadSource:[], studyPlans:[],
  englishLevel:[], timeline:[], interaction:[], destinationCountry:[],
  gpa:[], budget:[], confidence:[], counselor:[],
  presales:[], marketingStaff:[], caseOfficer:[],
  quality:[], techSupport:[], businessDevelopment:[],
  // Personal
  //yearOfBirth:[], residency:[], schoolEvent:[], preferredSocial:[], socialConsent:[],
  yearOfBirth:[], residency:[], referralSource:[], preferredSocial:[], socialConsent:[],
  // Self assessment
  scholarshipDemand:[], immigrationHistory:[], sponsorIncome:[],
  incomeEvidence:[], studyPlanGap:[], ultimateObjective:[],
  // Family
  motherContactMedium:[], fatherContactMedium:[],
  // Campaign
  campaignType:[], campaignName:[],
  // Source / academic / phase (catalog columns 64-73)
  source:[], sourceDetail:[], major:[], schoolAttended:[], ward:[], intake:[],
  degreeLevel:[], targetInstitution:[], rationale:[], orderPhase:[],
  // Per-column free-text "contains" filters — one entry per column that has no
  // dedicated multi/date chip. Keyed by column id. e.g. { fullName:'tran' }
  colText:{},
  // Date ranges
  dateFrom:'', dateTo:'', closeDateFrom:'', closeDateTo:'',
  campStartFrom:'', campStartTo:'', campEndFrom:'', campEndTo:'',
  assignedInFrom:'', assignedInTo:'', assignedOutFrom:'', assignedOutTo:'',
  actualCloseFrom:'', actualCloseTo:'', cancelFrom:'', cancelTo:'',
};

// ── Filter config — drives which filter controls render and for which column ──
// Single source of truth for "how many filters are active" — used by BOTH the
// breadcrumb label and the "Clear filters (N)" badge so they always agree.
// NOTE: colText is an object that is ALWAYS present ({}), so it must be counted
// by its non-empty entries, never by object truthiness.
function countActiveFilters(filters) {
  if (!filters) return 0;
  let n = filters.search ? 1 : 0;
  MULTI_KEYS.forEach(k => { if (filters[k]?.length > 0) n++; });
  if (filters.dateFrom       || filters.dateTo)        n++;
  if (filters.closeDateFrom  || filters.closeDateTo)   n++;
  if (filters.campStartFrom  || filters.campStartTo)   n++;
  if (filters.campEndFrom    || filters.campEndTo)     n++;
  if (filters.assignedInFrom  || filters.assignedInTo)  n++;
  if (filters.assignedOutFrom || filters.assignedOutTo) n++;
  if (filters.actualCloseFrom || filters.actualCloseTo) n++;
  if (filters.cancelFrom      || filters.cancelTo)      n++;
  Object.values(filters.colText || {}).forEach(v => { if (String(v || '').trim()) n++; });
  return n;
}

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
  { colKey:'presales',           label:'Pre-Sales',       type:'multi',     filterKey:'presales' },
  { colKey:'marketingStaff',     label:'Marketing',       type:'multi',     filterKey:'marketingStaff' },
  { colKey:'caseOfficer',        label:'Case Officer',    type:'multi',     filterKey:'caseOfficer' },
  { colKey:'quality',            label:'Quality',         type:'multi',     filterKey:'quality' },
  { colKey:'techSupport',        label:'Tech Support',    type:'multi',     filterKey:'techSupport' },
  { colKey:'businessDevelopment',label:'Business Development', type:'multi', filterKey:'businessDevelopment' },
  // Personal
  { colKey:'yearOfBirth',        label:'Year of Birth',   type:'multi',     filterKey:'yearOfBirth' },
  { colKey:'residency',          label:'Residency',       type:'multi',     filterKey:'residency' },
  //{ colKey:'schoolEvent',        label:'School/Event',    type:'multi',     filterKey:'schoolEvent' },
  { colKey:'referralSource',     label:'Campaign/Event',  type:'multi',     filterKey:'referralSource' },
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
  // Source / academic / phase (catalog columns 64-73) — faceted from column data
  { colKey:'source',             label:'Source',          type:'multi',     filterKey:'source' },
  { colKey:'sourceDetail',       label:'Source Detail',   type:'multi',     filterKey:'sourceDetail' },
  { colKey:'major',              label:'Major',           type:'multi',     filterKey:'major' },
  { colKey:'schoolAttended',     label:'School Attended', type:'multi',     filterKey:'schoolAttended' },
  { colKey:'ward',               label:'Ward',            type:'multi',     filterKey:'ward' },
  { colKey:'intake',             label:'Intake',          type:'multi',     filterKey:'intake' },
  { colKey:'degreeLevel',        label:'Degree',          type:'multi',     filterKey:'degreeLevel' },
  { colKey:'targetInstitution',  label:'Institution',     type:'multi',     filterKey:'targetInstitution' },
  { colKey:'rationale',          label:'Rationale',       type:'multi',     filterKey:'rationale' },
  { colKey:'orderPhase',         label:'Order Phase',     type:'multi',     filterKey:'orderPhase' },
  // Date ranges
  { colKey:'createdAt',          label:'Created',         type:'daterange', fromKey:'dateFrom',      toKey:'dateTo' },
  { colKey:'closeDate',          label:'Close Date',      type:'daterange', fromKey:'closeDateFrom', toKey:'closeDateTo' },
  { colKey:'campaignStart',      label:'Camp. Start',     type:'daterange', fromKey:'campStartFrom', toKey:'campStartTo' },
  { colKey:'campaignEnd',        label:'Camp. End',       type:'daterange', fromKey:'campEndFrom',   toKey:'campEndTo' },
  { colKey:'assignedIn',         label:'Assigned In',       type:'daterange', fromKey:'assignedInFrom',  toKey:'assignedInTo' },
  { colKey:'assignedOut',        label:'Assigned Out',      type:'daterange', fromKey:'assignedOutFrom', toKey:'assignedOutTo' },
  { colKey:'actualCloseDate',    label:'Actual Close Date', type:'daterange', fromKey:'actualCloseFrom', toKey:'actualCloseTo' },
  { colKey:'cancellationDate',   label:'Cancellation Date', type:'daterange', fromKey:'cancelFrom',      toKey:'cancelTo' },
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
  if (!createdAt) return null;
  return `${Math.floor((Date.now() - new Date(createdAt)) / 86400000)}d`;
}

function matchesSearch(value, pattern) {
  if (!pattern) return true;
  if (!value) return false;
  // Normalise both sides: collapse whitespace and strip common punctuation
  // so "093 6187919" matches "0936187919" and vice versa, and
  // "baotran.tran@..." still matches a dotted search term.
  const normalise = s => String(s).toLowerCase().replace(/[\s\-().+]/g, '');
  const v  = String(value).toLowerCase();
  const vn = normalise(value);
  const p  = pattern.toLowerCase();
  const pn = normalise(pattern);
  if (p.startsWith('*') && p.endsWith('*')) {
    const core = p.slice(1, -1);
    return v.includes(core) || vn.includes(normalise(core));
  }
  if (p.endsWith('*')) {
    const stem = p.slice(0, -1);
    return v.startsWith(stem) || vn.startsWith(normalise(stem));
  }
  if (p.startsWith('*')) {
    const tail = p.slice(1);
    return v.endsWith(tail) || vn.endsWith(normalise(tail));
  }
  return v.includes(p) || vn.includes(pn);
}

// ── Multi-select filter pill ──────────────────────────────────
// ChipPopover — renders a popover via React portal so it escapes any parent's
// overflow:hidden/auto (e.g. the table-wrap's horizontal scroll container).
// Anchors itself to the chip button via getBoundingClientRect() + position:fixed,
// and follows the anchor on scroll/resize. Handles outside-click close.
function ChipPopover({ anchorRef, open, onClose, children, minWidth = 220 }) {
  const popoverRef = useRef(null);
  const [pos, setPos] = useState(null);

  // Reposition on open + on any scroll/resize while open
  useEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }
    function update() {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      // If popover would overflow right edge of viewport, right-align it to the anchor
      const approxWidth = Math.max(minWidth, 240);
      const wantLeft = r.left;
      const overflowRight = wantLeft + approxWidth - window.innerWidth + 8;
      const left = overflowRight > 0 ? wantLeft - overflowRight : wantLeft;
      setPos({ top: r.bottom + 4, left });
    }
    update();
    window.addEventListener('scroll',  update, true);   // capture phase = catches inner scrollers too
    window.addEventListener('resize',  update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef, minWidth]);

  // Outside-click close. Anchor click is ignored — that's the toggle.
  useEffect(() => {
    if (!open) return;
    function h(e) {
      if (anchorRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div ref={popoverRef} style={{
      position:'fixed', top: pos.top, left: pos.left, zIndex: 1000,
      minWidth, maxHeight:'320px', overflowY:'auto',
      background:'var(--bg-primary)', border:'1px solid var(--border)',
      borderRadius:'8px', boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
    }}>
      {children}
    </div>,
    document.body
  );
}

function MultiFilter({ label, selected, onChange, options, labelFor = (v) => v }) {  
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
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{labelFor(opt)}</span>            
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ColumnFilterChip — compact filter chip rendered in the per-column header row.
// Shows as a small "+ Filter" placeholder when empty, or a colored pill with
// the active selection count when applied. Click toggles a popover with the
// multi-select options (same checkbox UI as MultiFilter). The popover is
// portal-rendered so it can escape the table-wrap's overflow boundary.
function ColumnFilterChip({ label, selected, onChange, options, labelFor = (v) => v }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const anchorRef = useRef(null);

  const toggle = v => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const count = selected.length;
  const active = count > 0;

  // Filter the displayed options by the search input (case-insensitive, matches against the visible label)
  const filteredOptions = search.trim()
    ? options.filter(opt => String(labelFor(opt) || opt).toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  return (
    <>
      <button
        ref={anchorRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title={active ? `${label}: ${count} selected` : `Filter ${label}`}
        style={{
          display:'inline-flex', alignItems:'center', gap:'3px',
          padding: active ? '2px 8px' : '2px 6px',
          border: active ? '1px solid var(--primary)' : '1px dashed var(--border)',
          borderRadius:'10px',
          background: active ? 'var(--primary-light)' : 'transparent',
          color: active ? 'var(--primary)' : 'var(--text-secondary)',
          fontSize:'0.7rem', fontWeight: active ? 500 : 400,
          cursor:'pointer', whiteSpace:'nowrap',
          opacity: active ? 1 : 0.6,
        }}>
        {active ? `${count} active` : <span>＋ filter</span>}
      </button>
      <ChipPopover anchorRef={anchorRef} open={open} onClose={() => { setOpen(false); setSearch(''); }} minWidth={220}>
        <div style={{ padding:'0.4rem 0' }}>
          <div style={{
            padding:'0.3rem 0.6rem', fontSize:'0.7rem',
            color:'var(--text-secondary)', borderBottom:'1px solid var(--border)',
            display:'flex', justifyContent:'space-between', alignItems:'center',
          }}>
            <span style={{ fontWeight:500 }}>{label}</span>
            {active && (
              <button onClick={() => onChange([])} style={{
                fontSize:'0.7rem', color:'var(--danger)', background:'none',
                border:'none', cursor:'pointer', padding:0,
              }}>Clear</button>
            )}
          </div>
          {/* Search box — filters the options as you type. Shown only when there are
              enough options to make it useful (avoids clutter on short lists). */}
          {options.length > 5 && (
            <div style={{ padding:'0.3rem 0.6rem', borderBottom:'1px solid var(--border)' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                onClick={e => e.stopPropagation()}
                style={{
                  width:'100%', padding:'0.25rem 0.5rem',
                  fontSize:'0.75rem', border:'1px solid var(--border)',
                  borderRadius:'4px', background:'var(--bg-primary)',
                  color:'var(--text-primary)', outline:'none',
                  boxSizing:'border-box',
                }}
              />
            </div>
          )}
          {options.length === 0 && (
            <div style={{ padding:'0.4rem 0.6rem', color:'var(--text-secondary)', fontSize:'0.775rem' }}>
              No values
            </div>
          )}
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
          {filteredOptions.length === 0 && search.trim() && (
            <div style={{ padding:'0.4rem 0.6rem', color:'var(--text-secondary)', fontSize:'0.75rem', fontStyle:'italic' }}>
              No matches
            </div>
          )}
          {filteredOptions.map(opt => (
            <label key={opt} style={{
              display:'flex', alignItems:'center', gap:'0.4rem', padding:'0.3rem 0.6rem',
              cursor:'pointer', fontSize:'0.775rem',
              background: selected.includes(opt) ? 'var(--bg-secondary)' : 'transparent',
            }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} style={{ cursor:'pointer' }}/>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{labelFor(opt)}</span>
            </label>
          ))}
        </div>
      </ChipPopover>
    </>
  );
}

// DateRangeChip — compact pill, visually identical to ColumnFilterChip but
// opens a popover with from/to date inputs. Portal-rendered so it escapes the
// table-wrap's overflow boundary.
function DateRangeChip({ label, fromVal, toVal, onChangeFrom, onChangeTo }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);

  const active = !!(fromVal || toVal);
  const fmtShort = d => d ? d.slice(5).replace('-', '/') : '…';   // "5/13"
  const summary  = active ? `${fmtShort(fromVal)} → ${fmtShort(toVal)}` : null;

  return (
    <>
      <button
        ref={anchorRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title={active ? `${label}: ${summary}` : `Filter ${label}`}
        style={{
          display:'inline-flex', alignItems:'center', gap:'3px',
          padding: active ? '2px 8px' : '2px 6px',
          border: active ? '1px solid var(--primary)' : '1px dashed var(--border)',
          borderRadius:'10px',
          background: active ? 'var(--primary-light)' : 'transparent',
          color: active ? 'var(--primary)' : 'var(--text-secondary)',
          fontSize:'0.7rem', fontWeight: active ? 500 : 400,
          cursor:'pointer', whiteSpace:'nowrap',
          opacity: active ? 1 : 0.6,
        }}>
        {active ? summary : <span>＋ filter</span>}
      </button>
      <ChipPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} minWidth={260}>
        <div style={{ padding:'0.6rem 0.75rem', display:'flex', flexDirection:'column', gap:'0.4rem' }}>
          <div style={{
            fontSize:'0.7rem', color:'var(--text-secondary)', fontWeight:500,
            display:'flex', justifyContent:'space-between', alignItems:'center',
          }}>
            <span>{label}</span>
            {active && (
              <button onClick={() => { onChangeFrom(''); onChangeTo(''); }} style={{
                fontSize:'0.7rem', color:'var(--danger)', background:'none',
                border:'none', cursor:'pointer', padding:0,
              }}>Clear</button>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <input
              className="form-input" type="date"
              value={fromVal || ''}
              onChange={e => onChangeFrom(e.target.value)}
              style={{ flex:1, padding:'0.25rem 0.5rem', fontSize:'0.775rem' }}
            />
            <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>→</span>
            <input
              className="form-input" type="date"
              value={toVal || ''}
              onChange={e => onChangeTo(e.target.value)}
              style={{ flex:1, padding:'0.25rem 0.5rem', fontSize:'0.775rem' }}
            />
          </div>
        </div>
      </ChipPopover>
    </>
  );
}

// ── Main component ────────────────────────────────────────────
export default function Leads() {
  const [leads, setLeads]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filters, setFilters]         = useState(EMPTY_FILTERS);
  const [columns, setColumns]         = useState([]);
  const [selected, setSelected]       = useState([]);
  const [staffList, setStaffList]     = useState([]);
  const [massPhase, setMassPhase]       = useState('Counselling');
  const [massPosition, setMassPosition] = useState('');
  const [massValue, setMassValue]       = useState('');
  // Canonical phase model — KEEP IN SYNC with Server/src/utils/orderPhase.js
  const PHASE_SLOTS = {
    'Marketing': ['Marketing Staff'], 'Counselling': ['Counselor'], 'Presales': ['PreSales'],
    'Pool': ['Quality', 'Tech Support'], 'Business Development': ['Business Development'],
    'Case Officers': ['Case Officer, Direct', 'Case Officer, Sub'],
  };
  const RECIPIENT_REQUIRED = new Set(['Counselling', 'Presales', 'Case Officers']);
  const POSITION_LABEL = {
    'Marketing Staff':'Marketing Staff','Counselor':'Counsellor','PreSales':'Pre-Sales','Quality':'Quality',
    'Tech Support':'Tech Support','Business Development':'Business Development',
    'Case Officer, Direct':'Case Officer (Direct)','Case Officer, Sub':'Case Officer (Sub)',
  };
  const [printMode, setPrintMode]     = useState(false);

  // ── TanStack Table state ──
  // Each is the canonical shape TanStack expects, so it can be persisted
  // verbatim into a variant config.
  // Default = grouped by student (so a person's leads sit together), newest lead
  // first within each student. Users can re-sort any column; saved variants override.
  const [sorting,          setSorting]          = useState([{ id: 'studentId', desc: false }, { id: 'leadId', desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState({});
  const [columnOrder,      setColumnOrder]      = useState([]);
  const baseConfigRef = useRef({});  // saved 'All leads' default layout (from column_config)
  const [columnSizing,     setColumnSizing]     = useState({});
  const [pagination,       setPagination]       = useState({ pageIndex: 0, pageSize: 25 });

  // ── Layout variants — per-user saved layouts ──
  const [variants, setVariants]             = useState([]);   // [{id, name, isDefault, config}]
  const [activeVariantId, setActiveVariantId] = useState(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('');
  const [saveDialogDefault, setSaveDialogDefault] = useState(false);
  const variantsLoadedRef = useRef(false);  // prevent double-applying default on remount
  const PER_PAGE  = 25;

  const { staff }            = useAuth();
  const { canDo, canDoOnLead, scope, fieldList } = usePermissions();
  // Derived booleans, table-driven. Replaces the old isManager/isAdmin checks.
  const canManageColumns = canDo('column_config', 'manage');         // admin-only column config persistence
  // Leads-list = RU (leads.list_manage) exposes the select checkbox + mass-move bar.
  // Leads-list = R/None → display-only list (no selection).
  const canMassAssign    = canDo('leads', 'list_manage');            // select checkbox + mass-move bar
  const canDeleteLeads   = canDo('leads', 'delete');                  // delete button
  const canPrintList     = canDo('leads', 'export');                   // print/export — Director only via DB

  // ── Field masking helper ──────────────────────────────────────
  // fieldList(key) returns 'view_masked' when the role can see a field
  // but not in full (e.g. Counselors viewing leads not assigned to them).
  // For a counselor's OWN assigned lead we always show the real value.
  function maskField(key, value, lead) {
    if (!value) return null;
    if (fieldList(key) !== 'view_masked') return value;  // full access or hidden
    // Un-mask when this lead belongs to the current staff member
    const isOwn =
      lead.counselor       === staff?.fullName ||
      lead.seniorCounselor === staff?.fullName ||
      lead.presales        === staff?.fullName ||
      lead.marketingStaff  === staff?.fullName;
    if (isOwn) return value;
    // Apply partial mask
    if (key === 'email') {
      const [user, domain] = String(value).split('@');
      return (user?.slice(0, 2) || '') + '***@' + (domain || '');
    }
    if (key === 'phone') {
      const s = String(value);
      return s.slice(0, 3) + '****' + s.slice(-2);
    }
    return String(value).slice(0, 3) + '...';
  }

  // ── Click-to-call handler ─────────────────────────────────────
  // Opens the device dialler via the tel: link and silently logs a
  // Counselor Note so there is an automatic record of the call attempt.
  function handleCallClick(lead) {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    notesAPI.add(lead.studentId, 'counselor', `📞 Called student — ${now}`)
      .catch(err => console.warn('Auto call note failed:', err));
  }

  // Toast for "Access not authorised" feedback when a Counselor clicks an
  // unassigned lead. Auto-dismisses after 3 seconds.
  const [accessToast, setAccessToast] = useState(null);
  useEffect(() => {
    if (!accessToast) return;
    const t = setTimeout(() => setAccessToast(null), 3000);
    return () => clearTimeout(t);
  }, [accessToast]);

  const navigate = useNavigate();
  const location = useLocation();
  const [drillIds, setDrillIds] = useState([]);
  const { push: pushTrail } = useNavTrail();

  // ── Canonical lookup lists from the DB ─────────────────────
  // Used for filter dropdowns and for resolving "dirty" lead values
  // (e.g. 'Aus', 'Hồ Chí Minh') back to the canonical code so filtering works.
  const countries = useLookup('country');
  const provinces = useLookup('vietnam_province');

  const countryAliasMap = useMemo(() => {
    const m = new Map();
    countries.forEach(c => {
      if (c.code)    m.set(c.code.toLowerCase().trim(), c.code);
      if (c.labelEn) m.set(c.labelEn.toLowerCase().trim(), c.code);
      if (c.labelVi) m.set(c.labelVi.toLowerCase().trim(), c.code);
      (c.meta?.aliases || []).forEach(a => m.set(String(a).toLowerCase().trim(), c.code));
    });
    return m;
  }, [countries]);

  const provinceAliasMap = useMemo(() => {
    const m = new Map();
    provinces.forEach(p => {
      if (p.code)    m.set(p.code.toLowerCase().trim(), p.code);
      if (p.labelEn) m.set(p.labelEn.toLowerCase().trim(), p.code);
      if (p.labelVi) m.set(p.labelVi.toLowerCase().trim(), p.code);
      (p.meta?.aliases || []).forEach(a => m.set(String(a).toLowerCase().trim(), p.code));
    });
    return m;
  }, [provinces]);

  const resolveCountry  = (raw) => countryAliasMap.get(String(raw || '').toLowerCase().trim())  || raw || '';
  const resolveProvince = (raw) => provinceAliasMap.get(String(raw || '').toLowerCase().trim()) || raw || '';

  // Other dropdown-driven lookups — clean codes, no aliases needed.
  const leadStatuses         = useLookup('lead_status');
  const stoneTiers           = useLookup('stone_tier');
  const leadSources          = useLookup('lead_source');
  const studyPlansLookup     = useLookup('study_plan');
  const timelines            = useLookup('timeline');
  const interactions         = useLookup('interaction');
  const englishLevels        = useLookup('english_level');
  const gpas                 = useLookup('gpa');
  const budgets              = useLookup('budget');
  const confidences          = useLookup('confidence');
  const scholarshipDemands   = useLookup('scholarship_demand');
  const immigrationHistories = useLookup('immigration_history');
  const sponsorIncomes       = useLookup('sponsor_income');
  const incomeEvidences      = useLookup('income_evidence');
  const studyPlanGaps        = useLookup('study_plan_gap');
  const ultimateObjectives   = useLookup('ultimate_objective');
  const contactMediums       = useLookup('contact_medium');
  const columnLabels         = useLookup('column_label');

  // Language-aware display labels for the filter dropdowns.
  // The stored filter VALUE stays canonical (the code); only the visible
  // text changes based on the user's language toggle.
  const { language } = useLanguage();

  // Map every filter key to its lookup array. One source of truth.
  const lookupByFilterKey = {
    leadStatus:          leadStatuses,
    stoneTier:           stoneTiers,
    leadSource:          leadSources,
    studyPlans:          studyPlansLookup,
    timeline:            timelines,
    interaction:         interactions,
    englishLevel:        englishLevels,
    gpa:                 gpas,
    budget:              budgets,
    confidence:          confidences,
    destinationCountry:  countries,
    residency:           provinces,
    scholarshipDemand:   scholarshipDemands,
    immigrationHistory:  immigrationHistories,
    sponsorIncome:       sponsorIncomes,
    incomeEvidence:      incomeEvidences,
    studyPlanGap:        studyPlanGaps,
    ultimateObjective:   ultimateObjectives,
    motherContactMedium: contactMediums,
    fatherContactMedium: contactMediums,
  };

  // Generic language-aware label function for any filter key.
  const labelForFilterKey = (filterKey) => {
    const items = lookupByFilterKey[filterKey];
    if (!items) return (v) => v;
    return (code) => {
      const item = items.find(x => x.code === code);
      if (!item) return code;
      return language === 'vi' ? (item.labelVi || item.code) : (item.labelEn || item.code);
    };
  };

  // Display-side language-aware labels for TABLE CELLS.
  // - Returns labelVi when language is 'vi' for lookup-driven fields
  // - Multi-value cells (destinationCountry: "Australia, Canada") split + translate per piece
  // - Non-lookup fields (fullName, schoolEvent, etc.) pass through unchanged
  const displayCellLabel = (key, raw) => {
    if (!raw) return raw;
    if (!lookupByFilterKey[key]) return raw;
    const labeller = labelForFilterKey(key);
    if (key === 'destinationCountry') {
      return String(raw).split(',').map(s => labeller(s.trim())).filter(Boolean).join(', ');
    }
    return labeller(raw);
  };

  // Derive config key from role
  const roleKey = useMemo(() => {
    const r = staff?.role || 'Counselor';
    return ROLE_KEY_MAP[r] || 'counselor';
  }, [staff]);

  // ── Load leads + staff + columns (from API) ────────────────
  useEffect(() => {
    loadLeads();
    // Assignment dropdown: show all active staff. Previously this was
    // filtered by hardcoded role/position strings, which conflicted with
    // the goal of table-driven RBAC. The backend doesn't enforce a "who
    // can be assigned" rule based on role, so the dropdown is unrestricted.
    staffAPI.listActive()
      .then(d => setStaffList(d.data || []))
      .catch(() => {});

    // Column catalog comes from permission_fields table via the API.
    // Each item: { fieldName, label, width, order, category }
    // Visibility filtering by user permission happens at render time via
    // fieldList() — the catalog itself is identical for everyone.
    // column_config (per-role saved overrides) is still loaded so admin
    // resize-widths can persist across sessions, but no longer drives
    // visibility — RBAC owns that.
    Promise.all([
      staffAPI.listColumns(),
      columnConfigAPI.get(`leads_${roleKey}`).catch(() => ({ data: null })),
    ]).then(([catalogRes, configRes]) => {
      // listColumns returns rows with shape: { fieldName, label, width, order, category }
      const catalog = (catalogRes.data || []).map(c => ({
        key:     c.fieldName,
        label:   c.label,
        width:   c.width,
        visible: true,         // visibility now comes from fieldList() at render time
      }));
      // Saved 'All leads' default layout from column_config. Legacy shape: an
      // array of { key, width } (widths only). New shape: an object
      // { columnOrder, columnVisibility, columnSizing } (full layout). Stored in
      // baseConfigRef so applyVariant(null) ("All leads") can restore it.
      const cfg = configRes.data;
      const savedWidths = {};
      if (Array.isArray(cfg)) {
        cfg.forEach(c => { if (c.key && c.width) savedWidths[c.key] = c.width; });
        baseConfigRef.current = { columnSizing: savedWidths };
      } else if (cfg && typeof cfg === 'object') {
        Object.assign(savedWidths, cfg.columnSizing || {});
        baseConfigRef.current = {
          columnOrder:      Array.isArray(cfg.columnOrder) ? cfg.columnOrder : null,
          columnVisibility: cfg.columnVisibility || null,
          columnSizing:     cfg.columnSizing || null,
        };
      } else {
        baseConfigRef.current = {};
      }
      // leadId / studentId now come from the catalog (permission_fields) like every
      // other column, so they appear in Column Settings too. No code prepend.
      const merged = catalog.map(c => ({ ...c, width: savedWidths[c.key] || c.width }));
      setColumns(merged);
      // Apply persisted widths to TanStack's columnSizing state
      if (Object.keys(savedWidths).length > 0) {
        setColumnSizing(prev => ({ ...savedWidths, ...prev }));
      }
    }).catch(err => {
      console.error('Failed to load column catalog:', err);
      setColumns([]);  // fail-safe: no columns rather than wrong columns
    });
  }, [roleKey, canManageColumns]);

  // ── Apply drill-down filter from Dashboard ─────────────────
  useEffect(() => {
    const drill = location.state?.drillFilter;
    console.log('[Leads drill effect]', { state: location.state, drill });
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
    setPagination(p => ({ ...p, pageIndex: 0 }));
    window.history.replaceState({}, '');
  }, [location.state]);

  // ── Restore filter/sort/page state on mount ──
  // Only fires when arriving with the restoreFilters flag (back-arrow from a Lead detail).
  useEffect(() => {
    if (location.state?.drillFilter) return;
    if (!location.state?.restoreFilters) return;
    const saved = sessionStorage.getItem('leadsListState');
    if (!saved) return;
    try {
      const s = JSON.parse(saved);
      if (s.filters)                  setFilters(s.filters);
      if (Array.isArray(s.sorting))   setSorting(s.sorting);
      if (s.pagination)               setPagination(p => ({ ...p, ...s.pagination }));
      if (Array.isArray(s.drillIds))  setDrillIds(s.drillIds);
    } catch (e) {
      console.error('Failed to restore leads list state:', e);
    }
    window.history.replaceState({}, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist state on change ──
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    sessionStorage.setItem('leadsListState', JSON.stringify({
      filters, sorting, pagination, drillIds,
    }));
  }, [filters, sorting, pagination, drillIds]);

  // ── Push to navigation trail ──
  // Label includes filter context so users can see at a glance which
  // "Leads" view they came from. State carries restoreFilters so when
  // they navigate back via the trail, the persisted filter state is
  // re-applied (same mechanism the old "back to leads" arrow used).
  useEffect(() => {
    const count = countActiveFilters(filters);
    const label = count > 0
      ? `Leads (${count} filter${count > 1 ? 's' : ''})`
      : 'Leads';
    pushTrail({
      label,
      path:  '/leads',
      state: { restoreFilters: true },
    });
  }, [filters, drillIds, pushTrail]);

  async function loadLeads() {
    setLoading(true);
    try {
      const data = await studentAPI.searchLeads('');   // one row per LEAD (person + engagement)
      setLeads(data.data || []);
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // ── Variants — load on mount and apply default if any ──────
  useEffect(() => {
    variantsAPI.list('leads')
      .then(r => {
        const vs = r.data || [];
        setVariants(vs);
        // Skip default-variant apply when arriving via a Dashboard drill,
        // otherwise the variant's saved filters clobber the drill filter set
        // by the drill effect above. Same for back-arrow restore.
        if (location.state?.drillFilter)    return;
        if (location.state?.restoreFilters) return;
        const def = vs.find(v => v.isDefault);
        if (def) applyVariant(def);
      })
      .catch(() => setVariants([]));
  }, []);

  // Apply a variant: load its filters and TanStack state shapes.
  // Backwards-compatible with old variants that used { sort, columns } shape.
  function applyVariant(v) {
    if (!v) {
      // "All leads" — restore the saved global default layout (column_config),
      // falling back to catalog defaults when nothing has been saved.
      const base = baseConfigRef.current || {};
      setActiveVariantId(null);
      setFilters(EMPTY_FILTERS);
      setSorting([{ id: 'createdAt', desc: true }]);
      setColumnVisibility(base.columnVisibility || {});
      setColumnOrder(base.columnOrder || []);
      setColumnSizing(base.columnSizing || {});
      setPagination(p => ({ ...p, pageIndex: 0 }));
      return;
    }
    setActiveVariantId(v.id);
    const cfg = v.config || {};
    if (cfg.filters)            setFilters({ ...EMPTY_FILTERS, ...cfg.filters });
    // New TanStack-shape state
    if (cfg.sorting)            setSorting(cfg.sorting);
    if (cfg.columnVisibility)   setColumnVisibility(cfg.columnVisibility);
    if (cfg.columnOrder)        setColumnOrder(cfg.columnOrder);
    if (cfg.columnSizing)       setColumnSizing(cfg.columnSizing);
    // Legacy shape — migrate on the fly
    if (cfg.sort && !cfg.sorting) {
      setSorting([{ id: cfg.sort.field || 'createdAt', desc: cfg.sort.dir !== 'asc' }]);
    }
    if (Array.isArray(cfg.columns) && !cfg.columnOrder) {
      setColumnOrder(cfg.columns.map(c => c.key));
      const sizing = {};
      const visibility = {};
      cfg.columns.forEach(c => {
        if (c.width) sizing[c.key] = c.width;
        if (c.visible === false) visibility[c.key] = false;
      });
      setColumnSizing(sizing);
      setColumnVisibility(visibility);
    }
    setPagination(p => ({ ...p, pageIndex: 0 }));
  }

  // Build the current view as a variant config object.
  // Uses TanStack-shape state so it round-trips cleanly via table.setState().
  function currentConfig() {
    return {
      filters,
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
      pagination: { pageSize: pagination.pageSize },  // don't save pageIndex
    };
  }

  async function saveAsNewVariant(name) {
    if (!name?.trim()) return;
    try {
      const r = await variantsAPI.create({ page: 'leads', name: name.trim(), config: currentConfig() });
      setVariants(vs => [...vs, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveVariantId(r.data.id);
      setShowSaveDialog(false);
    } catch (e) { alert(e.message); }
  }

  async function saveCurrentVariant() {
    if (!activeVariantId) return;
    try {
      const r = await variantsAPI.update(activeVariantId, { config: currentConfig() });
      setVariants(vs => vs.map(v => v.id === activeVariantId ? r.data : v));
    } catch (e) { alert(e.message); }
  }

  // Save the current column order / visibility / widths as the global "All leads"
  // default (column_config, admin-gated). Lets an admin adjust the default view
  // and persist drag-reorder/resize done right in the list.
  async function saveDefaultLayout() {
    try {
      const cfg = { columnOrder, columnVisibility, columnSizing };
      await columnConfigAPI.save(`leads_${roleKey}`, cfg);
      baseConfigRef.current = cfg;
    } catch (e) { alert(e.message); }
  }

  async function deleteVariant(id) {
    if (!confirm('Delete this layout variant?')) return;
    try {
      await variantsAPI.delete(id);
      setVariants(vs => vs.filter(v => v.id !== id));
      if (activeVariantId === id) {
        setActiveVariantId(null);
        applyVariant(null);
      }
    } catch (e) { alert(e.message); }
  }

  // Toggle the "default" flag on a variant — backend unsets others
  // automatically (one default per user per page).
  async function makeDefaultVariant(v) {
    try {
      const r = await variantsAPI.update(v.id, { is_default: !v.isDefault });
      setVariants(vs => vs.map(x =>
        x.id === r.data.id ? r.data
        : (r.data.isDefault ? { ...x, isDefault: false } : x)
      ));
    } catch (e) { alert(e.message); }
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
    setPagination(p => ({ ...p, pageIndex: 0 }));
  }
  // Free-text "contains" filter for any column without a dedicated chip.
  function setColText(colKey, value) {
    setFilters(f => ({ ...f, colText: { ...(f.colText || {}), [colKey]: value } }));
    setPagination(p => ({ ...p, pageIndex: 0 }));
  }
  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPagination(p => ({ ...p, pageIndex: 0 }));
  }

  // ── Drag-and-drop column reordering ────────────────────────
  // Updates TanStack's columnOrder state. Held in a ref so we don't trigger
  // re-renders during drag (only on drop).
  const draggedColRef = useRef(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  function handleColDragStart(e, colId) {
    draggedColRef.current = colId;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', colId); } catch (_) {}
  }
  function handleColDragOver(e, colId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCol !== colId) setDragOverCol(colId);
  }
  function handleColDrop(e, targetId) {
    e.preventDefault();
    const fromId = draggedColRef.current;
    draggedColRef.current = null;
    setDragOverCol(null);
    if (!fromId || fromId === targetId) return;
    // Current order from TanStack — falls back to catalog order if not explicitly set
    const currentOrder = columnOrder.length > 0
      ? columnOrder
      : columns.map(c => c.key);
    const fromIdx = currentOrder.indexOf(fromId);
    const toIdx   = currentOrder.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...currentOrder];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setColumnOrder(next);
  }
  function handleColDragEnd() {
    draggedColRef.current = null;
    setDragOverCol(null);
  }

  // ── Visible columns set (O(1) lookup for filter rendering) ──
  const visibleColKeys = useMemo(
    () => new Set(columns.filter(c => c.visible).map(c => c.key)),
    [columns]
  );

  // ── Active filter count (for badge) ───────────────────────
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  // SortIndicator — driven by TanStack header.column.getIsSorted()
  // Returns 'asc' | 'desc' | false. Always render an icon (subdued when inactive)
  // so the affordance is obvious.
  function SortIndicator({ state }) {
    if (state === 'asc')  return <span style={{ color:'var(--primary)', marginLeft:'4px', display:'inline-flex' }}><FiChevronUp size={13} strokeWidth={3}/></span>;
    if (state === 'desc') return <span style={{ color:'var(--primary)', marginLeft:'4px', display:'inline-flex' }}><FiChevronDown size={13} strokeWidth={3}/></span>;
    return (
      <span style={{
        display:'inline-flex', flexDirection:'column',
        fontSize:'7px', lineHeight:'7px',
        color:'var(--text-secondary)', opacity:0.5,
        marginLeft:'4px',
      }}>
        <span>▲</span><span style={{ marginTop:'1px' }}>▼</span>
      </span>
    );
  }

  // Three-dot indicator for missing data. Light grey, slightly wider spacing
  // so it doesn't look like an ellipsis.
  function MissingValue() {
    return (
      <span style={{
        color:'var(--text-secondary)', opacity:0.45,
        letterSpacing:'2px', fontSize:'0.85rem',
      }}>...</span>
    );
  }

  // Stone tier → emoji map. Compact, no asset dependency.
  // Swap to actual PNGs later by replacing the values with imported image paths
  // and updating StoneIcon to render <img>.
  const STONE_ICONS = {
    Diamond:  '💎',
    Ruby:     '🔴',
    Sapphire: '🔷',
    Agate:    '🟠',
    Quartz:   '⚪',
  };

  function StoneIcon({ tier }) {
    if (!tier || tier === 'Unscored') return <MissingValue/>;
    const glyph = STONE_ICONS[tier];
    if (!glyph) return <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{tier}</span>;
    return (
      <span title={tier} style={{ fontSize:'1.1rem', lineHeight:1 }}>{glyph}</span>
    );
  }

  // ── Unique values for multi-select filter options ──────────
  const uniqueValues = useMemo(() => {
    const get = key => [...new Set(leads.map(l => l[key]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
    // Split comma-separated multi-value fields into individual values for filter options.
    // Used by destinationCountry where one lead may target multiple countries
    // (e.g. "Australia, Canada, UK") — we want each as a separate filter option.
    const getSplit = key => {
      const all = new Set();
      leads.forEach(l => {
        if (!l[key]) return;
        String(l[key]).split(',').forEach(v => {
          const t = v.trim();
          if (t) all.add(t);
        });
      });
      return [...all].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
    };
    return {
      // Lead management — canonical lists from DB lookup
      leadStatus:         leadStatuses.map(s => s.code),
      stoneTier:          stoneTiers.filter(s => s.code !== 'Unscored').map(s => s.code),
      leadSource:         leadSources.map(s => s.code),
      studyPlans:         studyPlansLookup.map(s => s.code),
      englishLevel:       englishLevels.map(s => s.code),
      timeline:           timelines.map(s => s.code),
      interaction:        interactions.map(s => s.code),
      destinationCountry: countries.map(c => c.code),
      gpa:                gpas.map(s => s.code),
      budget:             budgets.map(s => s.code),
      confidence:         confidences.map(s => s.code),
      // Staff names — still derived from current data (not lookup-driven)
      counselor:          get('counselor'),
      presales:           get('presales'),
      marketingStaff:     get('marketingStaff'),
      caseOfficer:        get('caseOfficer'),
      quality:            get('quality'),
      techSupport:        get('techSupport'),
      businessDevelopment: get('businessDevelopment'),
      // Source / academic / phase — faceted from current data
      source:             get('source'),
      sourceDetail:       get('sourceDetail'),
      major:              get('major'),
      schoolAttended:     get('schoolAttended'),
      ward:               get('ward'),
      intake:             get('intake'),
      degreeLevel:        get('degreeLevel'),
      targetInstitution:  get('targetInstitution'),
      rationale:          get('rationale'),
      orderPhase:         get('orderPhase'),
      // Personal — mix of free-form (from data) and canonical (DB lookup)
      yearOfBirth:        get('yearOfBirth'),
      residency:          provinces.map(p => p.code),
      // schoolEvent:        get('schoolEvent'),
      referralSource:     get('referralSource'),
      preferredSocial:    get('preferredSocial'),
      socialConsent:      get('socialConsent'),
      // Self assessment — canonical lists from DB lookup
      scholarshipDemand:  scholarshipDemands.map(s => s.code),
      immigrationHistory: immigrationHistories.map(s => s.code),
      sponsorIncome:      sponsorIncomes.map(s => s.code),
      incomeEvidence:     incomeEvidences.map(s => s.code),
      studyPlanGap:       studyPlanGaps.map(s => s.code),
      ultimateObjective:  ultimateObjectives.map(s => s.code),
      // Family — canonical contact medium codes
      motherContactMedium: contactMediums.map(s => s.code),
      fatherContactMedium: contactMediums.map(s => s.code),
      // Campaign — free-form from current data
      campaignType:       get('campaignType'),
      campaignName:       get('campaignName'),
    };
  }, [
    leads, countries, provinces,
    leadStatuses, stoneTiers, leadSources, studyPlansLookup, timelines, interactions,
    englishLevels, gpas, budgets, confidences,
    scholarshipDemands, immigrationHistories, sponsorIncomes, incomeEvidences,
    studyPlanGaps, ultimateObjectives, contactMediums,
  ]);

  // ── Filtering + sorting ────────────────────────────────────
  const filtered = useMemo(() => {
    let r = leads;

    if (drillIds.length > 0) {
      // Drill ids may be lead ids (int) or student ids (text) — they never collide.
      r = r.filter(l => drillIds.includes(l.leadId) || drillIds.includes(l.studentId));
    }

    // Backend's role_permissions.view_list controls whether each role
    // gets all leads or only their own. No second-layer filtering by role here.

    if (filters.search) {
      // Universal search — searches against both the display values AND the
      // raw underlying values for masked fields.
      //
      // The server returns masked display values (e.g. 'b...n@psb-academy.edu.sg')
      // for restricted fields, but also includes the real value under a
      // '_raw_<fieldName>' key (e.g. '_raw_email') so we can search against
      // the actual contact data without exposing it in the UI.
      //
      // This means:
      //   - Typing the masked value  ("b...n")          → matches via display value
      //   - Typing the real value    ("baotran.tran@...") → matches via _raw_ key
      //   - Typing a partial number  ("6187919")         → matches via _raw_phone
      //
      // contactDetails is a JSON object of social/contact handles (Zalo,
      // Facebook etc.). We flatten its values so handles are searchable too.
      r = r.filter(l => {
        const candidates = Object.entries(l).flatMap(([key, v]) => {
          if (v == null) return [];
          // Always include _raw_ fields in search candidates but never display them
          if (Array.isArray(v)) return [v.join(' ')];
          if (typeof v === 'object') return Object.values(v)
            .filter(x => x != null && typeof x !== 'object').map(String);
          return [String(v)];
        });
        return candidates.some(c => matchesSearch(c, filters.search));
      });
    }

    // Multi-select match. Supports the (none) sentinel: a lead matches if its value
    // is empty AND the filter has the sentinel selected, OR its value is in the
    // selected list. Empty filter array = no constraint.
    const mf = (arr, val) => {
      if (!arr?.length) return true;
      if (!val && arr.includes(NONE_VALUE)) return true;
      return arr.includes(val);
    };

    // Multi-value matcher for fields like destinationCountry where one cell
    // may hold "Australia, Canada, UK". Splits on common delimiters, resolves
    // each piece to its canonical code, and matches if ANY piece is in the
    // filter array.
    const matchesAnyCountry = (filterArr, raw) => {
      if (!filterArr?.length) return true;
      if (!raw && filterArr.includes(NONE_VALUE)) return true;
      if (!raw) return false;
      const pieces = String(raw)
        .split(/[,;\/&|]| and | or | và | hoặc /i)
        .map(s => s.trim())
        .filter(Boolean);
      return pieces.some(p => filterArr.includes(resolveCountry(p)));
    };

    if (filters.leadStatus?.length)          r = r.filter(l => mf(filters.leadStatus,          l.leadStatus  || 'New'));
    if (filters.stoneTier?.length)           r = r.filter(l => mf(filters.stoneTier,           l.stoneTier));
    if (filters.leadSource?.length)          r = r.filter(l => mf(filters.leadSource,          l.leadSource));
    if (filters.studyPlans?.length)          r = r.filter(l => mf(filters.studyPlans,          l.studyPlans));
    if (filters.englishLevel?.length)        r = r.filter(l => mf(filters.englishLevel,        l.englishLevel));
    if (filters.timeline?.length)            r = r.filter(l => mf(filters.timeline,            l.timeline));
    if (filters.interaction?.length)         r = r.filter(l => mf(filters.interaction,         l.interaction));
    // Multi-value match for fields that store comma-separated lists (like
    // destinationCountry). A lead matches if any of its values is in the
    // selected filter array, or if its value is empty and (none) is selected.
    const mfMulti = (arr, raw) => {
      if (!arr?.length) return true;
      if (!raw && arr.includes(NONE_VALUE)) return true;
      if (!raw) return false;
      const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
      return parts.some(p => arr.includes(p));
    };

    if (filters.destinationCountry?.length)  r = r.filter(l => matchesAnyCountry(filters.destinationCountry, l.destinationCountry));
    if (filters.gpa?.length)                 r = r.filter(l => mf(filters.gpa,                 l.gpa));
    if (filters.budget?.length)              r = r.filter(l => mf(filters.budget,              l.budget));
    if (filters.confidence?.length)          r = r.filter(l => mf(filters.confidence,          l.confidence));
    if (filters.counselor?.length)           r = r.filter(l => mf(filters.counselor,           l.counselor));
    if (filters.presales?.length)            r = r.filter(l => mf(filters.presales,            l.presales));
    if (filters.marketingStaff?.length)      r = r.filter(l => mf(filters.marketingStaff,      l.marketingStaff));
    if (filters.caseOfficer?.length)         r = r.filter(l => mf(filters.caseOfficer,         l.caseOfficer));
    if (filters.quality?.length)             r = r.filter(l => mf(filters.quality,             l.quality));
    if (filters.techSupport?.length)         r = r.filter(l => mf(filters.techSupport,         l.techSupport));
    if (filters.businessDevelopment?.length) r = r.filter(l => mf(filters.businessDevelopment, l.businessDevelopment));
    // Source / academic / phase
    if (filters.source?.length)              r = r.filter(l => mf(filters.source,              l.source));
    if (filters.sourceDetail?.length)        r = r.filter(l => mf(filters.sourceDetail,        l.sourceDetail));
    if (filters.major?.length)               r = r.filter(l => mf(filters.major,               l.major));
    if (filters.schoolAttended?.length)      r = r.filter(l => mf(filters.schoolAttended,      l.schoolAttended));
    if (filters.ward?.length)                r = r.filter(l => mf(filters.ward,                l.ward));
    if (filters.intake?.length)              r = r.filter(l => mf(filters.intake,              l.intake));
    if (filters.degreeLevel?.length)         r = r.filter(l => mf(filters.degreeLevel,         l.degreeLevel));
    if (filters.targetInstitution?.length)   r = r.filter(l => mf(filters.targetInstitution,   l.targetInstitution));
    if (filters.rationale?.length)           r = r.filter(l => mf(filters.rationale,           l.rationale));
    if (filters.orderPhase?.length)          r = r.filter(l => mf(filters.orderPhase,          l.orderPhase));
    // Personal
    if (filters.yearOfBirth?.length)         r = r.filter(l => mf(filters.yearOfBirth,         l.yearOfBirth));
    if (filters.residency?.length)           r = r.filter(l => mf(filters.residency,           resolveProvince(l.residency)));
    // if (filters.schoolEvent?.length)         r = r.filter(l => mf(filters.schoolEvent,         l.schoolEvent));
    if (filters.referralSource?.length)      r = r.filter(l => mf(filters.referralSource,      l.referralSource));
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
    if (filters.assignedInFrom)  r = r.filter(l => l.assignedIn       && new Date(l.assignedIn)       >= new Date(filters.assignedInFrom));
    if (filters.assignedInTo)    r = r.filter(l => l.assignedIn       && new Date(l.assignedIn)       <= new Date(filters.assignedInTo   + 'T23:59:59'));
    if (filters.assignedOutFrom) r = r.filter(l => l.assignedOut      && new Date(l.assignedOut)      >= new Date(filters.assignedOutFrom));
    if (filters.assignedOutTo)   r = r.filter(l => l.assignedOut      && new Date(l.assignedOut)      <= new Date(filters.assignedOutTo  + 'T23:59:59'));
    if (filters.actualCloseFrom) r = r.filter(l => l.actualCloseDate  && new Date(l.actualCloseDate)  >= new Date(filters.actualCloseFrom));
    if (filters.actualCloseTo)   r = r.filter(l => l.actualCloseDate  && new Date(l.actualCloseDate)  <= new Date(filters.actualCloseTo  + 'T23:59:59'));
    if (filters.cancelFrom)      r = r.filter(l => l.cancellationDate && new Date(l.cancellationDate) >= new Date(filters.cancelFrom));
    if (filters.cancelTo)        r = r.filter(l => l.cancellationDate && new Date(l.cancellationDate) <= new Date(filters.cancelTo      + 'T23:59:59'));

    // Generic per-column free-text "contains" filters — covers every column that
    // doesn't have a dedicated multi/date chip. Matches against the raw value too.
    const colText = filters.colText || {};
    for (const [k, val] of Object.entries(colText)) {
      const needle = String(val || '').trim().toLowerCase();
      if (!needle) continue;
      r = r.filter(l => {
        const disp = l[k];
        const raw  = l[`_raw_${k}`];
        return String(disp ?? '').toLowerCase().includes(needle)
            || String(raw  ?? '').toLowerCase().includes(needle);
      });
    }

    // No sort here — TanStack handles sorting via its sortedRowModel.
    return r;
  }, [leads, filters, drillIds]);

  // ── TanStack column definitions ──────────────────────────────
  // Built from the catalog (columns state). Each cell uses the existing
  // renderCell helper so we keep our masking, stones, dates, etc.
  // Header label is translated to Vietnamese via lookup_values.column_label
  // when the user has switched language to 'vi'.
  const columnHeaderFor = (col) => {
    if (language !== 'vi') return col.label || col.key;
    const lookup = columnLabels.find(c => c.code === col.key);
    return lookup?.labelVi || col.label || col.key;
  };

  const columnDefs = useMemo(() => {
    return columns.map(col => ({
      id:           col.key,
      accessorKey:  col.key,
      header:       columnHeaderFor(col),
      cell:         info => renderCellInner(col, info.row.original),
      enableSorting: col.key !== 'age',
      size:          col.width || 150,
      minSize:       80,
    }));
  }, [columns, columnLabels, language]);

  // ── TanStack table instance ─────────────────────────────────
  const table = useReactTable({
    data: filtered,
    columns: columnDefs,
    state: {
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
      pagination,
    },
    onSortingChange:           setSorting,
    onColumnVisibilityChange:  setColumnVisibility,
    onColumnOrderChange:       setColumnOrder,
    onColumnSizingChange:      setColumnSizing,
    onPaginationChange:        setPagination,
    getCoreRowModel:           getCoreRowModel(),
    getSortedRowModel:         getSortedRowModel(),
    getPaginationRowModel:     getPaginationRowModel(),
    enableColumnResizing:      true,
    columnResizeMode:          'onChange',
    // Rows are lead-level (one per lead). leadId is unique per row; studentId is
    // NOT (a student can have many leads), so keying by studentId produced
    // duplicate React keys and scrambled cells on sort/reorder.
    getRowId:                  row => String(row.leadId ?? `s_${row.studentId}`),
  });

  function toggleSelect(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }
  function toggleAll() {
    const pageIds = table.getRowModel().rows.map(r => r.original.studentId);
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

  // ── Export to Excel ──────────────────────────────────────────
  // Calls the backend export endpoint with the current visible columns and
  // any date filters in effect. The API helper triggers a browser download
  // of the .xlsx file.
  async function handleExportExcel() {
    try {
      const fields = visibleCols.map(c => c.key);
      // const result = await staffAPI.exportExcel({
      const result = await studentAPI.exportExcel({
        startDate:    filters.dateFrom    || null,
        endDate:      filters.dateTo      || null,
        dateField:    'createdAt',
        fields,
        includeNotes: false,
      });
      console.log(`Exported ${result.rowCount} rows to Excel`);
    } catch (e) {
      alert(`Export failed: ${e.message}`);
    }
  }

  async function handleMassAssign() {
    if (selected.length === 0) return;
    if (RECIPIENT_REQUIRED.has(massPhase) && !massValue) { alert(`A recipient is required to move into ${massPhase}.`); return; }
    if ((PHASE_SLOTS[massPhase] || []).length > 1 && !massPosition) { alert('Select a position.'); return; }
    // Connected-unit rule: a working phase needs an active lead. Warn when any
    // selected record has none — the move will mint a new active lead for it.
    // (Pool is exempt — it can hold records with no active lead.)
    if (massPhase !== 'Pool') {
      const TERMINAL = new Set(['Contracted', 'Lost', 'Archived', 'Cancelled']);
      const hasActive = new Set(leads.filter(l => !TERMINAL.has(l.leadStatus || 'New')).map(l => l.studentId));
      const noActive = selected.filter(sid => !hasActive.has(sid));
      if (noActive.length > 0 &&
          !confirm(`${noActive.length} of ${selected.length} selected record(s) have no active lead.\n\n` +
                   `A new active lead will be created for each so it can be worked in ${massPhase}.\n\nContinue?`)) return;
    }
    try {
      const position = massPosition || (PHASE_SLOTS[massPhase] || [])[0] || '';
      const r = await staffAPI.massMovePhase(selected, massPhase, massValue, position);
      await loadLeads();
      setSelected([]);
      if (r?.data?.moved) {
        const created = r.data.createdLeads || 0;
        alert(`Moved ${r.data.moved} order(s) to ${r.data.toPhase}.` +
              (created ? `\nCreated ${created} new active lead(s) for records that had none.` : ''));
      }
    } catch(e) { alert(e.message); }
  }

  async function handleMassDelete() {
    if (selected.length === 0) return;
    const msg = `Permanently delete ${selected.length} lead${selected.length !== 1 ? 's' : ''}?\n\n` +
                `Each deletion will be archived to Google Drive (lead metadata + any notes) for forensic record.\n\n` +
                `This action cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      const result = await studentAPI.deleteRecords(selected);
      // result has shape { success, deleted, archives: [{ studentId, status, ... }] }
      const archives = result?.archives || [];
      const archived = archives.filter(a => a.status === 'archived').length;
      const failed   = archives.filter(a => a.status === 'failed').length;
      const skipped  = archives.filter(a => a.status === 'skipped').length;
      let summary = `Deleted ${selected.length} lead${selected.length !== 1 ? 's' : ''}.`;
      if (archived > 0) summary += `\n${archived} archive${archived !== 1 ? 's' : ''} saved to Google Drive.`;
      if (skipped > 0)  summary += `\n${skipped} skipped (lead not found).`;
      if (failed > 0)   summary += `\n${failed} archive failure${failed !== 1 ? 's' : ''} — check server logs.`;
      alert(summary);
      await loadLeads();
      setSelected([]);
    } catch(e) { alert(e.message); }
  }

  // Column resize is handled natively by TanStack (header.getResizeHandler).
  // The colWidths/resizing refs and startResize() function have been removed.

  // Returns just the cell content (not the wrapping <td>). The td wrapper
  // is rendered by the table row; styles for specific column types come from
  // cellStyleFor() below.
  function renderCellInner(col, lead) {
    const v = lead[col.key];
    switch(col.key) {
      case 'leadId':
        return v
          ? <span
              onClick={e => { e.stopPropagation(); navigate(`/lead/${v}`); }}
              style={{ color:'var(--primary)', cursor:'pointer', fontWeight:600 }}
              title="Open this lead">
              {v}
            </span>
          : <MissingValue/>;
      case 'studentId':
        return v
          ? <span
              onClick={e => { e.stopPropagation(); navigate(`/students/${v}`); }}
              style={{ color:'var(--primary)', cursor:'pointer' }}
              title="Open Sales profile">
              {v}
            </span>
          : <MissingValue/>;
      case 'fullName':              return v || <MissingValue/>;
      case 'leadStatus': {
        // Look up the cssClass and language-aware label from lookup data.
        const item = leadStatuses.find(s => s.code === v);
        const cssClass = item?.meta?.cssClass || 'new';
        const label = item
          ? (language === 'vi' ? (item.labelVi || item.code) : (item.labelEn || item.code))
          : (v || 'New');
        return <span className={`badge badge--${cssClass}`}>{label}</span>;
      }
      case 'stoneTier':             return <StoneIcon tier={v}/>;
      case 'orderPhase': {
        // Sales Order phase/department — colored pill, consistent with the
        // phase badge on the detail screen.
        if (!v) return <MissingValue/>;
        const PHASE_COLORS = {
          Marketing:       '#7C3AED',
          Counselling:     '#2563EB',
          Presales:        '#0891B2',
          Pool:            '#D97706',
          'Case Officers': '#059669',
          Support:         '#64748B',
        };
        const bg = PHASE_COLORS[v] || '#64748B';
        return (
          <span style={{
            display:'inline-block', padding:'0.1rem 0.5rem', borderRadius:'9999px',
            fontSize:'0.6875rem', fontWeight:700, color:'#fff', background:bg,
            whiteSpace:'nowrap',
          }}>
            {v}
          </span>
        );
      }
      case 'createdAt':             return v ? String(v).slice(0,10) : <MissingValue/>;
      case 'age':                   return getLeadAge(lead.createdAt) || <MissingValue/>;
      case 'riskScore':             return v || <MissingValue/>;
      case 'closeDate':             return v ? String(v).slice(0,10) : <MissingValue/>;
      case 'campaignStart':         return v ? String(v).slice(0,10) : <MissingValue/>;
      case 'campaignEnd':           return v ? String(v).slice(0,10) : <MissingValue/>;
      case 'updatedAt':
      case 'assignedIn':
      case 'assignedOut':
      case 'actualCloseDate':
      case 'cancellationDate':
      case 'personCreatedAt':
      case 'personUpdatedAt':
      case 'personAssignedIn':
      case 'personAssignedOut':      return v ? String(v).slice(0,10) : <MissingValue/>;
      case 'oceanExtraversion':
      case 'oceanAgreeableness':
      case 'oceanConscientiousness':
      case 'oceanNeuroticism':
      case 'oceanOpenness':         return v != null ? `${v}/15` : <MissingValue/>;

      // ── Email — respect field-level masking from RBAC ──────────
      case 'email': {
        const display = maskField('email', v, lead);
        if (!display) return <MissingValue/>;
        const isMasked = String(display).includes('*') || String(display).includes('...');
        if (isMasked) return <span style={{ color:'var(--text-secondary)', fontStyle:'italic' }}>{display}</span>;
        return <span>{display}</span>;
      }

      // ── Phone — mask if needed, or render as a click-to-call link ──
      case 'phone': {
        const display = maskField('phone', v, lead);
        if (!display) return <MissingValue/>;
        const isMasked = String(display).includes('*') || String(display).includes('...');
        if (isMasked) return <span style={{ color:'var(--text-secondary)', fontStyle:'italic' }}>{display}</span>;
        return (
          <a
            href={`tel:${v}`}
            style={{ color:'var(--primary)', textDecoration:'none', fontWeight:500 }}
            title={`Call ${display}`}
            onClick={e => { e.stopPropagation(); handleCallClick(lead); }}>
            {display}
          </a>
        );
      }

      default: {
        // Lookup-driven columns get language-aware display labels;
        // non-lookup columns (free-form text) pass through unchanged.
        const display = displayCellLabel(col.key, v);
        return display || <MissingValue/>;
      }
    }
  }

  // Returns per-cell <td> style based on column type (e.g. tabular numbers
  // for dates/scores). Applied in the tbody row render.
  function cellStyleFor(colKey, lead) {
    const v = lead[colKey];
    const isMaskedLooking = typeof v === 'string' && v.includes('...');
    switch(colKey) {
      case 'fullName':    return { fontWeight: 500 };
      case 'stoneTier':   return { textAlign: 'center' };
      case 'createdAt':
      case 'campaignStart':
      case 'campaignEnd': return { fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' };
      case 'age':
      case 'riskScore':
      case 'closeDate':
      case 'oceanExtraversion':
      case 'oceanAgreeableness':
      case 'oceanConscientiousness':
      case 'oceanNeuroticism':
      case 'oceanOpenness': return { fontVariantNumeric: 'tabular-nums' };
      default:
        return isMaskedLooking
          ? { color:'var(--text-secondary)', opacity:0.75 }
          : {};
    }
  }

  // ── Column visibility is driven by field-level RBAC, not column_config ──
  // If the user's `list_permission` for a field is 'view', 'view_masked',
  // or 'edit', the column shows. If it's 'none', the column is hidden.
  // Fields not in the permission catalog (createdAt, updatedAt, age, etc.)
  // default to 'view' and therefore show.
  //
  // Note: column_config is still loaded and can REORDER columns, but it
  // can no longer hide a column the role is RBAC-allowed to see, nor show
  // a column the role is RBAC-forbidden to see. This removes the duplicate
  // configuration surface — RBAC tables are the single source of truth.
  const visibleCols = columns.filter(c => c.key === 'leadId' || (fieldList(c.key) !== 'none' && c.visible !== false));
  const FIELD_LABELS = {
    counselor:'Counselor', seniorCounselor:'Senior Counselor',
    presales:'Pre-Sales', marketingStaff:'Marketing Staff',
  };

  // Bulk phase-move targets + the staff positions valid in each. Picking a phase
  // filters the recipient list to that phase's staff (the owner drives the phase).
  const PHASE_POSITIONS = {
    Counselling:            ['Staff, Counsellor', 'Lead, Counsellor', 'Counselor', 'Senior Counselor'],
    Presales:               ['Staff, Pre-sales', 'Lead, Pre-sales', 'PreSales'],
    Pool:                   ['Staff, Data Quality', 'Staff, Technical Support', 'Manager, Technical Support', 'Administrator, Office', 'Quality', 'Tech Support'],
    Marketing:              ['Staff, Marketing', 'Manager, Marketing', 'Marketing Staff'],
    'Business Development':  ['Staff, Business Development', 'Manager, Business Development'],
    'Case Officers':        ['Staff, Case Officer - Dir', 'Staff, Case Officer - Sub', 'Lead, Case Officer', 'Case Officer, Direct', 'Case Officer, Sub'],
  };
  const massStaff = staffList.filter(s => (PHASE_POSITIONS[massPhase] || []).includes(s.position));

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
        /* Data cells: long values truncate with ellipsis. Headers don't,
           so the column auto-grows to fit the label. */
        .leads-data-table tbody td {
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Zebra rows — light opaque blue on even rows */
        .leads-data-table tbody tr:nth-child(even) td {
          background-color: rgba(59, 130, 246, 0.08);
        }
        .leads-data-table tbody tr:hover td {
          background-color: rgba(59, 130, 246, 0.14) !important;
        }
      `}</style>
      <div className="page-header no-print">
        <span className="page-title">Leads ({filtered.length})</span>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {/* "Your assigned leads" label removed — all roles now see all leads in the list.
              Counselor still gets a 403 on detail for unassigned leads (Phase 2c). */}
        </div>
      </div>

      <div className="page-body" style={{ height:'calc(100vh - var(--header-height))', display:'flex', flexDirection:'column', minHeight:0, overflow:'hidden' }}>
        {/* ── Upper row: variants | search | date filters | actions ────── */}
        <div className="no-print" style={{
          display:'flex', alignItems:'center', gap:'12px',
          flexWrap:'wrap', marginBottom:'8px',
          borderBottom:'0.5px solid var(--border)', paddingBottom:'8px',
        }}>
          {/* Variant tabs */}
          <div style={{ display:'flex', alignItems:'flex-end', gap:'2px', flexWrap:'wrap' }}>
            {/* "All leads" — no variant active */}
            <button
              onClick={() => applyVariant(null)}
              style={{
                padding:'6px 14px', fontSize:'13px',
                background: !activeVariantId ? 'var(--primary-light)' : 'transparent',
                color:     !activeVariantId ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: !activeVariantId ? '2px solid var(--primary)' : '2px solid transparent',
                border:'none',
                borderTopLeftRadius:'6px', borderTopRightRadius:'6px',
                cursor:'pointer',
                fontWeight: !activeVariantId ? 500 : 400,
              }}>
              All leads
            </button>
            {!activeVariantId && canManageColumns && (
              <button
                onClick={saveDefaultLayout}
                title="Save the current column order, visibility and widths as the default 'All leads' layout (your role)"
                style={{ padding:'6px 10px', fontSize:'12px', background:'transparent', border:'none',
                         color:'var(--primary)', cursor:'pointer', alignSelf:'center', whiteSpace:'nowrap' }}>
                💾 Save default
              </button>
            )}
            {variants.map(v => {
              const isActive = activeVariantId === v.id;
              return (
                <div key={v.id} style={{
                  display:'flex', alignItems:'center',
                  background: isActive ? 'var(--primary-light)' : 'transparent',
                  borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  borderTopLeftRadius:'6px', borderTopRightRadius:'6px',
                }}>
                  <button
                    onClick={() => applyVariant(v)}
                    title={v.isDefault ? 'Your default view' : 'Switch to this view'}
                    style={{
                      padding:'6px 6px 6px 14px', fontSize:'13px',
                      background:'transparent', border:'none',
                      color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 500 : 400,
                      cursor:'pointer',
                    }}>
                    {v.isDefault && <FiStar size={11} style={{ color:'#f59e0b', marginRight:'4px', verticalAlign:'-1px' }} fill="#f59e0b"/>}
                    {v.name}
                  </button>
                  {isActive && (
                    <div style={{ display:'flex', gap:'2px', padding:'0 8px 0 2px' }}>
                      <button onClick={() => makeDefaultVariant(v)} title={v.isDefault ? 'Remove as default' : 'Set as default'}
                        style={{ background:'none', border:'none', padding:'4px', cursor:'pointer',
                                 color: v.isDefault ? '#f59e0b' : 'var(--text-secondary)', display:'inline-flex' }}>
                        <FiStar size={12} fill={v.isDefault ? '#f59e0b' : 'none'}/>
                      </button>
                      <button onClick={saveCurrentVariant} title="Save current view"
                        style={{ background:'none', border:'none', padding:'4px', cursor:'pointer',
                                 color:'var(--text-secondary)', display:'inline-flex' }}>
                        <FiSave size={12}/>
                      </button>
                      <button onClick={() => deleteVariant(v.id)} title="Delete this view"
                        style={{ background:'none', border:'none', padding:'4px', cursor:'pointer',
                                 color:'var(--danger)', display:'inline-flex' }}>
                        <FiTrash2 size={12}/>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setShowSaveDialog(true)}
              title="Save the current view as a new variant"
              style={{
                padding:'6px 10px', fontSize:'13px',
                background:'transparent', border:'none',
                color:'var(--text-secondary)', cursor:'pointer',
                marginLeft:'4px',
              }}>
              + New view
            </button>
          </div>

          {/* Wildcard search — constrained width */}
          <div className="search-input-wrap" style={{ width:'280px', flex:'0 0 280px' }}>
            <FiSearch size={15}/>
            <input
              className="search-input"
              placeholder="Search any field… (* wildcard)"
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

          {/* Actions on the far right — Print + Export are permission-gated */}
          <div style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center' }}>
            {activeFilterCount > 0 && (
              <button className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear filters ({activeFilterCount})</button>
            )}
            {canPrintList && (
              <button className="btn btn--secondary btn--sm" onClick={handlePrint}
                style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}
                title="Print the current filtered list">
                <FiPrinter size={13}/> Print
              </button>
            )}
            {canPrintList && (
              <button className="btn btn--secondary btn--sm" onClick={handleExportExcel}
                style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}
                title="Export the current filtered list to Excel">
                <FiDownload size={13}/> Export
              </button>
            )}
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────── */}
        <div className="table-card print-area" style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
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
            style={{ overflow:'auto', flex:1, minHeight:0 }}
          >
            <table className="leads-data-table" style={{ tableLayout:'auto', width:'100%' }}>
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {canMassAssign && (
                      <th className="checkbox-col" style={{ width:'40px' }}>
                        <input
                          type="checkbox"
                          checked={table.getRowModel().rows.length > 0 && table.getRowModel().rows.every(r => selected.includes(r.original.studentId))}
                          onChange={toggleAll}
                        />
                      </th>
                    )}
                    {headerGroup.headers.map(header => {
                      const canSort = header.column.getCanSort();
                      const sorted  = header.column.getIsSorted();
                      const colId   = header.column.id;
                      const isDragOver = dragOverCol === colId;
                      return (
                        <th key={header.id}
                            draggable={true}
                            onDragStart={e => handleColDragStart(e, colId)}
                            onDragOver={e  => handleColDragOver(e, colId)}
                            onDrop={e      => handleColDrop(e, colId)}
                            onDragEnd={handleColDragEnd}
                            style={{
                              width: header.getSize(),
                              position:'relative', userSelect:'none',
                              whiteSpace:'nowrap',
                              textAlign:'left',
                              borderLeft: isDragOver ? '2px solid var(--primary)' : '2px solid transparent',
                              transition:'border-color 0.1s',
                            }}>
                          {/* Grip handle — visual cue for draggability. The whole th
                              is the drag source (draggable=true) so dragging from
                              anywhere on the header works. */}
                          <span style={{
                            color:'var(--text-secondary)', opacity:0.4,
                            marginRight:'4px', cursor:'grab', verticalAlign:'-1px',
                            fontSize:'10px', letterSpacing:'-1px',
                          }} aria-hidden="true">⋮⋮</span>
                          <span
                            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                            style={{
                              cursor: canSort ? 'pointer' : 'default',
                              display:'inline-flex', alignItems:'center',
                            }}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {canSort && <SortIndicator state={sorted}/>}
                          </span>
                          {/* TanStack-native column resize handle */}
                          <span
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            style={{
                              position:'absolute', right:0, top:0, bottom:0, width:'5px',
                              cursor:'col-resize',
                              background: header.column.getIsResizing() ? 'var(--primary)' : 'transparent',
                            }}
                          />
                        </th>
                      );
                    })}
                  </tr>
                ))}
                {/* Filter row — one chip per filterable column, aligned with its column.
                    Multi-select columns get a ColumnFilterChip; date columns get a DateRangeChip. */}
                <tr className="leads-filter-row">
                  {canMassAssign && <th style={{ padding:'4px 6px', background:'var(--bg-secondary)' }}/>}
                  {table.getVisibleLeafColumns().map(col => {
                    const fcMulti = FILTER_CONFIG.find(f => f.colKey === col.id && f.type === 'multi');
                    const fcDate  = FILTER_CONFIG.find(f => f.colKey === col.id && f.type === 'daterange');
                    return (
                      <th key={col.id}
                          style={{
                            padding:'4px 6px',
                            background:'var(--bg-secondary)',
                            borderTop:'1px solid var(--border)',
                            fontWeight:400,
                            textAlign:'left',
                          }}>

                        {fcMulti && (
                          <ColumnFilterChip
                            label={fcMulti.label}
                            selected={filters[fcMulti.filterKey]}
                            onChange={v => setFilter(fcMulti.filterKey, v)}
                            options={uniqueValues[fcMulti.filterKey] || []}
                            labelFor={labelForFilterKey(fcMulti.filterKey)}
                          />
                        )}
                        {fcDate && (
                          <DateRangeChip
                            label={fcDate.label}
                            fromVal={filters[fcDate.fromKey]}
                            toVal={filters[fcDate.toKey]}
                            onChangeFrom={v => setFilter(fcDate.fromKey, v)}
                            onChangeTo={v   => setFilter(fcDate.toKey, v)}
                          />
                        )}
                        {!fcMulti && !fcDate && (
                          <input
                            type="text"
                            value={(filters.colText && filters.colText[col.id]) || ''}
                            onChange={e => setColText(col.id, e.target.value)}
                            onClick={e => e.stopPropagation()}
                            placeholder="filter…"
                            style={{ width:'100%', minWidth:'70px', fontSize:'0.72rem', padding:'2px 6px',
                                     border:'1px solid var(--border)', borderRadius:'4px',
                                     background:'#fff', color:'var(--text)' }}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => {
                  const lead = row.original;
                  const canViewThisLead = canDoOnLead('leads', 'view_detail', lead);
                  return (
                    <tr
                      key={row.id}
                      style={{
                        cursor: canViewThisLead ? 'pointer' : 'not-allowed',
                        opacity: canViewThisLead ? 1 : 0.55,
                      }}
                      onClick={() => {
                        if (lead.studentId) navigate(`/students/${lead.studentId}`);
                      }}>
                      {canMassAssign && (
                        <td onClick={e => { e.stopPropagation(); toggleSelect(lead.studentId); }}>
                          <input type="checkbox" checked={selected.includes(lead.studentId)} onChange={() => {}}/>
                        </td>
                      )}
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} style={cellStyleFor(cell.column.id, lead)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {table.getRowModel().rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={table.getVisibleLeafColumns().length + (canMassAssign ? 1 : 0)}
                      style={{ textAlign:'center', color:'var(--text-secondary)', padding:'2rem' }}>
                      No leads found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-pagination no-print" style={{ justifyContent: 'space-between', gap: '1.5rem' }}>
            <span>{filtered.length} leads</span>
            <div className="pagination-controls">
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}>← Prev</button>
              <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}</span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}>Next →</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mass assign / delete bar ────────────────────────── */}
      {canMassAssign && selected.length > 0 && (
        <div className="mass-assign-bar no-print">
          <span>{selected.length} selected</span>
          <select value={massPhase} onChange={e => { setMassPhase(e.target.value); setMassPosition(''); setMassValue(''); }} title="Target phase">
            {Object.keys(PHASE_SLOTS).map(p => (
              <option key={p} value={p}>{p === 'Presales' ? 'Pre-Sales' : p}</option>
            ))}
          </select>
          {(PHASE_SLOTS[massPhase] || []).length > 1 && (
            <select value={massPosition} onChange={e => setMassPosition(e.target.value)} title="Position">
              <option value="">Position…</option>
              {(PHASE_SLOTS[massPhase] || []).map(pos => (
                <option key={pos} value={pos}>{POSITION_LABEL[pos] || pos}</option>
              ))}
            </select>
          )}
          <select value={massValue} onChange={e => setMassValue(e.target.value)} title="Recipient for this phase">
            <option value="">{RECIPIENT_REQUIRED.has(massPhase) ? 'Select recipient (required)…' : 'Unassigned'}</option>
            {massStaff.map(s => (
              <option key={s.id} value={s.fullName}>{s.fullName} ({s.position})</option>
            ))}
          </select>
          <button className="btn btn--primary btn--sm" onClick={handleMassAssign}
            disabled={(RECIPIENT_REQUIRED.has(massPhase) && !massValue) || ((PHASE_SLOTS[massPhase]||[]).length>1 && !massPosition)}>Move</button>
          {canDeleteLeads && (
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

      {/* ── Access-denied toast ─────────────────────────────────
          Shown when a Counselor clicks an unassigned lead. Auto-dismisses
          after 3 seconds. No navigation happens — the user stays on the list.
          aria-live tells screen readers to announce the message. */}
      {/* ── Save-as-new-view dialog — opened by "+ New view" tab ── */}
      {showSaveDialog && (
        <div
          className="no-print"
          onClick={() => setShowSaveDialog(false)}
          style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.4)',
            display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:'var(--bg-primary)', padding:'1.5rem', borderRadius:'10px',
              minWidth:'360px', boxShadow:'0 8px 32px rgba(0,0,0,0.2)',
            }}>
            <h3 style={{ marginTop:0 }}>Save current view</h3>
            <p style={{ fontSize:'0.8rem', color:'var(--text-secondary)', marginBottom:'0.75rem' }}>
              Captures your current filters, sort order, and column widths/order.
            </p>
            <input
              type="text"
              autoFocus
              placeholder="View name (e.g. 'My Diamond pipeline')"
              id="variant-save-name"
              style={{
                width:'100%', padding:'0.5rem', fontSize:'0.875rem',
                border:'1px solid var(--border)', borderRadius:'6px',
                marginBottom:'1rem',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') saveAsNewVariant(e.currentTarget.value);
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
            />
            <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => {
                  const inp = document.getElementById('variant-save-name');
                  saveAsNewVariant(inp.value);
                }}>
                Save view
              </button>
            </div>
          </div>
        </div>
      )}

      {accessToast && (
        <div
          role="status"
          aria-live="polite"
          className="no-print"
          style={{
            position:     'fixed',
            bottom:       '24px',
            left:         '50%',
            transform:    'translateX(-50%)',
            background:   'var(--danger, #dc2626)',
            color:        '#fff',
            padding:      '0.75rem 1.25rem',
            borderRadius: '8px',
            boxShadow:    '0 6px 20px rgba(0,0,0,0.18)',
            fontSize:     '0.875rem',
            maxWidth:     '420px',
            zIndex:       1000,
            display:      'flex',
            alignItems:   'center',
            gap:          '0.75rem',
          }}>
          <span>{accessToast}</span>
          <button
            onClick={() => setAccessToast(null)}
            style={{ background:'transparent', border:'none', color:'#fff', cursor:'pointer', fontSize:'1.1rem', padding:0, lineHeight:1 }}
            aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
