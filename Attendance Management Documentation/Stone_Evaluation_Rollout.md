# Stone evaluation in customer messages + Roster — rollout notes

> **UPDATE 2026-07-15 (v2) — communication-flow rework.** Superseding details below where they conflict:
>
> **The two-message flow per student interaction:**
> 1. **Badge send (staff-triggered):** badge + questionnaire link, always. If the questionnaire is
>    *incomplete* → "please complete" copy. If *complete* → stone-centred badge + stone banner +
>    "you can review/update your answers" copy. (Completeness = the check-in qualification gate.)
> 2. **Follow-up (automatic on every questionnaire submit/resubmit):** the UPDATED badge with the
>    student's **stone in the centre of the QR** (replacing the StudyLink logo), the stone
>    banner/message, and a thank-you-for-registering message. Via e-mail + Zalo.
>
> **Mechanics:** the profile page renders the stone-centred badge after submit and posts it to the new
> `POST /profile/:token/badge`, which stores it (`event_attendees.badge_png`) and sends the follow-up.
> E-mails now reference the badge by **hosted URL** (`/badge-image/:token?v=…`) instead of attaching
> it — attachments were showing a second, miniaturised copy of the badge at the end of the message in
> iPhone Mail. The LM "Send badge" modal also renders the stone-centred badge for evaluated students.
>
> **Actions:**
> - **Re-run the migration** (adds `badge_png`, which `/badge-image` always needed):
>   `node src/migrations/addStoneResultColumns.js` (dev) / `--allow-remote` (PROD).
> - **Replace the whole GAS script** with `GAS_Relay_doPost.gs` (same folder) and redeploy
>   (Manage deployments → ✏️ → New version).
> - Note: e-mail images (badge + stone) resolve against the PROD server URL, so image rendering can
>   only be fully verified with PROD deployed — dev-sent e-mails will show broken images until then.

**Built:** 2026-07-15 (dev, uncommitted). Two requests from the field:

1. Include the **evaluation of the questionnaire** (the stone) in the response
   messages to the customer — via **e-mail AND Zalo**, showing the **stone +
   stone banner/message**.
2. Show the **stone image** (only the stone) against each student's row on the
   **Roster & Check-in** page.

## What the code now does

| Piece | Behaviour |
|---|---|
| Questionnaire submit (`POST /api/event-console/profile/:token`) | Saves answers, **recalculates risk score → stone tier** (same overlay logic as the LM "Calculate risk" button), returns the evaluation to the page, then fire-and-forgets the e-mail + Zalo sends and stamps `event_attendees.result_*`. |
| Thank-you page (Client `/profile?t=…`) | Shows the stone reveal card (image + "Chúc mừng Bạn! — <stone>" + VN banner message) immediately after submit. |
| Badge e-mail (`POST /api/event-console/email-badge`) | Now passes `stoneTier / stoneLabel / stoneMessage / stoneImageUrl` to the GAS relay **when the student already has a stone**; unscored students get the e-mail exactly as before. |
| Evaluation e-mail | New GAS payload `type: 'stone_result'` (see GAS changes below). |
| Evaluation Zalo | New `zaloService.sendStoneResult` — ZNS template `ZALO_ZNS_RESULT_TEMPLATE_ID` (**dormant until that env var is set**; needs a new approved template, see spec below). OA free-form fallback works for followers when `ZALO_SEND_METHOD=oa`. |
| Roster & Check-in | Each row has a **Stone** column showing just the stone image (hover = tier name); dash when unscored. |
| Stone images | Served publicly at `GET /api/event-console/stone-image/<Tier>` (Quartz/Agate/Sapphire/Ruby/Diamond) from `Server/src/assets/stones/` for use in e-mails. |

VN stone labels + banner messages are canonical (copied from the LQ i18n /
LeadManagement stone utils) and live server-side in `Server/src/utils/stoneContent.js`.

## Runbook (dev first, then PROD with `--allow-remote`)

```powershell
cd Server
node src/migrations/addStoneResultColumns.js        # adds event_attendees.result_* stamps
```

No other schema change. New/changed files:

- `Server/src/utils/stoneContent.js` (new), `Server/src/assets/stones/*.png` (new)
- `Server/src/migrations/addStoneResultColumns.js` (new)
- `Server/src/routes/eventConsole.js`, `Server/src/services/emailService.js`, `Server/src/services/zaloService.js`
- `LeadManagement/src/pages/EventConsole.jsx`
- `Client/src/pages/ProfilePage.jsx`

Env (Railway): optionally set `ZALO_ZNS_RESULT_TEMPLATE_ID=<approved template id>`
once Zalo approves the result template. Until then the Zalo leg is silently
dormant (e-mail + on-screen reveal still work).

## GAS relay changes (Google Apps Script — outside this repo)

The e-mail HTML is rendered by the Apps Script behind `GAS_SEND_OTP_URL`.
Two edits in its `doPost`:

### 1. `event_badge` — render the stone banner when present

The payload now also carries `stoneTier, stoneLabel, stoneMessage, stoneImageUrl`
(all empty strings when the student is unscored). Under the existing badge
image / profile button, add:

```javascript
// data = JSON.parse(e.postData.contents) — inside the 'event_badge' branch,
// after the badge <img> and profile button HTML:
var stoneHtml = '';
if (data.stoneTier) {
  stoneHtml =
    '<div style="margin-top:24px;padding:20px;border:1px solid #f3d6da;border-radius:12px;' +
    'background:#fdf4f5;text-align:center;">' +
    (data.stoneImageUrl
      ? '<img src="' + data.stoneImageUrl + '" alt="' + data.stoneLabel +
        '" width="96" style="width:96px;height:auto;margin-bottom:10px;" />'
      : '') +
    '<div style="font-size:18px;font-weight:800;color:#c8102e;margin-bottom:8px;">' +
    'Chúc mừng Bạn! — ' + data.stoneLabel + '</div>' +
    '<div style="font-size:14px;color:#374151;line-height:1.6;text-align:left;">' +
    data.stoneMessage + '</div>' +
    '</div>';
}
// ...append stoneHtml into the e-mail body before the closing wrapper.
```

### 2. New branch: `type === 'stone_result'` (questionnaire response e-mail)

Payload: `{ type:'stone_result', email, name, eventName, stoneTier, stoneLabel,
stoneMessage, stoneImageUrl, profileUrl, from }`.

```javascript
if (data.type === 'stone_result') {
  var subject = 'Kết quả đánh giá của bạn' + (data.eventName ? ' — ' + data.eventName : '');
  var html =
    '<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
    '<p style="font-size:15px;">Chào ' + (data.name || 'bạn') + ',</p>' +
    '<p style="font-size:14px;color:#374151;">Cảm ơn bạn đã hoàn thành bảng câu hỏi' +
    (data.eventName ? ' cho sự kiện <strong>' + data.eventName + '</strong>' : '') +
    '. Đây là kết quả đánh giá của bạn:</p>' +
    '<div style="padding:24px;border:1px solid #f3d6da;border-radius:12px;background:#fdf4f5;text-align:center;">' +
    (data.stoneImageUrl
      ? '<img src="' + data.stoneImageUrl + '" alt="' + data.stoneLabel +
        '" width="110" style="width:110px;height:auto;margin-bottom:10px;" />'
      : '') +
    '<div style="font-size:20px;font-weight:800;color:#c8102e;margin-bottom:8px;">' +
    'Chúc mừng Bạn! — ' + data.stoneLabel + '</div>' +
    '<div style="font-size:14px;color:#374151;line-height:1.6;text-align:left;">' +
    data.stoneMessage + '</div>' +
    '</div>' +
    (data.profileUrl
      ? '<p style="text-align:center;margin-top:20px;"><a href="' + data.profileUrl +
        '" style="background:#c8102e;color:#fff;text-decoration:none;padding:12px 22px;' +
        'border-radius:10px;font-weight:700;display:inline-block;">Xem hồ sơ &amp; phù hiệu của bạn</a></p>'
      : '') +
    '<p style="font-size:12px;color:#9ca3af;margin-top:24px;">StudyLink International</p>' +
    '</div>';
  GmailApp.sendEmail(data.email, subject, '', { htmlBody: html, from: data.from, name: 'StudyLink' });
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

(Adapt the send call to however the existing branches send — e.g. if they use
`MailApp` or an alias parameter, mirror that. Redeploy the web app after editing.)

## New ZNS template to request (Zalo console)

Same OA/app as the badge template (601036). Suggested content:

> **Kết quả đánh giá — StudyLink**
> Chào **{{customer_name}}**, cảm ơn bạn đã hoàn thành bảng tự đánh giá — chúng
> tôi rất mong được chào đón bạn tại **{{event_name}}**!
> Kết quả đánh giá của bạn: **{{stone_name}}**
> 📅 Thời gian: **{{event_time}}**
> 📍 Địa điểm: **{{event_venue}}**
> Mã đăng ký: **{{registration_code}}**
> Button "Xem thẻ & kết quả" → `https://slcareerguidance.netlify.app/profile?t={{token}}`

Params the server sends: `customer_name, event_name, stone_name, event_time,
event_venue, registration_code, token` (time/venue come from
`events.meta.invite`, set via `setEventInvite.js`). Once approved, set
`ZALO_ZNS_RESULT_TEMPLATE_ID` on Railway (and dev `.env`) — no code change
needed to go live.

## Test steps (dev)

1. Run the migration (above), start Server + Client + LeadManagement.
2. LM → Event Management → pick an event → roster shows the **Stone** column
   (students with a `stone_tier` show the image).
3. "Send badge" for a scored student → server log shows
   `[DEV] event badge email ... incl. stone <Tier>` when `GAS_SEND_OTP_URL` is
   unset locally.
4. Open the badge link `/profile?t=<token>` in the Client app, submit answers →
   stone reveal card appears; server log shows the stone-result e-mail line;
   `event_attendees.result_*` stamps update (e-mail only until GAS/ZNS are live).
5. Roster refresh → stone image appears/updates for that student.
