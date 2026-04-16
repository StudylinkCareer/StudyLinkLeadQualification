const renderFamilyDetailInput = (pfx, medium, ccField, detailField) => {
    if (!medium) {
      return (
        <input
          className="form-input contact-detail-input"
          type="text"
          value=""
          disabled
          placeholder={t('selectMediumFirst', language)}
        />
      );
    }

    if (PHONE_MEDIUMS.includes(medium) && !DUAL_MEDIUMS.includes(medium)) {
      return (
        <PhoneInput
          countryCodeName={ccField}
          numberName={detailField}
          countryCodeValue={formData[ccField] || '+84'}
          numberValue={formData[detailField] || '0'}
          onChange={updateField}
        />
      );
    }

    if (EMAIL_MEDIUMS.includes(medium) && !DUAL_MEDIUMS.includes(medium)) {
      return (
        <input
          className="form-input contact-detail-input"
          type="email"
          value={formData[detailField] || ''}
          onChange={(e) => updateField(detailField, e.target.value)}
          placeholder={`${medium} email`}
        />
      );
    }

    if (DUAL_MEDIUMS.includes(medium)) {
      const mode = getFamilyDualMode(pfx);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              type="button"
              className={`btn btn--sm ${mode === 'email' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setFamilyContactDualMode(pfx, 'email');
                updateField(ccField, 'N/A');
                updateField(detailField, '');
              }}
            >
              ✉ Email
            </button>
            <button
              type="button"
              className={`btn btn--sm ${mode === 'phone' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setFamilyContactDualMode(pfx, 'phone');
                updateField(ccField, '+84');
                updateField(detailField, '0');
              }}
            >
              📱 Phone
            </button>
          </div>
          {mode === 'email' ? (
            <input
              className="form-input contact-detail-input"
              type="email"
              value={formData[detailField] || ''}
              onChange={(e) => updateField(detailField, e.target.value)}
              placeholder={`${medium} email`}
            />
          ) : (
            <PhoneInput
              countryCodeName={ccField}
              numberName={detailField}
              countryCodeValue={formData[ccField] || '+84'}
              numberValue={formData[detailField] || '0'}
              onChange={updateField}
            />
          )}
        </div>
      );
    }

    // Plain text
    return (
      <input
        className="form-input contact-detail-input"
        type="text"
        value={formData[detailField] || ''}
        onChange={(e) => updateField(detailField, e.target.value)}
        placeholder={t('enterDetails', language).replace('{medium}', medium)}
      />
    );
  };