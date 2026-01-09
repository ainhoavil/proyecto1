// backend/routes/perros.js
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, requireAdmin, allowRoles } from "../middleware/auth.js";

const router = express.Router();
const TABLE = "perros";

const nowIso = () => new Date().toISOString();
const boolToInt = (v) => (v ? 1 : 0);
const u2n = (v) => (v === undefined ? null : v);
const getUserId = (u = {}) => u.uid || u.id || u.sub || null;

function toIsoDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return null;
}

function toDB(body = {}) {
  const { nombre, raza, nacimiento, castrado, notas, avatarURL } = body;
  return {
    nombre,
    raza,
    nacimiento: toIsoDate(nacimiento),
    castrado: castrado == null ? undefined : !!castrado,
    notas,
    avatarURL,
  };
}

/* ====== Detección columnas avatar ====== */
let HAS_CAMEL = false;
let HAS_SNAKE = false;

async function readSchema() {
  const cols = await query(`PRAGMA table_info(${TABLE})`);
  const names = cols.map((c) => c.name);
  HAS_CAMEL = names.includes("avatarURL");
  HAS_SNAKE = names.includes("avatar_url");
  return names;
}

function avatarCol() {
  if (HAS_SNAKE) return "avatar_url";
  if (HAS_CAMEL) return "avatarURL";
  return "avatar_url";
}

/* ====== Asegurar tabla, índice, validación FK ====== */
async function ensureSchema() {
  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      raza TEXT NOT NULL,
      nacimiento TEXT,
      castrado INTEGER DEFAULT 0,
      notas TEXT,
      avatarURL TEXT,
      archived INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )`
  );

  const names = await readSchema();
  if (!names.includes("avatarURL") && !names.includes("avatar_url")) {
    try { await query(`ALTER TABLE ${TABLE} ADD COLUMN avatar_url TEXT`); } catch {}
    await readSchema();
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_user ON ${TABLE}(user_id)`);
}
await ensureSchema();

/* =================== RUTAS USUARIO =================== */

// GET → lista de perros del usuario
router.get("/", verifyToken, allowRoles(["client", "adiestrador"]), async (req, res) => {
  try {
    const userId = getUserId(req.user);
    if (!userId) return res.status(401).json({ error: "Token inválido" });

    const rows = await query(
      `SELECT id, nombre, raza, nacimiento, castrado, notas,
              COALESCE(avatar_url, avatarURL) AS avatarURL,
              created_at AS createdAt, updated_at AS updatedAt
       FROM ${TABLE}
       WHERE user_id = ? 
       ORDER BY nombre COLLATE NOCASE ASC`,
      [userId]
    );

    res.json({ items: rows.map((r) => ({ ...r, castrado: !!r.castrado })) });
  } catch (e) {
    console.error("GET /perros:", e);
    res.status(500).json({ error: "No se pudo listar" });
  }
});

/* =====================================================
   GET /api/perros/user/:userId  (admin / adiestrador)
   Devuelve perros activos (archived=0) del usuario indicado.
====================================================== */
router.get("/user/:userId", verifyToken, allowRoles(["admin", "adiestrador"]), async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Falta userId" });

    const rows = await query(
      `SELECT id, user_id AS userId, nombre, raza, nacimiento, castrado, notas,
              COALESCE(avatar_url, avatarURL) AS avatarURL,
              archived,
              created_at AS createdAt, updated_at AS updatedAt
         FROM ${TABLE}
        WHERE user_id = ?
          AND COALESCE(archived,0) = 0
        ORDER BY nombre COLLATE NOCASE ASC`,
      [userId]
    );

    res.json({ items: rows.map((r) => ({ ...r, castrado: !!r.castrado })) });
  } catch (e) {
    console.error("GET /perros/user/:userId:", e);
    res.status(500).json({ error: "No se pudo listar perros del usuario" });
  }
});

/* =====================================================
   GET /api/perros/by-email?email=...
   (admin) Resuelve usuario por email y devuelve sus perros activos.
   Respuesta: { userId, items: [...] }
====================================================== */
router.get("/by-email", verifyToken, requireAdmin, async (req, res) => {
  try {
    const email = String(req.query?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Falta email" });

    const u = await query(
      `SELECT id, email, rol FROM usuarios WHERE lower(email) = lower(?) LIMIT 1`,
      [email]
    );

    const userId = u?.[0]?.id || null;
    if (!userId) return res.json({ userId: null, items: [] });

    // Evitar exponer perros de adiestradores desde este endpoint (solo clientes)
    // Nota: en este proyecto los adiestradores también pueden tener perros propios,
    // pero el uso de /by-email es para crear reservas a clientes.
    const rol = String(u?.[0]?.rol || "").toLowerCase().trim();
    if (rol === "adiestrador" || rol === "trainer") {
      return res.json({ userId, items: [], reason: 'trainer' });
    }

    const rows = await query(
      `SELECT id, user_id AS userId, nombre, raza, nacimiento, castrado, notas,
              COALESCE(avatar_url, avatarURL) AS avatarURL,
              archived,
              created_at AS createdAt, updated_at AS updatedAt
         FROM ${TABLE}
        WHERE user_id = ?
          AND COALESCE(archived,0) = 0
        ORDER BY nombre COLLATE NOCASE ASC`,
      [userId]
    );

    res.json({ userId, items: rows.map((r) => ({ ...r, castrado: !!r.castrado })) });
  } catch (e) {
    console.error("GET /perros/by-email:", e);
    res.status(500).json({ error: "No se pudo resolver perros por email" });
  }
});

// POST → crear nuevo perro
router.post("/", verifyToken, allowRoles(["client", "adiestrador"]), async (req, res) => {
  try {
    const userId = getUserId(req.user);
    if (!userId) return res.status(401).json({ error: "Token inválido" });

    const d = toDB(req.body || {});
    if (!d.nombre?.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
    if (!d.raza?.trim()) return res.status(400).json({ error: "La raza/tamaño es obligatoria" });
    if (!d.nacimiento) return res.status(400).json({ error: "La fecha de nacimiento es obligatoria o inválida" });

    const id = uuidv4();
    const now = nowIso();
    const col = avatarCol();

    await query(
      `INSERT INTO ${TABLE}
       (id, user_id, nombre, raza, nacimiento, castrado, notas, ${col}, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, userId,
        d.nombre.trim(), d.raza.trim(), d.nacimiento,
        d.castrado ? 1 : 0,
        (d.notas || "").trim(),
        (d.avatarURL || "").trim(),
        now, now
      ]
    );

    res.status(201).json({
      item: {
        id,
        nombre: d.nombre.trim(),
        raza: d.raza.trim(),
        nacimiento: d.nacimiento,
        castrado: !!d.castrado,
        notas: d.notas || "",
        avatarURL: d.avatarURL || "",
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (e) {
    console.error("POST /perros:", e);
    res.status(500).json({ error: "No se pudo crear" });
  }
});

// PATCH → actualizar perro (solo dueño)
router.patch("/:id", verifyToken, allowRoles(["client", "adiestrador"]), async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { id } = req.params;
    const d = toDB(req.body || {});
    const now = nowIso();
    const col = avatarCol();

    const owner = await query(`SELECT 1 FROM ${TABLE} WHERE id=? AND user_id=?`, [id, userId]);
    if (!owner.length) return res.status(404).json({ error: "No encontrado" });

    await query(
      `UPDATE ${TABLE}
       SET nombre = COALESCE(?, nombre),
           raza = COALESCE(?, raza),
           nacimiento = COALESCE(?, nacimiento),
           castrado = COALESCE(?, castrado),
           notas = COALESCE(?, notas),
           ${col} = COALESCE(?, ${col}),
           updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        u2n(d.nombre?.trim()),
        u2n(d.raza?.trim()),
        u2n(d.nacimiento),
        d.castrado == null ? null : boolToInt(!!d.castrado),
        u2n(d.notas?.trim()),
        u2n((d.avatarURL || "").trim()),
        now,
        id,
        userId,
      ]
    );

    const rows = await query(
      `SELECT id, nombre, raza, nacimiento, castrado, notas,
              COALESCE(avatar_url, avatarURL) AS avatarURL,
              created_at AS createdAt, updated_at AS updatedAt
       FROM ${TABLE} WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    res.json({ item: { ...rows[0], castrado: !!rows[0].castrado } });
  } catch (e) {
    console.error("PATCH /perros:", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

// DELETE → borrado duro (real)
router.delete("/:id", verifyToken, allowRoles(["client", "adiestrador"]), async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { id } = req.params;

    const owner = await query(`SELECT 1 FROM ${TABLE} WHERE id=? AND user_id=?`, [id, userId]);
    if (!owner.length) return res.status(404).json({ error: "No encontrado" });

    await query(`DELETE FROM ${TABLE} WHERE id = ? AND user_id = ?`, [id, userId]);
    res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error("DELETE /perros:", e);
    res.status(500).json({ error: "No se pudo eliminar" });
  }
});

/* =================== RUTAS ADMIN OPCIONALES =================== */

// GET → todos los perros con su dueño
router.get("/admin/all", verifyToken, requireAdmin, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT p.id, p.user_id AS ownerId, u.email AS ownerEmail,
              p.nombre, p.raza, p.nacimiento, p.castrado, p.notas,
              COALESCE(p.avatar_url, p.avatarURL) AS avatarURL,
              p.created_at AS createdAt, p.updated_at AS updatedAt
       FROM ${TABLE} p
       LEFT JOIN usuarios u ON u.id = p.user_id
       ORDER BY u.email COLLATE NOCASE ASC, p.nombre COLLATE NOCASE ASC`
    );
    res.json({ items: rows.map(r => ({ ...r, castrado: !!r.castrado })) });
  } catch (e) {
    console.error("GET /perros/admin/all:", e);
    res.status(500).json({ error: "No se pudo listar" });
  }
});

// DELETE /api/perros/admin/purge → borrar archivados (si quedaran)
router.delete("/admin/purge", verifyToken, requireAdmin, async (_req, res) => {
  try {
    const info = await query(`DELETE FROM ${TABLE} WHERE archived = 1`);
    res.json({ ok: true, purged: info.length || 0 });
  } catch (e) {
    console.error("DELETE /perros/admin/purge:", e);
    res.status(500).json({ error: "No se pudo purgar" });
  }
});

export default router;
