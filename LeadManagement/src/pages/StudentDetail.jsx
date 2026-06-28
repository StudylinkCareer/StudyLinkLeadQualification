// src/pages/StudentDetail.jsx
// The person view is rendered by the real PROD LeadDetail (person + lead, with a
// "Leads for this student" table). /students/:studentId resolves the person's
// representative lead and lands on that PROD detail — so every detail screen is PROD.

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { leadAPI } from '../services/api';

export default function StudentDetail() {
  const { studentId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await leadAPI.listForStudent(studentId);
        const ls = r.data || [];
        if (!alive) return;
        if (ls.length) navigate(`/lead/${ls[0].leadId}`, { replace: true });
        else navigate('/leads', { replace: true });
      } catch {
        if (alive) navigate('/leads', { replace: true });
      }
    })();
    return () => { alive = false; };
  }, [studentId, navigate]);

  return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Opening…</div>;
}
