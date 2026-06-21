# StudyLink Event Management App — Specification (v1)

A staff app for running education fairs: check in registered students, redirect walk-ins
to the LQ app, capture desk visits + notes at institution stands, and collect confidential
student feedback. Reuses the existing StudyLink stack (leads, notes, QR, RBAC, audit, email/Zalo).

---

## 1. Principles that shaped the design

- **Reuse, don't rebuild.** Leads (`students`), notes (`student_notes`), QR generation,
  the LQ/Client app, RBAC (`role_permissions`), and audit already exist. This app stitches them together.
- **Desk = station; people sign into it.** Every note is attributed to two things automatically:
  the **institution** (the desk) and the **operator** (the signed-in person).
- **No printing.** All QR/badges are digital, delivered by email or Zalo.
- **Reusable across events.** Each event owns its own roster, institutions, desks, and feedback.

### Architecture (where it lives) — decided
Split along the login seam, to keep the LM console from bloating without duplicating auth:
- **Staff event console** (event setup, roster, check-in, reports) → its own self-contained, lazy-loaded
  **section inside LM**, reusing LM's auth / RBAC / components.
- **Public / tokenised surfaces** (desk capture for external reps, student feedback form) → the
  **Client/LQ app**, which is already the public, mobile, QR-capable, token-based home.
- **Backend** → event routes/services/controllers in their **own module** under `Server`.

---

## 2. Roles (five at a desk)

| # | Role | Account | Access |
|---|------|---------|--------|
| 1 | Institution | n/a (configured on the event) | — |
| 2 | Institution representative | Staff record, `Event staff` role, `staff_type=event`, expires at event end | **Create notes only** |
| 3 | StudyLink permanent staff | Existing account + role | Their normal permissions (can read notes) |
| 4 | StudyLink temporary staff | Staff record, `Event staff` role, `staff_type=event`, expires at event end | **Create notes only** |
| 5 | Student | No account; identified by a digital QR | Sees their own feedback form only |

### The new `Event staff` role
- A table-driven RBAC role (in `role_permissions`) scoped to **exactly one capability: create a note**.
  No lead lists, no exports, no admin, **no reading of existing notes**.
- Assigned to institution reps and StudyLink temps.
- The desk screen content adapts to who is signed in: an `Event staff` operator sees only
  the student's **name + Student ID** and a blank note box; a permanent staffer sees more, per their own role.

### Adding event people to the staff roster (decision: yes, with three safeguards)
Institution reps + temps are added to the existing `staff` table so notes get a real
`author_id` and the per-person access log comes for free. Three safeguards make this safe:
1. **Expiry tag** — `staff_type='event'`, `event_id`, and `valid_until = event end`.
   Closing the event (or `valid_until` passing) deactivates them automatically — no manual cleanup of 40 accounts.
2. **Keep out of normal pickers** — filter day-to-day staff lists (e.g. the distribution
   coverage dropdown, assignment lists) to `staff_type='permanent'` so the console isn't polluted by ex-reps.
3. **Frictionless phone login** — a one-tap **magic link or PIN** sent by email/Zalo
   (operators can't scan a QR on the same phone they're logging in from), plus the rep's `institution_id` stored on the record.

---

## 3. Identity & QR flows (no printing)

- **Student badge = digital QR.** Encodes an *event-scoped attendance token* (not the raw lead).
  Delivered by email/Zalo and shown on the check-in screen so the student can screenshot it on the spot.
  Reps scan it from the student's phone with their own phone camera.
- **Operator login = magic link / PIN** via email/Zalo, tapped on their own phone.
- **What a scan reveals is role-gated:** an institution rep sees only name + Student ID + a note box.
  Full lead/contact data is never exposed to external reps.

---

## 4. Data model

**`events` is the EXISTING shared table — reused, not recreated.** It holds **all** campaign/event types
(StudyLink campaigns, school outreach, business seminars, HTV tours, exhibitions…), categorised by
`event_group` and `event_type`. The EM app targets only the subset where **`event_type = 'Exhibition / Fair'`**
(filter on `event_type`, not `event_group` — e.g. an event can be group "StudyLink" but type "Exhibition / Fair").
It is managed by the existing events admin and has a `meta` jsonb.
The EM app **layers onto an existing exhibition event** (you pick one); it does not create events or duplicate
that admin. EM-specific config (`note_topic`, location, institution selection, status) lives in `events.meta`,
so the shared table and the other features that depend on it are never disturbed.
Key columns we rely on: `id` (PK), `name`, `start_date`, `end_date`, `event_type`, `is_active`, `meta`.

New tables (all key students by `unique_id` — the `students` PK — and staff by `id`):

- `event_attendees` — one row per registered student per event: `event_id` → `events(id)`,
  `student_unique_id` → `students(unique_id)`, `registered_at`, `attended_at`,
  `checked_in_by` → `staff(id)`, `attendance_token` (the QR). Email/phone come from the lead.
- `institutions` — master list of every institution worked with (reusable across events).
- `event_institutions` — which institutions have a desk at this event (**up to 50**),
  each with a `desk_token` + `desk_pin`. This is what makes "Institution #1 = Monash here, UNSW next time" work — no fixed slots; each event selects its own set from the master list.
- `desk_sessions` — who is signed into which desk and when: `event_id`, `institution_id`,
  `staff_id`, `started_at`, `ended_at`. **Concurrent operators per desk are allowed**
  (two reps at one busy desk = two open sessions). An idle timeout auto-closes a forgotten session.
- `event_desk_visits` — one row per student × desk visit: `visited_at`, `recorded_by` (staff_id),
  `rep_rating` (1–10, optional), and the `note_id` it created in `student_notes`.
- `event_feedback` — **exhibition header**, one row per student per event: `token`, channel (qr/email/zalo),
  `sent_at`, `responded_at`, overall + question scores, open suggestions.
- `event_feedback_institutions` — **desk detail**, one row per institution the student rated:
  `feedback_id` (FK to `event_feedback`), `institution_id`, `rating`, optional `comment`.

Existing tables reused: `events`, `students` (PK `unique_id`), `staff` (PK `id`),
`student_notes` (notes carry the institution + operator), `role_permissions`, audit tables.

---

## 5. Attendee journey

1. **Pre-registered** students appear in the roster (note: pre-registration only captured ~5–6 fields,
   so their lead record is incomplete — completed at check-in, see §5a).
2. **Check-in (manual)** — staff find the student via the **search filters** (name / email / phone / ID),
   confirm identity, tap **Attended** (writes timestamp + who), then run the **check-in completion flow** (§5a).
   The student's QR is **minted at the end** of that flow and sent by email/Zalo (and shown for screenshot).
3. **Walk-in (not registered)** — "Register walk-in" deep-links to the **LQ app** with the event attached;
   the new lead is created, tagged to the event, issued a QR, and appears in the roster.
4. **At each desk** — the student shows their QR; the rep scans it → captures the visit.
5. **Feedback** — the student completes the confidential form (onsite QR or emailed link).

### 5a. Check-in completion flow (mandatory data + self-assessment)
Because pre-registration is only a short form, check-in is where the lead is completed. Reuses the
existing LQ form tabs so there's no second data-entry system.

1. **Complete mandatory data** — the student finishes all mandatory lead fields not captured at
   pre-registration (on the check-in device / their own phone). Walk-ins already do this via the LQ app, so
   pre-registered students follow the same completion path.
2. **Self-assessment is required of all students.** If it hasn't been completed, on finishing ("sign out")
   a warning flashes: *do you wish to complete the Self Assessment?*
   - **Yes** → the student is taken to the **Self-assessment tab** to complete it.
   - **No** → their information is saved as-is, and the **QR is minted and sent** (email/Zalo).
3. Once mandatory data is in (and the self-assessment decision is made), the record is saved and the
   QR issued — this is the point at which the student is ready to visit desks.

---

## 6. Operator / desk journey

1. Operator taps their **magic link** (or enters PIN) on their phone → signed in as themselves with their role.
2. They **sign into a desk** (their institution; permanent staff can rove between desks) → opens a `desk_session`.
3. **Scan the student's QR** → the note section opens for that exact student (name + ID).
4. Add a note (+ rep rating if permanent/allowed) → saved, authored by them, tagged to the institution,
   and auto-stamped with the event's note topic (see §8a). The operator never picks the topic.
5. Every action is **audit-logged**. Idle timeout closes the session so notes aren't misattributed after they leave.

### 6a. Event note topic
On event creation, the app auto-generates a single note topic `{event name} {start yymmdd}`
(e.g. "UEH Fair 260616"), stores it on `events.note_topic`, and registers it in the note-topics list
(filterable in the LM notes UI). **Every** note captured at the event — across all desks and operators —
is stamped with this one topic, so the whole event's notes aggregate under it for later filtering and reporting.
One topic per event (start date), regardless of how many days or desks.

---

## 7. Roster screen (staff console)

- **Columns:** select · Student (ID + name + tier) · OCEAN · **email** · **phone** · Attended ·
  **desks-visited summary** (count + names, expandable — *not* 50 columns) · Feedback.
- **Search filters** above name / email / phone for fast manual check-in.
- **Event picker** at top (multi-event reuse); per-event **institution config** screen to add/remove
  participating institutions (up to 50) from the master list.
- Contact details respect existing field-masking/permissions.

> Design note: the per-institution *columns* in the original sketch don't scale to 50 desks,
> so desk capture happens at the desk (scan-driven) and the roster shows a compact visit summary instead.

---

## 8. Feedback form (confidential)

Separate from the desk; only StudyLink staff can see responses (an institution rep never sees how a
student rated their desk). Reachable by **onsite QR** (now) and **emailed/Zalo link** (when SMTP is live)
— same token, so onsite and later are one form. One page, **two levels**, generated per student.

### Two levels (header + detail)
The form has a **header-detail** structure: one exhibition record per student, with many institution
records hanging off it.

**Level 1 — Exhibition (answered once):** the overall StudyLink event. Stored once on `event_feedback`.

| Item | Type |
|------|------|
| Overall event rating | 1–5 |
| Information was useful / relevant | 1–5 |
| Reps were knowledgeable | 1–5 |
| Presentation / clarity | 1–5 |
| How well organised | 1–5 |
| Likelihood to apply through StudyLink | 1–5 (intent signal) |
| Suggestions | open text |

**Level 2 — Desks (one per institution visited):** a repeating block, pre-filled from the visit log,
one row per institution in the child table `event_feedback_institutions`. Keep it light to protect completion rates.

| Item | Type |
|------|------|
| Rating for this institution | 1–5 |
| Comment (optional) | short text |

### Rules
- **Per institution, not per visit.** The visit log is de-duplicated to distinct institutions, so a
  student who stopped at the Monash desk three times rates Monash *once*. (This is separate from the
  *rep's* per-visit rating on `event_desk_visits` — Monash can hold three rep-ratings of that student but receives one student-rating back.)
- **Zero-desk case** — a student who visited no desks gets the exhibition section only; no child rows, form still valid.
- **One submission per student per event** — re-opening the link lets them revise their answers until the
  event closes, then it locks. No duplicate submissions.

### Reconciliation
Because desk sessions are timestamped, a Level-2 rating maps to the institution *and* the operator who
served that student at the time; Level-1 answers roll up to the event. Both institution- and staff-level
feedback fall out of the same form.

---

## 9. Cross-cutting considerations

- **Privacy & consent** — external institutions see a minimised view; capture student consent to share
  limited details with institutions (extend the LQ consent). This is a legal/reputation issue, not just UX.
- **Audit** — every desk login, scan, and note logged (important with outside operators).
- **Connectivity** — venue wifi is unreliable; BYOD phones with mobile data help but aren't guaranteed
  (foreign reps may lack local data). Decide between graceful-fail and local-queue-and-sync.
- **Devices (BYOD)** — desk screen is a mobile-first web page (URL + magic-link login + phone-camera scan);
  laptops/tablets get the same responsive page.
- **Access termination** — driven by the event start/end dates already captured; closing the event kills
  all `Event staff` access and desk tokens at once.
- **Multi-day** — `valid_until` = event end, so access persists across days then dies at the close.

---

## 10. Phased build plan

Each phase is independently usable at a real event.

- **Phase 1 — Roster + check-in + walk-in.** `events`, `event_attendees`, the roster screen with
  search filters and email/phone, manual check-in with the **completion flow** (mandatory data + self-assessment
  gate, reusing the LQ form tabs) + QR minting, and the LQ walk-in deep-link.
- **Phase 2 — Desk capture.** `institutions` master list + per-event picker, `event_institutions`,
  `desk_sessions`, `event_desk_visits`, the `Event staff` role, magic-link login, mobile desk screen with scan → note + rep rating.
- **Phase 3 — Feedback + reporting.** Confidential feedback form (onsite QR now, email/Zalo when SMTP lands),
  `event_feedback`, and the event report (attendance %, desk traffic, ratings reconciled to staff + institution, conversion).

---

## 11. Still open / to confirm

- Confirm `Event staff` reps are **write-only** on notes (cannot read prior notes) — current assumption.
- Connectivity strategy (graceful-fail vs offline queue) — to be decided before Phase 2.
- Exact student-consent wording for sharing data with institutions.
- **Which lead fields are mandatory at check-in** (the set the short pre-registration didn't capture).
- **Check-in device** — does the student complete their data/self-assessment on their own phone (via a link)
  or on a shared check-in tablet/kiosk? ("their screen" implies a student-facing device.)
- Confirm note-topic format: `{event name} {start yymmdd}` (vs plain `mmdd`).
