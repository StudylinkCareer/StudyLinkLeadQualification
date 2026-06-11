// src/pages/ClientFollowup.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Client Followup — two tabs:
//   1. Reminders  — latest open reminder per lead, bucketed into a timeline:
//                   past 4 weeks (weekly) / next 4 weeks (weekly) /
//                   next 2 months (monthly beyond week 4).
//                   Always uses the most recent effective date (rescheduled
//                   if set, otherwise follow_up_date). Closed reminders excluded.
//   2. Communications — volume analytics (last 7 days daily + 3-month weekly)
//                   broken down by platform.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { notesAPI, staffAPI } from '../services/api';
import Watermark from '../components/Watermark';

// ── Date helpers ──────────────────────────────────────────────────────────────
function startOfDay(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth()+n); return r; }
function startOfWeekMon(d) {
  const r = startOfDay(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}
function startOfMonth(d) { const r = new Date(d); r.setDate(1); r.setHours(0,0,0,0); return r; }
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
}
function fmtDateFull(d) {
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtMonth(d) {
  return new Date(d).toLocaleDateString('en-GB', { month:'long', year:'numeric' });
}

// Effective scheduled date — rescheduled takes priority over original
function effDate(r) {
  return r.rescheduledDate ? new Date(r.rescheduledDate) : new Date(r.followUpDate);
}

// Count how many times a reminder has been rescheduled.
// Each addendum appends a ─────── separator line, so we count those.
function rescheduleCount(r) {
  if (!r.content) return 0;
  const matches = r.content.match(/─────/g);
  return matches ? matches.length : 0;
}

// Colour tier based on reschedule count
function rescheduleColor(count) {
  if (count === 0) return '#15803d';  // green — on track
  if (count === 1) return '#d97706';  // amber — rescheduled once
  if (count === 2) return '#c2410c';  // orange — rescheduled twice
  return '#b91c1c';                   // red    — 3+ reschedules
}
const RESCHEDULE_TIERS = [
  { label: 'On track (0)',    color: '#15803d' },
  { label: 'Rescheduled ×1', color: '#d97706' },
  { label: 'Rescheduled ×2', color: '#c2410c' },
  { label: 'Rescheduled ×3+',color: '#b91c1c' },
];

// ── Segment hover styles ─────────────────────────────────────────────────────
// Injected once into <head>. Provides border outline and 3D lift on hover
// without needing a CSS file.
if (typeof document !== 'undefined' && !document.getElementById('cl-seg-styles')) {
  const s = document.createElement('style');
  s.id = 'cl-seg-styles';
  s.textContent = `
    .cl-seg {
      transition: filter 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
    }
    .cl-seg:hover {
      filter: brightness(1.18) saturate(1.1);
      transform: scaleY(1.04) translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.28);
      z-index: 10;
      position: relative;
    }
  `;
  document.head.appendChild(s);
}

// ── Platform colours ──────────────────────────────────────────────────────────
const PLATFORMS = ['Direct','Phone Call','Text Message','Zalo','WhatsApp','Messenger','Email'];
// High-contrast platform colours — maximally distinct hues + luminance spread
const PLATFORM_COLORS = {
  'Direct':       '#7c3aed',  // vivid violet
  'Phone Call':   '#15803d',  // deep green
  'Text Message': '#0369a1',  // ocean blue
  'Zalo':         '#0891b2',  // teal
  'WhatsApp':     '#65a30d',  // lime green
  'Messenger':    '#d97706',  // amber
  'Email':        '#dc2626',  // red
};
// Null/empty contactPlatform means note was entered directly
// Resolve the platform for a communication record.
// New notes store contact_platform explicitly. Old notes (pre-migration) have
// the platform embedded in the content line as "📞 Phone Call — ...",
// "✉ Email — ...", "M Messenger — ...", etc.
// If neither source gives a platform, classify as Direct.
const CONTENT_PLATFORM_PATTERNS = [
  { pattern: /phone call/i,    platform: 'Phone Call'   },
  { pattern: /text message/i,  platform: 'Text Message' },
  { pattern: /💬/,             platform: 'Text Message' },
  { pattern: /📞/,             platform: 'Phone Call'   },
  { pattern: /zalo/i,          platform: 'Zalo'         },
  { pattern: /whatsapp/i,      platform: 'WhatsApp'     },
  { pattern: /W.*—/,       platform: 'WhatsApp'     },
  { pattern: /messenger/i,     platform: 'Messenger'    },
  { pattern: /M.*—/,       platform: 'Messenger'    },
  { pattern: /email/i,         platform: 'Email'        },
  { pattern: /✉/,              platform: 'Email'        },
];

function parsePlatformFromContent(content) {
  if (!content) return null;
  // Only look at the first line — that's where the platform header is
  const firstLine = content.split('\n')[0];
  for (const { pattern, platform } of CONTENT_PLATFORM_PATTERNS) {
    if (pattern.test(firstLine)) return platform;
  }
  return null;
}

function normPlatform(contactPlatform, content) {
  if (contactPlatform && contactPlatform !== 'Unknown') return contactPlatform;
  const fromContent = parsePlatformFromContent(content);
  return fromContent || 'Direct';
}

// ── Stacked vertical bar chart ───────────────────────────────────────────────
// Each bar is fixed at BAR_H pixels max. Segments are individually clickable.
// Total count floats above each bar.
const BAR_H = 200; // px — fixed chart height

function BarChart({ buckets, onBarClick, onSegmentClick, onLabelClick }) {
  const max = Math.max(...buckets.map(b => b.total), 1);

  return (
    <div style={{ overflowX:'auto', paddingBottom:'0.5rem' }}>
      <div style={{
        display:'flex', gap:'6px', alignItems:'flex-end',
        minWidth: `${buckets.length * 44}px`,
        padding:'0 4px',
        // Reserve space above bars for the count label
        paddingTop:'1.5rem',
        position:'relative',
      }}>
        {buckets.map((b, i) => {
          const barH = max > 0 ? Math.round((b.total / max) * BAR_H) : 0;
          return (
            <div key={i} style={{ flex:'1 0 36px', display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
              {/* Count label above bar — clickable hyperlink */}
              <div style={{ height:'1rem', lineHeight:'1rem', textAlign:'center' }}>
                {b.total > 0 ? (
                  <button
                    onClick={e=>{ e.stopPropagation(); onLabelClick && onLabelClick(b); }}
                    style={{ background:'none', border:'none', padding:0, cursor:'pointer',
                      fontSize:'0.7rem', fontWeight:700, color:'var(--primary)',
                      textDecoration:'underline', whiteSpace:'nowrap' }}>
                    Total: {b.total}
                  </button>
                ) : <span style={{ color:'transparent', fontSize:'0.7rem' }}>0</span>}
              </div>

              {/* Bar container — fixed height, bar grows from bottom */}
              <div
                style={{ width:'100%', height:`${BAR_H}px`, display:'flex', flexDirection:'column', justifyContent:'flex-end', cursor: b.total > 0 ? 'pointer' : 'default', position:'relative' }}
                onClick={() => b.total > 0 && onBarClick && onBarClick(b)}
                title={b.total > 0 ? `${b.label}: ${b.total} total — click to view all` : b.label}
              >
                {/* Empty bar baseline */}
                {b.total === 0 && (
                  <div style={{ width:'100%', height:'3px', background:'var(--border)', borderRadius:'2px' }}/>
                )}

                {/* Stacked segments — bottom to top matches PLATFORMS order */}
                {b.total > 0 && (
                  <div style={{ width:'100%', height:`${barH}px`, display:'flex', flexDirection:'column-reverse', borderRadius:'4px 4px 0 0', overflow:'hidden' }}>
                    {PLATFORMS.map(p => {
                      const count = b.byPlatform?.[p] || 0;
                      if (!count) return null;
                      const segH = Math.round((count / b.total) * barH);
                      return (
                        <div key={p}
                          className="cl-seg"
                          style={{ width:'100%', height:`${segH}px`, minHeight:'3px', background:PLATFORM_COLORS[p], flexShrink:0, cursor:'pointer' }}
                          title={`${p}: ${count}`}
                          onClick={e => {
                            e.stopPropagation();
                            onSegmentClick && onSegmentClick(b, p);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Date label */}
              <div style={{ fontSize:'0.6rem', color:'var(--text-secondary)', textAlign:'center', whiteSpace:'nowrap', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', lineHeight:1.3 }}>
                {b.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlatformLegend({ data }) {
  const totals = {};
  PLATFORMS.forEach(p=>{ totals[p]=data.filter(c=>normPlatform(c.contactPlatform, c.content)===p).length; });
  const active = PLATFORMS.filter(p=>totals[p]>0);
  if (!active.length) return null;
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem 1rem', padding:'0.75rem 0' }}>
      {active.map(p=>(
        <div key={p} style={{ display:'flex', alignItems:'center', gap:'0.375rem', fontSize:'0.8125rem' }}>
          <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:PLATFORM_COLORS[p], flexShrink:0 }}/>
          <span style={{ color:'var(--text-secondary)' }}>{p}</span>
          <span style={{ fontWeight:700 }}>{totals[p]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Communications tab ────────────────────────────────────────────────────────
// ── ChartRow ──────────────────────────────────────────────────────────────────
// Self-contained row: chart on the left (50%), independent drill panel on right.
// Each instance has its own panel state so they never interfere.
function ChartRow({ title, subtitle, legend, buckets }) {
  const [panel, setPanel] = useState(null);
  const navigate = useNavigate();

  function drill(bucket) {
    setPanel({ label: bucket.label, rows: bucket.rows || [] });
  }
  function drillSeg(bucket, platform) {
    const filtered = (bucket.rows||[]).filter(r=>normPlatform(r.contactPlatform,r.content)===platform);
    setPanel({ label:`${bucket.label} — ${platform}`, rows:filtered });
  }

  return (
    <div style={{ display:'flex', gap:'1.25rem', alignItems:'flex-start' }}>
      {/* Chart — left 50% */}
      <div style={{ flex:'0 0 50%', minWidth:0, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'12px', padding:'1.25rem' }}>
        <div style={{ fontWeight:700, fontSize:'0.9375rem', marginBottom:'0.125rem' }}>{title}</div>
        <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', marginBottom:'0.5rem' }}>{subtitle}</div>
        {legend}
        <BarChart buckets={buckets} onBarClick={drill} onSegmentClick={drillSeg} onLabelClick={drill}/>
      </div>
      {/* Drill panel — right half */}
      <div style={{ flex:'1 1 0', minWidth:0 }}>
        {panel ? (
              <div style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'12px', padding:'1.25rem', overflow:'auto' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.875rem' }}>
                  <div style={{ fontWeight:700, fontSize:'0.9375rem' }}>{panel.label}</div>
                  <button onClick={()=>setPanel(null)}
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'var(--text-secondary)', lineHeight:1 }}>✕</button>
                </div>
                {panel.rows.length === 0 ? (
                  <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No communications found.</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                    {panel.rows.map((r,i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.625rem', padding:'0.5rem 0.625rem', background:'var(--bg-secondary)', borderRadius:'8px', flexWrap:'wrap' }}>
                        <div style={{ width:'8px', height:'8px', borderRadius:'2px', background:PLATFORM_COLORS[normPlatform(r.contactPlatform, r.content)], flexShrink:0 }}/>
                        <button onClick={()=>navigate(`/leads/${r.studentUniqueId}`)}
                          style={{ background:'none', border:'none', cursor:'pointer', fontWeight:700, color:'var(--primary)', fontSize:'0.8125rem', padding:0 }}>
                          {r.studentName || r.studentUniqueId}
                        </button>
                        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>{normPlatform(r.contactPlatform, r.content)}</span>
                        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', marginLeft:'auto' }}>{r.authorName}</span>
                        <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono', whiteSpace:'nowrap' }}>
                          {new Date(r.createdAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
        ) : (
              <div style={{ background:'var(--bg-secondary)', border:'1px dashed var(--border)', borderRadius:'12px', padding:'2rem 1.25rem', textAlign:'center', color:'var(--text-secondary)', fontSize:'0.875rem' }}>
                Click a bar or segment to see details here
              </div>
        )}
      </div>
    </div>
  );
}

function CommunicationsTab({ comms }) {
  const navigate = useNavigate();
  const today = startOfDay(new Date());

  const dailyBuckets = useMemo(()=>{
    return Array.from({length:7},(_,i)=>{
      const day=startOfDay(addDays(today,-(6-i))), next=addDays(day,1);
      const rows=comms.filter(c=>{ const d=new Date(c.createdAt); return d>=day&&d<next; });
      const byPlatform={};
      rows.forEach(c=>{ const p=normPlatform(c.contactPlatform, c.content); byPlatform[p]=(byPlatform[p]||0)+1; });
      return { label:fmtDate(day), total:rows.length, byPlatform, rows, ids:rows.map(r=>r.studentUniqueId) };
    });
  },[comms,today]);

  const weeklyBuckets = useMemo(()=>{
    const buckets=[], ago=addDays(today,-91);
    let ws=startOfWeekMon(ago);
    while(ws<=today){
      const we=addDays(ws,7);
      const rows=comms.filter(c=>{ const d=new Date(c.createdAt); return d>=ws&&d<we; });
      const byPlatform={};
      rows.forEach(c=>{ const p=normPlatform(c.contactPlatform, c.content); byPlatform[p]=(byPlatform[p]||0)+1; });
      buckets.push({ label:fmtDate(ws), total:rows.length, byPlatform, rows, ids:rows.map(r=>r.studentUniqueId) });
      ws=addDays(ws,7);
    }
    return buckets;
  },[comms,today]);

  const [summaryPanel, setSummaryPanel] = useState(null);

  const total = comms.length;
  const platTotals = PLATFORMS.map(p=>({ platform:p, count:comms.filter(c=>normPlatform(c.contactPlatform, c.content)===p).length })).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>

      {/* ── Summary cards ── */}
      <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap' }}>
        <div style={{ flex:'1 1 120px', background:'var(--bg-secondary)', borderRadius:'10px', padding:'0.875rem 1rem' }}>
          <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.25rem' }}>3 months</div>
          <button onClick={()=>setSummaryPanel({ label:`Total: ${total}`, rows:comms })}
            style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'1.75rem', fontWeight:800, color:'var(--primary)', lineHeight:1 }}>
            Total: {total}
          </button>
        </div>
        {platTotals.map(({platform,count})=>(
          <div key={platform} style={{ flex:'1 1 100px', background:'var(--bg-secondary)', borderRadius:'10px', padding:'0.875rem 1rem', borderLeft:`3px solid ${PLATFORM_COLORS[platform]}` }}>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', fontWeight:600, marginBottom:'0.25rem' }}>{platform}</div>
            <button onClick={()=>setSummaryPanel({ label:`${platform} — Total: ${count}`, rows:comms.filter(c=>normPlatform(c.contactPlatform,c.content)===platform) })}
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'1.375rem', fontWeight:800, color:PLATFORM_COLORS[platform], lineHeight:1 }}>
              Total: {count}
            </button>
          </div>
        ))}
      </div>

      {/* Summary card drill panel */}
      {summaryPanel && (
        <div style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'12px', padding:'1.25rem' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.875rem' }}>
            <div style={{ fontWeight:700, fontSize:'0.9375rem' }}>{summaryPanel.label}</div>
            <button onClick={()=>setSummaryPanel(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'var(--text-secondary)', lineHeight:1 }}>✕</button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
            {summaryPanel.rows.map((r,i)=>(
              <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.625rem', padding:'0.5rem 0.625rem', background:'var(--bg-secondary)', borderRadius:'8px', flexWrap:'wrap' }}>
                <div style={{ width:'8px', height:'8px', borderRadius:'2px', background:PLATFORM_COLORS[normPlatform(r.contactPlatform,r.content)], flexShrink:0 }}/>
                <button onClick={()=>navigate(`/leads/${r.studentUniqueId}`)} style={{ background:'none', border:'none', cursor:'pointer', fontWeight:700, color:'var(--primary)', fontSize:'0.8125rem', padding:0 }}>
                  {r.studentName||r.studentUniqueId}
                </button>
                <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>{normPlatform(r.contactPlatform,r.content)}</span>
                <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', marginLeft:'auto' }}>{r.authorName}</span>
                <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono', whiteSpace:'nowrap' }}>
                  {new Date(r.createdAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Each chart is a self-contained row with its own drill panel ── */}
      <ChartRow
        title="Last 7 Days — Daily"
        subtitle="Click bar or segment to drill down"
        legend={<PlatformLegend data={comms.filter(c=>new Date(c.createdAt)>=addDays(today,-6))}/>}
        buckets={dailyBuckets}
      />
      <ChartRow
        title="Last 3 Months — Weekly"
        subtitle="Click bar or segment to drill down"
        legend={<PlatformLegend data={comms}/>}
        buckets={weeklyBuckets}
      />

    </div>
  );
}

// ── Reminder row ──────────────────────────────────────────────────────────────
function ReminderRow({ reminder, onUpdate, navigate }) {
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [saving,  setSaving]  = useState(false);
  const ed = effDate(reminder);
  const isOverdue = ed < startOfDay(new Date());

  async function close() {
    setSaving(true);
    await onUpdate(reminder.id, { reminderStatus:'closed' });
    setSaving(false);
  }
  async function reschedule() {
    if (!newDate) return;
    setSaving(true);
    await onUpdate(reminder.id, { reminderStatus:'rescheduled', rescheduledDate:newDate });
    setSaving(false);
    setEditing(false);
  }

  const nextStepsText = (() => {
    const m = reminder.content?.match(/Next Steps:\s*([\s\S]*?)(?:\n(?:Reason:|Follow-up Date:)|$)/);
    return m ? m[1].trim() : null;
  })();

  return (
    <div style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'10px', padding:'0.875rem 1rem', display:'flex', flexDirection:'column', gap:'0.5rem',
      borderLeft: isOverdue ? '3px solid #dc2626' : reminder.reminderStatus==='rescheduled' ? '3px solid #f59e0b' : '3px solid #10b981' }}>
      {(() => {
        const daysUntil = Math.ceil((ed - startOfDay(new Date())) / (1000*60*60*24));
        const isWithin5 = !isOverdue && daysUntil <= 5;
        const rc = rescheduleCount(reminder);
        return (
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'0.5rem', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
              <button onClick={()=>navigate(`/leads/${reminder.studentUniqueId}`)}
                style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:700, fontSize:'0.9375rem', color:'var(--primary)', textAlign:'left' }}>
                {reminder.studentName}
              </button>
              {reminder.topic && (
                <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:600 }}>{reminder.topic}</span>
              )}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
              {isWithin5 && (
                <span title={`Due in ${daysUntil} day${daysUntil===1?'':`s`}`}
                  style={{ fontSize:'0.7rem', background:'#fef9c3', color:'#854d0e', borderRadius:'4px', padding:'2px 7px', fontWeight:700, border:'1px solid #fde047' }}>
                  ⚑ {daysUntil === 0 ? 'Due today' : `Due in ${daysUntil}d`}
                </span>
              )}
              {rc > 0 && (
                <span style={{ fontSize:'0.7rem', background: rc>=3?'#fee2e2':rc===2?'#ffedd5':'#fef3c7',
                  color: rc>=3?'#991b1b':rc===2?'#9a3412':'#92400e',
                  borderRadius:'4px', padding:'2px 6px', fontWeight:600 }}>
                  ↻×{rc}
                </span>
              )}
              {reminder.reminderStatus==='rescheduled' && rc===0 && (
                <span style={{ fontSize:'0.7rem', background:'#fef3c7', color:'#92400e', borderRadius:'4px', padding:'2px 6px', fontWeight:600 }}>Rescheduled</span>
              )}
              <span style={{ fontSize:'0.8125rem', fontWeight:700, color:isOverdue?'#dc2626':isWithin5?'#92400e':'#374151' }}>{fmtDateFull(ed)}</span>
            </div>
          </div>
        );
      })()}
      {/* Reference row: Lead ID · Student Name · Date Created */}
      <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center', fontSize:'0.8125rem', color:'var(--text-secondary)',
        background:'var(--bg-secondary)', borderRadius:'6px', padding:'0.375rem 0.625rem' }}>
        <span style={{ fontFamily:'DM Mono', fontSize:'0.75rem', color:'var(--text-secondary)' }}>
          {reminder.studentUniqueId}
        </span>
        <span style={{ color:'var(--border)' }}>·</span>
        <span style={{ fontWeight:600, color:'var(--text-primary)' }}>{reminder.studentName}</span>
        <span style={{ color:'var(--border)' }}>·</span>
        <span>
          Created: {new Date(reminder.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
        </span>
      </div>
      {/* Close date + Confidence row — always shown; red alert if either missing */}
      {(() => {
        const hasClose      = !!reminder.closeDate;
        const hasConfidence = !!reminder.confidence;
        const bothMissing   = !hasClose && !hasConfidence;
        const closeMissing  = !hasClose && hasConfidence;
        const confMissing   = hasClose && !hasConfidence;
        const anyMissing    = !hasClose || !hasConfidence;

        if (bothMissing) return (
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.8125rem',
            background:'#fee2e2', borderRadius:'6px', padding:'0.375rem 0.625rem',
            border:'1px solid #fca5a5', color:'#991b1b', fontWeight:600 }}>
            ⚠ Close Date and Confidence have not been updated
          </div>
        );

        return (
          <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center', fontSize:'0.8125rem',
            background: anyMissing ? '#fee2e2' : 'transparent',
            borderRadius: anyMissing ? '6px' : undefined,
            padding: anyMissing ? '0.375rem 0.625rem' : undefined,
            border: anyMissing ? '1px solid #fca5a5' : undefined }}>
            {/* Close date */}
            {hasClose ? (
              <span style={{ display:'flex', alignItems:'center', gap:'0.3rem' }}>
                <span style={{ color:'var(--text-secondary)' }}>Close:</span>
                <span style={{ fontWeight:600, color:'var(--text-primary)' }}>
                  {new Date(reminder.closeDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
                </span>
              </span>
            ) : (
              <span style={{ fontWeight:600, color:'#991b1b' }}>⚠ Close Date not set</span>
            )}
            <span style={{ color: anyMissing ? '#fca5a5' : 'var(--border)' }}>·</span>
            {/* Confidence */}
            {hasConfidence ? (
              <span style={{ display:'flex', alignItems:'center', gap:'0.3rem' }}>
                <span style={{ color: anyMissing ? '#991b1b' : 'var(--text-secondary)' }}>Confidence:</span>
                <span style={{ fontWeight:700,
                  color: reminder.confidence==='High'   ? '#15803d'
                       : reminder.confidence==='Medium' ? '#d97706'
                       : reminder.confidence==='Low'    ? '#dc2626'
                       : 'var(--text-primary)' }}>
                  {reminder.confidence}
                </span>
              </span>
            ) : (
              <span style={{ fontWeight:600, color:'#991b1b' }}>⚠ Confidence not set</span>
            )}
          </div>
        );
      })()}
      <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
        <span style={{ fontWeight:600, color:'var(--text-primary)' }}>{reminder.authorName}</span>
        {reminder.contactPlatform && (
          <span> · <span style={{ display:'inline-block', width:'8px', height:'8px', borderRadius:'2px', background:PLATFORM_COLORS[reminder.contactPlatform]||'#9ca3af', marginRight:'3px', verticalAlign:'middle' }}/>{reminder.contactPlatform}</span>
        )}
      </div>
      {nextStepsText && (
        <div style={{ fontSize:'0.8125rem', color:'var(--text-primary)', background:'var(--bg-secondary)', borderRadius:'6px', padding:'0.5rem 0.625rem', lineHeight:1.5, whiteSpace:'pre-wrap' }}>{nextStepsText}</div>
      )}
      {!editing ? (
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginTop:'0.25rem' }}>
          <button disabled={saving} onClick={close}
            style={{ padding:'0.3rem 0.75rem', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg-secondary)', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer', color:'#6b7280' }}>✓ Close</button>
          <button disabled={saving} onClick={()=>setEditing(true)}
            style={{ padding:'0.3rem 0.75rem', borderRadius:'6px', border:'1px solid #f59e0b', background:'#fef3c7', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer', color:'#92400e' }}>↻ Reschedule</button>
          <button onClick={()=>navigate(`/leads/${reminder.studentUniqueId}`)}
            style={{ padding:'0.3rem 0.75rem', borderRadius:'6px', border:'1px solid var(--primary)', background:'transparent', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer', color:'var(--primary)' }}>→ View Lead</button>
        </div>
      ) : (
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap', marginTop:'0.25rem' }}>
          <span style={{ fontSize:'0.8125rem', fontWeight:600 }}>New date:</span>
          <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)}
            style={{ padding:'0.3rem 0.5rem', borderRadius:'6px', border:'1px solid var(--border)', fontSize:'0.8125rem' }}/>
          <button disabled={saving||!newDate} onClick={reschedule}
            style={{ padding:'0.3rem 0.75rem', borderRadius:'6px', border:'none', background:'var(--primary)', color:'#fff', fontSize:'0.8125rem', fontWeight:600, cursor:newDate?'pointer':'not-allowed', opacity:newDate?1:0.5 }}>
            {saving?'Saving…':'Confirm'}
          </button>
          <button onClick={()=>setEditing(false)}
            style={{ padding:'0.3rem 0.75rem', borderRadius:'6px', border:'1px solid var(--border)', background:'transparent', fontSize:'0.8125rem', cursor:'pointer' }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ── Reminders tab ─────────────────────────────────────────────────────────────
// ── Topic colours ────────────────────────────────────────────────────────────
// Consistent colour per topic label across all charts.
// High-contrast topic colours — distinct hue + value combinations
const TOPIC_PALETTE = [
  '#1d4ed8',  // strong blue
  '#15803d',  // deep green
  '#b91c1c',  // deep red
  '#d97706',  // amber
  '#7c3aed',  // vivid violet
  '#0e7490',  // dark teal
  '#be185d',  // dark pink
  '#4d7c0f',  // olive green
  '#c2410c',  // burnt orange
  '#1e3a5f',  // navy
];
const topicColorCache = {};
let topicColorIdx = 0;
function topicColor(topic) {
  const key = topic || 'General';
  if (!topicColorCache[key]) {
    topicColorCache[key] = TOPIC_PALETTE[topicColorIdx++ % TOPIC_PALETTE.length];
  }
  return topicColorCache[key];
}

// ── ReminderBarChart ──────────────────────────────────────────────────────────
// Stacked vertical bars. Each bar = one time bucket. Segments = topics.
// onBarClick(bucket) / onSegmentClick(bucket, topic) opens drill-down.
const REM_BAR_H = 160;

function ReminderBarChart({ buckets, onBarClick, onSegmentClick }) {
  const max = Math.max(...buckets.map(b => b.total), 1);
  return (
    <div style={{ overflowX:'auto', paddingBottom:'0.25rem' }}>
      <div style={{ display:'flex', gap:'6px', alignItems:'flex-end', minWidth:`${buckets.length*44}px`, paddingTop:'1.5rem' }}>
        {buckets.map((b, i) => {
          const barH = Math.round((b.total / max) * REM_BAR_H);
          return (
            <div key={i} style={{ flex:'1 0 36px', display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
              <div style={{ height:'1rem', lineHeight:'1rem', textAlign:'center' }}>
                {b.total > 0 ? (
                  <button onClick={e=>{ e.stopPropagation(); onBarClick&&onBarClick(b); }}
                    style={{ background:'none', border:'none', padding:0, cursor:'pointer',
                      fontSize:'0.7rem', fontWeight:700, color:'var(--primary)',
                      textDecoration:'underline', whiteSpace:'nowrap' }}>
                    Total: {b.total}
                  </button>
                ) : <span style={{ color:'transparent', fontSize:'0.7rem' }}>0</span>}
              </div>
              <div style={{ width:'100%', height:`${REM_BAR_H}px`, display:'flex', flexDirection:'column', justifyContent:'flex-end',
                cursor:b.total>0?'pointer':'default' }}
                onClick={()=>b.total>0&&onBarClick&&onBarClick(b)}
                title={b.total>0?`${b.label}: ${b.total} reminders`:b.label}>
                {b.total===0 && <div style={{ width:'100%', height:'3px', background:'var(--border)', borderRadius:'2px' }}/>}
                {b.total>0 && (
                  <div style={{ width:'100%', height:`${barH}px`, display:'flex', flexDirection:'column-reverse', borderRadius:'4px 4px 0 0', overflow:'hidden' }}>
                    {(b.byTopic||[]).map((seg)=>{
                      const { topic, count } = seg;
                      const segH = Math.round((count/b.total)*barH);
                      return (
                        <div key={topic} className="cl-seg"
                          style={{ width:'100%', height:`${segH}px`, minHeight:'3px', background:seg.color||topicColor(topic), flexShrink:0, cursor:'pointer' }}
                          title={`${topic||'General'}: ${count}`}
                          onClick={e=>{ e.stopPropagation(); onSegmentClick&&onSegmentClick(b,topic); }}/>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ fontSize:'0.6rem', color:'var(--text-secondary)', textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', maxWidth:'100%', textOverflow:'ellipsis', lineHeight:1.3 }}>
                {b.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TopicLegend ───────────────────────────────────────────────────────────────
function TopicLegend({ items }) {
  const counts = {};
  items.forEach(r=>{ const k=r.topic||'General'; counts[k]=(counts[k]||0)+1; });
  const topics = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  if (!topics.length) return null;
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem 1rem', padding:'0.5rem 0' }}>
      {topics.map(([t,c])=>(
        <div key={t} style={{ display:'flex', alignItems:'center', gap:'0.375rem', fontSize:'0.8125rem' }}>
          <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:topicColor(t), flexShrink:0 }}/>
          <span style={{ color:'var(--text-secondary)' }}>{t}</span>
          <span style={{ fontWeight:700 }}>{c}</span>
        </div>
      ))}
    </div>
  );
}

// Legend for reminder charts — shows reschedule tier colours
function RescheduleLegend({ buckets }) {
  const totals = {};
  buckets.forEach(b=>b.items.forEach(r=>{
    const i = Math.min(rescheduleCount(r),3);
    const label = RESCHEDULE_TIERS[i].label;
    totals[label] = (totals[label]||0)+1;
  }));
  const active = RESCHEDULE_TIERS.filter(t=>totals[t.label]>0);
  if (!active.length) return null;
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem 1rem', padding:'0.5rem 0' }}>
      {active.map(t=>(
        <div key={t.label} style={{ display:'flex', alignItems:'center', gap:'0.375rem', fontSize:'0.8125rem' }}>
          <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:t.color, flexShrink:0 }}/>
          <span style={{ color:'var(--text-secondary)' }}>{t.label}</span>
          <span style={{ fontWeight:700 }}>{totals[t.label]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Build bucket array for a set of reminders ─────────────────────────────────
// Stacks by reschedule tier (0/1/2/3+) so bar colour shows urgency.
// Items are still available for drill-down by topic.
function buildBuckets(reminders, boundaries, getWindow) {
  return boundaries.map(b=>{
    const { start, end, label } = getWindow(b);
    const items = reminders.filter(r=>{ const d=effDate(r); return d>=start&&d<end; })
      .sort((a,c)=>effDate(a)-effDate(c));
    // Stack by reschedule tier
    const tierCounts = [0,0,0,0];
    items.forEach(r=>{ const t=Math.min(rescheduleCount(r),3); tierCounts[t]++; });
    const byTier = RESCHEDULE_TIERS.map((tier,i)=>({
      topic: tier.label,   // reuse topic key so ReminderBarChart works unchanged
      count: tierCounts[i],
      color: tier.color,
    })).filter(t=>t.count>0);
    return { label, total:items.length, byTopic:byTier, items };
  });
}

// ── ChartSection ─────────────────────────────────────────────────────────────
// Self-contained row: chart left (50%), independent drill panel right.
// Bars coloured by reschedule tier; drill panel shows ReminderRow cards.
function ChartSection({ title, buckets, onUpdate, navigate }) {
  const [panel, setPanel] = useState(null);
  if (buckets.every(b=>b.total===0)) return null;

  function drillBar(b) { setPanel({ label:b.label, items:b.items }); }
  function drillSeg(b, tierLabel) {
    // Filter to reminders in this reschedule tier
    const tierIdx = RESCHEDULE_TIERS.findIndex(t=>t.label===tierLabel);
    const filtered = tierIdx>=0
      ? b.items.filter(r=>Math.min(rescheduleCount(r),3)===tierIdx)
      : b.items;
    setPanel({ label:`${b.label} — ${tierLabel}`, items:filtered });
  }

  return (
    <div style={{ display:'flex', gap:'1.25rem', alignItems:'flex-start' }}>
      {/* Chart — left 50% */}
      <div style={{ flex:'0 0 50%', minWidth:0, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'12px', padding:'1.25rem' }}>
        <div style={{ fontWeight:700, fontSize:'0.9375rem', marginBottom:'0.125rem' }}>{title}</div>
        <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', marginBottom:'0.25rem' }}>Click bar or segment to drill down</div>
        <RescheduleLegend buckets={buckets}/>
        <ReminderBarChart buckets={buckets} onBarClick={drillBar} onSegmentClick={drillSeg}/>
      </div>
      {/* Drill panel — right half */}
      <div style={{ flex:'1 1 0', minWidth:0 }}>
        {panel ? (
          <div style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'12px', padding:'1.25rem', overflow:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
              <span style={{ fontWeight:700, fontSize:'0.9375rem' }}>{panel.label} — {panel.items.length} reminder{panel.items.length!==1?'s':''}</span>
              <button onClick={()=>setPanel(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'var(--text-secondary)', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.625rem' }}>
              {panel.items.map(r=>(
                <ReminderRow key={r.id} reminder={r} onUpdate={onUpdate} navigate={navigate}/>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ background:'var(--bg-secondary)', border:'1px dashed var(--border)', borderRadius:'12px', padding:'2rem 1.25rem', textAlign:'center', color:'var(--text-secondary)', fontSize:'0.875rem' }}>
            Click a bar or segment to see reminders here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reminders tab ─────────────────────────────────────────────────────────────
function RemindersTab({ reminders, setReminders, navigate }) {
  const today = startOfDay(new Date());

  // ── Active reminders: latest per lead PER TOPIC ──────────────────────────
  // Each lead+topic thread gets one entry — the one with the latest effective date.
  // This means a lead with "General" and "First Meeting" threads each contribute
  // one reminder row.
  const activeReminders = useMemo(() => {
    const open = reminders.filter(r => r.reminderStatus !== 'closed' && r.followUpDate);
    // Sort newest effective date first
    const sorted = [...open].sort((a,b) => effDate(b) - effDate(a));
    const seen = new Set();
    const result = [];
    for (const r of sorted) {
      const key = `${r.studentUniqueId}__${r.topic||'__none__'}`;
      if (!seen.has(key)) { seen.add(key); result.push(r); }
    }
    return result;
  }, [reminders]);

  async function handleUpdate(noteId, update) {
    try {
      const res = await notesAPI.updateReminder(noteId, update);
      if (res.success) setReminders(prev => prev.map(r => r.id===noteId ? {...r,...res.data} : r));
    } catch(e) { alert('Failed to update reminder: ' + e.message); }
  }

  // ── Bucket definitions ────────────────────────────────────────────────────

  // 1. Overdue daily — last 7 days (day -7 to today exclusive)
  const overdueDailyBuckets = useMemo(() => {
    const overdue = activeReminders.filter(r => effDate(r) < today);
    const days = Array.from({length:7},(_,i)=>{
      const d = startOfDay(addDays(today,-(7-i)));
      return { start:d, end:addDays(d,1), label:fmtDate(d) };
    });
    return buildBuckets(overdue, days, b=>b);
  }, [activeReminders, today]);

  // 2. Overdue weekly — 4 weeks prior to the 7-day daily window
  const overdueWeeklyBuckets = useMemo(() => {
    const cutoff7 = startOfDay(addDays(today,-7));
    const overdue = activeReminders.filter(r => effDate(r) < cutoff7);
    const weeks = Array.from({length:4},(_,i)=>{
      const ws = startOfWeekMon(addDays(today,-(4-i)*7-7));
      return { start:ws, end:addDays(ws,7), label:`w/c ${fmtDate(ws)}` };
    });
    return buildBuckets(overdue, weeks, b=>b);
  }, [activeReminders, today]);

  // 3. Upcoming daily — next 7 days
  const upcomingDailyBuckets = useMemo(() => {
    const upcoming = activeReminders.filter(r => effDate(r) >= today);
    const days = Array.from({length:7},(_,i)=>{
      const d = startOfDay(addDays(today,i));
      const isToday = i===0;
      return { start:d, end:addDays(d,1), label: isToday?'Today':fmtDate(d) };
    });
    return buildBuckets(upcoming, days, b=>b);
  }, [activeReminders, today]);

  // 4. Upcoming weekly — 4 weeks after the next 7 days
  const upcomingWeeklyBuckets = useMemo(() => {
    const from7 = startOfDay(addDays(today,7));
    const upcoming = activeReminders.filter(r => effDate(r) >= from7);
    const weeks = Array.from({length:4},(_,i)=>{
      const ws = startOfWeekMon(addDays(today,7+i*7));
      return { start:ws, end:addDays(ws,7), label:`w/c ${fmtDate(ws)}` };
    });
    return buildBuckets(upcoming, weeks, b=>b);
  }, [activeReminders, today]);

  const totalOpen    = activeReminders.length;
  const totalOverdue = activeReminders.filter(r=>effDate(r)<today).length;
  const totalNext7   = activeReminders.filter(r=>{ const d=effDate(r); return d>=today&&d<addDays(today,7); }).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
      {/* Summary cards */}
      <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap' }}>
        {[
          { label:'Total open',  value:totalOpen,    color:'#374151' },
          { label:'Overdue',     value:totalOverdue, color:'#dc2626' },
          { label:'Next 7 days', value:totalNext7,   color:'#2563eb' },
        ].map(({label,value,color})=>(
          <div key={label} style={{ flex:'1 1 120px', background:'var(--bg-secondary)', borderRadius:'10px', padding:'0.875rem 1.25rem', borderTop:`3px solid ${color}` }}>
            <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:600, marginBottom:'0.25rem' }}>{label}</div>
            <div style={{ fontSize:'1.75rem', fontWeight:800, color }}>{value}</div>
          </div>
        ))}
      </div>

      <ChartSection title="⚠ Overdue — Last 7 Days (Daily)" buckets={overdueDailyBuckets} onUpdate={handleUpdate} navigate={navigate}/>
      <ChartSection title="⚠ Overdue — Prior 4 Weeks (Weekly)" buckets={overdueWeeklyBuckets} onUpdate={handleUpdate} navigate={navigate}/>
      <ChartSection title="Upcoming — Next 7 Days (Daily)" buckets={upcomingDailyBuckets} onUpdate={handleUpdate} navigate={navigate}/>
      <ChartSection title="Upcoming — Next 4 Weeks (Weekly)" buckets={upcomingWeeklyBuckets} onUpdate={handleUpdate} navigate={navigate}/>

      {totalOpen===0 && (
        <div style={{ textAlign:'center', padding:'3rem', color:'var(--text-secondary)' }}>
          <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>✅</div>
          <div style={{ fontWeight:600 }}>No open reminders</div>
          <div style={{ fontSize:'0.875rem', marginTop:'0.25rem' }}>All follow-ups are up to date</div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ClientFollowup() {
  const [tab,           setTab]           = useState('reminders');
  const [comms,         setComms]         = useState([]);
  const [reminders,     setReminders]     = useState([]);
  const [activeStaff,   setActiveStaff]   = useState([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);

  const { staff }           = useAuth();
  const { scope }           = usePermissions();
  const { language }        = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const navigate            = useNavigate();
  const hasAllScope = scope('leads', 'view_list') === 'all';

  useEffect(() => {
    pushTrail({ label: language==='vi' ? 'Theo dõi khách hàng' : 'Client Followup', path:'/client-followup' });
  }, [pushTrail, language]);

  useEffect(() => {
    setLoading(true); setError(null);
    const fetches = [notesAPI.getCommunications(), notesAPI.getReminders()];
    if (hasAllScope) fetches.push(staffAPI.listActive());
    Promise.all(fetches)
      .then(([c, r, s]) => {
        setComms(c.data||[]);
        setReminders(r.data||[]);
        if (s) setActiveStaff(s.data||[]);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [hasAllScope]);

  const filteredComms = useMemo(() => {
    if (!selectedStaff) return comms;
    return comms.filter(c => c.authorName === selectedStaff);
  }, [comms, selectedStaff]);

  const filteredReminders = useMemo(() => {
    if (!selectedStaff) return reminders;
    return reminders.filter(r => r.authorName === selectedStaff);
  }, [reminders, selectedStaff]);

  const TABS = [
    { key:'reminders',      label: language==='vi' ? 'Nhắc nhở'  : 'Reminders' },
    { key:'communications', label: language==='vi' ? 'Liên lạc'  : 'Communications' },
  ];

  if (loading) return <div className="page-body" style={{ textAlign:'center', padding:'4rem', color:'var(--text-secondary)' }}>Loading…</div>;
  if (error)   return <div className="page-body"><div className="alert alert--error">{error}</div></div>;

  return (
    <>
      <Watermark/>
      <div className="page-header">
        <span className="page-title">{language==='vi' ? 'Theo dõi khách hàng' : 'Client Followup'}</span>
      </div>
      <div className="page-body">

        {/* Staff filter — Admin / Manager / Director only */}
        {hasAllScope && activeStaff.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem',
            background:'var(--bg-secondary)', borderRadius:'10px', padding:'0.75rem 1rem', flexWrap:'wrap' }}>
            <label style={{ fontSize:'0.875rem', fontWeight:600, color:'var(--text-secondary)', whiteSpace:'nowrap' }}>
              Filter by staff:
            </label>
            <select value={selectedStaff} onChange={e=>setSelectedStaff(e.target.value)}
              style={{ padding:'0.375rem 0.75rem', borderRadius:'8px', border:'1px solid var(--border)',
                fontSize:'0.875rem', background:'var(--bg-primary)', color:'var(--text-primary)',
                fontFamily:'inherit', cursor:'pointer', minWidth:'200px' }}>
              <option value=''>All Staff</option>
              {activeStaff
                .slice().sort((a,b)=>(a.fullName||'').localeCompare(b.fullName||''))
                .map(s=>(
                  <option key={s.id} value={s.fullName}>{s.fullName} ({s.role})</option>
                ))}
            </select>
            {selectedStaff && (
              <>
                <button onClick={()=>setSelectedStaff('')}
                  style={{ padding:'0.375rem 0.75rem', borderRadius:'8px', border:'1px solid var(--border)',
                    background:'transparent', fontSize:'0.8125rem', cursor:'pointer', color:'var(--text-secondary)' }}>
                  ✕ Clear
                </button>
                <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
                  Showing: <strong style={{ color:'var(--text-primary)' }}>{selectedStaff}</strong>
                </span>
              </>
            )}
          </div>
        )}

        <div style={{ display:'flex', borderBottom:'2px solid var(--border)', marginBottom:'1.5rem' }}>
          {TABS.map(({key,label})=>(
            <button key={key} onClick={()=>setTab(key)}
              style={{ padding:'0.625rem 1.25rem', border:'none', background:'none', cursor:'pointer',
                fontWeight:tab===key?700:500, fontSize:'0.9375rem',
                color:tab===key?'var(--primary)':'var(--text-secondary)',
                borderBottom:tab===key?'2px solid var(--primary)':'2px solid transparent',
                marginBottom:'-2px', transition:'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>
        {tab==='communications' && <CommunicationsTab comms={filteredComms}/>}
        {tab==='reminders'      && <RemindersTab reminders={filteredReminders} setReminders={setReminders} navigate={navigate}/>}
      </div>
    </>
  );
}
