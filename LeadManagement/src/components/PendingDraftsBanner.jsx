// src/components/PendingDraftsBanner.jsx
// Cross-device note drafts (2026-08): shown at the top of every page while
// the current staffer has one or more pending drafts — a "Make phone call"
// (or Zalo/SMS/etc.) click on another device that's still waiting to be
// filled in. Dismissible, but reappears if the pending count grows past
// what was dismissed (e.g. they lock another note before finishing this
// one) — dismissing doesn't mean "stop reminding me forever", it just
// clears the current nudge.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiClock, FiX } from 'react-icons/fi';
import { useNoteDrafts } from '../contexts/NoteDraftsContext';

const DISMISS_KEY = 'pendingDraftsDismissedCount';

export default function PendingDraftsBanner() {
  const { count, loading } = useNoteDrafts();
  const navigate = useNavigate();
  const [dismissedCount, setDismissedCount] = useState(() => {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return raw ? Number(raw) : 0;
  });

  // A newly-created draft (count grows past whatever was last dismissed)
  // should resurface the banner, so we don't gate on a plain boolean.
  useEffect(() => {
    if (count < dismissedCount) setDismissedCount(count); // drafts got resolved elsewhere; reset
  }, [count, dismissedCount]);

  if (loading || count === 0 || count <= dismissedCount) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, String(count));
    setDismissedCount(count);
  }

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.625rem 1rem',
      background:'#fef3c7', border:'1px solid #f59e0b', borderRadius:'8px',
      margin:'0 0 0.875rem', color:'#92400e', fontSize:'0.875rem',
    }}>
      <FiClock size={16} style={{ flexShrink:0 }}/>
      <div style={{ flex:1 }}>
        <strong>{count} pending note{count > 1 ? 's' : ''}</strong> waiting to be finished — started on another device or tab and not yet saved.
      </div>
      <button onClick={() => navigate('/notes/drafts')}
        style={{ padding:'0.3rem 0.75rem', borderRadius:'6px', border:'none', background:'#f59e0b', color:'#fff', fontWeight:600, fontSize:'0.8125rem', cursor:'pointer', whiteSpace:'nowrap' }}>
        View
      </button>
      <button onClick={dismiss} title="Dismiss for now"
        style={{ background:'none', border:'none', cursor:'pointer', color:'#92400e', display:'flex', padding:'0.2rem' }}>
        <FiX size={16}/>
      </button>
    </div>
  );
}
