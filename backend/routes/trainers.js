// backend/routes/trainers.js
import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   GET /api/trainers/eligible
   - Si NO hay servicioId → devuelve todos los adiestradores
   - Si hay servicioId (+ modalidad) → intenta filtrar por trainer_servicios
     y si falla o no hay datos → fallback a todos los adiestradores
   Roles: admin / client / user / adiestrador
============================================================ */
router.get(
  "/eligible",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      const { servicioId, modalidad } = req.query;
      const mod = modalidad ? String(modalidad) : null;

      // helper: devuelve todos los adiestradores SIN depender de "nombre"
      const getAll = async () => {
        // NO uses u.nombre aquí; así no rompe si la columna no existe
        const rows = await query(
          `SELECT id AS uid, email, NULL AS nombre
             FROM usuarios
            WHERE rol = 'adiestrador'
            ORDER BY email ASC`
        );
        return rows;
      };

      // SIN FILTROS → TODOS
      if (!servicioId) {
        const rows = await getAll();
        return res.json(rows);
      }

      // CON FILTROS → intentar compatibles
      let rows = [];
      try {
        rows = await query(
          `
          SELECT DISTINCT
                 u.id AS uid,
                 u.email,
                 NULL AS nombre
            FROM usuarios u
            JOIN trainer_servicios ts
              ON ts.trainer_id = u.id
           WHERE u.rol = 'adiestrador'
             AND ts.enabled = 1
             AND ts.servicio_id = ?
             AND (
               ts.modalidad IS NULL
               OR ts.modalidad = ''
               OR ? IS NULL
               OR ts.modalidad = ?
             )
           ORDER BY u.email ASC
          `,
          [String(servicioId), mod, mod]
        );
      } catch (e) {
        rows = [];
      }

      // Si no hay compatibles o trainer_servicios no existe → fallback a todos
      if (!rows || rows.length === 0) {
        const fallback = await getAll();
        return res.json(fallback);
      }

      return res.json(rows);
    } catch (err) {
      console.error("GET /api/trainers/eligible error:", err);
      res.status(500).json({
        error: "No se pudo cargar la lista de adiestradores",
      });
    }
  }
);

/* ============================================================
   GET /api/trainers/me/clients
   Devuelve los clientes del adiestrador autenticado (según reservas)
   Roles: adiestrador / admin
============================================================ */
router.get(
  "/me/clients",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      // En tu sistema suele ser req.user.uid (pero dejo fallback)
      const trainerId = String(req.user?.uid || req.user?.id || "");
      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const rows = await query(
        `
        SELECT DISTINCT
               u.id,
               u.email,
               NULL AS nombre
          FROM reservas r
          JOIN usuarios u
            ON u.id = r.uid
         WHERE r.trainer_id = ?
           AND r.uid IS NOT NULL
           AND r.status IN ('pending','pending_user','confirmed')
         ORDER BY u.email ASC
        `,
        [trainerId]
      );

      res.json(rows);
    } catch (err) {
      console.error("GET /api/trainers/me/clients error:", err);
      res.status(500).json({
        error: "No se pudieron cargar los clientes del adiestrador",
      });
    }
  }
);

export default router;
