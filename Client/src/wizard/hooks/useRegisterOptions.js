import { useEffect, useState } from 'react';

// Public (pre-login) option lists for the registration form. Every list comes from
// the server — nothing is hardcoded — so the Source-of-Lead restructure can land
// without touching the wizard. Each fetch is best-effort: a failed list is just empty.
const EMPTY_SOURCES = { sourceOfLead: [], source: {}, b2bType: [], b2bParty: {} };

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export function useRegisterOptions() {
  const [events, setEvents] = useState([]);
  const [sources, setSources] = useState(EMPTY_SOURCES);
  const [provinces, setProvinces] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      getJson('/api/marketing-events/public'),
      getJson('/api/reference-data/public/source-options'),
      getJson('/api/lookups/public/vietnam_province'),
    ]).then(([ev, src, prov]) => {
      if (!alive) return;
      if (ev.status === 'fulfilled') setEvents(ev.value.data || []);
      if (src.status === 'fulfilled') setSources(src.value.data || EMPTY_SOURCES);
      if (prov.status === 'fulfilled') setProvinces(prov.value.data || []);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  return { events, sources, provinces, ready };
}
