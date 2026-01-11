import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ===================== schema (trainer_profiles) ===================== */

let _schemaReady = false;
let _schemaPromise = null;

async function ensureTrainerProfilesSchema() {
  if (_schemaReady) return;
  if (_schemaPromise) return _schemaPromise;

  _schemaPromise = (async () => {
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

    _schemaReady = true;
  })().finally(() => {
    if (!_schemaReady) _schemaPromise = null;
  });

  return _schemaPromise;
}

/* ===================== helpers ===================== */

function normalizeArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function parseSpecialties(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return normalizeArray(raw);
  const s = String(raw || "").trim();
  if (!s) return [];

  // JSON
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return normalizeArray(parsed);
    if (parsed == null) return [];
    return normalizeArray([parsed]);
  } catch {
    // comma separated
    return normalizeArray(
      s
        .split(",")
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    );
  }
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function trainerExists(trainerId) {
  const rows = await query(
    `SELECT 1 FROM usuarios
      WHERE id = ?
        AND lower(COALESCE(rol,'')) IN ('adiestrador','trainer')
      LIMIT 1`,
    [trainerId]
  );
  return rows.length > 0;
}

async function profileRowExists(trainerId) {
  await ensureTrainerProfilesSchema();
  const rows = await query(
    `SELECT 1 FROM trainer_profiles WHERE trainer_id = ? LIMIT 1`,
    [trainerId]
  );
  return rows.length > 0;
}

async function getTrainerProfile(trainerId) {
  await ensureTrainerProfilesSchema();

  // Nota: en este proyecto existen ambas tablas (usuarios + users)
  // y pueden tener campos útiles como nombre/foto/notas.
  const rows = await query(
    `
    SELECT
      au.id AS trainerId,
      au.email AS email,

      COALESCE(NULLIF(tp.display_name, ''), NULLIF(u.nombre, ''), au.email) AS displayName,
      COALESCE(NULLIF(tp.bio, ''), NULLIF(u.notas, ''), '') AS bio,
      COALESCE(NULLIF(tp.photo_url, ''), NULLIF(u.foto, ''), '') AS photoUrl,

      tp.experience_years AS experienceYears,
      tp.specialties AS specialties
    FROM usuarios au
    LEFT JOIN trainer_profiles tp ON tp.trainer_id = au.id
    LEFT JOIN users u ON u.uid = au.id
    WHERE au.id = ?
      AND lower(COALESCE(au.rol,'')) IN ('adiestrador','trainer')
    LIMIT 1
    `,
    [trainerId]
  );

  return rows[0] || null;
}

async function getWorkDogs(trainerId) {
  try {
    const rows = await query(
      `
      SELECT
        id,
        nombre,
        raza,
        COALESCE(avatar_url, avatarURL) AS avatarUrl
      FROM perros
      WHERE user_id = ?
        AND COALESCE(archived, 0) = 0
      ORDER BY nombre COLLATE NOCASE ASC
      `,
      [trainerId]
    );

    return (rows || []).map((r) => ({
      id: r.id,
      nombre: r.nombre || "",
      raza: r.raza || "",
      avatarUrl: r.avatarUrl || "",
    }));
  } catch {
    return [];
  }
}

async function syncUserPhoto(trainerId, photoUrl) {
  try {
    // Mantener sincronizada la foto del usuario (tabla users) con el perfil público.
    // Esto evita inconsistencias entre panel admin / perfil adiestrador.
    await query(
      `UPDATE users
          SET foto = ?,
              updated_at = datetime('now')
        WHERE uid = ?`,
      [String(photoUrl ?? '').trim(), String(trainerId || '').trim()]
    );
  } catch {
    // best-effort
  }
}

async function upsertTrainerProfile(trainerId, body = {}) {
  await ensureTrainerProfilesSchema();

  const displayName = String(body.displayName || "").trim();
  const bio = String(body.bio || "").trim();

  const hasPhotoUrl =
    Object.prototype.hasOwnProperty.call(body, "photoUrl") ||
    Object.prototype.hasOwnProperty.call(body, "photo_url") ||
    Object.prototype.hasOwnProperty.call(body, "foto");
  const photoUrl = String(body.photoUrl || "").trim();
  const experienceYears = toIntOrNull(body.experienceYears);
  const specialties = JSON.stringify(parseSpecialties(body.specialties));

  const exists = await profileRowExists(trainerId);

  if (exists) {
    await query(
      `
      UPDATE trainer_profiles
         SET display_name = ?,
             bio = ?,
             photo_url = ?,
             experience_years = ?,
             specialties = ?,
             updated_at = datetime('now')
       WHERE trainer_id = ?
      `,
      [displayName, bio, photoUrl, experienceYears, specialties, trainerId]
    );
  } else {
    await query(
      `
      INSERT INTO trainer_profiles (
        trainer_id, display_name, bio, photo_url, experience_years, specialties,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
      [trainerId, displayName, bio, photoUrl, experienceYears, specialties]
    );
  }

  if (hasPhotoUrl) {
    await syncUserPhoto(trainerId, photoUrl);
  }
}

/* ==========================================================
   GET /api/trainers/me/profile
   Perfil del adiestrador autenticado
========================================================== */
router.get(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.uid || "").trim();
      if (!trainerId) return res.status(401).json({ error: "Token inválido" });

      const row = await getTrainerProfile(trainerId);
      if (!row) return res.status(404).json({ error: "Adiestrador no encontrado" });

      const exists = await profileRowExists(trainerId);

      res.json({
        exists,
        trainerId: row.trainerId,
        email: row.email,
        displayName: row.displayName || "",
        bio: row.bio || "",
        photoUrl: row.photoUrl || "",
        experienceYears: toIntOrNull(row.experienceYears),
        specialties: parseSpecialties(row.specialties),
      });
    } catch (err) {
      console.error("GET /api/trainers/me/profile error:", err);
      res.status(500).json({ error: "No se pudo cargar el perfil" });
    }
  }
);

/* ==========================================================
   POST /api/trainers/me/profile
   Crea/actualiza perfil del adiestrador autenticado
========================================================== */
router.post(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.uid || "").trim();
      if (!trainerId) return res.status(401).json({ error: "Token inválido" });

      // Solo permitir crear/editar perfiles a adiestradores
      const okTrainer = await trainerExists(trainerId);
      if (!okTrainer) {
        return res.status(403).json({ error: "Solo para adiestradores" });
      }

      await upsertTrainerProfile(trainerId, req.body || {});

      const row = await getTrainerProfile(trainerId);
      const exists = await profileRowExists(trainerId);

      res.json({
        ok: true,
        exists,
        trainerId: row?.trainerId || trainerId,
        email: row?.email || req.user?.email || "",
        displayName: row?.displayName || "",
        bio: row?.bio || "",
        photoUrl: row?.photoUrl || "",
        experienceYears: toIntOrNull(row?.experienceYears),
        specialties: parseSpecialties(row?.specialties),
      });
    } catch (err) {
      console.error("POST /api/trainers/me/profile error:", err);
      res.status(500).json({ error: "No se pudo guardar el perfil" });
    }
  }
);

/* ==========================================================
   GET /api/trainers/:trainerId/profile
   Perfil público del adiestrador + perros de trabajo
========================================================== */
router.get("/:trainerId/profile", async (req, res) => {
  try {
    const trainerId = String(req.params.trainerId || "").trim();
    if (!trainerId) return res.status(400).json({ error: "Falta trainerId" });

    const row = await getTrainerProfile(trainerId);
    if (!row) return res.status(404).json({ error: "Perfil no encontrado" });

    const workDogs = await getWorkDogs(trainerId);

    res.json({
      trainerId: row.trainerId,
      email: row.email,
      displayName: row.displayName || "",
      bio: row.bio || "",
      photoUrl: row.photoUrl || "",
      experienceYears: toIntOrNull(row.experienceYears),
      specialties: parseSpecialties(row.specialties),
      workDogs,
    });
  } catch (err) {
    console.error("GET /api/trainers/:trainerId/profile error:", err);
    res.status(500).json({ error: "No se pudo cargar el perfil" });
  }
});

/* ==========================================================
   POST /api/trainers/:trainerId/profile
   Admin guarda perfil (o el propio adiestrador si coincide)
========================================================== */
router.post(
  "/:trainerId/profile",
  verifyToken,
  allowRoles(["admin", "adiestrador"]),
  async (req, res) => {
    try {
      const trainerId = String(req.params.trainerId || "").trim();
      if (!trainerId) return res.status(400).json({ error: "Falta trainerId" });

      const isAdmin = String(req.user?.rol || "").toLowerCase() === "admin" || !!req.user?.isAdmin;
      const isSelf = String(req.user?.uid || "") === trainerId;

      if (!isAdmin && !isSelf) {
        return res.status(403).json({ error: "Permisos insuficientes" });
      }

      const okTrainer = await trainerExists(trainerId);
      if (!okTrainer) return res.status(404).json({ error: "Adiestrador no encontrado" });

      await upsertTrainerProfile(trainerId, req.body || {});

      const row = await getTrainerProfile(trainerId);
      res.json({
        ok: true,
        trainerId,
        email: row?.email || "",
        displayName: row?.displayName || "",
        bio: row?.bio || "",
        photoUrl: row?.photoUrl || "",
        experienceYears: toIntOrNull(row?.experienceYears),
        specialties: parseSpecialties(row?.specialties),
      });
    } catch (err) {
      console.error("POST /api/trainers/:trainerId/profile error:", err);
      res.status(500).json({ error: "No se pudo guardar el perfil" });
    }
  }
);

export default router;
