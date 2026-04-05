const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendOTPEmail(to, otp) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV] OTP for ${to}: ${otp}`);
    return { success: true, mode: 'dev-console' };
  }

  const { error } = await resend.emails.send({
    from: 'StudyLink <onboarding@resend.dev>',
    to,
    subject: 'StudyLink - Your Verification Code',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:20px;">
        <h2 style="color:#2563eb;">StudyLink Verification</h2>
        <p>Your verification code is:</p>
        <div style="background:#f0f4ff;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
          <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e40af;">${otp}</span>
        </div>
        <p style="color:#666;font-size:14px;">This code expires in 10 minutes.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }

  console.log(`OTP email sent to ${to}`);
  return { success: true };
}

module.exports = { sendOTPEmail };