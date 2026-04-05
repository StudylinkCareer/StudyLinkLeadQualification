import { useState, useRef, useCallback, useEffect } from 'react';
import { studentAPI } from '../services/api';

export function useFormState(uniqueId, initialData = {}) {
  const [formData, setFormData] = useState(initialData);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const uniqueIdRef = useRef(uniqueId);
  const initializedRef = useRef(false);
  const formDataRef = useRef(formData);
  const dirtyRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    uniqueIdRef.current = uniqueId;
  }, [uniqueId]);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Sync initialData whenever it changes to a new student record.
  // We track the uniqueId so switching students always reloads fresh data.
  const prevUniqueId = useRef(null);
  useEffect(() => {
    const incomingId = initialData?.uniqueId;
    const isNewStudent = incomingId && incomingId !== prevUniqueId.current;
    const isFirstLoad = !initializedRef.current && initialData && Object.keys(initialData).length > 0;

    if (isFirstLoad || isNewStudent) {
      prevUniqueId.current = incomingId || null;
      initializedRef.current = true;
      formDataRef.current = initialData;
      setFormData(initialData);
      setDirty(false);
      dirtyRef.current = false;
      setLastSaved(null);
    }
  }, [initialData]);

  // Warn on browser close / refresh when there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Update field in memory only — no auto-save.
  // The ref is updated synchronously so that saveAll() always reads the latest data,
  // even when called in the same tick (e.g. auto-save after QR scan).
  const updateField = useCallback((name, value) => {
    formDataRef.current = { ...formDataRef.current, [name]: value };
    setFormData(formDataRef.current);
    setDirty(true);
    dirtyRef.current = true;

    // Clear error for this field
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  // Write all in-memory data to Google Sheet
  const saveAll = useCallback(async () => {
    const id = uniqueIdRef.current;
    if (!id) return;
    try {
      setSaving(true);
      console.log('[useFormState] Saving all fields to sheet');
      await studentAPI.update(id, formDataRef.current);
      setLastSaved(new Date());
      setDirty(false);
      console.log('[useFormState] Save OK');
    } catch (err) {
      console.error('[useFormState] Save failed:', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  // Discard unsaved changes — revert to last saved / initial data
  const discard = useCallback(() => {
    setFormData(initialData);
    formDataRef.current = initialData;
    setDirty(false);
  }, [initialData]);

  return { formData, updateField, saving, lastSaved, dirty, errors, setErrors, saveAll, discard, setFormData };
}
