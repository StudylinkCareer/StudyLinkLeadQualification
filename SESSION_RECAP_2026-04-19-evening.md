# StudyLink i18n — Phase 2b finishing + LQ narrative alignment + crisis recovery

**Session date:** 2026-04-19 (evening, following earlier same-day Phase 2b session)
**User:** Rhod (novice programmer on Windows/VS Code, GitHub web UI pencil-edit workflow)
**Repos:** `StudylinkCareer/StudyLinkLeadQualification` (monorepo — `Client/` = LQ student app, `LeadManagement/` = LM console, `Server/` = shared backend)

## What was accomplished

### Final Phase 2b files delivered and deployed
Completed the last two page files from the morning's Phase 2b work:
- **Leads.jsx** — translated filter pills, column headers, toolbar, pagination, mass-assign bar, confirm dialogs. Filter dropdowns show translated values; table cells kept English by user's explicit choice to avoid wrapping.
- **LeadDetail.jsx** — translated every section (lead status, student info, self assessment, career fit, family contacts, notes, change history, summary panel, staff assignment). Dropdown option values render bilingual in edit mode. OCEAN questions section wired up for language-reactive display.

All deployed successfully. User confirmed "Meeting expectations" after LeadDetail.

### LQ ↔ LM translation consistency — the big lesson
User reported translations were working in LM but asked about consistency with LQ. Investigation revealed an embarrassing oversight: the authoritative native-speaker VN translations for shared content lived in files I hadn't originally searched.

**What was actually in the codebase (but I missed initially):**
- `Server/src/controllers/studentController.js` lines 107–166 — the full `NARRATIVE_PHRASES` object with native-VN OCEAN narrative phrases for all 5 traits × 3 levels, plus language-specific template sentences. Used by the server when calculating OCEAN for an LQ student.
- `client/src/i18n/vi.js` lines 299–318 — canonical stone names (`stone_Quartz` = "Thạch Anh", `stone_Diamond` = "Kim Cương", etc. using Title Case) and full motivational messages (`stoneSubtitle_*`).
- `client/src/i18n/vi.js` lines 214–229 — all 15 OCEAN questions translated.

**Correction path:** Created three new LM utility files that mirror the LQ's authoritative translations verbatim:
- `LeadManagement/src/utils/oceanNarrative.js` — localized narrative regenerated on-the-fly from scores. Ignores the stored `ocean_narrative` DB field entirely (which is still saved by the server in English). Exports `generateLocalizedNarrative(scores, language)`.
- `LeadManagement/src/utils/stoneMessages.js` — full motivational message per stone per language. Exports `stoneMessage(tier, language)`.
- `LeadManagement/src/utils/oceanQuestions.js` — all 15 questions in both languages. Exports `oceanQuestion(id, language)` and `oceanQuestionList(language)`.
- Also **updated** `LeadManagement/src/utils/stoneLabels.js` — stone names changed from sentence case ("Kim cương") to LQ canonical Title Case ("Kim Cương") and "Lam ngọc" corrected to "Ngọc Bích" for Sapphire. User explicitly chose the robust consistency option over leaving existing stoneLabels alone.

**LeadDetail.jsx edits required (surgical):**
1. Added three imports (`generateLocalizedNarrative`, `stoneMessage`, `oceanQuestionList`)
2. Deleted the hardcoded `STONE_MESSAGES` object (was English-only paraphrase, not canonical)
3. Deleted the hardcoded `OCEAN_QUESTIONS` array
4. Changed `{STONE_MESSAGES[lead.stoneTier]}` → `{stoneMessage(lead.stoneTier, language)}`
5. Changed `{OCEAN_QUESTIONS.map(...)}` → `{oceanQuestionList(language).map(...)}`
6. Changed `{oceanResult.narrative}` → `{generateLocalizedNarrative(oceanResult.scores, language)}`

### Crisis recovery — LQ Dashboard overwrite incident
Near session end, user reported the LQ app's Netlify build was failing:
```
Could not resolve "../contexts/AuthContext" from "src/pages/Dashboard.jsx"
file: /opt/build/repo/Client/src/pages/Dashboard.jsx
```
**Diagnosis:** User had accidentally pasted the LM Dashboard.jsx into `Client/src/pages/Dashboard.jsx` on GitHub (committed ~3 hours earlier with message "Changing Layout of Dashboard"). The LM Dashboard imports `useAuth` from `../contexts/AuthContext`, but LQ uses `../hooks/useAuth` — different architectures. LM content in LQ location = unresolvable imports = build failure.

**Recovery path (that worked):**
1. User navigated to the bad commit on GitHub (26b1ba2)
2. Clicked parent commit link (5007c66) — last known good state
3. Browse files at that commit → navigated to Client/src/pages/Dashboard.jsx
4. Copied raw content → pasted over the broken file on main branch → committed
5. Netlify rebuild succeeded

## Architecture summary at end of session

### LM translation infrastructure (complete)
```
LeadManagement/src/
├── contexts/LanguageContext.jsx      -- provider, browser auto-detect, VN default, localStorage key 'studylink_lm_language'
├── components/LanguageSelector.jsx   -- VN/UK flag buttons
├── i18n/
│   ├── en.js                          -- ~354 translation keys
│   ├── vi.js                          -- matching 354 keys
│   └── index.js                       -- t(key, language) helper with EN fallback
├── utils/
│   ├── leadStatusLabels.js            -- lead status translations (existed before this session)
│   ├── stoneLabels.js                 -- stone tier translations (LQ-canonical Title Case)
│   ├── stoneMessages.js               -- NEW: full motivational messages, LQ-authoritative VN
│   ├── oceanNarrative.js              -- NEW: on-the-fly narrative generator, LQ-authoritative VN
│   ├── oceanQuestions.js              -- NEW: 15 questions in both languages
│   └── optionLabels.js                -- 14 dropdown option groups, bilingual
└── pages/ (all translated)
```

### What stays English (by design)
- DB values — lead statuses, stone tiers, dropdown values all stored as English canonical strings. This preserves filter/sort/search/comparison integrity across languages.
- Table cell values on Leads page — user chose English cells to avoid wrapping issues in narrow columns.
- OCEAN radar chart SVG labels — space-constrained, kept as English abbreviations (Extraversion, Agree., Conscient., Neurotic., Open.)
- Counselor names, staff names, student-entered data — user data is never translated.
- `ocean_narrative` DB column — now effectively dead weight in LM (regenerated on-the-fly); server still writes it in English for legacy reasons. User agreed to leave cleanup for later.

### What follows LQ's canonical translations
- Stone names: Kim Cương, Hồng Ngọc, Ngọc Bích, Mã Não, Thạch Anh, Chưa chấm điểm
- Stone motivational messages: verbatim from `client/src/i18n/vi.js` `stoneSubtitle_*` keys
- OCEAN narrative: verbatim from `Server/src/controllers/studentController.js` `NARRATIVE_PHRASES`
- OCEAN 15 questions: verbatim from `client/src/i18n/vi.js` `ocean_q1`..`ocean_q15`

## Pending / future work

1. **Translation lexicon table** (delivered alongside this journal entry) — spreadsheet for staff members to update translations without touching code. Would need a small refactor later to pull translations from the spreadsheet at build time if user wants that workflow.
2. **`ocean_narrative` DB column cleanup** — column is still written by server but not read by LM. Safe to drop eventually. Low priority.
3. **`optionLabels.js` native speaker review** — bulk of dropdown option VN translations were my first-pass, not yet reviewed by the team's native speaker. User has native VN speaker on team who did the LQ's critical translations — same person could review this one file.
4. **`leadStatusLabels.js` review** — similar; pre-existed this session, may or may not have had native speaker review.

## User characteristics (carry forward)

- Novice programmer, impatient with long prose, prefers files-first delivery with concise explanations
- Uses GitHub web UI pencil-edit workflow — does not use local git or CLI
- Deploys via Netlify (LM at sl-leadmanagement.netlify.app; LQ at its own Netlify site) + Railway (backend)
- Frequently forgets hard-refresh after deploy — browser cache gaslighted him at least twice this session
- Gets anxious during silence — appreciates quick ack messages between file deliveries
- Accepts clear recommendations with reasoning over open-ended "what would you like"
- Learned during this session about GitHub commit reverts and file history recovery

## Key paths reference

- LM frontend: `LeadManagement/src/...` — pages/, components/, contexts/, utils/, i18n/
- LQ frontend: `Client/src/...` — pages/, components/, contexts/, hooks/, utils/, i18n/
- Backend: `Server/src/...`
- LQ and LM deploy to separate Netlify sites from the same monorepo; Railway auto-deploys backend
- Both apps auto-build on push to main; hard-refresh always required after deploy
