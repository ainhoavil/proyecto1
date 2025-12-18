import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   GET /api/bloqueos/day?fecha=YYYY-MM-DD
   Devuelve bloqueos del adiestrador logueado en una fecha
   Roles: adiestrador / admin
============================================================ */
router.get(
  "/day",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha } = req.query;
      const trainerId = req.user?.id;

      if (!fecha) {
        return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
      }
      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const rows = await query(
        `
        SELECT id, fecha, hora
          FROM bloqueos
         WHERE fecha = ?
           AND trainer_id = ?
         ORDER BY hora ASC
        `,
        [fecha, trainerId]
      );

      res.json(rows);
    } catch (e) {
      console.error("GET /bloqueos/day", e);
      res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
    }
  }
);

/* ============================================================
   POST /api/bloqueos
   Crea un bloqueo para una hora concreta
   Roles: adiestrador / admin
============================================================ */
router.post(
  "/",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha, hora } = req.body;
      const trainerId = req.user?.id;

      if (!fecha || !hora) {
        return res.status(400).json({ error: "Faltan datos" });
      }
      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      // Evitar duplicados
      const exists = await query(
        `
        SELECT id
          FROM bloqueos
         WHERE fecha = ?
           AND hora = ?
           AND trainer_id = ?
         LIMIT 1
        `,
        [fecha, hora, trainerId]
      );

      if (exists.length) {
        return res.status(409).json({ error: "La hora ya está bloqueada" });
      }

      await query(
        `
        INSERT INTO bloqueos (fecha, hora, trainer_id)
        VALUES (?, ?, ?)
        `,
        [fecha, hora, trainerId]
      );

      res.json({ ok: true });
    } catch (e) {
      console.error("POST /bloqueos", e);
      res.status(500).json({ error: "No se pudo crear el bloqueo" });
    }
  }
);

/* ============================================================
   DELETE /api/bloqueos
   Elimina un bloqueo por fecha + hora
   Roles: adiestrador / admin
============================================================ */
router.delete(
  "/",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha, hora } = req.body;
      const trainerId = req.user?.id;

      if (!fecha || !hora) {
        return res.status(400).json({ error: "Faltan datos" });
      }
      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      await query(
        `
        DELETE FROM bloqueos
         WHERE fecha = ?
           AND hora = ?
           AND trainer_id = ?
        `,
        [fecha, hora, trainerId]
      );

      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /bloqueos", e);
      res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
    }
  }
);

export default router;
