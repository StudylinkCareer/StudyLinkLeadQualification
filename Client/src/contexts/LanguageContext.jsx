import { createContext, useContext, useState } from 'react';

const LanguageContext = createContext();

const STORAGE_KEY = 'studylink_language';

export function LanguageProvider({ children }) {
  // FIX 1: Always default to Vietnamese — never read from localStorage on load.
  // The user's choice is still saved during their session via setLanguage,
  // but the app will always open in Vietnamese regardless of previous visits.
  const [language, setLanguageState] = useState('vi');

  const setLanguage = (lang) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
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
