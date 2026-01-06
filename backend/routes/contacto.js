// backend/routes/contacto.js
import express from "express";
import { query } from "../db.js";
import { sendMail, buildEmailHtml } from "../utils/mailer.js";
import {
  hasMinLetters,
  isValidEmail,
  isValidSpanishPhone,
  normalizeSpanishPhone,
} from "../utils/validators.js";

const router = express.Router();

function pickBody(body = {}) {
  // Soporta 2 formatos:
  // A) { nombre, email, mensaje, telefono, tipoServicio, honeypot }
  // B) { name, email, message, phone, serviceType, website }
  const nombre = body.nombre ?? body.name ?? "";
  const email = body.email ?? "";
  const mensaje = body.mensaje ?? body.message ?? "";
  const telefono = body.telefono ?? body.phone ?? "";
  const tipoServicio = body.tipoServicio ?? body.serviceType ?? "";
  const honeypot = body.honeypot ?? body.website ?? "";
  const ts = body.ts ?? body.loadedAt ?? "";

  return {
    nombre: String(nombre || "").trim(),
    email: String(email || "").trim(),
    mensaje: String(mensaje || "").trim(),
    telefono: String(telefono || "").trim(),
    tipoServicio: String(tipoServicio || "").trim(),
    honeypot: String(honeypot || "").trim(),
    ts: ts === "" || ts == null ? "" : Number(ts),
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isNoSuchTableMensajes(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("no such table: mensajes");
}

// POST /api/contacto
router.post("/", async (req, res) => {
  try {
    const { nombre, email, mensaje, telefono, tipoServicio, honeypot, ts } = pickBody(
      req.body
    );

    // Honeypot
    if (honeypot) return res.status(204).end();

    // Tiempo mínimo (anti-bot): si llega "ts" desde frontend
    if (ts && Number.isFinite(Number(ts))) {
      const elapsed = Date.now() - Number(ts);
      if (elapsed >= 0 && elapsed < 3000) {
        return res.status(429).json({
          error: "Has enviado el formulario demasiado rápido, inténtalo de nuevo.",
        });
      }
    }

    if (!nombre || !email || !mensaje) {
      return res.status(400).json({ error: "Faltan campos (nombre/email/mensaje)" });
    }

    if (!hasMinLetters(nombre, 2)) {
      return res.status(400).json({ error: "El nombre debe tener al menos 2 letras" });
    }

    const emailNorm = String(email).trim().toLowerCase();
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ error: "El email no parece válido" });
    }

    if (String(mensaje).trim().length < 10) {
      return res
        .status(400)
        .json({ error: "El mensaje debe tener al menos 10 caracteres" });
    }

    const phoneNorm = telefono ? normalizeSpanishPhone(telefono) : "";
    if (telefono && (!phoneNorm || !isValidSpanishPhone(phoneNorm))) {
      return res
        .status(400)
        .json({ error: "Teléfono inválido (España: 9 dígitos)" });
    }

    const nowIso = new Date().toISOString();

    // (Opcional) Rate limit + guardado en BD si existe tabla "mensajes"
    try {
      const rows = await query(
        "SELECT fecha FROM mensajes WHERE email = ? ORDER BY fecha DESC LIMIT 10",
        [emailNorm]
      );
      const last = rows?.[0];

      // 1) 1 mensaje por minuto por email
      if (last?.fecha) {
        const diffMs = Date.now() - new Date(last.fecha).getTime();
        if (diffMs < 60_000) {
          return res.status(429).json({
            error:
              "Has enviado un mensaje hace muy poco, espera un momento antes de volver a intentarlo.",
          });
        }
      }

      // 2) Máximo 5 por hora (best-effort)
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const lastHourCount = (rows || []).filter((r) => {
        const t = new Date(r?.fecha || "").getTime();
        return Number.isFinite(t) && t >= oneHourAgo;
      }).length;
      if (lastHourCount >= 5) {
        return res.status(429).json({
          error:
            "Has enviado demasiados mensajes en poco tiempo. Espera un rato y vuelve a intentarlo.",
        });
      }

      await query(
        `INSERT INTO mensajes (id, nombre, email, mensaje, fecha)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
        [nombre, emailNorm, mensaje, nowIso]
      );
    } catch (e) {
      // Si no existe la tabla, no rompemos el envío.
      if (!isNoSuchTableMensajes(e)) console.error("Contacto DB error:", e);
    }

    // Email destino (tu correo del sistema)
    const to =
      process.env.CONTACT_TO ||
      process.env.EMAIL_FROM_EMAIL ||
      process.env.EMAIL_USER ||
      "dogformtraining@gmail.com";

    // Nota: si no hay config de mailer (EMAIL_USER/EMAIL_PASS o SMTP...),
    // el mailer entra en modo DEV LOG (no rompe).

    const appName = String(process.env.APP_NAME || "DogForm").trim();
    const subject = `${appName} · Nuevo mensaje de contacto`;

    // Texto plano (por si el cliente de correo no renderiza HTML)
    const linesTxt = [
      `Nombre: ${nombre}`,
      `Email: ${emailNorm}`,
      phoneNorm ? `Teléfono: ${phoneNorm}` : null,
      tipoServicio ? `Tipo de servicio: ${tipoServicio}` : null,
      `Fecha: ${nowIso}`,
    ].filter(Boolean);

    const text = `${linesTxt.join("\n")}\n\nMensaje:\n${mensaje}\n`;

    // ✅ HTML que SÍ incluye el mensaje (con saltos)
    const contentHtml = `
      <h3 style="margin:16px 0 8px; font-size:16px;">Mensaje</h3>
      <div style="white-space: pre-wrap; border:1px solid #eeeeee; background:#fafafa; padding:12px; border-radius:10px; color:#111;">
        ${escapeHtml(mensaje)}
      </div>
      <p style="margin:16px 0 0; color:#666; font-size:12px;">
        Responde a este email y se enviará al cliente (Reply-To).
      </p>
    `;

    const html = buildEmailHtml({
      title: "Nuevo mensaje de contacto",
      intro: "Has recibido una nueva consulta desde el formulario de contacto.",
      lines: [
        `Nombre: ${nombre}`,
        `Email: ${emailNorm}`,
        phoneNorm ? `Teléfono: ${phoneNorm}` : "",
        tipoServicio ? `Tipo de servicio: ${tipoServicio}` : "",
        `Fecha: ${nowIso}`,
      ].filter(Boolean),
      contentHtml,
      footer: "DogForm · Formulario de contacto",
    });

    const mail = await sendMail({
      to,
      subject,
      text,
      html,
      replyTo: emailNorm, // ✅ Responder al cliente
    });

    return res.status(201).json({
      ok: true,
      emailSent: !!mail?.ok,
      ...(mail?.ok ? {} : { emailReason: mail?.reason || mail?.error || "SEND_FAILED" }),
    });
  } catch (error) {
    console.error("POST /api/contacto", error);
    res.status(500).json({ error: "Error al procesar el mensaje" });
  }
});

export default router;
