import express from "express";
import { query } from "../db.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   Tabla: reserva_notes
   - No depende de joins para evitar 500 por esquemas variables
============================================================ */
async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS reserva_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- reservas.id es UUID (texto). En SQLite el tipo es flexible, pero lo declaramos como TEXT.
      reserva_id TEXT NOT NULL,
      author_uid TEXT NOT NULL,
      author_email TEXT,
      author_role TEXT,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_reserva_notes_reserva_id ON reserva_notes(reserva_id)`);
}

async function tableExists(name) {
  try {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
      [name]
    );
    return !!(rows && rows.length);
  } catch {
    return false;
  }
}

async function loadLegacyNotes(reservaId, reservaRow) {
  // Compatibilidad con implementación anterior (tabla `reserva_notas`).
  // Si existe, las devolvemos para no perder notas antiguas.
  const exists = await tableExists("reserva_notas");
  if (!exists) return [];

  try {
    const rows = await query(
      `SELECT id, reserva_id AS reservaId, author, nota AS text, created_at AS createdAt
         FROM reserva_notas
        WHERE reserva_id=? AND (deleted_at IS NULL OR deleted_at='')
        ORDER BY created_at ASC`,
      [reservaId]
    );

    const resUid = String(reservaRow?.uid || "");
    const resEmail = String(reservaRow?.email || "");

    return (Array.isArray(rows) ? rows : []).map((r) => {
      const legacyRole = normalizeRole(r.author);

      // Antiguamente `author` era "user" o "admin".
      const authorUid = legacyRole === "client" ? resUid : legacyRole;
      const authorEmail = legacyRole === "client" ? resEmail : "";

      return {
        id: r.id,
        reservaId: r.reservaId,
        authorUid,
        authorEmail,
        authorRole: legacyRole,
        text: r.text,
        createdAt: r.createdAt,
        legacy: true,
      };
    });
  } catch {
    return [];
  }
}

function normalizeRole(raw) {
  const r = String(raw || "").trim().toLowerCase();
  if (!r) return "client";
  if (r === "user" || r === "usuario" || r === "cliente") return "client";
  if (r === "trainer") return "adiestrador";
  return r;
}

async function assertReservaAccess(req, reservaId) {
  const role = normalizeRole(req.user?.rol || req.user?.role || "");
  const uid = String(req.user?.uid || req.user?.id || "").trim();
  const email = String(req.user?.email || "").trim().toLowerCase();

  // Detecta columnas reales (compatibilidad)
  const cols = await query("PRAGMA table_info(reservas)");
  const has = (name) => Array.isArray(cols) && cols.some((c) => String(c?.name) === name);

  const trainerCol = has("trainer_id") ? "trainer_id" : has("trainerId") ? "trainerId" : "trainer_id";
  const uidCol = has("uid") ? "uid" : has("user_id") ? "user_id" : "uid";
  const emailCol = has("email") ? "email" : "email";

  const rows = await query(
    `SELECT id, ${uidCol} AS uid, ${emailCol} AS email, ${trainerCol} AS trainerId
       FROM reservas
      WHERE id = ?
      LIMIT 1`,
    [reservaId]
  );
  if (!rows?.length) return { ok: false, status: 404, error: "Reserva no encontrada" };

  const r = rows[0] || {};
  const isAdmin = role === "admin" || !!req.user?.isAdmin;
  if (isAdmin) return { ok: true, reserva: r, role };

  // adiestrador: solo reservas asignadas
  if (role === "adiestrador") {
    const trainerId = String(r?.trainerId || "").trim();
    if (!uid || !trainerId || trainerId !== uid) {
      return { ok: false, status: 403, error: "No autorizado" };
    }
    return { ok: true, reserva: r, role };
  }

  // cliente: solo reservas propias
  const ownerUid = String(r?.uid || "").trim();
  const ownerEmail = String(r?.email || "").trim().toLowerCase();
  const okOwner = (uid && ownerUid && uid === ownerUid) || (email && ownerEmail && email === ownerEmail);
  if (!okOwner) return { ok: false, status: 403, error: "No autorizado" };

  return { ok: true, reserva: r, role };
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
router.get("/:id/notes", verifyToken, async (req, res) => {
  try {
    await ensureSchema();
    const reservaId = String(req.params.id || "").trim();
    if (!reservaId) return res.status(400).json({ error: "Falta id de reserva" });

    const access = await assertReservaAccess(req, reservaId);
    if (!access?.ok) return res.status(access.status).json({ error: access.error });

    const rows = await query(
      `SELECT id, reserva_id AS reservaId, author_uid AS authorUid, author_email AS authorEmail,
              author_role AS authorRole, text, created_at AS createdAt
         FROM reserva_notes
        WHERE reserva_id = ?
        ORDER BY id ASC`,
      [reservaId]
    );

    const hydrated = await hydrateAuthorFields(Array.isArray(rows) ? rows : []);
    const legacy = await loadLegacyNotes(reservaId, access.reserva);

    const combined = [...(Array.isArray(hydrated) ? hydrated : []), ...(Array.isArray(legacy) ? legacy : [])].sort(
      (a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      }
    );

    const meUid = String(req.user?.uid || req.user?.id || "").trim();
    const meEmail = String(req.user?.email || "").trim().toLowerCase();
    const meRole = normalizeRole(req.user?.rol || req.user?.role || "");
    const isAdmin = meRole === "admin" || !!req.user?.isAdmin;
    const isTrainer = meRole === "adiestrador";

    const items = combined.map((n) => {
  const authorUidVal = String(n?.authorUid || n?.author_uid || "").trim();
  const authorEmailVal = String(n?.authorEmail || n?.author_email || "").trim().toLowerCase();

  const sameAuthor =
    (!!authorUidVal && !!meUid && authorUidVal === meUid) ||
    (!!authorEmailVal && !!meEmail && authorEmailVal === meEmail);

  const roleNormalized = n?.authorRole
    ? normalizeRole(n.authorRole)
    : n?.author_role
      ? normalizeRole(n.author_role)
      : n?.authorRole;

  return {
    ...n,
    // snake_case (contrato frontend)
    created_at: n?.createdAt || n?.created_at || null,
    author_uid: n?.authorUid || n?.author_uid || null,
    author_email: n?.authorEmail || n?.author_email || null,
    author_role: roleNormalized,

    // compatibilidad (camelCase)
    createdAt: n?.createdAt || n?.created_at || null,
    authorUid: n?.authorUid || n?.author_uid || null,
    authorEmail: n?.authorEmail || n?.author_email || null,
    authorRole: roleNormalized,

    canDelete: isAdmin || isTrainer || sameAuthor,
  };
});

res.json({ ok: true, items });
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
router.post("/:id/notes", verifyToken, async (req, res) => {
  try {
    await ensureSchema();
    const reservaId = String(req.params.id || "").trim();
    const text = String(req.body?.text || "").trim();

    if (!reservaId) return res.status(400).json({ error: "Falta id de reserva" });
    if (!text) return res.status(400).json({ error: "Falta texto" });

    const access = await assertReservaAccess(req, reservaId);
    if (!access?.ok) return res.status(access.status).json({ error: access.error });

    const authorUid = String(req.user?.uid || req.user?.id || "").trim();
    if (!authorUid) return res.status(401).json({ error: "No autorizado" });
    let authorEmail = String(req.user?.email || "").trim();
    let authorRole = normalizeRole(req.user?.rol || req.user?.role || "");

    if ((!authorEmail || !authorRole) && authorUid) {
      try {
        const u = await query(`SELECT email, rol FROM usuarios WHERE id = ? LIMIT 1`, [authorUid]);
        if (Array.isArray(u) && u.length) {
          authorEmail = authorEmail || String(u[0]?.email || "").trim();
          authorRole = authorRole || normalizeRole(u[0]?.rol || "");
        }
      } catch {
        // ignora
      }
    }

    authorRole = normalizeRole(authorRole);

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
    const legacy = await loadLegacyNotes(reservaId, access.reserva);

    const combined = [...(Array.isArray(hydrated) ? hydrated : []), ...(Array.isArray(legacy) ? legacy : [])].sort(
      (a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      }
    );

    const meUid = String(req.user?.uid || req.user?.id || "").trim();
    const meEmail = String(req.user?.email || "").trim().toLowerCase();
    const meRole = normalizeRole(req.user?.rol || req.user?.role || "");
    const isAdmin = meRole === "admin" || !!req.user?.isAdmin;
    const isTrainer = meRole === "adiestrador";

    const items = combined.map((n) => {
  const authorUidVal = String(n?.authorUid || n?.author_uid || "").trim();
  const authorEmailVal = String(n?.authorEmail || n?.author_email || "").trim().toLowerCase();

  const sameAuthor =
    (!!authorUidVal && !!meUid && authorUidVal === meUid) ||
    (!!authorEmailVal && !!meEmail && authorEmailVal === meEmail);

  const roleNormalized = n?.authorRole
    ? normalizeRole(n.authorRole)
    : n?.author_role
      ? normalizeRole(n.author_role)
      : n?.authorRole;

  return {
    ...n,
    // snake_case (contrato frontend)
    created_at: n?.createdAt || n?.created_at || null,
    author_uid: n?.authorUid || n?.author_uid || null,
    author_email: n?.authorEmail || n?.author_email || null,
    author_role: roleNormalized,

    // compatibilidad (camelCase)
    createdAt: n?.createdAt || n?.created_at || null,
    authorUid: n?.authorUid || n?.author_uid || null,
    authorEmail: n?.authorEmail || n?.author_email || null,
    authorRole: roleNormalized,

    canDelete: isAdmin || isTrainer || sameAuthor,
  };
});

res.json({ ok: true, items });
  } catch (e) {
    console.error("POST /reservas/:id/notes", e);
    res.status(500).json({
      error: "No se pudo guardar la nota",
      detail: process.env.NODE_ENV !== "production" ? String(e?.message || e) : undefined,
    });
  }
});

/* ============================================================
   DELETE /api/reservas/:id/notes/:noteId
   - Admin: puede borrar cualquiera
   - Adiestrador: puede borrar notas de sus reservas
   - Cliente: solo sus propias notas
============================================================ */
router.delete("/:id/notes/:noteId", verifyToken, async (req, res) => {
  try {
    await ensureSchema();
    const reservaId = String(req.params.id || "").trim();
    const noteId = String(req.params.noteId || "").trim();

    if (!reservaId) return res.status(400).json({ error: "Falta id de reserva" });
    if (!noteId) return res.status(400).json({ error: "Falta id de nota" });

    const access = await assertReservaAccess(req, reservaId);
    if (!access?.ok) return res.status(access.status).json({ error: access.error });

    // Nota en tabla nueva (reserva_notes)
    let n = null;
    let isLegacy = false;

    const rows = await query(
      `SELECT id, author_uid AS authorUid, author_email AS authorEmail
         FROM reserva_notes
        WHERE id = ? AND reserva_id = ?
        LIMIT 1`,
      [noteId, reservaId]
    );
    n = Array.isArray(rows) ? rows[0] : null;

    // Fallback: notas legacy (reserva_notas)
    if (!n && (await tableExists("reserva_notas"))) {
      try {
        const legacyRows = await query(
          `SELECT id, author, nota, created_at AS createdAt, deleted_at AS deletedAt
             FROM reserva_notas
            WHERE id = ? AND reserva_id = ?
            LIMIT 1`,
          [noteId, reservaId]
        );
        const lr = Array.isArray(legacyRows) ? legacyRows[0] : null;
        if (lr && !lr.deletedAt) {
          const legacyRole = normalizeRole(lr.author);
          const ownerUid = String(access.reserva?.uid || "").trim();
          const ownerEmail = String(access.reserva?.email || "").trim().toLowerCase();
          n = {
            id: lr.id,
            authorUid: legacyRole === "client" ? ownerUid : legacyRole === "admin" ? "admin" : "",
            authorEmail: legacyRole === "client" ? ownerEmail : "",
          };
          isLegacy = true;
        }
      } catch {
        // si la tabla existe pero el esquema no coincide, ignoramos
      }
    }

    if (!n) return res.status(404).json({ error: "Nota no encontrada" });

    const meUid = String(req.user?.uid || req.user?.id || "").trim();
    const meEmail = String(req.user?.email || "").trim().toLowerCase();
    const meRole = normalizeRole(req.user?.rol || req.user?.role || "");

    const isAdmin = meRole === "admin" || !!req.user?.isAdmin;
    const isTrainer = meRole === "adiestrador";

    const authorUid = String(n?.authorUid || "").trim();
    const authorEmail = String(n?.authorEmail || "").trim().toLowerCase();
    const sameAuthor =
      (!!authorUid && !!meUid && authorUid === meUid) ||
      (!!authorEmail && !!meEmail && authorEmail === meEmail);

    if (!(isAdmin || isTrainer || sameAuthor)) {
      return res.status(403).json({ error: "No puedes borrar esta nota" });
    }

    if (isLegacy) {
      // Soft delete si existe columna deleted_at; si no, borrado duro
      try {
        await query(
          `UPDATE reserva_notas SET deleted_at = datetime('now') WHERE id = ? AND reserva_id = ?`,
          [noteId, reservaId]
        );
      } catch {
        await query(`DELETE FROM reserva_notas WHERE id = ? AND reserva_id = ?`, [noteId, reservaId]);
      }
    } else {
      await query(`DELETE FROM reserva_notes WHERE id = ? AND reserva_id = ?`, [noteId, reservaId]);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /reservas/:id/notes/:noteId", e);
    return res.status(500).json({ error: "No se pudo borrar la nota" });
  }
});

export default router;
