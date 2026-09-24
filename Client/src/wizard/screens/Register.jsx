import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { Dialog, NavButton, RadioGroup, SelectField, TextField, Field } from '../components/ui';
import { useRegisterOptions } from '../hooks/useRegisterOptions';
import { useRegistration } from '../hooks/useRegistration';
import { COUNTRY_CODES, STUDY_PLANS, VIETNAM_PROVINCES } from '../../utils/formFields';
import { t } from '../../i18n';
import { formatPhoneInput, isEmail, isValidYob } from '../lib/phone';
import { captureQrParams, matchEvent, normText } from '../lib/qrParams';

const NONE = 'none';
// Hà Nội, Hồ Chí Minh, Đà Nẵng, Hải Phòng, Cần Thơ (matched on the accent-free code).
const MAJOR_CITIES = ['ha noi', 'ho chi minh', 'da nang', 'hai phong', 'can tho'];

export default function Register() {
  const navigate = useNavigate();
  const { language, w, adopt } = useWizard();
  const { events, sources, provinces } = useRegisterOptions();
  const { check, register, openExisting } = useRegistration();
  const L = (o) => (language === 'vi' ? (o.labelVi || o.code) : (o.labelEn || o.code));

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [cc, setCc] = useState('+84');
  const [phoneNumber, setPhoneNumber] = useState('0');
  const [yob, setYob] = useState('');
  const [channel, setChannel] = useState('');
  const [source, setSource] = useState('');
  const [referrer, setReferrer] = useState('');
  const [eventChoice, setEventChoice] = useState('');   // '' | 'none' | <event id> | 'qr-text'
  const [qrEventName, setQrEventName] = useState('');   // QR link named an event we can't match
  const [qrCounsellor, setQrCounsellor] = useState('');
  const [residence, setResidence] = useState('');
  const [studyPlan, setStudyPlan] = useState('');
  const [connect, setConnect] = useState('');

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);

  const qr = useMemo(() => captureQrParams(), []);
  const lockedByQr = !!(qr && (qr.eid || qr.ename || qr.sol === 'Event/Campaign'));

  // Event-QR deep link: preselect + lock the event (id first, then name).
  useEffect(() => {
    if (qr && qr.counsellor) setQrCounsellor(qr.counsellor);
    if (!lockedByQr) return;
    const ev = matchEvent(events, qr);
    if (ev) { setEventChoice(String(ev.id)); if (ev.dedicatedCounsellor && !qr.counsellor) setQrCounsellor(ev.dedicatedCounsellor); }
    else if (qr.ename) { setEventChoice('qr-text'); setQrEventName(qr.ename); }
  }, [events, qr, lockedByQr]);

  const eventSol = (sources.sourceOfLead.find((o) => o.mode === 'events') || {}).code || 'Event/Campaign';
  const channelOptions = sources.sourceOfLead
    .filter((o) => o.mode !== 'events' && o.mode !== 'b2b')
    .map((o) => ({ value: o.code, label: L(o) }));
  const channelMode = (sources.sourceOfLead.find((o) => o.code === channel) || {}).mode || '';
  const sourceListOptions = (sources.source[channel] || []).map((o) => ({ value: o.code, label: L(o) }));
  const eventOptions = [
    { value: NONE, label: w('eventNone') },
    ...events.map((e) => ({ value: String(e.id), label: (language === 'vi' ? e.labelVi : e.labelEn) || e.name })),
    ...(eventChoice === 'qr-text' ? [{ value: 'qr-text', label: qrEventName }] : []),
  ];
  // Same fallback the legacy form uses while/if the public lookup is empty.
  const provinceOptions = provinces.length
    ? provinces.map((p) => ({ value: p.code, label: L(p) }))
    : VIETNAM_PROVINCES.map((p) => ({ value: p, label: p }));
  // The 5 centrally-run cities are what most customers pick, so they go first.
  const provinceGroups = (() => {
    const key = (o) => normText(o.value);
    const majors = MAJOR_CITIES.map((c) => provinceOptions.find((o) => key(o).startsWith(c))).filter(Boolean);
    const rest = provinceOptions.filter((o) => !majors.includes(o));
    return [{ label: w('provMajor'), options: majors }, { label: w('provOther'), options: rest }];
  })();
  const planLabels = t('studyPlanOptions', language);
  const planOptions = STUDY_PLANS.map((v, i) => ({ value: v, label: Array.isArray(planLabels) ? planLabels[i] : v }));

  const hasEvent = eventChoice !== '' && eventChoice !== NONE;
  const ev = hasEvent ? events.find((e) => String(e.id) === eventChoice) : null;

  const clearErr = (k) => setErrors((p) => ({ ...p, [k]: false }));

  const buildPayload = () => {
    const mode = channelMode;
    return {
      email: email.trim(),
      phone: phoneNumber,
      phoneCountryCode: cc,
      fullName: fullName.trim(),
      yearOfBirth: yob,
      residency: residence,
      socialConsent: connect,
      preferredSocial: '',
      contactMedium1: '',
      studyPlans: studyPlan,
      sourceOfLead: hasEvent ? eventSol : channel,
      source: hasEvent ? (ev ? ev.name : qrEventName) : source,
      sourceDetail: !hasEvent && mode === 'list_freetext' ? referrer.trim() : '',
      sourceUnverified: false,
      counsellor: qrCounsellor || (ev && ev.dedicatedCounsellor) || '',
      eventId: hasEvent && ev ? ev.id : null,
    };
  };

  const finish = async (id) => {
    await adopt(id);
    navigate('/app/hub', { replace: true });
  };

  const fail = (err) => setMessage((err && err.message) || w('errGeneric'));

  const submit = async (e) => {
    e.preventDefault();
    setMessage('');
    const errs = {};
    if (!fullName.trim()) errs.fullName = true;
    if (phoneNumber.replace(/\D/g, '').length < 8) errs.phone = true;
    if (!email.trim()) errs.email = true;
    if (!yob) errs.yob = true;
    if (!hasEvent && !channel) errs.channel = true;
    if (!hasEvent && (channelMode === 'list' || channelMode === 'list_freetext') && !source) errs.source = true;
    if (!eventChoice) errs.event = true;
    if (!residence) errs.residence = true;
    if (!studyPlan) errs.studyPlan = true;
    if (!connect) errs.connect = true;
    if (Object.keys(errs).length) { setErrors(errs); return setMessage(w('errRequired')); }
    if (!isEmail(email)) { setErrors({ email: true }); return setMessage(w('errEmail')); }
    if (!isValidYob(yob)) { setErrors({ yob: true }); return setMessage(w('errYob')); }
    setErrors({});

    setBusy(true);
    try {
      const payload = buildPayload();
      const r = await check({ email: payload.email, phone: `${cc} ${phoneNumber}` });
      if (r.scenario === 'single_active') {
        setDialog({ type: 'welcome', hasActiveLead: r.hasActiveLead, record: r.activeRecord, payload });
      } else if (r.scenario === 'conflict') {
        setDialog({ type: 'conflict', matches: r.matches, payload });
      } else {
        await finish(await register(payload));
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const confirmWelcome = async () => {
    const { hasActiveLead, record, payload } = dialog;
    setDialog(null); setBusy(true);
    try {
      const id = hasActiveLead
        ? await openExisting(record.studentId, payload)
        : await register(payload, { existingStudentId: record.studentId });
      await finish(id);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const confirmConflict = async (selectedId) => {
    const { matches, payload } = dialog;
    const deactivate = matches.filter((m) => m.status === 'Active' && m.studentId !== selectedId).map((m) => m.studentId);
    setDialog(null); setBusy(true);
    try { await finish(await openExisting(selectedId, payload, { deactivate })); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <Screen showAccount={false}>
      <div className="wz-login">
        <img src="/wizard/login-illustration.png" alt="" />
        <div>
          <p>{w('regHaveAccount')}</p>
          <p className="wz-login-cta">
            <Link to="/login" className="wz-login-link">
              {w('regLogin')} <span className="wz-login-here">{w('regLoginHere')}</span>
            </Link>
          </p>
        </div>
      </div>
      <div className="wz-divider" />

      <form className="wz-form" onSubmit={submit} noValidate>
        <h1 className="wz-title">{w('regTitle')}</h1>

        <TextField id="wz-name" label={w('fullName')} required invalid={errors.fullName} autoComplete="name"
          placeholder={w('fullNamePh')} value={fullName}
          onChange={(e) => { setFullName(e.target.value); clearErr('fullName'); }} />

        <Field id="wz-phone" label={w('phone')} required>
          <div className="wz-phone">
            <select className="wz-select" aria-label="Country code" value={cc} onChange={(e) => setCc(e.target.value)}>
              {COUNTRY_CODES.map((c) => <option key={`${c.code}-${c.country}`} value={c.code}>{c.code}</option>)}
            </select>
            <input id="wz-phone" className={`wz-input${errors.phone ? ' wz-invalid' : ''}`} type="tel" inputMode="tel"
              autoComplete="tel-national" placeholder={w('phonePh')} value={phoneNumber}
              onChange={(e) => { setPhoneNumber(formatPhoneInput(e.target.value)); clearErr('phone'); }} />
          </div>
        </Field>

        <TextField id="wz-email" type="email" label={w('email')} required invalid={errors.email} autoComplete="email"
          placeholder={w('emailPh')} value={email}
          onChange={(e) => { setEmail(e.target.value); clearErr('email'); }} />

        <TextField id="wz-yob" label={w('yob')} required invalid={errors.yob} inputMode="numeric" maxLength={4}
          placeholder={w('yobPh')} value={yob}
          onChange={(e) => { setYob(e.target.value.replace(/\D/g, '').slice(0, 4)); clearErr('yob'); }} />

        <SelectField id="wz-channel" label={w('channel')} required invalid={errors.channel} placeholder={w('choose')}
          value={hasEvent ? '' : channel} options={channelOptions} disabled={hasEvent}
          hint={hasEvent ? w('eventLocked') : undefined}
          onChange={(v) => { setChannel(v); setSource(''); setReferrer(''); clearErr('channel'); }} />

        {!hasEvent && (channelMode === 'list' || channelMode === 'list_freetext') && (
          <SelectField id="wz-source" label={w('channelSource')} required invalid={errors.source} placeholder={w('choose')}
            value={source} options={sourceListOptions}
            onChange={(v) => { setSource(v); clearErr('source'); }} />
        )}
        {!hasEvent && channelMode === 'list_freetext' && (
          <TextField id="wz-referrer" label={w('referrerName')} maxLength={40} placeholder={w('optional')}
            value={referrer} onChange={(e) => setReferrer(e.target.value)} />
        )}

        <SelectField id="wz-event" label={w('event')} required invalid={errors.event} placeholder={w('choose')}
          value={eventChoice} options={eventOptions} disabled={lockedByQr && eventChoice !== ''}
          onChange={(v) => { setEventChoice(v); clearErr('event'); }} />

        <div className="wz-row2">
          <SelectField id="wz-residence" label={w('residence')} required invalid={errors.residence} placeholder={w('choose')}
            value={residence} options={provinceOptions} groups={provinceGroups}
            onChange={(v) => { setResidence(v); clearErr('residence'); }} />
          <SelectField id="wz-plan" label={w('dream')} required invalid={errors.studyPlan} placeholder={w('choose')}
            value={studyPlan} options={planOptions}
            onChange={(v) => { setStudyPlan(v); clearErr('studyPlan'); }} />
        </div>

        <RadioGroup name="wz-connect" label={w('connect')} required invalid={errors.connect} value={connect}
          options={[{ value: 'Yes', label: w('yes') }, { value: 'No', label: w('no') }]}
          onChange={(v) => { setConnect(v); clearErr('connect'); }} />

        <p className="wz-consent">{w('consent')}</p>
        {message && <p className="wz-error" role="alert">{message}</p>}

        <NavButton type="submit" className="wz-btn--wide" disabled={busy}>
          {busy ? w('connecting') : w('start')}
        </NavButton>
      </form>

      {dialog && dialog.type === 'welcome' && (
        <Dialog title={w('welcomeBack')} onClose={() => setDialog(null)}>
          <p>{dialog.hasActiveLead ? w('welcomeBackActive') : w('welcomeBackNew')}</p>
          <div className="wz-dialog-actions">
            <NavButton className="wz-btn--ghost" onClick={() => setDialog(null)}>{w('cancel')}</NavButton>
            <NavButton onClick={confirmWelcome}>{dialog.hasActiveLead ? w('continue') : w('createEnquiry')}</NavButton>
          </div>
        </Dialog>
      )}
      {dialog && dialog.type === 'conflict' && (
        <ConflictDialog matches={dialog.matches} w={w} onCancel={() => setDialog(null)} onPick={confirmConflict} />
      )}
    </Screen>
  );
}

function ConflictDialog({ matches, w, onCancel, onPick }) {
  const [picked, setPicked] = useState('');
  return (
    <Dialog title={w('conflictTitle')} onClose={onCancel}>
      <div role="radiogroup" aria-label={w('conflictTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {matches.map((m) => (
          <label key={m.studentId} className="wz-match">
            <input type="radio" name="wz-match" value={m.studentId} checked={picked === m.studentId}
              onChange={() => setPicked(m.studentId)} />
            <span>
              {m.fullName || '—'}
              <small>{[m.email, m.phone].filter(Boolean).join(' · ')}</small>
              <small>ID: {m.studentId}</small>
            </span>
          </label>
        ))}
      </div>
      <p>{w('conflictHint')}</p>
      <div className="wz-dialog-actions">
        <NavButton className="wz-btn--ghost" onClick={onCancel}>{w('cancel')}</NavButton>
        <NavButton disabled={!picked} onClick={() => onPick(picked)}>{w('keepSelected')}</NavButton>
      </div>
    </Dialog>
  );
}
