import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   Tabla: reserva_notes
   - No depende de joins para evitar 500 por esquemas variables
============================================================ */
async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS reserva_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL,
      author_uid TEXT NOT NULL,
      author_email TEXT,
      author_role TEXT,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_reserva_notes_reserva_id ON reserva_notes(reserva_id)`);
}

async function assertReservaAccess(req, reservaId) {
  // admin: siempre ok
  const role = String(req.user?.rol || req.user?.role || "").toLowerCase();
  if (role === "admin") return true;

  // adiestrador: solo reservas propias
  const cols = await query("PRAGMA table_info(reservas)");
  const has = (name) => Array.isArray(cols) && cols.some((c) => String(c?.name) === name);
  const trainerCol = has("trainer_id") ? "trainer_id" : has("trainerId") ? "trainerId" : "trainer_id";

  const rows = await query(`SELECT id, ${trainerCol} AS trainerId FROM reservas WHERE id = ? LIMIT 1`, [reservaId]);
  if (!rows?.length) return { ok: false, status: 404, error: "Reserva no encontrada" };

  const trainerId = String(rows[0]?.trainerId || "");
  const me = String(req.user?.uid || req.user?.id || "");
  if (!me || !trainerId || trainerId !== me) {
    return { ok: false, status: 403, error: "No autorizado" };
  }
  return true;
}

async function hydrateAuthorFields(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return Array.isArray(rows) ? rows : [];
  const missingUids = Array.from(
    new Set(
      rows
        .filter((r) => !r?.authorEmail || !r?.authorRole)
        .map((r) => String(r?.authorUid || "").trim())
        .filter(Boolean)
    )
  );
  if (!missingUids.length) return rows;

  // Tabla de usuarios: "usuarios" (id, email, rol). Si no existe, no rompe.
  try {
    const placeholders = missingUids.map(() => "?").join(",");
    const users = await query(
      `SELECT id, email, rol FROM usuarios WHERE id IN (${placeholders})`,
      missingUids
    );

    const map = new Map(
      (Array.isArray(users) ? users : []).map((u) => [
        String(u?.id || ""),
        { email: u?.email, rol: u?.rol },
      ])
    );

    return rows.map((r) => {
      const uid = String(r?.authorUid || "").trim();
      const u = map.get(uid);
      return {
        ...r,
        authorEmail: r.authorEmail || u?.email || r.authorEmail,
        authorRole: r.authorRole || u?.rol || r.authorRole,
      };
    });
  } catch {
    return rows;
  }
}

/* ============================================================
   GET /api/reservas/:id/notes
============================================================ */
router.get("/:id/notes", verifyToken, allowRoles(["adiestrador", "admin"]), async (req, res) => {
  try {
    await ensureSchema();
    const reservaId = String(req.params.id || "").trim();
    if (!reservaId) return res.status(400).json({ error: "Falta id de reserva" });

    const access = await assertReservaAccess(req, reservaId);
    if (access !== true) return res.status(access.status).json({ error: access.error });

    const rows = await query(
      `SELECT id, reserva_id AS reservaId, author_uid AS authorUid, author_email AS authorEmail,
              author_role AS authorRole, text, created_at AS createdAt
         FROM reserva_notes
        WHERE reserva_id = ?
        ORDER BY id ASC`,
      [reservaId]
    );

    const hydrated = await hydrateAuthorFields(Array.isArray(rows) ? rows : []);
    res.json({ items: hydrated });
  } catch (e) {
    console.error("GET /reservas/:id/notes", e);
    res.status(500).json({
      error: "No se pudieron cargar las notas",
      detail: process.env.NODE_ENV !== "production" ? String(e?.message || e) : undefined,
    });
  }
});

/* ============================================================
   POST /api/reservas/:id/notes   { text }
============================================================ */
router.post("/:id/notes", verifyToken, allowRoles(["adiestrador", "admin"]), async (req, res) => {
  try {
    await ensureSchema();
    const reservaId = String(req.params.id || "").trim();
    const text = String(req.body?.text || "").trim();

    if (!reservaId) return res.status(400).json({ error: "Falta id de reserva" });
    if (!text) return res.status(400).json({ error: "Falta texto" });

    const access = await assertReservaAccess(req, reservaId);
    if (access !== true) return res.status(access.status).json({ error: access.error });

    const authorUid = String(req.user?.uid || req.user?.id || "");
    let authorEmail = String(req.user?.email || "").trim();
    let authorRole = String(req.user?.rol || req.user?.role || "").trim();

    if ((!authorEmail || !authorRole) && authorUid) {
      try {
        const u = await query(`SELECT email, rol FROM usuarios WHERE id = ? LIMIT 1`, [authorUid]);
        if (Array.isArray(u) && u.length) {
          authorEmail = authorEmail || String(u[0]?.email || "").trim();
          authorRole = authorRole || String(u[0]?.rol || "").trim();
        }
      } catch {
        // ignora
      }
    }

    await query(
      `INSERT INTO reserva_notes (reserva_id, author_uid, author_email, author_role, text)
       VALUES (?, ?, ?, ?, ?)`,
      [reservaId, authorUid, authorEmail, authorRole, text]
    );

    // Devuelve la lista actualizada (simple y robusto)
    const rows = await query(
      `SELECT id, reserva_id AS reservaId, author_uid AS authorUid, author_email AS authorEmail,
              author_role AS authorRole, text, created_at AS createdAt
         FROM reserva_notes
        WHERE reserva_id = ?
        ORDER BY id ASC`,
      [reservaId]
    );

    const hydrated = await hydrateAuthorFields(Array.isArray(rows) ? rows : []);
    res.json({ ok: true, items: hydrated });
  } catch (e) {
    console.error("POST /reservas/:id/notes", e);
    res.status(500).json({
      error: "No se pudo guardar la nota",
      detail: process.env.NODE_ENV !== "production" ? String(e?.message || e) : undefined,
    });
  }
});

export default router;
