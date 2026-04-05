import en from './en';
import vi from './vi';

const translations = { en, vi };

/**
 * Get a translated string by key.
 * Usage: t('emailLabel', language) → 'Email Address' or 'Địa chỉ Email'
 * Falls back to English, then to the key itself.
 */
export function t(key, language = 'vi') {
  const lang = translations[language] || translations.vi;
  if (lang[key] !== undefined) return lang[key];
  if (translations.en[key] !== undefined) return translations.en[key];
  return key;
}

export { en, vi };
