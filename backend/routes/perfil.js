// backend/routes/perfil.js
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

/* -------------------- Auth middleware -------------------- */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });
  const token = h.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Convierte undefined -> NULL para que COALESCE conserve valor anterior
const u2n = (v) => (v === undefined ? null : v);

// ===== trainer_profiles sync (solo foto) =====
let _tpReady = false;
let _tpPromise = null;

async function ensureTrainerProfilesSchema() {
  if (_tpReady) return;
  if (_tpPromise) return _tpPromise;

  _tpPromise = (async () => {
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

    try {
      const cols = await query("PRAGMA table_info(trainer_profiles)");
      const names = new Set((cols || []).map((c) => c.name));

      const addCol = async (name, type) => {
        if (names.has(name)) return;
        await query(`ALTER TABLE trainer_profiles ADD COLUMN ${name} ${type}`);
        names.add(name);
      };

      await addCol("photo_url", "TEXT");
      await addCol("updated_at", "TEXT");
      await addCol("created_at", "TEXT");
    } catch {
      // best-effort
    }

    _tpReady = true;
  })().finally(() => {
    if (!_tpReady) _tpPromise = null;
  });

  return _tpPromise;
}

async function upsertTrainerPhoto(trainerId, photoUrl) {
  try {
    await ensureTrainerProfilesSchema();
    const tid = String(trainerId || "").trim();
    if (!tid) return;

    const exists = await query(
      `SELECT 1 FROM trainer_profiles WHERE trainer_id = ? LIMIT 1`,
      [tid]
    );

    const val = String(photoUrl ?? "").trim();

    if (exists.length) {
      await query(
        `UPDATE trainer_profiles
            SET photo_url = ?,
                updated_at = datetime('now')
          WHERE trainer_id = ?`,
        [val, tid]
      );
    } else {
      await query(
        `INSERT INTO trainer_profiles (trainer_id, photo_url, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))`,
        [tid, val]
      );
    }
  } catch {
    // best-effort
  }
}

/* -------------------- GET /api/perfil -------------------- */
/** Devuelve el perfil del usuario autenticado.
 *  Respuesta: { email, profile: { ... , foto, avatarURL, ... } }
 */
router.get("/", auth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT
         id,
         uid,
         email,
         nombre,
         telefono,
         direccion,
         notas,
         foto,
         foto AS avatarURL,   -- alias para el frontend
         prefix,
         role,
         created_at,
         updated_at
       FROM users
       WHERE uid = ?
       LIMIT 1`,
      [req.user.sub]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({
      email: rows[0].email,
      profile: rows[0],
    });
  } catch (error) {
    console.error("GET /api/perfil error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

/* -------------------- PATCH /api/perfil -------------------- */
/** Actualiza parcialmente el perfil.
 *  Acepta claves ES/EN:
 *  - displayName | nombre
 *  - phone       | telefono
 *  - address     | direccion
 *  - avatarURL   | foto
 *  - notes       | notas
 *  - prefix
 *  - email (opcional)
 *
 *  Reglas:
 *  - Si una clave NO viene en el body -> se conserva el valor actual (COALESCE).
 *  - Si viene como "" (cadena vacía) -> se guarda "" (borra el contenido).
 */
router.patch("/", auth, async (req, res) => {
  try {
    const {
      // inglés
      displayName,
      phone,
      address,
      avatarURL,
      notes,
      prefix,
      email,

      // español
      nombre,
      telefono,
      direccion,
      foto,
      notas,
      prefijo, // por si llega como 'prefijo' (lo mapeamos a prefix)
    } = req.body || {};

    // Resolver alias/español
    const nameVal   = displayName ?? nombre;
    const phoneVal  = phone ?? telefono;
    const addrVal   = address ?? direccion;
    const photoVal  = avatarURL ?? foto;
    const notesVal  = notes ?? notas;
    const prefixVal = prefix ?? prefijo;

    // Update parcial con COALESCE(?, columna)
    await query(
      `UPDATE users SET
         nombre     = COALESCE(?, nombre),
         telefono   = COALESCE(?, telefono),
         direccion  = COALESCE(?, direccion),
         foto       = COALESCE(?, foto),
         notas      = COALESCE(?, notas),
         prefix     = COALESCE(?, prefix),
         email      = COALESCE(?, email),
         updated_at = datetime('now')
       WHERE uid = ?`,
      [
        u2n(nameVal),
        u2n(phoneVal),
        u2n(addrVal),
        u2n(photoVal),
        u2n(notesVal),
        u2n(prefixVal),
        u2n(email),
        req.user.sub,
      ]
    );

    // Si el usuario es adiestrador y se ha modificado la foto, la reflejamos también
    // en trainer_profiles para que admin/perfil público vean lo mismo.
    const roleLower = String(req.user?.rol || req.user?.role || "")
      .toLowerCase()
      .trim();
    const isTrainer = roleLower === "adiestrador" || roleLower === "trainer";

    if (isTrainer && (avatarURL !== undefined || foto !== undefined)) {
      await upsertTrainerPhoto(req.user?.sub, photoVal);
    }

    // Devolver perfil actualizado
    const rows = await query(
      `SELECT
         id,
         uid,
         email,
         nombre,
         telefono,
         direccion,
         notas,
         foto,
         foto AS avatarURL,
         prefix,
         role,
         created_at,
         updated_at
       FROM users
       WHERE uid = ?
       LIMIT 1`,
      [req.user.sub]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado tras actualizar" });
    }

    res.json({
      ok: true,
      message: "Perfil actualizado correctamente",
      profile: rows[0],
    });
  } catch (error) {
    console.error("PATCH /api/perfil error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
