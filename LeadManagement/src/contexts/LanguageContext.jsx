// src/contexts/LanguageContext.jsx
// -----------------------------------------------------------------------------
// Provides the current UI language ('en' or 'vi') to the whole Lead Management
// console. Works like the Lead Qualification app's LanguageContext, with two
// differences:
//   1. On first load it auto-detects from the browser (navigator.language).
//      If the browser reports Vietnamese it picks 'vi', otherwise it falls
//      back to 'vi' (team is Vietnam-based — Vietnamese default).
//   2. After first pick, the user's explicit choice from the toggle is
//      persisted to localStorage and takes priority on future visits.
// -----------------------------------------------------------------------------

import { createContext, useContext, useState } from 'react';

const LanguageContext = createContext();

const STORAGE_KEY = 'studylink_lm_language';

function detectInitialLanguage() {
  // 1. Honour an explicit previous choice.
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'vi') return saved;
  } catch {
    // localStorage may throw in private mode — ignore and fall through.
  }

  // 2. Auto-detect from browser. navigator.language returns e.g. 'en-US' or 'vi-VN'.
  try {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    if (nav.startsWith('vi')) return 'vi';
  } catch {
    /* ignore */
  }

  // 3. Default — team is Vietnam-based, so Vietnamese.
  return 'vi';
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(detectInitialLanguage);

  const setLanguage = (lang) => {
    setLanguageState(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
