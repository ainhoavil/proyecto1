// backend/routes/contacto.js
import express from "express";
import { query } from "../db.js";

const router = express.Router();

// POST /api/contacto  → guardar mensaje de contacto
router.post("/", async (req, res) => {
  try {
    const { nombre, email, mensaje, honeypot } = req.body || {};

    // 1) Honeypot: si viene relleno, tratamos como bot y no hacemos nada
    if (honeypot && String(honeypot).trim() !== "") {
      // Respondemos 204 (sin contenido) para no dar pistas al bot
      return res.status(204).end();
    }

    if (!nombre || !email || !mensaje) {
      return res.status(400).json({ error: "Faltan campos" });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // 2) Rate limit básico por email: máx 1 mensaje / 60 segundos
    try {
      const rows = await query(
        "SELECT fecha FROM mensajes WHERE email = ? ORDER BY fecha DESC LIMIT 1",
        [email]
      );
      const last = rows && rows[0];

      if (last?.fecha) {
        const lastDate = new Date(last.fecha);
        const diffMs = now.getTime() - lastDate.getTime();
        const diffSec = diffMs / 1000;

        if (diffSec < 60) {
          return res.status(429).json({
            error: "Has enviado un mensaje hace muy poco, espera un momento antes de volver a intentarlo.",
          });
        }
      }
    } catch (e) {
      // Si falla el check, no bloqueamos el envío: solo lo registramos
      console.error("Error comprobando último mensaje de contacto:", e);
    }

    // 3) Guardar mensaje
    await query(
      `INSERT INTO mensajes (id, nombre, email, mensaje, fecha)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
      [nombre, email, mensaje, nowIso]
    );

    res.status(201).json({ mensaje: "Enviado correctamente" });
  } catch (error) {
    console.error("POST /api/contacto", error);
    res.status(500).json({ error: "Error al guardar el mensaje" });
  }
});

export default router;
