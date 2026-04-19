// src/i18n/index.js
// -----------------------------------------------------------------------------
// t(key, language) — look up a translation string by key.
// Falls back to English, then to the key itself (so unfinished keys remain
// legible in the UI while translation work is ongoing).
//
// Usage:
//   import { t } from '../i18n';
//   import { useLanguage } from '../contexts/LanguageContext';
//   const { language } = useLanguage();
//   <span>{t('sidebar.dashboard', language)}</span>
// -----------------------------------------------------------------------------

import en from './en';
import vi from './vi';

const translations = { en, vi };

export function t(key, language = 'vi') {
  const lang = translations[language] || translations.vi;
  if (lang[key] !== undefined) return lang[key];
  if (translations.en[key] !== undefined) return translations.en[key];
  return key;
}

export { en, vi };
