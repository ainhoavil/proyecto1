// backend/routes/trainerNotes.js
// ============================================================
// Notas PRIVADAS del adiestrador
// - Se guardan por (trainer_id, client_id, dog_id?)
// - SOLO visibles para el adiestrador (no admin, no cliente)
// - NO se mezclan con el chat
// ============================================================

import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";
import { dogBelongsToClient, trainerHasClient, getAuthUserId } from "../utils/trainerAccess.js";

const router = express.Router();
const nowISO = () => new Date().toISOString();

// ============================================================
// SCHEMA (auto-create)
// ============================================================

let schemaReady = false;
let schemaPromise = null;

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await query(`
    CREATE TABLE IF NOT EXISTS trainer_notes (
      id TEXT PRIMARY KEY,
      trainer_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      dog_id TEXT,
      title TEXT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `);

    await query(`CREATE INDEX IF NOT EXISTS idx_trainer_notes_trainer ON trainer_notes(trainer_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_trainer_notes_client ON trainer_notes(client_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_trainer_notes_dog ON trainer_notes(dog_id)`);
    await query(
    `CREATE INDEX IF NOT EXISTS idx_trainer_notes_trainer_client ON trainer_notes(trainer_id, client_id)`
  );

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } catch (e) {
    schemaPromise = null;
    throw e;
  }

  schemaPromise = null;
}

// Ejecuta al importar el router (best-effort)
ensureSchema().catch((e) => {
  console.warn("[trainerNotes] No se pudo asegurar schema:", e?.message || e);
});

// ============================================================
// Helpers
// ============================================================

function cleanText(v) {
  return String(v ?? "").trim();
}

// ============================================================
// GET /api/trainer-notes?clientId=...&dogId=...
// Lista notas del adiestrador (por cliente, opcional por perro)
// ============================================================
router.get(
  "/",
  verifyToken,
  allowRoles(["adiestrador"]),
  async (req, res) => {
    try {
      await ensureSchema();

      const trainerId = getAuthUserId(req);
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const clientId = cleanText(req.query.clientId);
      const dogId = cleanText(req.query.dogId);

      if (!clientId) return res.status(400).json({ error: "clientId requerido" });

      const ok = await trainerHasClient({ trainerId, clientId });
      if (!ok) return res.status(403).json({ error: "Sin permisos" });

      const params = [trainerId, clientId];
      let dogWhere = "";
      if (dogId) {
        dogWhere = " AND dog_id = ?";
        params.push(dogId);
      }

      const rows = await query(
        `
          SELECT
            id,
            trainer_id AS trainerId,
            client_id AS clientId,
            dog_id AS dogId,
            title,
            text,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM trainer_notes
          WHERE trainer_id = ?
            AND client_id = ?
            ${dogWhere}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 300
        `,
        params
      );

      return res.json({ items: rows });
    } catch (e) {
      console.error("GET /api/trainer-notes", e);
      return res.status(500).json({ error: "No se pudieron cargar las notas" });
    }
  }
);

// ============================================================
// POST /api/trainer-notes
// body: { clientId, dogId?, title?, text }
// ============================================================
router.post(
  "/",
  verifyToken,
  allowRoles(["adiestrador"]),
  async (req, res) => {
    try {
      await ensureSchema();

      const trainerId = getAuthUserId(req);
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const clientId = cleanText(req.body?.clientId);
      const dogIdRaw = cleanText(req.body?.dogId);
      const title = cleanText(req.body?.title);
      const text = cleanText(req.body?.text);

      if (!clientId) return res.status(400).json({ error: "clientId requerido" });
      if (!text) return res.status(400).json({ error: "El texto es obligatorio" });

      const ok = await trainerHasClient({ trainerId, clientId });
      if (!ok) return res.status(403).json({ error: "Sin permisos" });

      let dogId = dogIdRaw || null;
      if (dogId) {
        const dogOk = await dogBelongsToClient({ dogId, clientId });
        if (!dogOk) {
          return res.status(400).json({ error: "Ese perro no pertenece al cliente" });
        }
      }

      const id = uuidv4();
      const ts = nowISO();

      await query(
        `
          INSERT INTO trainer_notes (
            id, trainer_id, client_id, dog_id, title, text,
            created_at, updated_at, deleted_at
          )
          VALUES (?,?,?,?,?,?,?,?,NULL)
        `,
        [id, trainerId, clientId, dogId, title || null, text, ts, ts]
      );

      return res.status(201).json({
        item: {
          id,
          trainerId,
          clientId,
          dogId,
          title: title || "",
          text,
          createdAt: ts,
          updatedAt: ts,
        },
      });
    } catch (e) {
      console.error("POST /api/trainer-notes", e);
      return res.status(500).json({ error: "No se pudo guardar la nota" });
    }
  }
);

// ============================================================
// PATCH /api/trainer-notes/:id
// body: { title?, text? }
// ============================================================
router.patch(
  "/:id",
  verifyToken,
  allowRoles(["adiestrador"]),
  async (req, res) => {
    try {
      await ensureSchema();

      const trainerId = getAuthUserId(req);
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const id = cleanText(req.params.id);
      if (!id) return res.status(400).json({ error: "id requerido" });

      const title = req.body?.title === undefined ? undefined : cleanText(req.body?.title);
      const text = req.body?.text === undefined ? undefined : cleanText(req.body?.text);

      // Si viene text, no puede ser vacío
      if (text !== undefined && !text) {
        return res.status(400).json({ error: "El texto no puede estar vacío" });
      }

      const exists = await query(
        `SELECT id FROM trainer_notes WHERE id=? AND trainer_id=? AND deleted_at IS NULL LIMIT 1`,
        [id, trainerId]
      );
      if (!exists.length) return res.status(404).json({ error: "Nota no encontrada" });

      const ts = nowISO();

      await query(
        `
          UPDATE trainer_notes
          SET
            title = COALESCE(?, title),
            text  = COALESCE(?, text),
            updated_at = ?
          WHERE id = ? AND trainer_id = ? AND deleted_at IS NULL
        `,
        [title === undefined ? null : title, text === undefined ? null : text, ts, id, trainerId]
      );

      const row = await query(
        `
          SELECT
            id,
            trainer_id AS trainerId,
            client_id AS clientId,
            dog_id AS dogId,
            title,
            text,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM trainer_notes
          WHERE id=? AND trainer_id=?
          LIMIT 1
        `,
        [id, trainerId]
      );

      return res.json({ item: row[0] });
    } catch (e) {
      console.error("PATCH /api/trainer-notes/:id", e);
      return res.status(500).json({ error: "No se pudo actualizar la nota" });
    }
  }
);

// ============================================================
// DELETE /api/trainer-notes/:id
// ============================================================
router.delete(
  "/:id",
  verifyToken,
  allowRoles(["adiestrador"]),
  async (req, res) => {
    try {
      await ensureSchema();

      const trainerId = getAuthUserId(req);
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const id = cleanText(req.params.id);
      if (!id) return res.status(400).json({ error: "id requerido" });

      const ts = nowISO();
      await query(
        `UPDATE trainer_notes SET deleted_at=? WHERE id=? AND trainer_id=? AND deleted_at IS NULL`,
        [ts, id, trainerId]
      );

      return res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /api/trainer-notes/:id", e);
      return res.status(500).json({ error: "No se pudo borrar la nota" });
    }
  }
);

export default router;
