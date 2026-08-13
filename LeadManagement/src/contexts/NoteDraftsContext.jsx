// src/contexts/NoteDraftsContext.jsx
// Single shared poller for the current staffer's pending note drafts —
// backs both the sidebar badge and the top-of-page banner so they don't
// each run their own interval/duplicate fetches. Mounted once inside
// ConsoleShell (i.e. only while authenticated).
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { noteDraftsAPI } from '../services/api';
import { useAuth } from './AuthContext';

const NoteDraftsContext = createContext(null);

const POLL_MS = 60000; // pending drafts have no expiry, so a slow poll is fine

export function NoteDraftsProvider({ children }) {
  const { staff } = useAuth();
  const [drafts, setDrafts]   = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!staff) { setDrafts([]); setLoading(false); return; }
    try {
      const res = await noteDraftsAPI.listMine();
      setDrafts(res.data || []);
    } catch {
      // network blip — keep showing the last known list rather than blanking it
    } finally {
      setLoading(false);
    }
  }, [staff]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  return (
    <NoteDraftsContext.Provider value={{ drafts, count: drafts.length, loading, refresh }}>
      {children}
    </NoteDraftsContext.Provider>
  );
}

export function useNoteDrafts() {
  const ctx = useContext(NoteDraftsContext);
  if (!ctx) throw new Error('useNoteDrafts must be used within NoteDraftsProvider');
  return ctx;
}
