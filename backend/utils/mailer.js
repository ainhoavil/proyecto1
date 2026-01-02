// backend/utils/mailer.js
// Envío de emails (recuperación de contraseña)

import nodemailer from "nodemailer";

function hasSmtpConfig() {
  return (
    !!process.env.SMTP_HOST &&
    !!process.env.SMTP_PORT &&
    !!process.env.SMTP_USER &&
    !!process.env.SMTP_PASS
  );
}

function getTransport() {
  // SMTP típico
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true", // true para 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  const from =
    process.env.MAIL_FROM ||
    process.env.SMTP_USER ||
    "no-reply@dogform.local";
  const appName = process.env.APP_NAME || "DogForm";

  const subject = `${appName} · Recuperación de contraseña`;
  const text = `Has solicitado restablecer tu contraseña.

Abre este enlace para crear una nueva contraseña (válido por tiempo limitado):
${resetUrl}

Si no has sido tú, puedes ignorar este email.`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px 0">Recuperación de contraseña</h2>
      <p>Has solicitado restablecer tu contraseña.</p>
      <p>
        <a href="${resetUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#f47f2c;color:#fff;text-decoration:none;font-weight:700">
          Restablecer contraseña
        </a>
      </p>
      <p style="color:#666;font-size:13px">Si no has sido tú, ignora este email.</p>
      <p style="color:#666;font-size:12px">Enlace directo: ${resetUrl}</p>
    </div>
  `;

  if (!hasSmtpConfig()) {
    // En producción, esto debe estar configurado. No lanzamos error para evitar filtrar.
    console.warn("[mailer] SMTP no configurado. No se enviará el email.");
    return { ok: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  const transport = getTransport();

  // Verifica conexión de forma best-effort
  try {
    await transport.verify();
  } catch (e) {
    console.warn("[mailer] verify() falló:", e?.message || e);
    // seguimos igualmente; sendMail reportará si falla
  }

  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return { ok: true, messageId: info?.messageId };
}
