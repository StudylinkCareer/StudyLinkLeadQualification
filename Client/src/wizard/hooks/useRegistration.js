import { useCallback } from 'react';
import { authAPI, studentAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';

// The ONE place the wizard registers / re-opens a student.
//   1. checkLogin  -> scenario (no_match | single_active | conflict)
//   2. bypassed OTP pair (intentional, known) -> establishes the server session
//   3. POST /students/register  (or open an existing record + append a registration)
// Unlike the legacy Home → Dashboard split, everything happens here, in order.
export function useRegistration() {
  const { login } = useAuth();

  const establishSession = useCallback(async (email) => {
    await authAPI.requestOTP(email);
    const result = await authAPI.verifyOTP(email, '000000');
    login(result.email, null, false);
  }, [login]);

  // Look the person up before creating anything.
  const check = useCallback(async ({ email, phone }) => {
    const r = await authAPI.checkLogin(email.trim(), phone.trim());
    return {
      scenario: r.scenario,
      matches: r.matches || [],
      activeRecord: r.activeRecord,
      hasActiveLead: r.hasActiveLead,
    };
  }, []);

  // Brand-new student, or a new lead on an existing student (existingStudentId).
  const register = useCallback(async (payload, { existingStudentId } = {}) => {
    await establishSession(payload.email);
    try {
      const res = await studentAPI.register({
        ...payload,
        ...(existingStudentId ? { existingStudentId } : {}),
        minimalConflict: true,
      });
      return res.data.studentId;
    } catch (err) {
      // Someone registered between the check and now: open that record instead.
      if (err.status === 409 && err.data && err.data.existing && err.data.existing.studentId) {
        return err.data.existing.studentId;
      }
      throw err;
    }
  }, [establishSession]);

  // Existing active record: open it and count this submission as a new registration.
  const openExisting = useCallback(async (studentId, payload, { deactivate = [] } = {}) => {
    await establishSession(payload.email);
    await studentAPI.getById(studentId);
    if (payload.sourceOfLead) {
      try {
        await studentAPI.addRegistration(studentId, {
          sourceOfLead: payload.sourceOfLead,
          source: payload.source,
          sourceDetail: payload.sourceDetail,
          sourceUnverified: payload.sourceUnverified,
          counsellor: payload.counsellor,
          eventId: payload.eventId,
        });
      } catch (e) { console.warn('add-registration failed:', e); }
    }
    if (deactivate.length) {
      try { await studentAPI.deactivateRecords(deactivate); } catch (e) { console.warn('deactivate failed:', e); }
    }
    return studentId;
  }, [establishSession]);

  return { check, register, openExisting };
}
