import { useMemo } from 'react';
import { useLookup } from '../../contexts/LookupContext';
import { DESTINATION_COUNTRIES_GROUPED } from '../../utils/formFields';

const REGION_ORDER = ['Australasia', 'Europe', 'North America', 'Asia', 'Other'];

// Country chips come from the `country` lookup (grouped by meta.region) — the same
// source the legacy Study tab and LeadManagement use — so the list is never hardcoded
// here. The old hardcoded list is only a fallback if the lookup failed to load.
export function useCountryGroups(language) {
  const countries = useLookup('country');
  return useMemo(() => {
    if (!countries.length) {
      return DESTINATION_COUNTRIES_GROUPED.map((g) => ({
        region: g.region,
        countries: g.countries.map((c) => ({ value: c, label: c })),
      }));
    }
    const byRegion = new Map();
    for (const item of countries) {
      const region = (item.meta && item.meta.region) || 'Other';
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region).push({
        value: item.code,
        label: language === 'vi' ? (item.labelVi || item.code) : (item.labelEn || item.code),
      });
    }
    for (const arr of byRegion.values()) arr.sort((a, b) => a.label.localeCompare(b.label));
    const known = REGION_ORDER.filter((r) => byRegion.has(r));
    const extra = [...byRegion.keys()].filter((r) => !REGION_ORDER.includes(r));
    return [...known, ...extra].map((r) => ({ region: r, countries: byRegion.get(r) }));
  }, [countries, language]);
}
