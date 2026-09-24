import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { IconHome } from '../components/Icons';
import { Field, NavButton, PillButton, SelectField, TextField } from '../components/ui';
import { useCountryGroups } from '../hooks/useCountryGroups';
import { COUNTRY_CODES, CONTACT_MEDIUMS, getTranslatedOptions } from '../../utils/formFields';
import { studentAPI } from '../../services/api';
import { formatPhoneInput, isEmail } from '../lib/phone';

const MAX_COUNTRIES = 3;
const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// One parent block (mother* or father*) is what the record holds; the Mẹ/Ba dropdown
// only chooses which. If a legacy record has both, Mẹ is shown and Ba is left alone.
function readParent(s) {
  const block = (p) => ({
    name: s[`${p}FullName`] || '', cc: s[`${p}PhoneCountryCode`] || '+84',
    phone: s[`${p}Phone`] || '', email: s[`${p}Email`] || '',
    filled: has(s[`${p}FullName`]) || has(s[`${p}Phone`]) || has(s[`${p}Email`]),
  });
  const m = block('mother'), f = block('father');
  const role = m.filled ? 'mother' : f.filled ? 'father' : '';
  return { role, bothFilled: m.filled && f.filled, ...(role === 'father' ? f : m) };
}

const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(',').map((x) => x.trim()).filter(Boolean));

export default function Step1() {
  const navigate = useNavigate();
  const { language, w, student, patch, flush, reload } = useWizard();
  const groups = useCountryGroups(language);
  const init = useState(() => readParent(student))[0];

  const [role, setRole] = useState(init.role);
  const [name, setName] = useState(init.name);
  const [cc, setCc] = useState(init.cc);
  const [phone, setPhone] = useState(init.phone || '0');
  const [email, setEmail] = useState(init.email);
  const [countries, setCountries] = useState(() => toList(student.destinationCountry));
  const [timeline, setTimeline] = useState(student.timeline || '');
  const [platform, setPlatform] = useState(student.contactMedium1 || '');
  const [handle, setHandle] = useState(student.contactDetail1 || '');

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const clearErr = (k) => setErrors((p) => ({ ...p, [k]: false }));

  const toggleCountry = (value) => {
    clearErr('countries');
    setCountries((cur) => {
      if (cur.includes(value)) return cur.filter((c) => c !== value);
      return cur.length >= MAX_COUNTRIES ? cur : [...cur, value];
    });
  };

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!role) errs.role = w('errParent');
    if (!name.trim()) errs.name = w('errParentName');
    if (phone.replace(/\D/g, '').length < 8) errs.phone = w('errParentPhone');
    if (!isEmail(email)) errs.email = w('errParentEmail');
    if (!countries.length) errs.countries = w('errCountries');
    setErrors(errs);
    const first = Object.values(errs).find(Boolean);
    setMessage(first || '');
    if (first) return;

    setBusy(true);
    try {
      const base = role;                       // 'mother' | 'father'
      const other = role === 'mother' ? 'father' : 'mother';
      const fields = {
        [`${base}FullName`]: name.trim(),
        [`${base}Phone`]: phone,
        [`${base}PhoneCountryCode`]: cc,
        [`${base}Email`]: email.trim(),
      };
      // Switched Mẹ↔Ba on a record that only had one parent: move it, don't duplicate it.
      if (init.role && init.role !== role && !init.bothFilled) {
        Object.assign(fields, {
          [`${other}FullName`]: '', [`${other}Phone`]: '', [`${other}PhoneCountryCode`]: '', [`${other}Email`]: '',
        });
      }
      if (has(platform) || has(handle) || has(student.contactMedium1) || has(student.contactDetail1)) {
        Object.assign(fields, { contactMedium1: platform, contactDetail1: handle.trim(), preferredSocial: platform });
      }
      patch(fields);
      if (!(await flush())) throw new Error(w('saveFailed'));

      // Country/timeline go through the qualification endpoint: it writes the student
      // AND the lead (the advance-QR gate reads the lead copy).
      // (A blank timeline is simply not sent — it never clears what a counsellor set.)
      await studentAPI.saveQualification(student.studentId, { destinationCountry: countries, ...(timeline ? { timeline } : {}) });

      // Country/timeline feed the gem score — refresh it if one already exists.
      const fresh = await reload();
      if (fresh && has(fresh.stoneTier)) {
        await studentAPI.calculateRisk(student.studentId);
        await reload();
      }
      navigate('/app/step/2');
    } catch (err) {
      setMessage(err.message || w('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PillButton icon={<IconHome />} onClick={() => navigate('/app/hub')}>{w('home')}</PillButton>
      <h1 className="wz-pagetitle">{w('s1Title')}</h1>

      <form className="wz-form" onSubmit={save} noValidate>
        <section className="wz-card">
          <SelectField id="wz-parent" label={w('parent')} required invalid={!!errors.role} placeholder={w('parentPick')}
            value={role} options={[{ value: 'mother', label: w('mother') }, { value: 'father', label: w('father') }]}
            onChange={(v) => { setRole(v); clearErr('role'); }} />
          <TextField id="wz-pname" label={w('parentName')} required invalid={!!errors.name} autoComplete="off"
            placeholder={w('fullNamePh')} value={name} onChange={(e) => { setName(e.target.value); clearErr('name'); }} />
          <Field id="wz-pphone" label={w('parentPhone')} required>
            <div className="wz-phone">
              <select className="wz-select" aria-label="Country code" value={cc} onChange={(e) => setCc(e.target.value)}>
                {COUNTRY_CODES.map((c) => <option key={`${c.code}-${c.country}`} value={c.code}>{c.code}</option>)}
              </select>
              <input id="wz-pphone" className={`wz-input${errors.phone ? ' wz-invalid' : ''}`} type="tel" inputMode="tel"
                placeholder={w('phonePh')} value={phone}
                onChange={(e) => { setPhone(formatPhoneInput(e.target.value)); clearErr('phone'); }} />
            </div>
          </Field>
          <TextField id="wz-pemail" type="email" label={w('parentEmail')} required invalid={!!errors.email}
            placeholder={w('emailPh')} value={email} onChange={(e) => { setEmail(e.target.value); clearErr('email'); }} />
        </section>

        <section className="wz-card" aria-labelledby="wz-countries-h">
          <h2 className="wz-card-title" id="wz-countries-h">{w('countries')}</h2>
          {groups.map((g) => (
            <div className="wz-region" key={g.region}>
              <p className="wz-region-head">{g.region}<small>{w('countriesHint')}</small></p>
              <div className="wz-chips">
                {g.countries.map((c) => {
                  const on = countries.includes(c.value);
                  const blocked = !on && countries.length >= MAX_COUNTRIES;
                  return (
                    <button key={c.value} type="button" className="wz-chip" aria-pressed={on}
                      aria-disabled={blocked || undefined} onClick={() => !blocked && toggleCountry(c.value)}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className={errors.countries ? 'wz-error' : 'wz-count'} role="status">
            {errors.countries || w('countriesCount').replace('{n}', countries.length)}
          </p>
        </section>

        <section className="wz-card">
          <SelectField id="wz-timeline" label={w('timeline')} placeholder={w('timelinePick')} value={timeline}
            options={getTranslatedOptions('timeline', language)} onChange={setTimeline} />
        </section>

        <section className="wz-card">
          <h2 className="wz-card-title" style={{ fontSize: 16 }}>{w('socialTitle')}</h2>
          <SelectField id="wz-platform" label={w('socialPlatform')} placeholder={w('socialNone')} value={platform}
            options={CONTACT_MEDIUMS.map((m) => ({ value: m, label: m }))} onChange={setPlatform} />
          {platform && (
            <TextField id="wz-handle" label={w('socialHandle')} maxLength={120} value={handle}
              onChange={(e) => setHandle(e.target.value)} />
          )}
        </section>

        {message && <p className="wz-error" role="alert">{message}</p>}
        <div className="wz-center">
          <NavButton type="submit" disabled={busy}>{busy ? w('connecting') : w('next')}</NavButton>
        </div>
      </form>
    </Screen>
  );
}
