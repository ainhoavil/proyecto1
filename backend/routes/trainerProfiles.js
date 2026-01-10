import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ===================== schema (trainer_profiles) ===================== */

let _trainerProfilesSchemaReady = false;
let _trainerProfilesSchemaPromise = null;

async function ensureTrainerProfilesSchema() {
  if (_trainerProfilesSchemaReady) return;
  if (_trainerProfilesSchemaPromise) return _trainerProfilesSchemaPromise;

  _trainerProfilesSchemaPromise = (async () => {
    // Base table
    await query(`
      CREATE TABLE IF NOT EXISTS trainer_profiles (
        trainer_id TEXT PRIMARY KEY,
        display_name TEXT,
        bio TEXT,
        photo_url TEXT,
        experience_years INTEGER,
        specialties TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    // Backfill missing columns in older DBs
    const cols = await query("PRAGMA table_info(trainer_profiles)");
    const names = new Set((cols || []).map((c) => c.name));

    const addCol = async (name, type) => {
      if (names.has(name)) return;
      await query(`ALTER TABLE trainer_profiles ADD COLUMN ${name} ${type}`);
      names.add(name);
    };

    await addCol("display_name", "TEXT");
    await addCol("bio", "TEXT");
    await addCol("photo_url", "TEXT");
    await addCol("experience_years", "INTEGER");
    await addCol("specialties", "TEXT");
    await addCol("created_at", "TEXT");
    await addCol("updated_at", "TEXT");

    _trainerProfilesSchemaReady = true;
  })().finally(() => {
    // allow retry if something transient failed
    if (!_trainerProfilesSchemaReady) _trainerProfilesSchemaPromise = null;
  });

  return _trainerProfilesSchemaPromise;
}

/* ===================== helpers ===================== */
const parseSpecialties = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return [String(raw)];
  }
};
/* ====== perros (mis perros -> perros de trabajo en perfil público) ====== */
let _perrosCols = null;
async function getPerrosCols() {
  if (_perrosCols) return _perrosCols;
  try {
    const cols = await query("PRAGMA table_info(perros)");
    _perrosCols = cols.map((c) => c.name);
  } catch {
    _perrosCols = [];
  }
  return _perrosCols;
}

async function getPerrosAvatarCol() {
  const cols = await getPerrosCols();
  if (cols.includes("avatar_url")) return "avatar_url";
  if (cols.includes("avatarURL")) return "avatarURL";
  return null;
}

/* ============================================================
   GET /api/trainers/:id/profile
   PERFIL PÚBLICO (SIN AUTH)

   PRIORIDAD DE DATOS:
   1) trainer_profiles
   2) users (perfil usuario)
   3) email
============================================================ */
router.get(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      await ensureTrainerProfilesSchema();
      const trainerId = String(req.user?.id || req.user?.uid || "");
      if (!trainerId) {
        return res.status(401).json({ error: "No autorizado" });
      }

      const rows = await query(
        `
        SELECT
          au.id AS trainerId,

          COALESCE(NULLIF(tp.display_name, ''), NULLIF(up.nombre, ''), au.email) AS displayName,
          COALESCE(NULLIF(tp.bio, ''), NULLIF(up.notas, ''), '') AS bio,
          COALESCE(NULLIF(tp.photo_url, ''), NULLIF(up.foto, ''), '') AS photoUrl,

          tp.experience_years AS experienceYears,
          tp.specialties AS specialties,

          CASE WHEN tp.trainer_id IS NULL THEN 0 ELSE 1 END AS exists

        FROM usuarios au
        LEFT JOIN trainer_profiles tp
          ON tp.trainer_id = au.id
        LEFT JOIN users up
          ON up.uid = au.id
        WHERE au.id = ?
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

      const r = rows[0];

      res.json({
        trainerId: r.trainerId,
        displayName: r.displayName || "",
        bio: r.bio || "",
        photoUrl: r.photoUrl || "",
        experienceYears:
          r.experienceYears === null || r.experienceYears === undefined
            ? null
            : Number(r.experienceYears),
        specialties: parseSpecialties(r.specialties),
        exists: Boolean(r.exists),
      });
    } catch (e) {
      console.error("GET /api/trainers/me/profile", e);
      res.status(500).json({ error: "No se pudo cargar tu perfil" });
    }
  }
);

/* ============================================================
   POST /api/trainers/me/profile
   UPSERT trainer_profiles
============================================================ */
router.post(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      await ensureTrainerProfilesSchema();
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



router.get("/:id/profile", async (req, res) => {
  try {
    await ensureTrainerProfilesSchema();
    const { id } = req.params;

    const rows = await query(
      `
      SELECT
        au.id AS trainerId,
        au.email AS email,

        -- nombre público
        COALESCE(
          NULLIF(tp.display_name, ''),
          NULLIF(up.nombre, ''),
          au.email
        ) AS displayName,

        -- bio
        COALESCE(
          NULLIF(tp.bio, ''),
          NULLIF(up.notas, ''),
          ''
        ) AS bio,

        -- foto
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
      WHERE au.id = ?
        AND au.rol = 'adiestrador'
      LIMIT 1
      `,
      [String(id)]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Adiestrador no encontrado" });
    }

    const r = rows[0];
    // En el perfil público, "perros de trabajo" son los mismos perros que el adiestrador gestiona en "Mis perros".
    const avatarCol = await getPerrosAvatarCol();
    const perrosCols = await getPerrosCols();
    const hasArchived = perrosCols.includes("archived");

    const avatarSelect = avatarCol ? `${avatarCol} AS avatarUrl` : "'' AS avatarUrl";
    const dogsSql = `
      SELECT
        id,
        nombre,
        raza,
        ${avatarSelect}
      FROM perros
      WHERE user_id = ?
      ${hasArchived ? "AND (archived IS NULL OR archived = 0)" : ""}
      ORDER BY created_at DESC
    `;

    const dogsRows = await query(dogsSql, [String(id)]);
    const workDogs = dogsRows.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      raza: d.raza,
      avatarUrl: d.avatarUrl || "",
    }));


    res.json({
      trainerId: r.trainerId,
      email: r.email,
      displayName: r.displayName,
      bio: r.bio || "",
      photoUrl: r.photoUrl || "",
      experienceYears:
        r.experienceYears === null || r.experienceYears === undefined
          ? null
          : Number(r.experienceYears),
      specialties: parseSpecialties(r.specialties),
      workDogs,
    });
  } catch (e) {
    console.error("GET /api/trainers/:id/profile", e);
    res.status(500).json({ error: "No se pudo cargar el perfil" });
  }
});

/* ============================================================
   POST /api/trainers/:id/profile
   UPSERT trainer_profiles para un adiestrador concreto
   Roles: admin
============================================================ */
router.post(
  "/:id/profile",
  verifyToken,
  allowRoles(["admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.params.id || "");
      if (!trainerId) return res.status(400).json({ error: "Datos inválidos" });

      // valida que exista y sea adiestrador
      const u = await query(
        `
        SELECT id
        FROM usuarios
        WHERE id = ?
          AND rol = 'adiestrador'
        LIMIT 1
        `,
        [trainerId]
      );
      if (!u.length) return res.status(404).json({ error: "Adiestrador no encontrado" });

      const {
        displayName = "",
        bio = "",
        photoUrl = "",
        experienceYears = null,
        specialties = [],
      } = req.body;

      const exp =
        experienceYears === null ||
        experienceYears === undefined ||
        experienceYears === ""
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
      console.error("POST /api/trainers/:id/profile", e);
      res.status(500).json({ error: "No se pudo guardar el perfil" });
    }
  }
);

/* ============================================================
   GET /api/trainers/me/profile
   PERFIL PRIVADO (adiestrador / admin)
   → también con fallback a users
============================================================ */


export default router;
