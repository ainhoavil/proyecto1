// backend/routes/contacto.js
import express from "express";
import { query } from "../db.js";
import { sendMail } from "../utils/mailer.js";

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

  return {
    nombre: String(nombre || "").trim(),
    email: String(email || "").trim(),
    mensaje: String(mensaje || "").trim(),
    telefono: String(telefono || "").trim(),
    tipoServicio: String(tipoServicio || "").trim(),
    honeypot: String(honeypot || "").trim(),
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
    const { nombre, email, mensaje, telefono, tipoServicio, honeypot } = pickBody(req.body);

    // Honeypot
    if (honeypot) return res.status(204).end();

    if (!nombre || !email || !mensaje) {
      return res.status(400).json({ error: "Faltan campos (nombre/email/mensaje)" });
    }

    const nowIso = new Date().toISOString();

    // (Opcional) Rate limit + guardado en BD si existe tabla "mensajes"
    try {
      const rows = await query(
        "SELECT fecha FROM mensajes WHERE email = ? ORDER BY fecha DESC LIMIT 1",
        [email]
      );
      const last = rows?.[0];

      if (last?.fecha) {
        const diffMs = Date.now() - new Date(last.fecha).getTime();
        if (diffMs < 60_000) {
          return res.status(429).json({
            error:
              "Has enviado un mensaje hace muy poco, espera un momento antes de volver a intentarlo.",
          });
        }
      }

      await query(
        `INSERT INTO mensajes (id, nombre, email, mensaje, fecha)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
        [nombre, email, mensaje, nowIso]
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
      `Email: ${email}`,
      telefono ? `Teléfono: ${telefono}` : null,
      tipoServicio ? `Tipo de servicio: ${tipoServicio}` : null,
      `Fecha: ${nowIso}`,
    ].filter(Boolean);

    const text = `${linesTxt.join("\n")}\n\nMensaje:\n${mensaje}\n`;

    // ✅ HTML que SÍ incluye el mensaje (con saltos)
    const html = `
      <div style="font-family: Arial, sans-serif; background:#f6f6f6; padding:24px;">
        <div style="max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #eeeeee; border-radius:12px; padding:24px;">
          <h2 style="margin:0 0 12px; font-size:22px;">Nuevo mensaje de contacto</h2>
          <p style="margin:0 0 16px; color:#333;">Has recibido una nueva consulta desde el formulario de contacto.</p>

          <ul style="margin:0 0 16px; padding-left:18px; color:#111;">
            <li><strong>Nombre:</strong> ${escapeHtml(nombre)}</li>
            <li><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></li>
            ${telefono ? `<li><strong>Teléfono:</strong> ${escapeHtml(telefono)}</li>` : ""}
            ${tipoServicio ? `<li><strong>Tipo de servicio:</strong> ${escapeHtml(tipoServicio)}</li>` : ""}
            <li><strong>Fecha:</strong> ${escapeHtml(nowIso)}</li>
          </ul>

          <h3 style="margin:16px 0 8px; font-size:16px;">Mensaje</h3>
          <div style="white-space: pre-wrap; border:1px solid #eeeeee; background:#fafafa; padding:12px; border-radius:10px; color:#111;">
            ${escapeHtml(mensaje)}
          </div>

          <p style="margin:16px 0 0; color:#666; font-size:12px;">
            Responde a este email y se enviará al cliente (Reply-To).
          </p>
        </div>
      </div>
    `;

    const mail = await sendMail({
      to,
      subject,
      text,
      html,
      replyTo: email, // ✅ Responder al cliente
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
