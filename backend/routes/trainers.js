import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   GET /api/trainers/eligible
   - Si NO hay servicioId → devuelve todos los adiestradores
   - Si hay servicioId (+ modalidad) → filtra por trainer_servicios
     y si no hay datos → fallback a todos
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
        const rows = await query(`
          SELECT
            u.id AS uid,
            u.email
          FROM usuarios u
          WHERE u.rol = 'adiestrador'
          ORDER BY u.email ASC
        `);
        return rows;
      };

      if (!servicioId) {
        return res.json(await getAll());
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

      if (!rows.length) {
        return res.json(await getAll());
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
      const trainerId = String(req.user?.id || "");
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
   Listado público de adiestradores (DB REAL)
   - usuarios → auth + rol
   - trainer_profiles → info pública
============================================================ */
router.get("/public", async (_req, res) => {
  try {
    const rows = await query(`
      SELECT
        u.id AS trainerId,
        u.email AS email,
        COALESCE(NULLIF(tp.display_name, ''), u.email) AS displayName,
        tp.bio AS bio,
        tp.photo_url AS photoUrl,
        tp.experience_years AS experienceYears,
        tp.specialties AS specialties
      FROM usuarios u
      LEFT JOIN trainer_profiles tp
        ON tp.trainer_id = u.id
      WHERE u.rol = 'adiestrador'
      ORDER BY displayName ASC, u.email ASC
    `);

    const data = rows.map((r) => {
      let specialties = [];
      if (r.specialties) {
        try {
          const parsed = JSON.parse(r.specialties);
          specialties = Array.isArray(parsed) ? parsed : [String(parsed)];
        } catch {
          specialties = [String(r.specialties)];
        }
      }

      return {
        trainerId: r.trainerId,
        displayName: r.displayName,
        email: r.email,
        bio: r.bio || "",
        photoUrl: r.photoUrl || "",
        experienceYears:
          r.experienceYears === null || r.experienceYears === undefined
            ? null
            : Number(r.experienceYears),
        specialties,
      };
    });

    res.json(data);
  } catch (err) {
    console.error("GET /api/trainers/public error:", err);
    res.status(500).json({ error: "No se pudo cargar el listado" });
  }
});

export default router;
