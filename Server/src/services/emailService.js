// server/src/services/emailService.js
// Sends OTP emails via Gmail OAuth2 using individual GMAIL_* env variables

const nodemailer = require('nodemailer');
const config = require('../config');

async function sendOTPEmail(to, otp) {
  if (!config.gmail.privateKey) {
    console.log(`[DEV] OTP for ${to}: ${otp}`);
    return { success: true, mode: 'dev-console' };
  }

  const transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,
    auth: {
      type:          'OAuth2',
      user:          config.gmail.fromEmail,
      serviceClient: config.gmail.clientId,
      privateKey:    config.gmail.privateKey,
    },
  });

  await transporter.sendMail({
    from:    `StudyLink <${config.gmail.fromEmail}>`,
    to,
    subject: 'Your StudyLink verification code',
    text:    `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #333;">StudyLink Verification</h2>
        <p style="color: #555;">Enter this code to complete your login:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 10px; padding: 24px;
                    background: #f5f5f5; text-align: center; border-radius: 8px;
                    color: #222; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #888; font-size: 13px;">
          This code expires in <strong>10 minutes</strong>.<br>
          If you did not request this, please ignore this email.
        </p>
      </div>
    `,
  });

  console.log(`[EMAIL] OTP sent to ${to} via Gmail OAuth2`);
  return { success: true, mode: 'gmail-oauth2' };
}

module.exports = { sendOTPEmail };
