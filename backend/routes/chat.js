// backend/routes/chat.js
// ============================================================
// Chat Cliente–Adiestrador
// ✅ 1 conversación por PAREJA (trainer_id + client_id)
// ✅ Mensajes con adjuntos (fotos / vídeos / archivos)
// ✅ Mantiene compatibilidad con el endpoint /by-reserva/:id
// ============================================================

import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();
const nowISO = () => new Date().toISOString();

// 👇 Tu auth a veces usa id, otras uid. Esto lo hace robusto.
const getUserId = (req) => String(req.user?.id || req.user?.uid || "");

// 👇 Tu rol puede venir como rol o role.
const getUserRole = (req) => String(req.user?.rol || req.user?.role || "").toLowerCase();

// ============================================================
// CONFIG
// ============================================================

// Estados de reserva en los que permitimos relación de chat
// (no bloquea que el chat exista; solo controla creación/obtención).
const CHAT_ALLOWED_STATUSES = new Set(["confirmed", "confirmada", "pending_user", "pending"]);

function normStatus(s) {
  return String(s || "").toLowerCase().trim();
}

function pairKey(trainerId, clientId) {
  return `pair:${String(trainerId)}:${String(clientId)}`;
}

function safeJsonParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function normalizeAttachments(input) {
  // Permitimos array de objetos {id, mime, name, size}
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const it of arr) {
    if (!it) continue;
    const id = String(it.id || "").trim();
    if (!id) continue;
    out.push({
      id,
      mime: String(it.mime || "").toLowerCase().trim(),
      name: String(it.name || "").slice(0, 180),
      size: Number.isFinite(Number(it.size)) ? Number(it.size) : null,
    });
  }
  return out;
}

// ============================================================
// SCHEMA (auto-create / auto-migrate)
// ============================================================

let schemaPromise = null;

async function ensureChatSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    // conversations
    await query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        reserva_id TEXT,
        trainer_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        last_message_at TEXT,
        last_message_preview TEXT
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_conversations_reserva_id ON conversations(reserva_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_conversations_trainer ON conversations(trainer_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id)`);

    // messages
    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        body TEXT,
        attachments TEXT,
        created_at TEXT,
        read_at TEXT
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`);

    // Si existían tablas antiguas sin columna attachments, la añadimos.
    try {
      const cols = await query(`PRAGMA table_info(messages)`);
      const hasAttachments = cols.some((c) => String(c.name || "").toLowerCase() === "attachments");
      if (!hasAttachments) {
        await query(`ALTER TABLE messages ADD COLUMN attachments TEXT`);
      }
    } catch (e) {
      // En algunos entornos el PRAGMA puede fallar; no bloqueamos.
      console.warn("[chat] No se pudo asegurar columna attachments:", e?.message || e);
    }
  })();

  return schemaPromise;
}

let legacyMigrationDone = false;

async function migrateLegacyConversations() {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  // Migración best-effort:
  // - Antes: 1 conversación por reserva (con reserva_id = <id_reserva>)
  // - Ahora: 1 conversación por pareja (reserva_id = pair:trainer:client)
  // Si hay varias conversaciones para la misma pareja, fusionamos los mensajes.

  try {
    const convs = await query(
      `SELECT id, reserva_id, trainer_id, client_id, created_at, updated_at, last_message_at FROM conversations`
    );

    if (!Array.isArray(convs) || convs.length === 0) return;

    // Agrupar por pareja
    const groups = new Map();
    for (const c of convs) {
      const trainerId = String(c.trainer_id || "").trim();
      const clientId = String(c.client_id || "").trim();
      if (!trainerId || !clientId) continue;
      const key = pairKey(trainerId, clientId);
      const list = groups.get(key) || [];
      list.push(c);
      groups.set(key, list);
    }

    for (const [key, list] of groups.entries()) {
      if (list.length === 0) continue;

      // Elegir canonical:
      // 1) preferimos el que ya tenga reserva_id == key
      // 2) si no, el que tenga last_message_at más reciente
      let canonical = list.find((x) => String(x.reserva_id || "") === key);
      if (!canonical) {
        canonical = [...list].sort((a, b) => {
          const ta = String(a.last_message_at || a.updated_at || a.created_at || "");
          const tb = String(b.last_message_at || b.updated_at || b.created_at || "");
          return tb.localeCompare(ta);
        })[0];
      }

      const canonicalId = String(canonical.id);

      // Asegurar que canonical tenga reserva_id=pairKey
      if (String(canonical.reserva_id || "") !== key) {
        await query(`UPDATE conversations SET reserva_id = ?, updated_at = ? WHERE id = ?`, [key, nowISO(), canonicalId]);
      }

      // Fusionar el resto
      for (const other of list) {
        const otherId = String(other.id);
        if (otherId === canonicalId) continue;

        // mover mensajes
        await query(`UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`, [canonicalId, otherId]);
        // borrar conversación antigua
        await query(`DELETE FROM conversations WHERE id = ?`, [otherId]);
      }

      // Recalcular último mensaje
      const last = await query(
        `SELECT body, attachments, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`,
        [canonicalId]
      );

      if (last.length) {
        const body = String(last[0].body || "");
        const createdAt = String(last[0].created_at || "");
        await query(
          `UPDATE conversations SET last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE id = ?`,
          [createdAt || nowISO(), body.slice(0, 120), nowISO(), canonicalId]
        );
      }
    }
  } catch (e) {
    console.warn("[chat] Migración legacy (best-effort) falló:", e?.message || e);
  }
}

// ============================================================
// HELPERS
// ============================================================

async function relationshipExists(trainerId, clientId) {
  // Relación basada en reservas: cliente (uid) + trainer_id/entrenador_id
  // Permitimos si existe al menos una reserva en estados permitidos.
  const rows = await query(
    `
      SELECT id, status
      FROM reservas
      WHERE uid = ?
        AND (trainer_id = ? OR entrenador_id = ?)
      ORDER BY fecha DESC, hora DESC
      LIMIT 50
    `,
    [String(clientId), String(trainerId), String(trainerId)]
  );

  if (!rows.length) return false;

  // Si hay estados, al menos uno debe estar en lista permitida
  for (const r of rows) {
    const st = normStatus(r.status);
    if (!st) return true; // si no hay status, asumimos relación válida
    if (CHAT_ALLOWED_STATUSES.has(st)) return true;
  }
  return false;
}

async function getOrCreateConversationByPair({ trainerId, clientId }) {
  const key = pairKey(trainerId, clientId);

  // 1) Buscar por key (en columna reserva_id para compatibilidad)
  const existing = await query(
    `SELECT id FROM conversations WHERE reserva_id = ? LIMIT 1`,
    [key]
  );
  if (existing.length) {
    return { conversationId: existing[0].id, exists: true };
  }

  // 2) Crear conversación
  const convId = uuidv4();
  const ts = nowISO();
  await query(
    `
      INSERT INTO conversations (
        id, reserva_id, trainer_id, client_id,
        created_at, updated_at, last_message_at, last_message_preview
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
    `,
    [convId, key, String(trainerId), String(clientId), ts, ts]
  );

  return { conversationId: convId, exists: false };
}

async function ensureCanAccessConversation({ conversationId, userId, role }) {
  const conv = await query(
    `SELECT id, trainer_id, client_id FROM conversations WHERE id = ? LIMIT 1`,
    [String(conversationId)]
  );
  if (!conv.length) {
    const err = new Error("Chat no encontrado");
    err.status = 404;
    throw err;
  }

  const c = conv[0];
  const isAdmin = String(role || "").toLowerCase() === "admin";
  const trainerId = String(c.trainer_id);
  const clientId = String(c.client_id);

  if (!isAdmin && userId !== trainerId && userId !== clientId) {
    const err = new Error("Sin permisos");
    err.status = 403;
    throw err;
  }

  return { trainerId, clientId };
}

async function verifyAttachmentsOwnership({ userId, attachments }) {
  if (!attachments.length) return;

  // LIMIT hard: evita abuso
  if (attachments.length > 5) {
    const err = new Error("Demasiados archivos (máx 5 por mensaje)");
    err.status = 400;
    throw err;
  }

  for (const a of attachments) {
    const rows = await query(
      `SELECT id, mime FROM files WHERE id = ? AND owner_uid = ? LIMIT 1`,
      [String(a.id), String(userId)]
    );
    if (!rows.length) {
      const err = new Error("Adjunto no válido (no existe o no te pertenece)");
      err.status = 400;
      throw err;
    }
  }
}

// ============================================================
// ENDPOINTS
// ============================================================

/**
 * POST /api/chats/by-reserva/:reservaId
 * ✅ Compat: antes creaba 1 chat por reserva
 * ✅ Ahora crea/obtiene 1 chat por pareja (trainer + client)
 */
router.post(
  "/by-reserva/:reservaId",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureChatSchema();
      await migrateLegacyConversations();

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const reservaId = String(req.params.reservaId || "").trim();
      if (!reservaId) {
        return res.status(400).json({ error: "reservaId requerido" });
      }

      // 1) Cargar reserva
      const rr = await query(
        `
          SELECT id, uid, status, trainer_id, entrenador_id
          FROM reservas
          WHERE id = ?
          LIMIT 1
        `,
        [reservaId]
      );

      if (!rr.length) {
        return res.status(404).json({ error: "Reserva no encontrada" });
      }

      const r = rr[0];
      const status = normStatus(r.status);
      if (status && !CHAT_ALLOWED_STATUSES.has(status)) {
        return res.status(403).json({
          error: "Chat no disponible para el estado actual de la reserva",
          status,
        });
      }

      const clientId = String(r.uid || "");
      const trainerId = String(r.trainer_id || r.entrenador_id || "");

      if (!clientId || !trainerId) {
        return res.status(400).json({
          error: "Reserva incompleta (faltan participantes)",
          clientId: !!clientId,
          trainerId: !!trainerId,
        });
      }

      // 2) Permiso: solo cliente o adiestrador de esa reserva (admin también)
      const isAdmin = getUserRole(req) === "admin";
      if (!isAdmin && userId !== clientId && userId !== trainerId) {
        return res.status(403).json({ error: "Sin permisos para este chat" });
      }

      // 3) Obtener/crear conversación por pareja
      const out = await getOrCreateConversationByPair({ trainerId, clientId });
      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-reserva/:reservaId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

/**
 * POST /api/chats/by-trainer/:trainerId
 * Cliente abre chat con un adiestrador (1 chat por pareja)
 * Seguridad: requiere que exista relación previa por reservas.
 */
router.post(
  "/by-trainer/:trainerId",
  verifyToken,
  allowRoles(["admin", "client", "user"]),
  async (req, res) => {
    try {
      await ensureChatSchema();
      await migrateLegacyConversations();

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const trainerId = String(req.params.trainerId || "").trim();
      if (!trainerId) return res.status(400).json({ error: "trainerId requerido" });

      // Admin puede forzar con clientId
      const isAdmin = getUserRole(req) === "admin";
      const clientId = isAdmin
        ? String(req.body?.clientId || userId).trim()
        : userId;

      if (!clientId) return res.status(400).json({ error: "clientId requerido" });

      if (!isAdmin) {
        const ok = await relationshipExists(trainerId, clientId);
        if (!ok) return res.status(403).json({ error: "Sin relación previa con este adiestrador" });
      }

      const out = await getOrCreateConversationByPair({ trainerId, clientId });
      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-trainer/:trainerId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

/**
 * POST /api/chats/by-client/:clientId
 * Adiestrador abre chat con un cliente (1 chat por pareja)
 * Seguridad: requiere relación previa por reservas.
 */
router.post(
  "/by-client/:clientId",
  verifyToken,
  allowRoles(["admin", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureChatSchema();
      await migrateLegacyConversations();

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const clientId = String(req.params.clientId || "").trim();
      if (!clientId) return res.status(400).json({ error: "clientId requerido" });

      const isAdmin = getUserRole(req) === "admin";
      const trainerId = isAdmin ? String(req.body?.trainerId || "").trim() : userId;
      if (!trainerId) return res.status(400).json({ error: "trainerId requerido" });

      if (!isAdmin) {
        const ok = await relationshipExists(trainerId, clientId);
        if (!ok) return res.status(403).json({ error: "Sin relación previa con este cliente" });
      }

      const out = await getOrCreateConversationByPair({ trainerId, clientId });
      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-client/:clientId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

/**
 * GET /api/chats/:conversationId/messages
 * Lista mensajes (valida pertenencia)
 */
router.get(
  "/:conversationId/messages",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureChatSchema();

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const conversationId = String(req.params.conversationId || "").trim();
      if (!conversationId) {
        return res.status(400).json({ error: "conversationId requerido" });
      }

      await ensureCanAccessConversation({
        conversationId,
        userId,
        role: getUserRole(req),
      });

      const before = req.query.before ? String(req.query.before) : null;

      const rows = await query(
        before
          ? `
              SELECT
                id,
                conversation_id AS conversationId,
                sender_id AS senderId,
                body,
                attachments,
                created_at AS createdAt,
                read_at AS readAt
              FROM messages
              WHERE conversation_id = ?
                AND created_at < ?
              ORDER BY created_at DESC
              LIMIT 30
            `
          : `
              SELECT
                id,
                conversation_id AS conversationId,
                sender_id AS senderId,
                body,
                attachments,
                created_at AS createdAt,
                read_at AS readAt
              FROM messages
              WHERE conversation_id = ?
              ORDER BY created_at DESC
              LIMIT 30
            `,
        before ? [conversationId, before] : [conversationId]
      );

      const items = [...rows]
        .reverse()
        .map((m) => ({
          ...m,
          attachments: m.attachments ? safeJsonParse(m.attachments, []) : [],
        }));

      res.json({
        items,
        nextBefore: rows.length ? rows[rows.length - 1].createdAt : null,
      });
    } catch (e) {
      const st = e?.status || 500;
      console.error("GET /api/chats/:conversationId/messages error:", e);
      res.status(st).json({ error: e?.message || "No se pudieron cargar mensajes" });
    }
  }
);

/**
 * POST /api/chats/:conversationId/messages
 * Envía mensaje (texto y/o adjuntos)
 */
router.post(
  "/:conversationId/messages",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureChatSchema();

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const conversationId = String(req.params.conversationId || "").trim();
      const body = String(req.body?.body || "");

      const attachments = normalizeAttachments(req.body?.attachments);
      const bodyTrim = body.trim();

      if (!conversationId) {
        return res.status(400).json({ error: "conversationId requerido" });
      }
      if (!bodyTrim && attachments.length === 0) {
        return res.status(400).json({ error: "Mensaje vacío" });
      }

      await ensureCanAccessConversation({
        conversationId,
        userId,
        role: getUserRole(req),
      });

      // Validar que los adjuntos pertenecen al usuario
      await verifyAttachmentsOwnership({ userId, attachments });

      const msgId = uuidv4();
      const ts = nowISO();
      const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;

      await query(
        `
          INSERT INTO messages (
            id, conversation_id, sender_id, body, attachments, created_at, read_at
          )
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
        [msgId, conversationId, userId, bodyTrim || null, attachmentsJson, ts]
      );

      // Preview: si no hay body, ponemos un marcador
      const preview = bodyTrim
        ? bodyTrim.slice(0, 120)
        : attachments.length
        ? `📎 ${attachments.length} archivo(s)`
        : "";

      await query(
        `
          UPDATE conversations
          SET updated_at = ?,
              last_message_at = ?,
              last_message_preview = ?
          WHERE id = ?
        `,
        [ts, ts, preview, conversationId]
      );

      res.json({ ok: true, messageId: msgId, createdAt: ts });
    } catch (e) {
      const st = e?.status || 500;
      console.error("POST /api/chats/:conversationId/messages error:", e);
      res.status(st).json({ error: e?.message || "No se pudo enviar el mensaje" });
    }
  }
);

export default router;
