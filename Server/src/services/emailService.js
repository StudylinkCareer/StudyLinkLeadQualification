// server/src/services/emailService.js
const config = require('../config');

async function sendOTPEmail(to, otp) {
  const gasUrl = config.gas.sendOtpUrl;
  if (!gasUrl) {
    console.log(`[DEV] OTP for ${to}: ${otp}`);
    return { success: true, mode: 'dev-console' };
  }
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: to, otp, from: 'info@studylink.org' }),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`GAS email failed: ${response.status} ${response.statusText}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'GAS email sending failed');
  }
  console.log(`OTP email sent to ${to} via GAS`);
  return result;
}

// Email a rendered event registration badge (PNG) via the same GAS relay.
// The relay's doPost branches on type === 'event_badge'.
//   to     - recipient email
//   fields - { name, eventName, badgeUrl, badgePngBase64, profileUrl, stone }
//   profileUrl - public "Know you better" form link (/profile?t=<token>); when
//                present the relay renders a button under the badge image.
//   stone      - { tier, label, message, imageUrl } from utils/stoneContent;
//                when present the relay renders the stone banner (image +
//                congratulatory message) under the badge. Omitted for
//                unscored students -> the e-mail renders exactly as before.
//   questionnaireComplete - drives the questionnaire block's copy: false ->
//                "please complete the remaining questions"; true -> "you can
//                review/update your answers".
async function sendEventQrEmail(to, { name = '', eventName = '', badgeUrl = '', badgeImageUrl = '', badgePngBase64 = '', profileUrl = '', stone = null, questionnaireComplete = false } = {}) {
  const gasUrl = config.gas.sendOtpUrl;
  if (!badgePngBase64) {
    throw new Error('badgePngBase64 is required');
  }
  if (!gasUrl) {
    console.log(`[DEV] event badge email for ${to} (${eventName || 'event'})${stone ? ` incl. stone ${stone.tier}` : ''}`);
    return { success: true, mode: 'dev-console' };
  }
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'event_badge',
      email: to,
      name,
      eventName,
      badgeUrl,
      badgeImageUrl,
      badgePng: badgePngBase64,
      profileUrl,
      stoneTier:     stone ? stone.tier     : '',
      stoneLabel:    stone ? stone.label    : '',
      stoneMessage:  stone ? stone.message  : '',
      stoneImageUrl: stone ? stone.imageUrl : '',
      questionnaireComplete: !!questionnaireComplete,
      from: 'info@studylink.org',
    }),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`GAS badge email failed: ${response.status} ${response.statusText}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'GAS badge email sending failed');
  }
  console.log(`Event badge email sent to ${to} via GAS`);
  return result;
}

// Email a student their questionnaire evaluation via the same GAS relay:
// the UPDATED stone-centred badge (inline PNG) + the stone banner + thank-you.
// Sent automatically when the "Know you better" questionnaire is submitted.
// The relay's doPost branches on type === 'stone_result'.
//   to     - recipient email
//   fields - { name, eventName, stone: { tier, label, message, imageUrl },
//              profileUrl, badgeImageUrl (public URL of the updated badge) }
async function sendStoneResultEmail(to, { name = '', eventName = '', stone = null, profileUrl = '', badgeImageUrl = '' } = {}) {
  const gasUrl = config.gas.sendOtpUrl;
  if (!stone || !stone.tier) {
    throw new Error('stone is required');
  }
  if (!gasUrl) {
    console.log(`[DEV] stone result email for ${to}: ${stone.tier}`);
    return { success: true, mode: 'dev-console' };
  }
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'stone_result',
      email: to,
      name,
      eventName,
      stoneTier:     stone.tier,
      stoneLabel:    stone.label,
      stoneMessage:  stone.message,
      stoneImageUrl: stone.imageUrl,
      profileUrl,
      badgeImageUrl,
      from: 'info@studylink.org',
    }),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`GAS stone-result email failed: ${response.status} ${response.statusText}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'GAS stone-result email sending failed');
  }
  console.log(`Stone result email sent to ${to} via GAS`);
  return result;
}

// Email a rep their one-click desk sign-in link via the same GAS relay.
// The relay's doPost branches on type === 'rep_link'.
//   to     - the rep's real staff email
//   fields - { name, eventName, link }
async function sendRepLinkEmail(to, { name = '', eventName = '', link = '' } = {}) {
  const gasUrl = config.gas.sendOtpUrl;
  if (!link) {
    throw new Error('link is required');
  }
  if (!gasUrl) {
    console.log(`[DEV] rep link email for ${to}: ${link}`);
    return { success: true, mode: 'dev-console' };
  }
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'rep_link',
      email: to,
      name,
      eventName,
      link,
      from: 'info@studylink.org',
    }),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`GAS rep-link email failed: ${response.status} ${response.statusText}`);
  }
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'GAS rep-link email sending failed');
  }
  console.log(`Rep link email sent to ${to} via GAS`);
  return result;
}

module.exports = { sendOTPEmail, sendEventQrEmail, sendStoneResultEmail, sendRepLinkEmail };
