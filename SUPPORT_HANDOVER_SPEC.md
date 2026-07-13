# StudyLink Lead Management System — Technical Handover Specification

**Audience:** Incoming support / maintenance engineer
**Date:** 13 July 2026
**Scope:** The complete system — PostgreSQL database, backend API, the **LQ** (customer intake) app, the **LM** (staff) console, and the GitHub / deployment / infrastructure layer, including **every LM console sidebar option**.

> This document was assembled from a full read of the codebase and a **read-only** inspection of the live database schema. Where behaviour is surprising or fragile it is flagged in **§9 Known Issues & Caveats** — skim that section early, it will save you time.

---

## Table of Contents

1. System Overview
2. Key Concepts & Glossary (the domain model)
3. Repository, Deployment & Environment
4. Database (PostgreSQL)
5. Backend (Server / API)
6. LQ App (Customer Intake)
7. LM Console (Staff) — every sidebar option
8. Operational Runbook (common support tasks)
9. Known Issues, Caveats & Tech Debt
10. Support Quick Reference

---

## 1. System Overview

**StudyLink Lead Management System (LMS)** is a single application — **one GitHub monorepo** — that delivers **three capabilities** to StudyLink, an overseas-study consultancy operating in Vietnam:

1. **The LQ App (Lead Qualification / customer intake)** — `Client/`, hosted at **`slcareerguidance.netlify.app`**. The public, customer-facing web app. Prospective students (and staff at events) register interest; it captures contact + study preferences, runs a **risk self-assessment** (producing a "Stone Tier" grade), a **15-question OCEAN personality assessment** (producing a Big-Five profile + career-fit archetype), and handles **event check-in** (desk kiosks, QR badges, profile completion).

2. **The LM Console (Lead Management / staff)** — `LeadManagement/`, its own Netlify site. The internal staff app. Staff work the sales pipeline here: view/filter leads, move records across workflow **phases**, assign owners, run activity/weekly reports, manage marketing events + event check-in, run lead distribution, edit reference data, and administer staff. **Every sidebar menu is documented in §7.**

3. **The Backend + Database** — `Server/`, a **Node/Express REST API** hosted on **Railway**, backed by **PostgreSQL** (Railway Postgres). Both frontends talk to this one API. It owns authentication, the RBAC permission model, all business logic, and integrations (Google Drive, Google Apps Script email, Zalo/ZNS messaging).

The three parts share **one database** and **one API**; the two frontends are separate React (Vite) SPAs. A single `git push` to `main` redeploys all of it (§3.4).

**How to read this doc:** §2 is a plain-English primer on the business/data model — read it first, everything else assumes it. §3–§7 are the technical deep-dives (infra, DB, API, LQ, console). §8 is the "how do I do X" runbook. §9 is the list of landmines. §10 is a one-page cheat sheet.

---

## 2. Key Concepts & Glossary (the domain model)

The single most important thing to understand is the **connected-unit / "1 Sale : Many Leads"** model. Internalise this before touching anything.

- **Sale / Sales Order = a `students` row.** Despite the table name, a `students` row represents the **person and their overall order/relationship** with StudyLink. Its business key is `student_id` (e.g. `20260420-905`). All **identity, family, self-assessment (risk), and OCEAN personality** data lives here and is **shared by every Lead beneath it**.

- **Lead = a `leads` row = one engagement.** A person can have **many** leads over time (e.g. they enquire, go cold, come back). `leads.person_id → students.student_id`. A lead carries the **workflow** fields: `lead_status`, `confidence`, `close_date`, staff owner, and the "ask" (intake, degree, institution, destination, timeline).

- **Active vs closed lead.** A lead is **active** if `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`. Those four are terminal. **Reports show active leads only.** This predicate appears everywhere — memorise it.

- **Phase / department = `students.order_phase`.** The phase a Sale currently sits in, **derived from the position of its current owner**: `Marketing`, `Presales`, `Counselling`, `Pool`, `Case Officers`, `Business Development`, `Support`. **Phase governs reporting visibility** — a counsellor only sees Sales in the `Counselling` phase. **`Pool`** is the holding/queue state (unowned or awaiting routing). Only **Counselling** and **Pool** are fully built out; the others are reserved/partial.

- **Ownership = `order_assignments` slots.** The canonical owner record: PK `(student_id, position)`, one owner per Sale × staff position. Four legacy positions (`counselor`, `senior_counselor`, `presales`, `marketing_staff`) still mirror down to columns on `students`/`leads` for old reporting. **Staff are referenced by name string, not by FK** — a known fragility (§9).

- **The 3-way returning-student rule (LQ intake).** When someone logs into the LQ app, the backend checks for an existing Sale by email/phone:
  - **Case 1** — existing Sale **with** an active lead → *retrieve & edit* it (no new lead).
  - **Case 2** — existing Sale, **no** active lead → *create a new lead* on the existing Sale.
  - **Case 3** — no match → *create a new student + lead*.
  - (Plus `conflict` = multiple active matches → user picks one; `counselor` = a staff member logging in.)

- **The ownership rule at registration.** When the LQ app creates a lead: if a **Counsellor is named** → phase `Counselling`, Counselor slot = that name; if **blank** → phase `Pool`, Quality slot = **`Mạch Nguyễn Phi Vân`** (the Data-Quality owner who holds the Pool).

- **Risk / Stone Tier.** A weighted score over self-assessment fields → a gemstone grade: **Quartz** (40–75), **Agate** (76–105), **Sapphire** (106–135), **Ruby** (136–165), **Diamond** (166–200). Stored on the **student**.

- **OCEAN.** A 15-question Big-Five personality assessment → 5 dimension scores + an **archetype** + narrative + career-fit suggestions. Stored on the **student** (`ocean_*`).

- **RBAC = authorisation profiles.** Each staff member has a **profile** (e.g. `Staff, Counsellor`, `Lead, Pre-sales`, `CEO`) that maps to a set of `(resource, operation) → scope` grants, where **scope ∈ `none` / `own` / `all`**. Enforced both server-side (route + controller) and client-side (menu visibility + field masking). See §5.4 and §7.18.

**Mini-glossary:** *LQ* = Lead Qualification (customer app). *LM* = Lead Management (staff console). *Sale / Sales Order* = a `students` row. *Lead* = an engagement row. *Phase* = the department a Sale sits in. *Pool* = the unowned holding queue. *Stone Tier* = risk grade. *Profile* = an RBAC role. *Slot* = an `order_assignments` (position, owner) pair.

---

## 3. Repository, Deployment & Environment

The project is a **single Git monorepo** containing three deployable applications plus a shared database migration set. Repo root: `C:\Users\rhod_\Documents\StudyLinkLeadQualification`. GitHub remote: `origin → https://github.com/StudylinkCareer/StudyLinkLeadQualification.git`.

### 3.1 Repo layout

Three apps live side-by-side under the repo root. Each has its own `package.json`, `node_modules`, and build config; there is no workspace/turbo tooling tying them together (the root `package.json` is a near-empty stub declaring only `csv-parse`).

| App | Path | Stack | Role | Dev port |
|-----|------|-------|------|----------|
| **Server** | `Server/` | Node + Express, PostgreSQL (`pg`), Redis sessions | Backend REST API for both frontends | **5000** (`Server/.env` `PORT`) |
| **Client** | `Client/` | Vite 6 + React 18, react-router 7 | LQ customer-facing intake (career-guidance / lead-qualification form, QR/badge landing, profile completion) | **3000** (`Client/vite.config.js`) |
| **LeadManagement** | `LeadManagement/` | Vite 5 + React 18, react-router 6, dnd-kit, tanstack-table | Internal staff console (lead pipeline, event console, reports, Create-Sales launcher) | **3001** (`LeadManagement/vite.config.js`) |

**Scripts** (identical pattern across the two frontends):
- **Server** (`Server/package.json`): `start` = `node src/server.js` (production entrypoint, used by Railway), `dev` = `nodemon src/server.js`.
- **Client / LeadManagement**: `dev` = `vite`, `build` = `vite build`, `preview` = `vite preview`.

**Dev proxying:** both frontends proxy `/api` → `http://localhost:5000` in dev (`Client/vite.config.js`; `LeadManagement/vite.config.js`), so the local backend must be running on 5000. Client binds `host: '0.0.0.0'` (LAN-accessible for phone/QR testing). A convenience launcher `start-dev-system.bat` and `Server/nodemon.json` support local dev.

**Backend source** (`Server/src/`): `server.js` (entry) → `app.js` (Express wiring, CORS, Redis/file session store, route mounting) → `config/index.js` (env → config object). Routes under `Server/src/routes/`, services under `Server/src/services/`, models under `Server/src/models/`.

**Database migrations:** `Server/Migrations/` (capital **M**). It holds ordered `.sql` files (`001_*` … `006_*`) and many hand-run `.js` migration scripts (e.g. `addLeadAssignmentDates.js`, `addBusinessDevPhase.js`, `reconcileStaffSlots.js`, `authProfiles_up.js`). Each `.js` migration reads `DATABASE_URL`/`NODE_ENV` directly and is **run manually** against the target DB (consistent with the "operator runs state-changing commands themselves" workflow).

### 3.2 Deployment topology

```
   GitHub: StudylinkCareer/StudyLinkLeadQualification (branch: main)
        |                    |                         |
   git push → auto-deploy on each hosted service:
        |                    |                         |
   ┌────▼─────┐      ┌───────▼────────┐        ┌───────▼─────────┐
   │ Railway  │      │ Netlify (x2)   │        │ Netlify (x1)    │
   │ Server   │      │ Client / LQ    │        │ LeadManagement  │
   │ Node svc │◄─────│ intake site    │        │ staff console   │
   │ + Railway│ /api │ (2 sites, same │  /api  │                 │
   │ Postgres │◄─────│  repo)         │◄───────│                 │
   └──────────┘      └────────────────┘        └─────────────────┘
        ▲  Redis sessions
```

- **Backend → Railway.** A Node service running `npm start` (`node src/server.js`), connected to **Railway-hosted PostgreSQL** (`DATABASE_URL`) and Redis (`REDIS_URL`, for the express-session store). Public URL: `https://studylinkleadqualification-production.up.railway.app`. This URL is hard-referenced as the API target in the Netlify redirects and as the fallback `PUBLIC_BASE_URL`.
- **Frontends → Netlify.** Static SPA builds (`vite build` → `dist/`).
  - **LeadManagement** ships `LeadManagement/netlify.toml`: `command="npm run build"`, `publish="dist"`; a proxy redirect `/api/* → https://…railway.app/api/:splat` (200, `force`); SPA catch-all `/* → /index.html` 200.
  - **Client** has **no `netlify.toml`** — it uses `Client/public/_redirects` with the same two rules. Client also ships Zalo domain-verification files in `Client/public/`.
  - Netlify build env supplies the `VITE_*` values baked in at build time (§3.5).

### 3.3 The two LQ (Client) Netlify sites — IMPORTANT

The **Client / LQ intake app builds to two separate Netlify sites**, both auto-deploying from the **same repo + `main` branch**:

| Site | Status | Referenced by |
|------|--------|---------------|
| **`slcareerguidance.netlify.app`** | **CANONICAL** — the one LQ URL other systems point at | Backend CORS (`CORS_ORIGIN`); Zalo profile links (`Server/src/services/zaloService.js`); the console's `VITE_LQ_BASE_URL` for event QR/badges/Create-Sales button |
| **`studylinkindex.netlify.app`** | **REDUNDANT DUPLICATE** — not referenced anywhere in code/config/CORS/Zalo; a leftover second site building the identical bundle. **Candidate for deletion.** | (none) |

Because both build from `main` they stay byte-identical, which masks the redundancy. Before deleting `studylinkindex`, confirm no external QR codes / printed collateral / Zalo templates point at it (everything in this codebase targets `slcareerguidance`) and that it has no custom domain. The **console (LeadManagement)** is its own, third Netlify site.

### 3.4 Git workflow & deploy steps

- **Remote:** `origin` = `github.com/StudylinkCareer/StudyLinkLeadQualification.git`.
- **Branches:** `main` (**= production**), plus feature branches (`auth-profiles`, `deep-cleanse`, `rename-unique-id-to-student-id`, `weekly-cal-targets`).
- **Deploy = `git push` to `main`.** No separate deploy step or CI: pushing `main` triggers **Railway** to rebuild the Server and **Netlify** (all three sites) to rebuild the frontends.
- **⚠️ Selective/partial commits are dangerous.** When committing selectively (e.g. via GitHub Desktop file-by-file staging), **all coupled Server files must ship in the same commit.** A partial commit that omitted `Server/src/models/Lead.js` caused a production **`leads_person_fk` FK error**: the atomic register transaction inserted the student on the *transaction* connection while the stale `Lead.create` (missing from the deploy) ran on a *separate pool* connection that couldn't see the not-yet-committed student row → FK failed. **Rule: when a change spans a route + model + service, commit and deploy them together.**

### 3.5 Environment variables reference

All secrets live in **gitignored `.env` files**. `.env` files present: `Server/.env` (full backend secret set), `Client/.env` (dev `VITE_API_URL`), `LeadManagement/.env` (dev `VITE_API_URL` + `VITE_LQ_BASE_URL`), `LeadManagement/.env.production` (`VITE_API_URL` = Railway URL). **In production the `.env` files are not used** — Railway supplies backend vars as service variables and each Netlify site supplies its `VITE_*` vars as build-time env.

**Frontend vars** (`import.meta.env.*`, inlined at Vite build time):

| Var | App(s) | Purpose | Configured in |
|-----|--------|---------|---------------|
| `VITE_API_URL` | Client, LeadManagement | Base URL of the Railway backend | Each Netlify site build env; dev via `.env` |
| `VITE_LQ_BASE_URL` | LeadManagement only | Canonical LQ site URL — event QR codes, badge links, Create-Sales button. Prod = `https://slcareerguidance.netlify.app` | LeadManagement Netlify build env |

**Backend vars** (`process.env.*`, Railway service variables in prod / `Server/.env` in dev):

| Var | Purpose | Notes |
|-----|---------|-------|
| `NODE_ENV` | Environment mode; drives secure cookies, `trust proxy`, session-store choice | `production` on Railway |
| `PORT` | HTTP listen port | 5000 dev; Railway injects its own |
| `DATABASE_URL` | PostgreSQL connection string | Also read directly by every `Server/Migrations/*.js` script |
| `SESSION_SECRET` | express-session signing secret | **Server refuses to boot in production if left at the dev default** |
| `SESSION_MAX_AGE` | Session cookie lifetime (ms) | Default 86400000 (24h) |
| `CORS_ORIGIN` | Comma-separated allowed origins (credentials on) | **Must include `https://slcareerguidance.netlify.app` + the console origin.** First place to look for CORS errors |
| `REDIS_URL` | Redis session store | If unset in prod → MemoryStore (warned); dev → file store |
| `PUBLIC_BASE_URL` | Backend's own public base for emailed badge-image URLs | Falls back to Railway URL |
| `SMTP_*`, `GMAIL_*`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID` | Email + Google Drive document storage | |
| `GAS_SEND_OTP_URL`, `GAS_SHEETS_URL` | Google Apps Script webhooks (OTP send, Sheets sync) | |
| `ZALO_APP_ID/SECRET`, `ZALO_OA_ACCESS/REFRESH_TOKEN`, `ZALO_ZNS_TEMPLATE_ID`, `ZALO_SEND_METHOD` | Zalo OA / ZNS event-badge delivery | Tokens DB-persisted + auto-refreshed |
| `COUNSELOR_EMAILS` | Counsellor notification recipients | |

---

## 4. Database (PostgreSQL)

The system runs on a single PostgreSQL database (dev DB `studylink_dev`; PROD is the Railway-hosted mirror). Connections go through the `pg` `Pool` using `DATABASE_URL` (SSL on in production, off on localhost). Every model file (`Server/src/models/*.js`) talks to the pool directly — **there is no ORM**. The DB stores **snake_case** columns; models translate to/from **camelCase** for the API via explicit column maps. The live DB currently holds **40 tables**.

### 4.1 The connected-unit data model (read §2 first)

- **A `students` row IS a "Sales document" / Sales Order.** PK `student_id` (text business key like `20260420-905`, generated `YYYYMMDD-NN` by `Student.generateUniqueId`). Holds identity, family, **risk** (`risk_score`, `stone_tier`), **OCEAN** (`ocean_q1..q15`, `ocean_extraversion/…/openness`, `ocean_archetype`, `ocean_narrative`), and **self-assessment** inputs (`budget`, `scholarship_demand`, `english_level`, `gpa`, `immigration_history`, `sponsor_income`, `income_evidence`, `study_plan_gap`, `ultimate_objective`), plus `order_phase`.
- **`order_assignments` holds per-Order staff slots.** PK `(student_id, position)` — one owner per Order × position (`Counselor`, `Senior Counselor`, `PreSales`, `Quality`, `Tech Support`, `Marketing Staff`, `Business Development`, `Case Officer Direct/Sub`). The **canonical owner record**. Four legacy positions mirror to columns on `students`/`leads`.
- **`leads` are the engagements** — `leads.person_id → students.student_id` (`leads_person_fk`, `ON DELETE CASCADE`), PK `lead_id` (auto-increment int). A new lead **seeds** its target fields from the person's most-recent prior lead and its staff from the Order (`Lead.create`, `SEED_FIELDS`).
- **`lead_events` records each registration/intake event** — one row per `(student_id, event_id)`, enforced by `UNIQUE (student_id, event_id)`. Keys on the **person**, not the lead.
- **Order phase / department.** `students.order_phase` (default `'Pool'`) derived from the owner's position (`utils/orderPhase.js` `syncOrderPhase → phaseForPosition`). Live distribution: Pool 2047, Counselling 1482, Presales 1066, Business Development 47, Marketing 1.

### 4.2 Active vs closed lead statuses

Active = `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`. This exact predicate drives reconciliation and reporting (`reconcileStaffSlots.js` `OPEN`; `utils/orderPhase.js` `ACTIVE_STATUSES`). Live `lead_status` distribution: Lost 1816, Not contactable 1216, Nurturing 511, Engaged 444, Archived 280, New 238, Contracted 65, Proposal 30, Vetted 17, Met with customer and family 16, Family negotiation/review 15, Cancelled 1. Blank normalises to `New`. Several lead columns are **trigger-managed / read-only** (`Lead.js` `READONLY`): `actual_close_date`, `cancellation_date`, `assigned_in`, `assigned_out`.

### 4.3 All tables (40) — one-line purpose

| Table | Rows | Purpose |
|---|---:|---|
| **students** | 4643 | The Sales Order / person record (PK `student_id`). Identity, family, OCEAN, risk, self-assessment + vestigial engagement mirror columns. |
| **leads** | 4649 | Engagements (PK `lead_id`, FK `person_id`→students). 1 Sale : Many Leads. Status, staff, target, source. |
| **lead_events** | 4003 | Per-person event registrations/intake (`UNIQUE(student_id,event_id)`) + source attribution. |
| **order_assignments** | 4763 | Per-Order staff slots. PK `(student_id, position)`. Canonical owner record. |
| **audit_log** | 63008 | Field-level change history (who/when/old→new); person-level vs lead-level via `lead_id`. |
| **student_notes** | 13231 | Notes / follow-up reminders / communications, attached to a student and optionally a `lead_id`. |
| **documents** | 0 | Document metadata (files in Google Drive); optional `lead_id`. |
| **staff** | 66 | Staff master: logon, `position`, `role`, contact platforms, targets, event-rep fields. |
| **role_permissions** | 492 | Operation-level RBAC grants: `(role, resource, operation) → scope`. Keyed by authorisation profile. |
| **role_field_permissions** | 564 | Field-level RBAC: per `(role, resource, field)` list/detail view/edit permission. |
| **permission_fields** | 112 | Catalog of permissionable fields per resource (labels, column width/order). |
| **lookup_values** | 728 | Generic reference-data table (category/subcategory/code + EN/VI labels). |
| **events** | 37 | Event/session catalog (`event_group`, `event_type`, name, dates, dedicated counsellor). |
| **event_attendees** | 37 | Event registration/attendance + badge email/Zalo delivery tracking. |
| **event_reps** | 23 | Link between a staff row and an event (kiosk token/PIN/desk). |
| **event_institutions** | 23 | Institutions present at an event, with per-desk token/PIN. |
| **event_desk_visits** | 7 | A student's visit to an institution desk (rating, note link). |
| **desk_sessions** | 16 | An institution rep's active kiosk session. |
| **institutions / partners / subagents** | 23 / 5 / 9 | Partner-institution, referral-partner, and sub-agent master lists. |
| **lead_distribution_log** | 198 | Audit of automated lead-distribution assignments. |
| **duplicate_reviews** | 0 | Queue of incoming records flagged as email/phone duplicates. |
| **phase_transitions / phase_positions / phase_transfer_exceptions** | 14 / 12 / 0 | Admin phase state-machine + editable positions per phase + blocked-transfer log. |
| **monthly_targets / target_tracked_staff / staff_office_assignments** | 1 / 6 / 11 | Sales targets, tracked-staff list, staff↔office weighting for distribution. |
| **weekly_report_snapshots / weekly_recommendations** | 9 / 7 | Frozen Monday-08:00 static Weekly Report payloads + per-week recommendations. |
| **column_config / user_variants / system_config** | 1 / 20 / 1 | Saved column layouts, per-staff saved views, generic key→JSONB config. |
| **zalo_oauth_tokens** | 1 | Single-row Zalo OA access/refresh token store with auto-refresh. |
| **students_staging / notes_staging** | 1518 / 896 | ETL staging copies of the legacy import (pre-restructure). |
| **reconcile_slot_backup / staff_profile_backup** | 3150 / 44 | Reversal snapshots for the staff-slot reconciliation and auth-profile migration. |

> **Note:** there is **no `marketing_events` table** — event data lives in `events` (catalog) + `lead_events` (per-person registrations); legacy marketing columns (`mkt_*`, `campaign_*`) survive as columns on `students`/`leads`.

### 4.4 Core table constraints & column notes

- **students** (112 physical columns, PK `student_id`). Contains a large set of **vestigial engagement columns** (`lead_status`, `counselor`, `close_date`, etc.) left behind by the person/engagement split — the **canonical engagement data of record is `leads`**, not this mirror. NOT NULL on `student_id`, `referral_source`, `source_unverified`. FK target for leads, documents, student_notes, lead_events, event_attendees, order_assignments. Model maps ~86 of the columns.
- **leads** (46 columns, PK `lead_id`). FK `person_id → students.student_id` (`leads_person_fk`, `ON DELETE CASCADE`). *Caveat:* the two NOT-NULL constraints still carry legacy names `applications_application_id_not_null` / `applications_person_id_not_null`.
- **lead_events** (PK `id`). `student_id`→students (`ON DELETE CASCADE`), `event_id`→events (nullable, `ON DELETE CASCADE`). **`UNIQUE (student_id, event_id)`** (`lead_events_student_id_event_id_key`).
- **order_assignments** (PK composite `(student_id, position)`). `staff_name` nullable (NULL/'' clears the slot). Upserted via `ON CONFLICT (student_id, position)`.
- **audit_log** (PK `id`). `student_id` (person anchor) + nullable `lead_id`→leads (`ON DELETE CASCADE`, NULL for identity-field changes). `field_name`, `old_value`, `new_value`, `changed_by`, `changed_at`, `change_source`.
- **role_permissions** (PK `id`). **`UNIQUE (role, resource, operation)`** — the upsert key. `role` holds the authorisation-**profile** name post-migration.
- **lookup_values** (PK `id`). Unique index on `(category, COALESCE(subcategory,''), code)`.
- **staff** (PK `id`). `email` **UNIQUE**. `staff_type` default `'permanent'` — `'event'` rows are synthetic and filtered out of most queries.

### 4.5 Key relationships summary

```
students (Sales Order, PK student_id)
  ├─1:N→ leads            (person_id → student_id)          [engagements]
  ├─1:N→ order_assignments(student_id, PK +position)         [staff slots]
  ├─1:N→ lead_events      (student_id, UNIQUE +event_id)     [event regs]
  ├─1:N→ student_notes    (student_id, opt lead_id)
  ├─1:N→ documents        (student_id, opt lead_id)
  └─1:N→ audit_log        (student_id, opt lead_id)
leads (PK lead_id) ←── student_notes.lead_id, documents.lead_id, audit_log.lead_id
events (PK id) ←── lead_events.event_id, event_attendees.event_id, event_reps, desk_sessions
staff (PK id) ←── event_reps.staff_id, monthly_targets.staff_id, student_notes.author_id
```

> **Fragility:** `order_assignments.staff_name` and the `leads`/`students` staff mirror columns reference staff **by name string**, not FK to `staff.id`. Duplicate/event-rep name rows are explicitly worked around in `syncOrderPhase` and `reconcileStaffSlots`.

---

## 5. Backend (Server / API)

A **Node.js / Express** REST API (PostgreSQL via `pg`, session-cookie auth). Entry point `src/server.js` → builds the app in `src/app.js` and listens on `PORT` (dev 5000). Two background services start on boot: the **Zalo delivery poller** and the **weekly-snapshot scheduler**. It serves **two front-ends** — the public LQ/student client and the internal LM staff console — via **two separate session-auth schemes** on the same server (§5.3).

### 5.1 App bootstrap & middleware (`src/app.js`, `src/config/index.js`)

Pipeline order: **CORS** (`origin: config.corsOrigin` from `CORS_ORIGIN`, `credentials: true`) → **morgan** logging → **express.json({limit:'15mb'})** (base64 photo/badge uploads) → **`trust proxy = 1`** in prod → **express-session** (secret `SESSION_SECRET`; server **exits in prod** if left at dev default; `secure`+`sameSite:'none'` in prod). **Session store**: Redis (`REDIS_URL`) in prod → file store in dev → MemoryStore fallback. A **Zalo domain-verification** page is served at `GET /` and `/zalo_verifier<code>.html`. Routers mount under `/api`; an **error handler** returns `{success:false, error}` last.

**Response conventions:** almost every endpoint returns `{ success: boolean, ... }`. Some routers create their **own `pg.Pool`** (marketingEvents, referenceData, leadEvents, eventConsole, eventDesk, zaloWebhook); controllers generally use shared `services/db.js`.

### 5.2 API routes by area (all under `/api`)

Auth key: **client** = student LQ session (`req.session.authenticated`); **staff** = LM session (`req.session.staffId`); **perm(x.y)** = `requirePermission`; **role∈{…}** = hardcoded gate; **public** = none.

- **Health** (`routes/api.js`): `GET /health` (public).
- **Auth — student/LQ** (`routes/auth.js`, `/api/auth`): `POST /check-login` (public, 3-way analysis) · `POST /request-otp` (public, **OTP send bypassed**) · `POST /verify-otp` (public, **any 6-digit code accepted**) · `GET /session` · `POST /logout` · `POST /qr-login`.
- **Students — LQ client** (`routes/students.js`, `/api/students`, `requireAuth`): `POST /register` · `POST /:id/add-registration` · `POST /deactivate` · `GET /search` (+counselor) · `GET /check-duplicate` · `GET /by-email` · `GET /:id` · `PUT /:id` · `POST /:id/calculate-risk` · `POST /:id/calculate-ocean` · `POST /:id/upload-photos`.
- **Staff / LM core** (`routes/staff.js`, `/api/staff`, `requireStaffAuth` + `requirePermission`): login/logout/session; `GET /permissions` (the user's permission map), `GET /roles`, `GET /columns`; layout variants (`/variants`); `GET /lead-list`, `GET /students/search`, `POST /students/export-excel` (perm `leads.export`), `GET/PUT /students/:id`, calculate-risk/ocean (perm `leads.recalculate`), `DELETE /students` + delete-preview (perm `leads.delete`), orphan cleanup (perm `leads.delete`); audit (`/audit/:studentId`, `/audit-range`, perm `audit.view`); column-config (`PUT` perm `column_config.manage`); staff mgmt (`GET/POST /` perm `staff.manage`), `PUT /assign/:studentId` · `/mass-assign` · `/mass-move-phase` · `/phase/:studentId` · `/assignment/:studentId` (perm `leads.assign`), `PUT /:id/target` (perm `staff.set_target`), `PUT /:id/password`, `PUT /:id/deactivate` (perm `staff.delete`).
- **Leads (engagement)** (`routes/leads.js`, `/api/leads`, `requireStaffAuth` only): `GET /` · `GET /student/:studentId` · `POST /student/:studentId` · `GET /:leadId` · `PUT /:leadId`. **⚠️ Per-lead access control + field masking NOT yet applied here** (documented TODO in `leadController.js`) — any authenticated staff can read/write any lead. Terminal-status lock *is* enforced (Lost/Archived/Cancelled editable only by manager/admin profiles).
- **Notes** (`routes/notes.js`, `/api/notes`, `requireStaffAuth`): reminders, communications, lead/student-level note CRUD, reminder patching.
- **Documents** (`routes/documents.js`, `/api/documents`, `requireAnyAuth` — client OR staff): list/upload per lead or student; storage via `services/driveService.js` (Google Drive).
- **Lookups / reference data**: `routes/lookups.js` (`/api/lookups` — `GET /public/:category` whitelisted `referral_source`/`vietnam_province`; admin CRUD); `routes/referenceData.js` (`/api/reference-data` — public LQ feeds `GET /public/counsellors` + `GET /public/source-options`; CRUD gated **role ∈ Admin/Manager/Director**); `routes/referralSources.js` (subagents/partners CRUD, same role gate).
- **Marketing events** (`routes/marketingEvents.js`, `/api/marketing-events`): the `events` catalog; public reads + role-gated writes.
- **Lead events / registrations** (`routes/leadEvents.js`, `/api/lead-events`, `requireStaff`): the `lead_events` join CRUD.
- **Reports** (`routes/reports.js`, `/api/reports`, `requireStaffAuth`): notes-activity (perm `reports.view`), contracted-stats, weekly (+regenerate), weekly-recommendation, monthly-targets, tracked-staff.
- **Distribution** (`routes/distribution.js`, `/api/distribution`, gated `distribution.manage='all'`): pool/preview/release/recall, upload/template, coverage, unassigned/review, duplicates.
- **Event Console — internal** (`routes/eventConsole.js`, `/api/event-console`): events/roster/check-in, institutions, reps (desk staff), qualification fields; **public token endpoints** `GET /profile/:token`, `POST /profile/:token`, `GET /badge-image/:token`; token/badge delivery (email + Zalo). Guards `requireStaffAuth` / `requireDeskAdmin` / `requireAdminOnly`.
- **Event Desk — public kiosk** (`routes/eventDesk.js`, `/api/event-desk`): **no LM login** — reps auth with event token + PIN → **HMAC-signed Bearer** (12h TTL), gated `requireRep`. `POST /login`, `/desks`, `/sign-in-desk`, `/lookup` (name-only), `/visit`.
- **QR proxy** (`routes/qr.js`): server-side proxy to qrcode-monkey (avoids CORS). No auth.
- **Cleanup / Deep Cleanse** (`routes/cleanup.js`, `/api/cleanup`): DESTRUCTIVE, `requireStaffAuth` + `requireAdmin`; destructive ops need `{confirm:true}`.
- **Zalo webhook** (`routes/zaloWebhook.js`, `/api/zalo`): **unauthenticated** (Zalo is the caller). Always `200`, then flips `event_attendees.badge_zalo_status` by matching stored msg id — harmless by construction.

### 5.3 Authentication & sessions

Two **independent** session identities on the same cookie:

| | Student / LQ client | Staff / LM console |
|---|---|---|
| Login | `/api/auth/*` (OTP-style, **bypassed**) or `qr-login` | `POST /api/staff/login` (email + bcrypt) |
| Session flag | `req.session.authenticated = true` | `req.session.staffId` set |
| Fields | `email`, `isCounselor`, (`studentId`) | `staffId`, `staffEmail`, `staffName`, `staffRole`, `staffTier`, `staffPosition` |
| Guards | `requireAuth`, `requireCounselor` | `requireStaffAuth` |

Guards are **not interchangeable** (`requireAuth` checks the client flag). `requireAnyAuth` (documents, lookups) accepts either.

**`checkLogin(req,res)`** (pre-auth, `authController.js`): calls `checkCounselor(email)` → if staff, `scenario:'counselor'`; else `searchDuplicates(email,phone)` filtered to **Active only** → 3-way scenario (`no_match` / `single_active` + `hasActiveLead` / `conflict`). Returns `{scenario, matches, activeRecord, hasActiveLead, activeLead}`.

**⚠️ OTP IS CURRENTLY BYPASSED.** `requestOTP` sends no email (returns success), `verifyOTP` **accepts any 6-digit code** and sets the client session. `services/otpService.js` + `emailService.sendOTPEmail` remain implemented but dormant. **To re-enable, restore the two commented blocks in `authController.js`.**

**Staff login** (`staffController.js`): looks up `staff` by email, bcrypt-verifies, then sets the **permission key** `req.session.staffRole = staff.position` **if that position is a seeded permission profile**, else falls back to legacy `staff.role`. This is the linchpin of profile-based RBAC.

### 5.4 RBAC & permissions

**Table-driven, keyed by "authorisation profile"** — three tables read by `services/permissionService.js`:
- **`role_permissions(role, resource, operation, scope)`** — resource-level. `scope ∈ {none, own, team, all}`. `role` = the **profile name**.
- **`permission_fields`** — the field catalog (drives Leads-list columns).
- **`role_field_permissions(role, resource, field, list_permission, detail_permission)`** — per-field: `edit`/`view`/`view_masked`/`none`.

**Enforcement — two layers:** (1) route `requirePermission(resource, op)` → 403 if scope is `none`/absent; (2) controller re-reads scope (`own`/`team`/`all`) to refine SQL, and `canAccessLead(staff, lead, op)` enforces per-record ownership for `own` (staff `fullName` appears in the lead's counselor/senior/presales/marketing). **Field masking** (`applyFieldPermissions`): `none` omitted; `view_masked` partially masked (`maskEmail`/`maskPhone`) with the raw value under `_raw_<field>` so the UI can still search/dial.

**How staff get a profile** (migrations): `authProfiles_up.js` seeds `role_permissions` from `data/auth_profiles.json` (24 profiles, each with `scope`, `phase`, `transfer`, and a `grants` map); `applyStaffProfiles.js` applies `data/auth_staff_map.json` (per-staff → profile + tier), setting `staff.position = profile`, `staff.role = tier`. Both are dev-guarded and back up before writing.

**Main resources + operations:** `leads` (create/view_list/view_detail/edit/delete/assign/recalculate/export), `sales` (create/read/update/delete), `staff` (view/edit/manage/delete/set_target), `reports` (view/activity/weekly/monthly), `events` (checkin_view/checkin/marketing_view/marketing), `followup` (view/manage), `notes` (write_counselor/write_presales/write_management), `refdata` (view/manage), `column_config` (manage), `distribution` (view/manage), `cleanse` (view/use), `maintenance` (view/use), `audit` (view).

**⚠️ Hybrid gating.** Not everything is table-driven: `referenceData.js`, `referralSources.js`, `marketingEvents.js` hardcode `role ∈ {Admin,Manager,Director}`; `eventConsole.js`/`cleanup.js` use `isManagerOrAdmin`/`isAdminProfile`. `utils/authProfiles.js` classifies profiles into `ADMIN_PROFILES`/`MANAGER_PROFILES` (incl. legacy role names for rollback safety) because `session.staffRole` may hold either a new profile OR a legacy role depending on migration state.

### 5.5 Background services (`src/services/`)

- **`emailService.js`** — GAS email relay (`GAS_SEND_OTP_URL`). `sendOTPEmail` (dormant — OTP bypassed), `sendEventQrEmail` (badge PNG), `sendRepLinkEmail` (desk sign-in link). No-ops to console if unset.
- **`zaloService.js`** — Zalo/ZNS badge delivery via the StudyLink OA. Two methods (`ZALO_SEND_METHOD`): **ZNS** (approved template to a phone; the "View Badge" URL is fixed to `slcareerguidance.netlify.app/profile?t=<token>`) and **OA** (free-form to a follower). DB-persisted auto-refresh tokens (`zaloTokenManager`); **dormant** until configured (returns `{sent:false, reason:'zalo_not_configured'}`). `zaloDeliveryPoller` flips `accepted→delivered` (Zalo's webhook is geo-blocked from the US server IP, so status is **pulled**).
- **`eventQualification.js`** — decides if a lead qualifies for an advance event QR; `issueAdvanceTokens` mints attendee tokens idempotently.
- **`dataService.js`** — ⚠️ `checkCounselor(email)` **queries the local `staff` table directly** (`role ∈ {Counselor,Manager,Director,Admin}`) and **ignores `fullName`/`phone`** despite `authController` comments claiming GAS validates all three (stale comments). Also `searchDuplicates`, `searchStudents`.
- **`otpService.js`** — fully implemented OTP generator/store, **dormant**.
- Boot/background: `weeklySnapshotScheduler.js` (Mon 08:00 VN snapshot), `distributionService.js`, `driveService.js`, `deepCleanseService.js`.

**Backend caveats:** (1) **OTP fully bypassed** on LQ login. (2) `/api/leads` has **no per-lead access control yet**. (3) permission gating is **hybrid**. (4) `zaloWebhook`, `event-desk`, `qr`, several `/public/*` are **intentionally unauthenticated**. (5) production CORS origins live only in the Railway `CORS_ORIGIN` env var.

---

## 6. LQ App (Customer Intake)

The customer-facing **intake** front end (Vite + React SPA, `react-router`, no Redux). Root `Client/`, deployed to `slcareerguidance.netlify.app`. Server calls go through `src/services/api.js` (`import.meta.env.VITE_API_URL || "/api"`, `credentials:'include'`); the event-desk API uses `Authorization: Bearer <token>`.

### 6.1 App shell & routing (`src/main.jsx`, `src/App.jsx`)

Bilingual EN/VI via `t(key, language)`. Providers: `LanguageProvider` → `AuthProvider` → `LookupProvider`. Routes:

| Path | Page | Protected? | Purpose |
|------|------|------------|---------|
| `/` | `Home.jsx` | public | Login / intake details capture |
| `/verify` | `OTPVerification.jsx` | public | OTP step (currently bypassed) |
| `/dashboard` | `Dashboard.jsx` | **yes** | The 7-tab student record |
| `/desk` | `DeskPage.jsx` | public (PIN + rep token) | Event check-in desk for reps |
| `/badge/:token` | `BadgePage.jsx` | public (token) | Printable event QR badge |
| `/profile` | `ProfilePage.jsx` | public (`?t=` token) | "Know you better" self-service form |

`ProtectedRoute` guards only `/dashboard`. `AuthContext` holds `isAuthenticated/email/studentId/isCounselor/loading`; on mount calls `authAPI.checkSession()`.

### 6.2 The login screen (`src/pages/Home.jsx`)

Captures the full first-contact payload before any account exists. **Mandatory** (`*`): `fullName*`, `email*` (regex), phone (country code + `phoneNumber*`, auto-formatted), `yearOfBirth*` (1980–2018), **Source of Lead cascade** (`sourceOfLead*` → a mode-dependent second field: `list`→Source dropdown; `events`→Event dropdown, auto-fills dedicated counsellor; `list_freetext`→Source + free-text referrer; `b2b`→Referral type + Partner, unknown party sets `sourceUnverified`), `placeOfResidence*` (province), `studyPlan*`, `preferredSocial*` (default Zalo), `connectWithYou*` (consent). Optional: `counsellor` dropdown, headshot.

**Reference data (public, best-effort):** source-options ← `GET /api/reference-data/public/source-options`; counsellors ← `/public/counsellors`; events ← `/api/marketing-events/public`; provinces ← `/api/lookups/public/vietnam_province`. Failures leave empty lists (form not blocked). **Deep-link/QR prefill** via URL params (`?sol=Event/Campaign&eid=&ename=&counsellor=`).

### 6.3 The `checkLogin` 3-way returning-student logic

On submit, `handleLogin` calls `authAPI.checkLogin(email, phone)`; the response drives a switch:
- **`no_match`** → **Case 3 (new)**: `mode='create'` — new student + lead.
- **`single_active` + `hasActiveLead===true`** → **Case 1**: confirmation modal ("you already have an active enquiry"), then `mode='change'`, `selectedRecordId` — retrieve/edit the existing lead.
- **`single_active` + `hasActiveLead===false`** → **Case 2**: modal ("a new enquiry will be created"), then `mode='create_lead'`, `existingStudentId` — new lead on the existing student.
- **`conflict`** → `DuplicateModal` (radio-pick which record to keep; others queued for deactivation).
- **`counselor`** → `mode='counselor'` (staff logging in) → dashboard opens in student-search mode.

The chosen `mode` + all captured fields pass through router `state` → `/verify` → `/dashboard`.

### 6.4 OTP step (`src/pages/OTPVerification.jsx`) — bypassed

**OTP is auto-submitted:** a `useEffect` pre-fills `BYPASS_CODE='000000'` and calls verify after 1200ms. Real OTP is fully wired (resend countdown, 5-attempt lockout, WebOTP, iOS autofill) but inactive; the file header documents re-enabling.

### 6.5 Registration & the ownership rule

Registration happens **in the Dashboard** (`loadStudent`, guarded by `registeredRef` so create fires once): Case 1 → `getById` + `addRegistration`; Case 2 → `register({...payload, existingStudentId})`; Case 3 → `register(payload)` (409 = already exists → load that record). **The connected-unit ownership rule is applied server-side** at `POST /students/register`: counsellor named → `order_phase='Counselling'` + Counselor slot; blank → `order_phase='Pool'` + Quality slot = `Mạch Nguyễn Phi Vân`.

### 6.6 Dashboard & tabs (`src/pages/Dashboard.jsx`, `src/components/Tabs/`)

Multi-tab student record, autosave on tab-change/close (`useFormState`). Three tabs are **counselorOnly**.

| Tab | Component | Captures | Gating |
|-----|-----------|----------|--------|
| **Personal** | `PersonalDetailsTab` | Name, up to 2 contact slots, email, phone, study plans; read-only Event/Campaign section; inline Family Contact | always |
| **Study** | `StudentInfoTab` | `destinationCountry` (multi, max 3), `timeline`, `processApplication`, `residency` | gated |
| **Assessment** | `SelfAssessmentTab` | Risk questions → risk score → **Stone Tier**. Calculate → `studentAPI.calculateRisk` | gated |
| **Career** | `CareerFitTab` | 15 OCEAN Likert → Big-Five + radar + archetype + narrative. Recalculate → `calculateOcean` | gated |
| **Family** | `FamilyContactsTab` | Mother/father details | counselorOnly |
| **Counselor** | `CounselorFeedbackTab` | ⚠️ see §9 — currently shows a legacy Career-Fit form | counselorOnly |
| **Documents** | `DocumentsTab` | File upload (≤10MB) via Google Drive | counselorOnly |

**Stone Tiers** (score capped 200): Quartz 40–75, Agate 76–105, Sapphire 106–135, Ruby 136–165, Diamond 166–200. **Tab-gating**: `checkMandatoryFields` (name/phone/email/studyPlans) then `checkFamilyMandatoryFields` (complete mother OR father) unlock the gated tabs. **Returning-student re-hydration**: assessment/OCEAN/study-info live on the student record; `SelfAssessmentTab` and `CareerFitTab` have `useEffect`s keyed on `formData.studentId` to restore the stored result banners (their `useState` initializers only capture mount-time data — hence the effects).

### 6.7 Event features

- **`DeskPage.jsx`** (`/desk`) — public mobile rep check-in desk (Bearer-token): PIN sign-in → pick desk → scan student QR → name only + note + optional 1–10 rating → `eventDeskAPI.visit`. No LM login.
- **`BadgePage.jsx`** (`/badge/:token`) — public full-screen registration badge; renders a QR PNG client-side; QR encodes the bare token the desk scanner resolves.
- **`ProfilePage.jsx`** (`/profile?t=`) — public, token-gated Vietnamese "Know you better" self-service form; writes answers back to the lead via `profileAPI.save`.

### 6.8 LQ findings / gotchas

1. **`CounselorFeedbackTab.jsx` is mislabeled** — its body is an older, English-only OCEAN Career-Fit form (header comment even reads `CareerFitTab.jsx`). The **Counselor tab therefore shows a duplicate Career-Fit form, not counselor feedback** — almost certainly an accidental copy/overwrite; verify before relying on that tab.
2. **OTP fully bypassed** (`'000000'`, auto-submit).
3. `api.js` `checkLogin`/`verifyOTP` silently drop the extra `fullName`/`phone` args callers pass (match uses email + phone only).

---

## 7. LM Console (Staff) — every sidebar option

The **Lead Management (LM) Console** is a Vite + React SPA that staff use to work Sales records and their Leads. Separate app from the LQ intake app (linked out via `VITE_LQ_BASE_URL`). All screens sit under a shared `ConsoleShell` (sidebar + breadcrumb trail + main content) in `src/App.jsx`.

### 7.0 Architecture & gating model (read first)

- **Route table:** `src/App.jsx`. Routes are wrapped in `ProtectedLayout` (redirect to `/login` when no `staff`) — **routes are NOT individually permission-gated at the router level** (an `AdminRoute` component exists but is **unused**). Per-feature authorization is enforced in two places: (1) the **sidebar** decides which items are *visible*; (2) each **page/component** re-checks permissions and the **backend** enforces scope. A user who deep-links to a route they lack rights for still loads the page; the page's own checks + API 403s are the real protection.
- **Auth context** (`src/contexts/AuthContext.jsx`): holds `staff`, `login/logout`, derived `isAdmin/isManager/isDirector`; re-syncs via `GET /api/staff/session` on mount + window focus.
- **RBAC context** (`src/contexts/PermissionsContext.jsx`, §7.18): sidebar visibility uses `canDo(resource, op)`.
- **Sidebar** (`src/components/Sidebar.jsx`): **MAIN** (always) + **ADMIN** (only if `showAdminSection = canManageStaff || canManageDistribution || canDeleteLeads || canMaintenance`). Footer: language toggle, staff badge, sign-out.

### MAIN section

**7.1 Dashboard** — `/dashboard` (`FiGrid`), `Dashboard.jsx`. KPI + pipeline dashboard. Counselors see own data; Manager/Admin/Director get Leads-by-Stone + Leads-by-Status, Leads-by-Counselor (drill-down), and a Pipeline Statistics table with a red **Backlog** row (active leads whose `closeDate` < this Monday) and "Close this week". Clicking any chart drills to `/leads` with a `drillFilter`. **Gate:** none (always visible; data scope enforced server-side).

**7.2 Leads** — `/leads` (`FiUsers`), `Leads.jsx` (deep-dive §7.15). **Gate:** none (row-detail + bulk controls individually gated inside).

**7.3 Create Sales/Lead** — **action item, no route** (`FiUserPlus`). `handleCreateSales()` → `window.open(\`${VITE_LQ_BASE_URL}/?src=console\`, '_blank', 'noopener')` (alerts if unset). Hands the user to the external LQ intake form to create a new Sales/Lead. **Gate:** `canDo('leads','create')`. *(This is the launcher we moved from the Leads toolbar into the sidebar.)*

**7.4 Sales Followup** — `/client-followup` (`FiBell`), `ClientFollowup.jsx`. Two tabs: **Reminders** (latest open reminder per lead, bucketed into a past-4-weeks / next-4-weeks / next-2-months timeline, using rescheduled-date if set) and **Communications** (contact-volume analytics by platform). **Gate:** none (scope server-driven).

**7.5 Event Check-in** — `/events` (`FiCheckSquare`), `EventConsole.jsx` (lazy-loaded). Tab 1 **Roster & check-in** (pick an exhibition/fair, view roster, check attendees in, badge render/email); Tab 2 **Desks** (configure which institutions have a desk; each desk gets a token + 4-digit PIN for its rep, up to 50/event). **Gate:** none.

**7.6 Activity Report** — `/reports/activity` (`FiPhoneCall`), `ActivityReport.jsx`. Phone-vs-other note-activity dashboard. Admin/Director/Manager see all staff; Counselor/Pre-Sales see only their own. Drill: staff bar → that staff's Tier/Status mini-charts + lead table → `/leads/:id`. **Gate:** `canDo('reports','view')` — **the only permission-gated report sidebar item.**

**7.7 Weekly Report (static)** — `/reports/weekly` (`FiFileText`), `WeeklyReport.jsx`. Weekly status report served from a **frozen Monday-08:00-VN snapshot**. Header = 5 Contracted KPI cards; rows: Contracted / Counselling Letters / Leads / Calls / Calls-by-day / Breakdown-by-mode. Right panel drills any metric into its lead list; footer = Recommendations panel. Managers pick a scope; header totals never change. **Gate:** none (always visible — not gated by `reports.view`).

**7.8 Marketing Events** — `/marketing-events` (`FiCalendar`), `MarketingEvents.jsx`. Admin editor for the `events` table: event type (add-new inline), name, EN/VI labels, dedicated counsellor, dates, "hide from list" override; generates styled event QR codes. The dedicated counsellor pre-tags single-counsellor events on the LQ form. **Gate:** **role check** `['Admin','Manager','Director'].includes(staff.role)` (not `canDo`).

**7.9 Reference Data** — `/reference-data` (`FiShare2`), `ReferenceData.jsx`. Left-nav editor over `/api/reference-data` whitelisted `lookup_values` categories: Source of Lead (with `mode`), Source ▸ Databases/On-line/Personal, B2B Type, B2B Party ▸ Subagents/Partners/School Outreach, Attendance Status. Add/edit/soft-delete. (Event/Campaign sources live on Marketing Events, not here.) **Gate:** **role check** `Admin/Manager/Director`.

**7.10 Column Settings** — `/settings/columns` (`FiLayout`), `ColumnLayoutSettings.jsx`. Per-user layout-variant manager for the Leads list: drag-drop column order (`@dnd-kit`), show/hide, category groups, save/star-as-default variants. Writes `{columnOrder, columnVisibility, columnSizing}`. **Gate:** none ("every user manages their own").

### ADMIN section (visible only if any admin item is)

**7.11 Staff** — `/staff` (`FiUserCheck`), `Staff.jsx`. Staff roster admin: create, edit, deactivate, reset password, set targets (separately gated by `staff.set_target`). Roles fetched from `GET /api/staff/roles`. **Gate:** `canDo('staff','manage')`.

**7.12 Lead Distribution** — `/distribution` (`FiShuffle`), `LeadDistribution.jsx`. Tabs Release / Upload / Coverage / Redistribute — release pooled leads to offices/counselors, upload lists, view coverage, redistribute unassigned/duplicates. **Gate:** `canDo('distribution','manage')`.

**7.13 Deep Cleanse** — `/admin/cleanup` (`FiTrash2`), `DataCleanup.jsx`. Schema-adaptive **destructive** cleanup (only talks to `/api/cleanup/*`): targeted purge (build set → preview per-table footprint → confirm cascade delete), search, orphan sweep, duplicates. Every delete confirmed + gated Admin/Director client+server. **Gate:** `canDo('leads','delete')`.

**7.14 Maintenance** — `/admin/maintenance` (`FiTool`), `AdminMaintenance.jsx`. Reminder-cleanup: lists open reminders on closed/non-contactable leads and bulk-closes them. **Gate:** `staff.role === 'Admin' || staff.position === 'Tech Support'` (role/position check, not `canDo`).

### 7.15 Deep-dive: Leads list (`src/pages/Leads.jsx`)

The keystone screen — one row **per Lead**, grouped by `studentId` then newest `leadId` first. Built on **TanStack Table** with column resize + drag-reorder. Data: `studentAPI.searchLeads('')` (masked display fields + hidden `_raw_<field>` for search); column catalog from `staffAPI.listColumns()` (backed by `permission_fields`); per-role layout from `columnConfigAPI.get('leads_<roleKey>')`.

**Special cells:** `leadId`/`studentId` (links), `leadStatus` (colored badge), `stoneTier` (emoji), `orderPhase` (colored phase pill), OCEAN (`n/15`), `phone` (masked or a `tel:` click-to-call that fires a background auto-note). **Per-column faceted filters** (multi-select popovers with a `(none)` sentinel; date-range chips; free-text "contains" for the rest) + a global wildcard search that always hits raw values. State persisted to `sessionStorage`. **Saved views/variants** render as tabs.

**Permission-gated UI:** `canManageColumns` (Save-default button), `canMassAssign = scope('leads','assign')==='all'` (bulk-select + mass bar), `canDeleteLeads` (Delete), `canPrintList = canDo('leads','export')` (Print/Export). **Column masking** via `fieldList(key)` (`'view_masked'` masks unless the lead is the user's own; `'none'` hides the column). **Row click** gated by `canDoOnLead('leads','view_detail', lead)`.

**"Move" (mass phase assignment):** `PHASE_SLOTS` = Marketing→[Marketing Staff], Counselling→[Counselor], Presales→[PreSales], Pool→[Quality, Tech Support], Business Development→[Business Development], Case Officers→[Case Officer Direct/Sub]. `RECIPIENT_REQUIRED` = Counselling/Presales/Case Officers. `handleMassAssign` → `staffAPI.massMovePhase(...)`. Moving to any working phase (not Pool) warns that records with no active lead get a fresh active lead minted. **KEEP `PHASE_SLOTS` in sync with `Server/src/utils/orderPhase.js`.** **Delete** archives each record to Google Drive (irreversible).

### 7.16 Deep-dive: Lead / Sales detail (`src/pages/LeadDetail.jsx`)

One component serves `/lead/:id`, `/leads/:id`, `/students/:id`. `isStudentView` = `/students/...` or any **non-numeric** id (student ids are non-numeric; lead ids numeric). Loads the lead + owning student + notes + staff + audit + event regs + sibling leads, **merged into one object** (`{...student, ...lead}`, lead wins). **Header:** Sales/Lead badge, title, orderPhase chip, Edit/Cancel/Save; a **terminal lockdown** banner makes Lost/Archived/Cancelled read-only for non-manager/admin (`Contracted` is editable).

**Sections:** Lead Status (lead view); Sales/Lead Information (identity + academic/target, masked email/phone); Event Registrations (person view); **Self Assessment** (Stone Tier hero card + risk inputs, **"Recalculate Risk"** → `studentAPI.calculateRisk`); **Career Fit — OCEAN** (radar + traits + archetype, collapsible 15-question responses, **"Recalculate"** when all 15 answered → `studentAPI.calculateOcean`); Family Contacts; Notes (lead view — threaded, reminder workflow, `ContactLogModal` that forces a mandatory note; note-type buttons gated by `canDo('notes','write_<type>')`); Sales-leads table + Change History (audit).

**Recalculate gating:** both buttons render only when `canRecalc = canDoOnLead('leads','recalculate', lead) && !leadLocked` and not in edit mode. *(This is why the buttons can be absent — either no `recalculate` permission, the lead is terminal-locked, or, for OCEAN, not all 15 questions are answered.)*

**Right column (person view, when `canAssign`):** Summary card, **Sales Order Phase** mover (uses server `phaseInfo.nextPhases`; recipient required for Counselling/Presales/Case Officers → `staffAPI.changePhase`), and **Staff Assignment** (Order-driven: legacy slots cascade to active leads via `staffAPI.assign`; non-legacy positions via `staffAPI.setAssignment` → `order_assignments`; a row is editable only if its position is in `phaseInfo.editablePositions`).

### 7.17 Login (`src/pages/Login.jsx`)

`/login` (only route outside `ProtectedLayout`). Email + password → `authAPI.login` (`POST /api/staff/login`) → `login(data.staff)` → `/dashboard`. Once `staff.id` is set, `PermissionsProvider` fetches `staffAPI.getPermissions()` (`GET /api/staff/permissions`) and normalizes it; until it resolves, all helpers fail-safe. `SessionExpiredModal` handles lapsed sessions.

### 7.18 RBAC helper (`src/contexts/PermissionsContext.jsx`)

- **`scope(resource, op)`** → stored scope, default `'none'`. **Scope ∈ `none`/`own`/`all`.**
- **`canDo(resource, op)`** → true when scope is `'all'` or `'own'` (menu visibility, non-ownership buttons).
- **`canDoOnLead(resource, op, lead)`** → ownership-aware: `'all'` passes; `'own'` passes only if the lead is the user's (name match on counselor/senior/presales/marketing); `'none'` fails.
- **Field-level:** `fieldList` / `fieldDetail` drive list masking + detail edit; `canEditField`, `isFieldMasked`.

**Console cautions:** (1) routes are auth-gated but **not permission-gated at the router**; (2) sidebar gating is **inconsistent by design** — some `canDo`, some raw role checks (Marketing Events, Reference Data), Maintenance role-or-position; Weekly Report + Column Settings ungated; (3) `PHASE_SLOTS` must stay in sync with `orderPhase.js`; (4) deletes are irreversible but archived to Drive.

---

## 8. Operational Runbook (common support tasks)

### 8.1 Local development setup

1. Clone the repo. In **each** of `Server/`, `Client/`, `LeadManagement/` run `npm install`.
2. Ensure the `.env` files exist (they're gitignored — get them from the current maintainer / Railway + Netlify dashboards). Minimum: `Server/.env` (`DATABASE_URL`, `SESSION_SECRET`, `CORS_ORIGIN=http://localhost:3000,http://localhost:3001`, `PORT=5000`), `Client/.env` (`VITE_API_URL=http://localhost:5000/api`), `LeadManagement/.env` (`VITE_API_URL=http://localhost:5000`, `VITE_LQ_BASE_URL=http://localhost:3000`).
3. Start the backend: `cd Server && npm run dev` (nodemon, port 5000). It connects to whatever `DATABASE_URL` points at — for local work, point it at a local Postgres or a **copy** of PROD, never PROD directly for testing.
4. Start the LQ app: `cd Client && npm run dev` (port **3000**). Start the console: `cd LeadManagement && npm run dev` (port **3001**). Both proxy `/api` → `:5000`.
5. `start-dev-system.bat` launches the set together.

### 8.2 Deploying a change to production

Deployment is **`git push` to `main`** — Railway rebuilds the Server, Netlify rebuilds all three frontend sites. There is no CI gate.
- **Always** run a syntax check first (`node -c <file>` for Server files; a `vite build` for a frontend catches import errors).
- **Coupled backend files ship together.** If you touch `studentController` + a model + a service, commit them in one commit (see the FK incident, §3.4 / §9). If using GitHub Desktop's file checkboxes, double-check you didn't leave a coupled file unstaged.
- **Server changes require the Railway service to reload** (automatic on push; if running locally, restart the node process — a browser refresh won't reload backend code).
- **Frontend changes** need a Netlify rebuild (automatic on push); locally, Vite HMR usually suffices, but hook-signature changes (adding a `useEffect`) may need a hard refresh (Ctrl+Shift+R).
- After deploy, smoke-test the affected flow on the **canonical** site (`slcareerguidance.netlify.app` for LQ, the console site for LM).

### 8.3 Inspecting the database (read-only)

There is no admin UI for raw SQL. The safe pattern used throughout this project is a **throwaway node script** in `Server/` (it picks up `DATABASE_URL` from `.env`):

```js
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const r = await pool.query(`SELECT ... `);   // SELECT / information_schema only
  console.log(r.rows);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
```

Run with `node script.js`, then **delete it**. Always print the DB host first (`DATABASE_URL.replace(/.*@/,'').split('/')[0]`) as a seatbelt so you know DEV vs PROD before any write. **State-changing SQL against PROD is done deliberately and separately — never as a casual test.**

### 8.4 Running a database migration

Migrations live in `Server/Migrations/` and are **run by hand**, not automatically. Each `.js` migration reads `DATABASE_URL` directly and most are **localhost-guarded** (they refuse a non-dev DB unless you pass `--allow-remote`). Typical safe sequence: run against DEV first → verify → back up PROD (`pg_dump`) → run against PROD with `--allow-remote` → verify. Reversible migrations provide `--rollback` / `--reset` / a `*_down.js`. The auth/staff/phase migrations back up to `staff_profile_backup` / `reconcile_slot_backup` before writing.

### 8.5 Common admin tasks

| Task | Where |
|------|-------|
| Add a **counsellor** to the LQ dropdown | Set the staff member's `lq_selectable=true` (Staff admin / DB). The public feed is `/api/reference-data/public/counsellors`. |
| Add a **Source of Lead / Source / B2B** option | Console → **Reference Data** (Admin/Manager/Director). |
| Add / edit a **marketing event** | Console → **Marketing Events**. Dedicated counsellor here pre-tags the LQ form + QR. |
| Reassign / **move a lead** across phases | Console → **Leads** (bulk "Move") or **Lead detail** right column (Phase mover + Staff Assignment). |
| Reset a **staff password** | Console → **Staff** → key icon (needs `staff.manage`). |
| Bulk-close **stale reminders** | Console → **Maintenance** (Admin / Tech Support). |
| Purge / clean up **orphan or duplicate records** | Console → **Deep Cleanse** (Admin/Director) — destructive, archived to Drive. |
| Re-enable **real OTP** | Restore the two commented blocks in `Server/src/controllers/authController.js` (`requestOTP`, `verifyOTP`). |

### 8.6 Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Frontend gets **CORS error** calling the API | The site's origin isn't in the backend allow-list | Add it to the Railway `CORS_ORIGIN` env var (comma-sep), redeploy backend |
| **`leads_person_fk` FK error** on registration | Partial deploy — a coupled Server model (e.g. `Lead.js`) wasn't shipped with the controller | Commit/push the missing file; keep coupled backend files in one commit |
| **`null value in person_id`** on registration | A model return-shape mismatch (`findById` returns `{data}`, `create` returns the record) | Unwrap `.data`; already fixed — regression check if it recurs |
| **Empty dropdowns** on the LQ login screen | Backend unreachable when the page loaded (only hardcoded-fallback dropdowns fill) | Confirm backend is up + reachable; reload. Source-of-Lead has no fallback, so it's the first to look empty |
| **Staff can't see a menu / button** they should | Their profile lacks the gating permission after the RBAC migration | Check `role_permissions` for their profile; verify `staff.position` = a seeded profile name |
| **Recalculate buttons missing** in Lead detail | No `leads.recalculate` permission, lead is terminal-locked, or (OCEAN) <15 answers | Grant the permission / check lead status / complete the assessment |
| **Study Info / assessment blank** on a returning student | Data genuinely null on the record, OR a field not in the model column map | Confirm the value exists in the DB; ensure the field is in `Student.js` `COLUMNS` |
| **Login accepts any code** | OTP is intentionally bypassed | Expected; re-enable per §8.5 if required |
| **Zalo badge not delivered** | OA not configured / delivery status is pulled not pushed | Check `zalo_oauth_tokens`, `ZALO_*` env, and the delivery poller logs |
| Server **won't boot in prod** | `SESSION_SECRET` left at the dev default | Set a real `SESSION_SECRET` in Railway |

---

## 9. Known Issues, Caveats & Tech Debt

Ranked roughly by importance. Most are intentional or low-risk but **you must know they exist.**

1. **🔴 OTP is fully bypassed on the LQ login.** Any 6-digit code (auto-submitted `000000`) logs a customer in; no email is sent. Intentional (removed a flaky email dependency) but it means the LQ app has **no real login verification**. Re-enable via §8.5.
2. **🔴 `/api/leads` has no per-lead access control yet.** Any authenticated staff member can read/write any lead via that router (documented TODO in `leadController.js`). The `/api/staff/*` lead endpoints *do* enforce scope; the gap is the `/api/leads` router. Terminal-status lock is enforced everywhere.
3. **🟠 Redundant LQ Netlify site.** `studylinkindex.netlify.app` duplicates `slcareerguidance.netlify.app` (both auto-deploy from `main`). Delete `studylinkindex` after confirming no custom domain / external links (§3.3).
4. **🟠 `CounselorFeedbackTab.jsx` (LQ) is mislabeled** and renders a legacy English-only Career-Fit form instead of counselor feedback — the Counselor tab shows a duplicate OCEAN form. Verify against intent before relying on it.
5. **🟠 Hybrid RBAC.** Some gates are table-driven (`role_permissions`), others hardcode `role ∈ {Admin,Manager,Director}` (Reference Data, Referral Sources, Marketing Events) or role/position (Maintenance, Event Console, Deep Cleanse). `session.staffRole` may hold **either** a new profile **or** a legacy role depending on migration state — `utils/authProfiles.js` intentionally lists both. Console routes are auth-gated but not permission-gated at the router.
6. **🟠 Staff referenced by name string**, not FK, in `order_assignments.staff_name` and the `leads`/`students` staff mirror columns. Duplicate / event-rep name rows require explicit workarounds (`syncOrderPhase`, `reconcileStaffSlots`). Renaming a staff member is not automatically propagated.
7. **🟡 Vestigial columns on `students`.** The table physically carries ~46 legacy engagement columns (`lead_status`, `counselor`, `close_date`, …) from before the person/lead split. **Canonical engagement data of record is `leads`.** Some legacy paths still read the `students` mirror.
8. **🟡 Legacy constraint names.** `leads` NOT-NULLs are still named `applications_*`; other objects carry pre-rename names. Cosmetic but confusing.
9. **🟡 `dataService.checkCounselor` ignores `fullName`/`phone`** and queries the local `staff` table by legacy `role` — the `authController` comments claiming "GAS validates all three" are stale.
10. **🟡 `api.js` (LQ) drops extra args.** `checkLogin`/`verifyOTP` wrappers silently discard the `fullName`/`phone` some callers pass; the returning-student match uses email + phone only.
11. **🟡 `PHASE_SLOTS` duplication.** The phase→positions map is hardcoded in both `LeadManagement` (`Leads.jsx`, `LeadDetail.jsx`) and `Server/src/utils/orderPhase.js`. **Keep them in sync** when phases/positions change.
12. **🟡 Only Counselling + Pool phases are fully built.** Marketing / Presales / Case Officers / Business Development / Support exist in the model but their workflows are partial/reserved.
13. **🟡 `register()` is atomic but not idempotent against double-submit at the network layer.** The client guards with `registeredRef`; a raw double POST could still create two leads. Watch for this if the client guard is ever bypassed.
14. **⚪ Intentionally unauthenticated endpoints:** `zaloWebhook`, `event-desk` (token+PIN instead), `qr` proxy, and several `/public/*` feeds. By design.
15. **⚪ Deletes are irreversible** (Deep Cleanse, Leads mass-delete) but each deleted record is archived to Google Drive for forensics.

---

## 10. Support Quick Reference

**Production URLs**
- LQ intake app (canonical): `https://slcareerguidance.netlify.app`
- LQ duplicate (to be deleted): `https://studylinkindex.netlify.app`
- LM console: its own Netlify site
- Backend API: `https://studylinkleadqualification-production.up.railway.app`
- GitHub: `github.com/StudylinkCareer/StudyLinkLeadQualification` (branch `main` = prod)

**Hosting**
- Backend + PostgreSQL + Redis → **Railway** (env vars = Railway service variables)
- Frontends → **Netlify** (env vars = each site's build env)

**Key source files**
- Backend entry / wiring: `Server/src/server.js`, `Server/src/app.js`, `Server/src/config/index.js`
- Auth + RBAC: `Server/src/controllers/authController.js`, `Server/src/services/permissionService.js`, migrations `Server/Migrations/authProfiles_up.js` + `data/auth_profiles.json` + `data/auth_staff_map.json`
- Phase model (source of truth): `Server/src/utils/orderPhase.js`
- LQ intake flow: `Client/src/pages/Home.jsx`, `Dashboard.jsx`, `src/components/Tabs/`
- Console sidebar + gating: `LeadManagement/src/components/Sidebar.jsx`, `src/contexts/PermissionsContext.jsx`
- Console keystone screens: `LeadManagement/src/pages/Leads.jsx`, `LeadDetail.jsx`

**Golden rules**
1. Deploy = `git push main`; keep coupled backend files in one commit.
2. Print the DB host before any write; test against DEV/a copy, never PROD.
3. Migrations are run by hand, DEV-first, backed up before PROD.
4. `PHASE_SLOTS` (console) must match `orderPhase.js` (server).
5. OTP is bypassed — don't mistake "any code works" for a bug.

---

*End of specification. Maintainers: keep this document beside the code and update the relevant section whenever behaviour changes — especially §9.*

