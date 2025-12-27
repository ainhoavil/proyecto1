import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   GET /api/trainers/:id/profile
   PERFIL PÚBLICO (SIN AUTH)
============================================================ */
router.get("/:id/profile", async (req, res) => {
  try {
    const { id } = req.params;

    const rows = await query(
      `
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
      WHERE u.id = ?
        AND u.rol = 'adiestrador'
      LIMIT 1
      `,
      [String(id)]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Adiestrador no encontrado" });
    }

    const profile = rows[0];

    // Parse specialties
    let specialties = [];
    if (profile.specialties) {
      try {
        const parsed = JSON.parse(profile.specialties);
        specialties = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        specialties = [String(profile.specialties)];
      }
    }

    res.json({
      trainerId: profile.trainerId,
      email: profile.email,
      displayName: profile.displayName,
      bio: profile.bio || "",
      photoUrl: profile.photoUrl || "",
      experienceYears:
        profile.experienceYears === null || profile.experienceYears === undefined
          ? null
          : Number(profile.experienceYears),
      specialties,
    });
  } catch (e) {
    console.error("GET /api/trainers/:id/profile", e);
    res.status(500).json({ error: "No se pudo cargar el perfil" });
  }
});

/* ============================================================
   GET /api/trainers/me/profile
   PERFIL PRIVADO (adiestrador / admin)
============================================================ */
router.get(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.id || req.user?.uid || "");

      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const rows = await query(
        `
        SELECT
          trainer_id AS trainerId,
          display_name AS displayName,
          bio,
          photo_url AS photoUrl,
          experience_years AS experienceYears,
          specialties
        FROM trainer_profiles
        WHERE trainer_id = ?
        LIMIT 1
        `,
        [trainerId]
      );

      if (!rows.length) {
        return res.json({
          trainerId,
          displayName: "",
          bio: "",
          photoUrl: "",
          experienceYears: null,
          specialties: [],
          exists: false,
        });
      }

      const profile = rows[0];

      let specialties = [];
      if (profile.specialties) {
        try {
          const parsed = JSON.parse(profile.specialties);
          specialties = Array.isArray(parsed) ? parsed : [String(parsed)];
        } catch {
          specialties = [String(profile.specialties)];
        }
      }

      res.json({
        trainerId: profile.trainerId,
        displayName: profile.displayName || "",
        bio: profile.bio || "",
        photoUrl: profile.photoUrl || "",
        experienceYears:
          profile.experienceYears === null || profile.experienceYears === undefined
            ? null
            : Number(profile.experienceYears),
        specialties,
        exists: true,
      });
    } catch (e) {
      console.error("GET /api/trainers/me/profile", e);
      res.status(500).json({ error: "No se pudo cargar tu perfil" });
    }
  }
);

/* ============================================================
   POST /api/trainers/me/profile
   CREAR / ACTUALIZAR PERFIL (UPSERT)
============================================================ */
router.post(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.id || req.user?.uid || "");

      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const {
        displayName = "",
        bio = "",
        photoUrl = "",
        experienceYears = null,
        specialties = [],
      } = req.body;

      // Validación mínima (no forzar number si te llega string desde forms)
      const exp =
        experienceYears === null || experienceYears === undefined || experienceYears === ""
          ? null
          : Number(experienceYears);

      if (typeof displayName !== "string" || typeof bio !== "string") {
        return res.status(400).json({ error: "Datos inválidos" });
      }
      if (exp !== null && Number.isNaN(exp)) {
        return res.status(400).json({ error: "Datos inválidos" });
      }

      const specialtiesStr = Array.isArray(specialties)
        ? JSON.stringify(specialties)
        : JSON.stringify([]);

      await query(
        `
        INSERT INTO trainer_profiles (
          trainer_id,
          display_name,
          bio,
          photo_url,
          experience_years,
          specialties,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(trainer_id) DO UPDATE SET
          display_name = excluded.display_name,
          bio = excluded.bio,
          photo_url = excluded.photo_url,
          experience_years = excluded.experience_years,
          specialties = excluded.specialties,
          updated_at = datetime('now')
        `,
        [trainerId, displayName, bio, photoUrl, exp, specialtiesStr]
      );

      res.json({ ok: true });
    } catch (e) {
      console.error("POST /api/trainers/me/profile", e);
      res.status(500).json({ error: "No se pudo guardar el perfil" });
    }
  }
);

export default router;
