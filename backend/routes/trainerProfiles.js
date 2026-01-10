import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ===================== schema (trainer_profiles) ===================== */

let _trainerProfilesSchemaReady = false;
let _trainerProfilesSchemaPromise = null;

/* ===================== table info helpers ===================== */

const _colsCache = new Map();

function _colName(row) {
  return String(row?.name ?? row?.NAME ?? row?.Name ?? "").trim();
}

async function getCols(tableName) {
  if (_colsCache.has(tableName)) return _colsCache.get(tableName);
  try {
    const cols = await query(`PRAGMA table_info(${tableName})`);
    const names = Array.isArray(cols) ? cols.map(_colName).filter(Boolean) : [];
    _colsCache.set(tableName, names);
    return names;
  } catch {
    _colsCache.set(tableName, []);
    return [];
  }
}

function pickFirst(cols, candidates = []) {
  const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
  for (const c of candidates) {
    if (set.has(String(c).toLowerCase())) return c;
  }
  return null;
}

function nullableTextExpr(alias, col) {
  if (!col) return null;
  return `NULLIF(${alias}.${col}, '')`;
}

async function ensureUsersProfileColumnsSoft() {
  // No debe romper el endpoint si la tabla "users" no existe o tiene un esquema distinto.
  // Intentamos añadir columnas "nombre/notas/foto" como fallback, pero ignoramos errores.
  const cols = await getCols("users");
  if (!cols.length) return;

  const names = new Set(cols.map((c) => String(c).toLowerCase()));
  const tryAdd = async (name, type) => {
    if (names.has(String(name).toLowerCase())) return;
    try {
      await query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
      names.add(String(name).toLowerCase());
      // refresca cache
      _colsCache.set("users", Array.from(names));
    } catch {
      // ignore
    }
  };

  await tryAdd("nombre", "TEXT");
  await tryAdd("notas", "TEXT");
  await tryAdd("foto", "TEXT");
}

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
    const cols = await getCols("trainer_profiles");
    const names = new Set(cols.map((c) => String(c).toLowerCase()));

    const tryAddCol = async (name, type) => {
      if (names.has(String(name).toLowerCase())) return;
      try {
        await query(`ALTER TABLE trainer_profiles ADD COLUMN ${name} ${type}`);
        names.add(String(name).toLowerCase());
        _colsCache.set("trainer_profiles", Array.from(names));
      } catch {
        // ignore (duplicate column, etc.)
      }
    };

    await tryAddCol("display_name", "TEXT");
    await tryAddCol("bio", "TEXT");
    await tryAddCol("photo_url", "TEXT");
    await tryAddCol("experience_years", "INTEGER");
    await tryAddCol("specialties", "TEXT");
    await tryAddCol("created_at", "TEXT");
    await tryAddCol("updated_at", "TEXT");

    // Soft fallback for very old schemas
    await ensureUsersProfileColumnsSoft();

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
    _perrosCols = Array.isArray(cols) ? cols.map(_colName).filter(Boolean) : [];
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
   GET /api/trainers/me/profile
   PERFIL PRIVADO (adiestrador / admin)

   PRIORIDAD DE DATOS:
   1) trainer_profiles
   2) usuarios (si tiene columnas de perfil)
   3) users (si existe y es compatible)
   4) email
============================================================ */
router.get(
  "/me/profile",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      await ensureTrainerProfilesSchema();

      const trainerId = String(req.user?.id || req.user?.uid || "");
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const usuariosCols = await getCols("usuarios");
      const auNameCol = pickFirst(usuariosCols, ["nombre", "name", "display_name", "full_name"]);
      const auNotesCol = pickFirst(usuariosCols, ["notas", "notes", "bio", "descripcion", "description"]);
      const auPhotoCol = pickFirst(usuariosCols, ["foto", "photo_url", "avatar_url", "avatarURL", "photo", "avatar"]);

      const usersCols = await getCols("users");
      const upJoinCol = pickFirst(usersCols, ["uid", "id", "user_id"]);
      const upNameCol = pickFirst(usersCols, ["nombre", "name", "display_name", "full_name"]);
      const upNotesCol = pickFirst(usersCols, ["notas", "notes", "bio", "descripcion", "description"]);
      const upPhotoCol = pickFirst(usersCols, ["foto", "photo_url", "avatar_url", "avatarURL", "photo", "avatar"]);

      const hasUsersJoin = Boolean(upJoinCol && (upNameCol || upNotesCol || upPhotoCol));

      const displayNameExprParts = [
        nullableTextExpr("tp", "display_name"),
        nullableTextExpr("au", auNameCol),
        hasUsersJoin ? nullableTextExpr("up", upNameCol) : null,
        "au.email",
      ].filter(Boolean);

      const bioExprParts = [
        nullableTextExpr("tp", "bio"),
        nullableTextExpr("au", auNotesCol),
        hasUsersJoin ? nullableTextExpr("up", upNotesCol) : null,
        "''",
      ].filter(Boolean);

      const photoExprParts = [
        nullableTextExpr("tp", "photo_url"),
        nullableTextExpr("au", auPhotoCol),
        hasUsersJoin ? nullableTextExpr("up", upPhotoCol) : null,
        "''",
      ].filter(Boolean);

      const sql = `
        SELECT
          au.id AS trainerId,
          COALESCE(${displayNameExprParts.join(", ")}) AS displayName,
          COALESCE(${bioExprParts.join(", ")}) AS bio,
          COALESCE(${photoExprParts.join(", ")}) AS photoUrl,
          tp.experience_years AS experienceYears,
          tp.specialties AS specialties,
          CASE WHEN tp.trainer_id IS NULL THEN 0 ELSE 1 END AS exists
        FROM usuarios au
        LEFT JOIN trainer_profiles tp
          ON tp.trainer_id = au.id
        ${hasUsersJoin ? `LEFT JOIN users up ON up.${upJoinCol} = au.id` : ""}
        WHERE au.id = ?
        LIMIT 1
      `;

      const rows = await query(sql, [trainerId]);

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

/* ============================================================
   GET /api/trainers/:id/profile
   PERFIL PÚBLICO (SIN AUTH)
============================================================ */
router.get("/:id/profile", async (req, res) => {
  try {
    await ensureTrainerProfilesSchema();
    const { id } = req.params;

    const usuariosCols = await getCols("usuarios");
    const auNameCol = pickFirst(usuariosCols, ["nombre", "name", "display_name", "full_name"]);
    const auNotesCol = pickFirst(usuariosCols, ["notas", "notes", "bio", "descripcion", "description"]);
    const auPhotoCol = pickFirst(usuariosCols, ["foto", "photo_url", "avatar_url", "avatarURL", "photo", "avatar"]);

    const usersCols = await getCols("users");
    const upJoinCol = pickFirst(usersCols, ["uid", "id", "user_id"]);
    const upNameCol = pickFirst(usersCols, ["nombre", "name", "display_name", "full_name"]);
    const upNotesCol = pickFirst(usersCols, ["notas", "notes", "bio", "descripcion", "description"]);
    const upPhotoCol = pickFirst(usersCols, ["foto", "photo_url", "avatar_url", "avatarURL", "photo", "avatar"]);

    const hasUsersJoin = Boolean(upJoinCol && (upNameCol || upNotesCol || upPhotoCol));

    const displayNameExprParts = [
      nullableTextExpr("tp", "display_name"),
      nullableTextExpr("au", auNameCol),
      hasUsersJoin ? nullableTextExpr("up", upNameCol) : null,
      "au.email",
    ].filter(Boolean);

    const bioExprParts = [
      nullableTextExpr("tp", "bio"),
      nullableTextExpr("au", auNotesCol),
      hasUsersJoin ? nullableTextExpr("up", upNotesCol) : null,
      "''",
    ].filter(Boolean);

    const photoExprParts = [
      nullableTextExpr("tp", "photo_url"),
      nullableTextExpr("au", auPhotoCol),
      hasUsersJoin ? nullableTextExpr("up", upPhotoCol) : null,
      "''",
    ].filter(Boolean);

    const sql = `
      SELECT
        au.id AS trainerId,
        au.email AS email,
        COALESCE(${displayNameExprParts.join(", ")}) AS displayName,
        COALESCE(${bioExprParts.join(", ")}) AS bio,
        COALESCE(${photoExprParts.join(", ")}) AS photoUrl,
        tp.experience_years AS experienceYears,
        tp.specialties AS specialties
      FROM usuarios au
      LEFT JOIN trainer_profiles tp
        ON tp.trainer_id = au.id
      ${hasUsersJoin ? `LEFT JOIN users up ON up.${upJoinCol} = au.id` : ""}
      WHERE au.id = ?
        AND au.rol = 'adiestrador'
      LIMIT 1
    `;

    const rows = await query(sql, [String(id)]);

    if (!rows.length) {
      return res.status(404).json({ error: "Adiestrador no encontrado" });
    }

    const r = rows[0];

    // "Perros de trabajo" = perros del adiestrador
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
      await ensureTrainerProfilesSchema();
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

export default router;
