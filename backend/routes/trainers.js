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
        const rows = await query(
          `
          SELECT
            au.id AS uid,
            au.email AS email,
            COALESCE(
              NULLIF(tp.display_name, ''),
              NULLIF(up.nombre, ''),
              au.email
            ) AS displayName
          FROM usuarios au
          LEFT JOIN trainer_profiles tp
            ON tp.trainer_id = au.id
          LEFT JOIN users up
            ON up.uid = au.id
          WHERE au.rol = 'adiestrador'
          ORDER BY displayName ASC, au.email ASC
          `
        );
        return rows;
      };

      // SIN FILTROS → TODOS
      if (!servicioId) {
        const rows = await getAll();
        return res.json(rows);
      }

      // CON FILTROS → COMPATIBLES
      let rows = [];
      try {
        rows = await query(
          `
          SELECT DISTINCT
            au.id AS uid,
            au.email AS email,
            COALESCE(
              NULLIF(tp.display_name, ''),
              NULLIF(up.nombre, ''),
              au.email
            ) AS displayName
          FROM usuarios au
          JOIN trainer_servicios ts
            ON ts.trainer_id = au.id
          LEFT JOIN trainer_profiles tp
            ON tp.trainer_id = au.id
          LEFT JOIN users up
            ON up.uid = au.id
          WHERE au.rol = 'adiestrador'
            AND ts.enabled = 1
            AND ts.servicio_id = ?
            AND (
              ts.modalidad IS NULL
              OR ts.modalidad = ''
              OR ? IS NULL
              OR ts.modalidad = ?
            )
          ORDER BY displayName ASC, au.email ASC
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
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      // reservas.uid = usuarios.id (cliente)
      const rows = await query(
        `
        SELECT DISTINCT
          cu.id AS id,
          cu.email AS email,
          COALESCE(NULLIF(up.nombre,''), cu.email) AS displayName
        FROM reservas r
        JOIN usuarios cu
          ON cu.id = r.uid
        LEFT JOIN users up
          ON up.uid = cu.id
        WHERE r.trainer_id = ?
          AND r.uid IS NOT NULL
          AND r.status IN ('pending','pending_user','confirmed')
        ORDER BY displayName ASC, cu.email ASC
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
   Listado público de adiestradores (con perfil + fallback a users)
============================================================ */
router.get("/public", async (_req, res) => {
  try {
    const rows = await query(`
      SELECT
        au.id AS trainerId,
        au.email AS email,

        COALESCE(
          NULLIF(tp.display_name, ''),
          NULLIF(up.nombre, ''),
          au.email
        ) AS displayName,

        COALESCE(
          NULLIF(tp.bio, ''),
          NULLIF(up.notas, ''),
          ''
        ) AS bio,

        COALESCE(
          NULLIF(tp.photo_url, ''),
          NULLIF(up.foto, ''),
          ''
        ) AS photoUrl,

        tp.experience_years AS experienceYears,
        tp.specialties AS specialties

      FROM usuarios au
      LEFT JOIN trainer_profiles tp
        ON tp.trainer_id = au.id
      LEFT JOIN users up
        ON up.uid = au.id

      WHERE au.rol = 'adiestrador'
      ORDER BY displayName ASC, au.email ASC
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
        email: r.email,
        displayName: r.displayName,
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
