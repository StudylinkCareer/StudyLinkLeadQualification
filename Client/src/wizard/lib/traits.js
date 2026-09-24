// Career-result trait bars. Order follows the design: E, A, C, N, O.
// Score per trait is the stored sum of 3 questions (3–15); the bar shows (sum−3)/12.
// Pole labels are the wording agreed with the owner (Openness: "Truyền thống ↔ Sáng tạo");
// Hoàng / Ms. Hà can still adjust them here in one place.
export const TRAITS = [
  { key: 'extraversion',      field: 'oceanExtraversion',      vi: { name: 'Hướng ngoại', left: 'Hướng nội',   right: 'Hướng ngoại' },
                                                                 en: { name: 'Extraversion', left: 'Introverted', right: 'Extraverted' } },
  { key: 'agreeableness',     field: 'oceanAgreeableness',     vi: { name: 'Dễ chịu',     left: 'Cạnh tranh',  right: 'Hòa hợp' },
                                                                 en: { name: 'Agreeableness', left: 'Competitive', right: 'Harmonious' } },
  { key: 'conscientiousness', field: 'oceanConscientiousness', vi: { name: 'Tận tâm',     left: 'Linh hoạt',   right: 'Kỷ luật' },
                                                                 en: { name: 'Conscientiousness', left: 'Flexible', right: 'Disciplined' } },
  { key: 'neuroticism',       field: 'oceanNeuroticism',       vi: { name: 'Nhạy cảm',    left: 'Điềm tĩnh',   right: 'Nhạy cảm' },
                                                                 en: { name: 'Sensitivity', left: 'Calm', right: 'Sensitive' } },
  { key: 'openness',          field: 'oceanOpenness',          vi: { name: 'Cởi mở',      left: 'Truyền thống', right: 'Sáng tạo' },
                                                                 en: { name: 'Openness', left: 'Traditional', right: 'Creative' } },
];

export const traitPercent = (sum) => {
  const n = Number(sum);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(((n - 3) / 12) * 100)));
};
