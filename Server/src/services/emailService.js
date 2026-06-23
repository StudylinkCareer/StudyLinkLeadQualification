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
//   fields - { name, eventName, badgeUrl, badgePngBase64, profileUrl }
//   profileUrl - public "Know you better" form link (/profile?t=<token>); when
//                present the relay renders a button under the badge image.
async function sendEventQrEmail(to, { name = '', eventName = '', badgeUrl = '', badgePngBase64 = '', profileUrl = '' } = {}) {
  const gasUrl = config.gas.sendOtpUrl;
  if (!badgePngBase64) {
    throw new Error('badgePngBase64 is required');
  }
  if (!gasUrl) {
    console.log(`[DEV] event badge email for ${to} (${eventName || 'event'})`);
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
      badgePng: badgePngBase64,
      profileUrl,
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

module.exports = { sendOTPEmail, sendEventQrEmail, sendRepLinkEmail };
