import { useState, useEffect } from 'react';
import TierSelector from '../Form/TierSelector';
import { getTranslatedAssessmentFields, STONE_TIERS } from '../../utils/formFields';
import { calculateRiskScore } from '../../utils/riskCalculator';
import { studentAPI } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';
import quartzImg from '../../Assets/Stones/quartz.png';
import agateImg from '../../Assets/Stones/agate.png';
import sapphireImg from '../../Assets/Stones/sapphire.png';
import rubyImg from '../../Assets/Stones/ruby.png';
import diamondImg from '../../Assets/Stones/diamond.png';
import gradcapImg from '../../Assets/gradcap.png';

const STONE_IMAGES = {
  Quartz: quartzImg,
  Agate: agateImg,
  Sapphire: sapphireImg,
  Ruby: rubyImg,
  Diamond: diamondImg,
};

export default function SelfAssessmentTab({ formData, updateField, saving, lastSaved, saveAll }) {
  const { language } = useLanguage();

  const [riskResult, setRiskResult] = useState(() => {
    if (formData?.stoneTier && formData?.riskScore) {
      const tier = STONE_TIERS.find((s) => s.name === formData.stoneTier);
      return tier ? { stoneTier: formData.stoneTier, totalScore: Number(formData.riskScore) } : null;
    }
    return null;
  });

  const [calculating, setCalculating] = useState(false);

  // Re-hydrate the stored risk result when a DIFFERENT record loads (returning-student
  // retrieval). The useState initializer above captures formData only at mount, so a
  // record whose risk data arrives afterward would otherwise show no result banner.
  // Keyed on studentId so it fires on load/retrieve, not on every in-session keystroke.
  useEffect(() => {
    // Show the stored result whenever a tier + score exist. The banner does its own
    // STONE_TIERS lookup with a fallback, so don't gate on the lookup succeeding here.
    if (formData?.stoneTier && formData?.riskScore) {
      setRiskResult({ stoneTier: formData.stoneTier, totalScore: Number(formData.riskScore) });
    } else {
      setRiskResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.studentId]);

  const liveScore = calculateRiskScore(formData);
  const translatedFields = getTranslatedAssessmentFields(language);

  const handleField = (name, value) => {
    updateField(name, value);
    setRiskResult(null);
  };

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      if (saveAll) await saveAll();

      let result;
      if (formData?.studentId) {
        const res = await studentAPI.calculateRisk(formData.studentId);
        result = res.data;
      } else {
        result = liveScore;
      }

      if (result) {
        updateField('riskScore', String(result.totalScore));
        updateField('stoneTier', result.stoneTier);
        if (saveAll) await saveAll();
      }

      setRiskResult(result);
      // Scroll to banner after result
      setTimeout(() => {
      document.querySelector('.assessment-banner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err) {
      console.error('Calculate risk failed:', err);
      const fallback = liveScore;
      updateField('riskScore', String(fallback.totalScore));
      updateField('stoneTier', fallback.stoneTier);
      if (saveAll) await saveAll();
      setRiskResult(fallback);
      // Scroll to banner after result
      setTimeout(() => {
      document.querySelector('.assessment-banner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('selfAssessmentTitle', language)}</h2>
        <div className="save-status">
          {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              {t('savedAt', language)} {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Banner: prompt before assessment, stone image + per-stone message after */}
      {riskResult ? (() => {
        const tier = STONE_TIERS.find((s) => s.name === riskResult.stoneTier) || STONE_TIERS[0];
        return (
          <div className="assessment-banner assessment-banner--result">
            <img
              src={STONE_IMAGES[tier.name]}
              alt={tier.name}
              className="assessment-banner-stone-img"
            />
            <span className="assessment-banner-text">{t(`stoneSubtitle_${tier.name}`, language)}</span>
          </div>
        );
      })() : (
        <div className="assessment-banner assessment-banner--prompt">
          <img src={gradcapImg} alt="" className="assessment-banner-gradcap" />
          <span className="assessment-banner-prompt-text">{t('assessmentBannerPrompt', language)}</span>
        </div>
      )}

      <div className="assessment-fields">
        {translatedFields.map((field) => (
          <TierSelector
            key={field.key}
            label={field.label}
            description={field.description}
            name={field.key}
            value={formData[field.key]}
            onChange={handleField}
            tiers={field.tiers}
            weight={field.weight}
          />
        ))}
      </div>

      <div className="assessment-actions">
        <button
          className="btn btn--primary btn--lg"
          onClick={handleCalculate}
          disabled={calculating}
        >
          {calculating ? t('calculating', language) : t('calculateRiskScore', language)}
        </button>
      </div>

    </div>
  );
}
