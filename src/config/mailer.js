import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  secure: process.env.EMAIL_SECURE === "true", // true for 465, false for others
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendOtpEmail(toEmail, otpCode) {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  const mailOptions = {
    from,
    to: toEmail,
    subject: "Your PHINMA TestBank verification code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color:#1976D2;">Verify your email</h2>
        <p>Use the following One-Time Password (OTP) to complete your registration:</p>
        <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; padding: 12px 16px; background: #f4f6f8; border-radius: 8px; text-align:center; color:#111;">
          ${otpCode}
        </div>
        <p style="margin-top: 16px; color:#555;">This code will expire in 10 minutes.</p>
        <p style="margin-top: 24px; font-size: 12px; color:#777;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

export default transporter;


