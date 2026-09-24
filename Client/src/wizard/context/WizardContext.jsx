import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useLanguage } from '../../contexts/LanguageContext';
import { studentAPI } from '../../services/api';
import { wt } from '../copy';

const WizardContext = createContext(null);
const ID_KEY = 'wz_studentId';
const SAVE_DEBOUNCE_MS = 600;

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// Progress is derived from saved data (no separate "step done" column):
//   step 1 ⇔ one full parent block + at least one destination country
//   step 2 ⇔ a gem has been calculated (stoneTier)
//   step 3 ⇔ the career quiz has been scored (OCEAN traits stored)
export function deriveProgress(s) {
  if (!s) return { step1: false, step2: false, step3: false, completed: false, currentStep: 1 };
  const mother = has(s.motherFullName) && has(s.motherPhone) && has(s.motherEmail);
  const father = has(s.fatherFullName) && has(s.fatherPhone) && has(s.fatherEmail);
  const step1 = (mother || father) && has(s.destinationCountry);
  const step2 = has(s.stoneTier);
  const step3 = has(s.oceanExtraversion);
  const currentStep = !step1 ? 1 : !step2 ? 2 : !step3 ? 3 : 3;
  return { step1, step2, step3, completed: !!s.journeyCompletedAt, currentStep };
}

export function WizardProvider({ children }) {
  const { language, setLanguage } = useLanguage();
  const { isAuthenticated, studentId, loading: authLoading, setStudentId } = useAuth();

  const [student, setStudent] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | none
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  const pending = useRef({});
  const timer = useRef(null);
  const studentRef = useRef(null);
  studentRef.current = student;

  const w = useCallback((key) => wt(key, language), [language]);

  const forget = useCallback(() => {
    try { sessionStorage.removeItem(ID_KEY); } catch { /* ignore */ }
    setStudent(null);
    setStatus('none');
  }, []);

  const load = useCallback(async (idOverride) => {
    const id = idOverride || studentId || (() => { try { return sessionStorage.getItem(ID_KEY); } catch { return null; } })();
    if (!id) { setStatus('none'); return null; }
    try {
      const res = await studentAPI.getById(id);
      setStudent(res.data);
      setStatus('ready');
      return res.data;
    } catch (err) {
      if ([401, 403, 404].includes(err.status)) { forget(); return null; }
      setStatus('none');
      return null;
    }
  }, [studentId, forget]);

  // Adopt a student (just registered / just picked at login) as "this session's" record.
  const adopt = useCallback(async (id) => {
    try { sessionStorage.setItem(ID_KEY, id); } catch { /* ignore */ }
    setStudentId(id);
    return load(id);
  }, [load, setStudentId]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) { setStatus('none'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const id = studentRef.current && studentRef.current.studentId;
    const body = pending.current;
    if (!id || !Object.keys(body).length) return true;
    pending.current = {};
    setSaveState('saving');
    try {
      await studentAPI.update(id, body);
      setSaveState('saved');
      return true;
    } catch {
      pending.current = { ...body, ...pending.current };
      setSaveState('error');
      return false;
    }
  }, []);

  // Merge changed fields locally and send ONLY those fields (debounced) — never the
  // whole record, so a stale snapshot can't overwrite fields changed elsewhere.
  const patch = useCallback((fields) => {
    setStudent((s) => ({ ...(s || {}), ...fields }));
    pending.current = { ...pending.current, ...fields };
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const progress = useMemo(() => deriveProgress(student), [student]);

  const value = {
    language, setLanguage, w,
    student, status, progress,
    saveState, patch, flush, reload: load, adopt, forget,
  };
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used inside <WizardProvider>');
  return ctx;
}
