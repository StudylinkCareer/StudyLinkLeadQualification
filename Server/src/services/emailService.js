const config = require('../config');

async function sendOTPEmail(to, otp) {
  const gasUrl = config.gas.sendOtpUrl;

  if (!gasUrl) {
    // Fallback: log to console in dev mode
    console.log(`[DEV] OTP for ${to}: ${otp}`);
    return { success: true, mode: 'dev-console' };
  }

  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: to, otp }),
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

module.exports = { sendOTPEmail };
