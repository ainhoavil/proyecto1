// backend/utils/mailer.js
// ============================================================
// Mailer (Nodemailer) para DogForm
// - Soporta Gmail (service) o SMTP genérico
// - En local, si NO hay credenciales, hace "DEV LOG" (no rompe)
// ============================================================

import nodemailer from "nodemailer";

// ---------- Helpers ----------

function normalizeUrlBase(url) {
  const s = String(url || "").trim();
  return s.replace(/\/+$/, "");
}

function getFrontendBaseUrl() {
  return normalizeUrlBase(process.env.FRONTEND_URL || "http://localhost:5173");
}

function escapeHtml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function roleLabel(role) {
  const r = String(role || "").trim().toLowerCase();
  if (!r) return "";
  if (["trainer", "adiestrador"].includes(r)) return "Adiestrador";
  if (["admin", "administrador"].includes(r)) return "Administrador";
  if (["client", "user", "usuario", "cliente"].includes(r)) return "Cliente";
  return String(role);
}

function getAppName() {
  return String(process.env.APP_NAME || process.env.EMAIL_FROM_NAME || "DogForm").trim();
}

function getFromAddress() {
  const name = String(process.env.EMAIL_FROM_NAME || process.env.APP_NAME || "DogForm").trim();

  const email = String(
    process.env.EMAIL_FROM_EMAIL ||
      process.env.MAIL_FROM ||
      process.env.EMAIL_USER ||
      process.env.SMTP_USER ||
      "dogformtraining@gmail.com"
  ).trim();

  // Si ya viene con formato "Nombre <mail>", lo respetamos.
  if (email.includes("<") && email.includes(">")) return email;
  return `${name} <${email}>`;
}

function getProvider() {
  // Prioridad:
  // 1) EMAIL_PROVIDER explícito
  // 2) Si hay EMAIL_USER/EMAIL_PASS => gmail
  // 3) Si hay SMTP_HOST => smtp
  const p = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  if (p) return p;

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) return "gmail";
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return "";
}

function hasMailerConfig() {
  const provider = getProvider();
  if (provider === "gmail") {
    return !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS;
  }
  if (provider === "smtp") {
    return !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
  }
  return false;
}

let cachedTransporter = null;
let cachedTransporterKey = "";

function buildTransporterKey() {
  const provider = getProvider();
  if (provider === "gmail") {
    return `gmail:${process.env.EMAIL_USER || ""}`;
  }
  if (provider === "smtp") {
    return `smtp:${process.env.SMTP_HOST || ""}:${process.env.SMTP_PORT || ""}:${process.env.SMTP_USER || ""}:${process.env.SMTP_SECURE || ""}`;
  }
  return "none";
}

function createTransporter() {
  const provider = getProvider();

  if (provider === "gmail") {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // SMTP genérico
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

export function getTransporter() {
  if (!hasMailerConfig()) return null;

  const key = buildTransporterKey();
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

  cachedTransporter = createTransporter();
  cachedTransporterKey = key;
  return cachedTransporter;
}

export async function verifyTransporter() {
  const t = getTransporter();
  if (!t) return { ok: false, reason: "MAILER_NOT_CONFIGURED" };

  try {
    await t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "VERIFY_FAILED", error: e?.message || String(e) };
  }
}

export async function sendMail({
  to,
  subject,
  text,
  html,
  replyTo,
} = {}) {
  const toNorm = String(to || "").trim();
  const subjectNorm = String(subject || "").trim();

  if (!toNorm) {
    return { ok: false, reason: "MISSING_TO" };
  }
  if (!subjectNorm) {
    return { ok: false, reason: "MISSING_SUBJECT" };
  }

  const transporter = getTransporter();

  // ✅ Modo DEV: si no hay config, no rompemos; imprimimos en consola.
  if (!transporter) {
    console.warn("\n========== [EMAIL DEV LOG] ==========");
    console.warn("To:", toNorm);
    console.warn("Subject:", subjectNorm);
    if (text) console.warn("Text:\n", String(text));
    if (html) console.warn("HTML:\n", String(html));
    console.warn("====================================\n");
    return { ok: false, reason: "MAILER_NOT_CONFIGURED" };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      to: toNorm,
      subject: subjectNorm,
      text: text ? String(text) : undefined,
      html: html ? String(html) : undefined,
      replyTo: replyTo ? String(replyTo) : undefined,
    });

    return { ok: true, messageId: info?.messageId };
  } catch (e) {
    console.error("[mailer] sendMail error:", e?.message || e);
    return { ok: false, reason: "SEND_FAILED", error: e?.message || String(e) };
  }
}

// ---------- HTML base ----------

export function buildEmailHtml({
  title,
  intro,
  lines = [],
  contentHtml,
  actionText,
  actionUrl,
  footer,
} = {}) {
  const appName = escapeHtml(getAppName());
  const titleSafe = escapeHtml(title || appName);
  const introSafe = intro ? `<p style="margin:0 0 12px 0">${escapeHtml(intro)}</p>` : "";

  const listHtml = Array.isArray(lines) && lines.length
    ? `<ul style="margin:0 0 14px 18px;padding:0">
        ${lines
          .filter(Boolean)
          .map((l) => `<li style="margin:0 0 6px 0">${escapeHtml(l)}</li>`)
          .join("\n")}
      </ul>`
    : "";

  const contentHtmlBlock = contentHtml ? `<div style="margin:0 0 14px 0">${contentHtml}</div>` : "";

  const actionHtml = actionUrl
    ? `
      <p style="margin:16px 0">
        <a href="${escapeHtml(actionUrl)}"
           style="display:inline-block;padding:10px 14px;border-radius:10px;background:#f47f2c;color:#fff;text-decoration:none;font-weight:700">
          ${escapeHtml(actionText || "Abrir")}
        </a>
      </p>
      <p style="margin:0;color:#666;font-size:12px">Si el botón no funciona, copia y pega este enlace:</p>
      <p style="margin:6px 0 0 0;color:#666;font-size:12px;word-break:break-all">${escapeHtml(actionUrl)}</p>
    `
    : "";

  const footerHtml = footer
    ? `<p style="margin:16px 0 0 0;color:#666;font-size:12px">${escapeHtml(footer)}</p>`
    : `<p style="margin:16px 0 0 0;color:#666;font-size:12px">${appName}</p>`;

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;background:#fafafa;padding:18px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:14px;padding:18px">
        <h2 style="margin:0 0 12px 0">${titleSafe}</h2>
        ${introSafe}
        ${listHtml}
        ${contentHtmlBlock}
        ${actionHtml}
        ${footerHtml}
      </div>
    </div>
  `;
}

// ---------- Emails de producto (listos para usar) ----------

export async function sendPasswordResetEmail({ to, resetUrl, minutes = 30 }) {
  const appName = getAppName();
  const subject = `${appName} · Recuperación de contraseña`;

  const text = `Has solicitado restablecer tu contraseña.\n\nAbre este enlace para crear una nueva contraseña (caduca en ${Number(minutes) || 30} min):\n${resetUrl}\n\nSi no has sido tú, ignora este email.`;

  const html = buildEmailHtml({
    title: "Recuperación de contraseña",
    intro: `Has solicitado restablecer tu contraseña. Este enlace caduca en ${Number(minutes) || 30} min.`,
    actionText: "Restablecer contraseña",
    actionUrl: resetUrl,
    footer: "Si no has sido tú, ignora este email.",
  });

  return await sendMail({ to, subject, text, html });
}

export async function sendReservationEmail({
  to,
  subject,
  title,
  intro,
  lines,
  actionPath = "/reservas",
  actionText = "Ver mis reservas",
} = {}) {
  const base = getFrontendBaseUrl();
  const actionUrl = `${base}${actionPath.startsWith("/") ? "" : "/"}${actionPath}`;

  const textLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const text = `${intro || ""}\n\n${textLines.map((l) => `- ${l}`).join("\n")}\n\nAbrir: ${actionUrl}`;

  const html = buildEmailHtml({
    title: title || "Notificación",
    intro,
    lines: textLines,
    actionText,
    actionUrl,
  });

  return await sendMail({ to, subject, text, html });
}

export async function sendChatEmail({
  to,
  subject,
  title = "Nuevo mensaje",
  intro,
  preview,
  conversationId,
} = {}) {
  const base = getFrontendBaseUrl();
  const actionUrl = `${base}/chat/${encodeURIComponent(String(conversationId || ""))}`;
  const lines = [];
  if (preview) lines.push(`Mensaje: ${String(preview).slice(0, 160)}`);

  const text = `${intro || "Tienes un nuevo mensaje."}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nAbrir chat: ${actionUrl}`;
  const html = buildEmailHtml({
    title,
    intro,
    lines,
    actionText: "Abrir chat",
    actionUrl,
  });

  return await sendMail({ to, subject, text, html });
}

export async function sendAccountCreatedEmail({ to, email, tempPassword, role }) {
  const appName = getAppName();
  const subject = `${appName} · Cuenta creada`;

  const base = normalizeUrlBase(process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173");
  const loginUrl = `${base}/login`;

  const intro = "Hemos creado una cuenta para ti. Por seguridad, cambia la contraseña al iniciar sesión.";
  const lines = [
    `Email: ${String(email || to || "").trim()}`,
    `Contraseña temporal: ${String(tempPassword || "")}`,
    role ? `Rol: ${roleLabel(role)}` : null,
  ].filter(Boolean);

  const text =
    `${intro}\n\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\n\nIniciar sesión: ${loginUrl}\n\n` +
    "Si no reconoces esta cuenta, ignora este correo o contacta con soporte.";

  const html = buildEmailHtml({
    title: "Tu cuenta está lista",
    intro,
    lines,
    actionText: "Iniciar sesión",
    actionUrl: loginUrl,
    footer: "Si no reconoces esta cuenta, ignora este correo o contacta con soporte.",
  });

  return await sendMail({ to, subject, text, html });
}



export async function sendWelcomeEmail({ to, name, role } = {}) {
  const appName = getAppName();
  const subject = `${appName} · Bienvenido/a`;

  const base = normalizeUrlBase(process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173");
  const loginUrl = `${base}/login`;

  const intro = name
    ? `Hola ${String(name).trim()}, ¡bienvenido/a a ${appName}!`
    : `¡Bienvenido/a a ${appName}!`;

  const lines = [
    role ? `Rol: ${roleLabel(role)}` : null,
    "Ya puedes iniciar sesión y gestionar tus reservas desde tu perfil.",
  ].filter(Boolean);

  const text =
    `${intro}\n\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\n\nIniciar sesión: ${loginUrl}`;

  const html = buildEmailHtml({
    title: "Bienvenido/a",
    intro,
    lines,
    actionText: "Iniciar sesión",
    actionUrl: loginUrl,
    footer: `${appName} · Soporte`,
  });

  return await sendMail({ to, subject, text, html });
}


export async function sendRoleChangedEmail({ to, name, role } = {}) {
  const appName = getAppName();
  const subject = `${appName} · Cambio de rol`;

  const intro = name
    ? `Hola ${String(name).trim()}, hemos actualizado tu rol en ${appName}.`
    : `Hemos actualizado tu rol en ${appName}.`;

  const lines = [role ? `Nuevo rol: ${roleLabel(role)}` : null].filter(Boolean);

  const base = normalizeUrlBase(process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173");
  const loginUrl = `${base}/login`;

  const text =
    `${intro}\n\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\n\nIniciar sesión: ${loginUrl}`;

  const html = buildEmailHtml({
    title: "Rol actualizado",
    intro,
    lines,
    actionText: "Iniciar sesión",
    actionUrl: loginUrl,
    footer: `${appName} · Soporte`,
  });

  return await sendMail({ to, subject, text, html });
}


export async function sendAccountDeletedEmail({ to, name } = {}) {
  const appName = getAppName();
  const subject = `${appName} · Cuenta eliminada`;

  const intro = name
    ? `Hola ${String(name).trim()}, te confirmamos que tu cuenta en ${appName} ha sido eliminada.`
    : `Te confirmamos que tu cuenta en ${appName} ha sido eliminada.`;

  const lines = [
    "Si no has solicitado esta acción, contacta con soporte lo antes posible.",
  ];

  const base = normalizeUrlBase(process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173");
  const contactUrl = `${base}/contacto`;

  const text =
    `${intro}\n\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\n\nContacto: ${contactUrl}`;

  const html = buildEmailHtml({
    title: "Cuenta eliminada",
    intro,
    lines,
    actionText: "Contactar con soporte",
    actionUrl: contactUrl,
    footer: `${appName} · Soporte`,
  });

  return await sendMail({ to, subject, text, html });
}
