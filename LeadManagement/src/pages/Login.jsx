// src/pages/Login.jsx
// -----------------------------------------------------------------------------
// CHANGES (i18n Phase 2b):
//   - All visible strings use t(key, language) from the i18n module.
//   - The brand name 'StudyLink' stays as-is (not translated).
//   - Error messages from the server come back in English and are shown
//     verbatim — translating server error strings is a later concern.
// -----------------------------------------------------------------------------

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const { login }               = useAuth();
  const { language }            = useLanguage();
  const navigate                = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authAPI.login(email, password);
      login(data.staff);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || t('login.error.failed', language));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <h1>{t('sidebar.productName', language)}</h1>
          <p>{t('login.portalTitle', language)}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('login.emailLabel', language)}</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder', language)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">{t('login.passwordLabel', language)}</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="alert alert--error">{error}</div>}

          <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
            {loading ? t('login.signingIn', language) : t('login.signInBtn', language)}
          </button>
        </form>
      </div>
    </div>
  );
}
