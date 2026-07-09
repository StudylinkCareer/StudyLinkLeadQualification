# StudyLink DEV → PROD Cutover Runbook

_Last updated: 2026-06-30. Branch state at writing: `rename-unique-id-to-student-id` is **4 commits ahead** of `origin/main`; `origin/main` is **8 commits ahead** of the dev branch (Deep Cleanse, Weekly Report, Zalo verifier — already on PROD). **A merge is required — not a plain push.**_

> ⚠️ **This is a one-way SCHEMA RESTRUCTURE** (person/application split, renames, destructive column drops), not a simple deploy. Allow a **proper window (2–3+ hours)**, never a rushed one. The restructure sequence was rehearsed on a fresh prod copy (4,409 persons) on 2026-06-27 and committed clean — but **re-rehearse on a fresh snapshot before touching live**, because 4 new migrations have been added since.

---

## 0. Pre-flight (do NOT skip)
1. **Fresh PROD DB backup** with `pg_dump`, stored safely, and **verify it restores** into a scratch DB. This is your only rollback for the destructive drops.
2. **Re-rehearse**: restore the fresh prod dump into an EMPTY db (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` first; drop any leftover `backup` schema), run the full sequence in §3, and smoke-test (§5). Only proceed to live once the rehearsal is clean.
3. Pick a **low-traffic window**; tell staff the console will be briefly unavailable.

## 1. Reconcile & merge the code (git)
1. Commit the Zalo work on the dev branch (see the commit command provided separately).
2. Merge `origin/main` **into** the dev branch to pick up its 8 commits:
   ```
   git checkout rename-unique-id-to-student-id
   git fetch origin
   git merge origin/main
   ```
3. **Resolve conflicts** (Deep Cleanse + the restructure both touched many files — expect some). When done, confirm BOTH frontends still build (`npm run build` in `LeadManagement/` and `Client/`).
   - **KEEP** the Zalo domain-verification `<meta name="zalo-platform-site-verification" content="UCNb6xBLVm1KqVK2rTjI6I-ewXt3tZ12CJOs">` tag in **both** `Client/index.html` and `LeadManagement/index.html`, plus the verifier file in `Client/public/`. (Also keep the personal app's existing meta tag in `Client/index.html`.)
4. Fast-forward `main` to the merged result, then push (this triggers PROD deploy — do it AFTER the DB is migrated, §3):
   ```
   git checkout main
   git merge rename-unique-id-to-student-id   # should fast-forward
   ```

## 2. PROD environment variables (Railway)
- **Re-mint a fresh OA token** — the dev tokens were typed in chat during setup, so don't reuse them. Run `node scripts/zaloMintToken.js <code>` with a fresh permission code, then set on Railway:
  - `ZALO_APP_ID`, `ZALO_APP_SECRET`
  - `ZALO_OA_ACCESS_TOKEN`, `ZALO_OA_REFRESH_TOKEN`
  - `ZALO_SEND_METHOD=zns`
  - `ZALO_ZNS_TEMPLATE_ID=601036`
- Confirm the LM frontend's `VITE_LQ_BASE_URL` = `https://slcareerguidance.netlify.app` (the badge-link target).

## 3. DB migrations on PROD — run in THIS EXACT ORDER
Backup first (§0). Each command: `node src/migrations/<name>.js --allow-remote`
**Before EACH run, double-check `DATABASE_URL` points to the intended PROD DB** (the `--allow-remote` flag bypasses the localhost safety guard).

**Proven restructure sequence** (rehearsed 2026-06-27, clean):
1. `splitPersonApplication`
2. `renameUniqueIdToStudentId`
3. `renameApplicationsToLeads`
4. `addLeadFields`
5. `addStudentStatus`
6. `addStudentStatusDerivation`
7. `dropRedundantLeadColumns`
8. `backfillAuditLeadId`
9. `addDuplicateReviews`
10. `dropStudentEngagementColumns`  ← **A4: destructive (drops 15 columns). Run LAST, only after §5 smoke test passes.**
11. `addLeadFieldsToColumnCatalog`

**New since the 2026-06-27 rehearsal (this session) — additive; run AFTER the restructure so `leads` exists; rehearse on a snapshot first:**
- `addLifecycleDates`        (assigned_in/out, actual_close_date, cancellation_date columns + triggers)
- `backfillLifecycleDates`   (backfill those from audit history)
- `renameCatalogLabels`      (Sales ID / Projected close date labels)
- `createZaloTokens`         (zalo_oauth_tokens table for the token auto-refresh)

**Idempotent extras** (anytime; no-ops if already present): `addMonthlyTargets`, `addBadgeZaloSentAt`
**Data hygiene** (dry-run by default; post-split only): `purgeJunkRows`, `mergeDuplicateStudents`, `purgeStudentOrphans`

> Note: order step 10 (`dropStudentEngagementColumns`) carefully — it reconciles students→leads then drops columns. Do it only once the merged app has been smoke-tested against the migrated data.

## 4. Deploy
- Push merged `main` → Railway (server) + Netlify (both frontends) auto-deploy.
- Confirm all three builds succeed.

## 5. Smoke test PROD
- Log in to the LM console.
- Leads list: loads; columns / filters / sort / drag-reorder; the new lifecycle date columns.
- Lead detail (`/lead/:id`) and Student detail (`/students/:id`); SALES chip; labels (Sales ID, Projected close date).
- Events page + check-in stats/filters; **"Send via Zalo"** button (manual fallback until the template is approved).
- Deep Cleanse still works (it's on PROD already — confirm the merge didn't break it).
- Create a lead (seed-on-create), Recalculate Risk.

## 6. Zalo go-live (after Zalo approves template `601036`, ~2–3 days)
- Confirm Railway has the Zalo env vars (§2).
- `node scripts/zaloTest.js <a-phone>` → expect `"sent": true`.
- The Event Console "Send via Zalo" button is then one-click live.

## 7. Rollback
- Because the restructure is destructive, rollback = **restore the §0 backup** + redeploy the previous `main` commit. (You cannot reverse-migrate the drops.) This is why the verified backup in §0 is non-negotiable.
