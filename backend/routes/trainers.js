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

      const getAll = async () => {
        const rows = await query(
          `SELECT id AS uid, email
             FROM usuarios
            WHERE rol = 'adiestrador'
            ORDER BY email ASC`
        );
        return rows;
      };

      if (!servicioId) {
        const rows = await getAll();
        return res.json(rows);
      }

      let rows = [];
      try {
        rows = await query(
          `
          SELECT DISTINCT
                 u.id AS uid,
                 u.email
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
      } catch {
        rows = [];
      }

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
   Devuelve los clientes del adiestrador autenticado
   Roles: adiestrador / admin
============================================================ */
router.get(
  "/me/clients",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.uid || req.user?.id || "");
      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const rows = await query(
        `
        SELECT DISTINCT
               u.id,
               u.email
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

/* ============================================================
   GET /api/trainers/public
   Listado público de adiestradores (COMPATIBLE CON DB ACTUAL)
============================================================ */
router.get("/public", async (_req, res) => {
  try {
    const rows = await query(`
      SELECT
        id AS trainerId,
        email AS displayName
      FROM usuarios
      WHERE rol = 'adiestrador'
      ORDER BY email ASC
    `);

    res.json(
      rows.map((r) => ({
        trainerId: r.trainerId,
        displayName: r.displayName,
        photoUrl: null,
        experienceYears: null,
        specialties: [],
      }))
    );
  } catch (err) {
    console.error("GET /api/trainers/public error:", err);
    res.status(500).json({ error: "No se pudo cargar el listado" });
  }
});

export default router;
