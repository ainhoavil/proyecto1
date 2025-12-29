// backend/routes/chat.js
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();
const nowISO = () => new Date().toISOString();

// 👇 Tu auth a veces usa id, otras uid. Esto lo hace robusto.
const getUserId = (req) => String(req.user?.id || req.user?.uid || "");

// 👇 Tu rol puede venir como rol o role.
const getUserRole = (req) =>
  String(req.user?.rol || req.user?.role || "").toLowerCase();

/**
 * CHAT por reserva:
 * - Si quieres estrictamente "solo después de confirmada", deja solo "confirmed".
 * - Yo dejo confirmed + pending_user (y si quieres pending también, lo añades).
 */
const CHAT_ALLOWED_STATUSES = new Set(["confirmed", "pending_user"]);
// const CHAT_ALLOWED_STATUSES = new Set(["confirmed", "pending_user", "pending"]);

function normStatus(s) {
  return String(s || "").toLowerCase().trim();
}

/* ============================================================
   POST /api/chats/by-reserva/:reservaId
   Crea u obtiene la conversación (1 chat por reserva)
   Solo si el usuario logueado pertenece a esa reserva.
============================================================ */
router.post(
  "/by-reserva/:reservaId",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const reservaId = String(req.params.reservaId || "").trim();
      if (!reservaId)
        return res.status(400).json({ error: "reservaId requerido" });

      // 1) Cargar reserva (adaptado a tu tabla)
      const rr = await query(
        `
        SELECT
          id,
          uid,
          status,
          trainer_id,
          entrenador_id
        FROM reservas
        WHERE id = ?
        LIMIT 1
        `,
        [reservaId]
      );

      if (!rr.length)
        return res.status(404).json({ error: "Reserva no encontrada" });

      const r = rr[0];

      const status = normStatus(r.status);
      if (status && !CHAT_ALLOWED_STATUSES.has(status)) {
        return res.status(403).json({
          error:
            "Chat no disponible para el estado actual de la reserva",
          status,
        });
      }

      const clientId = String(r.uid || "");
      // ✅ soporta ambos campos: trainer_id y entrenador_id
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

      // 3) Buscar conversación existente por reserva_id
      const existing = await query(
        `
        SELECT id
        FROM conversations
        WHERE reserva_id = ?
        LIMIT 1
        `,
        [reservaId]
      );

      if (existing.length) {
        return res.json({
          conversationId: existing[0].id,
          exists: true,
        });
      }

      // 4) Crear conversación
      const convId = uuidv4();
      const ts = nowISO();

      await query(
        `
        INSERT INTO conversations (
          id,
          reserva_id,
          trainer_id,
          client_id,
          created_at,
          updated_at,
          last_message_at,
          last_message_preview
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
        `,
        [convId, reservaId, trainerId, clientId, ts, ts]
      );

      return res.json({
        conversationId: convId,
        exists: false,
      });
    } catch (e) {
      console.error("POST /api/chats/by-reserva/:reservaId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

/* ============================================================
   GET /api/chats/:conversationId/messages
   Lista mensajes (valida pertenencia)
============================================================ */
router.get(
  "/:conversationId/messages",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const conversationId = String(req.params.conversationId || "").trim();
      if (!conversationId)
        return res.status(400).json({ error: "conversationId requerido" });

      const conv = await query(
        `
        SELECT id, trainer_id, client_id
        FROM conversations
        WHERE id = ?
        LIMIT 1
        `,
        [conversationId]
      );

      if (!conv.length)
        return res.status(404).json({ error: "Chat no encontrado" });

      const c = conv[0];
      const isAdmin = getUserRole(req) === "admin";
      if (
        !isAdmin &&
        userId !== String(c.trainer_id) &&
        userId !== String(c.client_id)
      ) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const before = req.query.before ? String(req.query.before) : null;

      const rows = await query(
        before
          ? `
            SELECT
              id,
              conversation_id AS conversationId,
              sender_id AS senderId,
              body,
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
              created_at AS createdAt,
              read_at AS readAt
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at DESC
            LIMIT 30
          `,
        before ? [conversationId, before] : [conversationId]
      );

      res.json({
        items: [...rows].reverse(),
        nextBefore: rows.length ? rows[rows.length - 1].createdAt : null,
      });
    } catch (e) {
      console.error("GET /api/chats/:conversationId/messages error:", e);
      res.status(500).json({ error: "No se pudieron cargar mensajes" });
    }
  }
);

/* ============================================================
   POST /api/chats/:conversationId/messages
   Envía mensaje
============================================================ */
router.post(
  "/:conversationId/messages",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const conversationId = String(req.params.conversationId || "").trim();
      const body = String(req.body?.body || "").trim();

      if (!conversationId)
        return res.status(400).json({ error: "conversationId requerido" });
      if (!body) return res.status(400).json({ error: "Mensaje vacío" });

      const conv = await query(
        `SELECT id, trainer_id, client_id FROM conversations WHERE id = ? LIMIT 1`,
        [conversationId]
      );
      if (!conv.length)
        return res.status(404).json({ error: "Chat no encontrado" });

      const c = conv[0];
      const isAdmin = getUserRole(req) === "admin";
      if (
        !isAdmin &&
        userId !== String(c.trainer_id) &&
        userId !== String(c.client_id)
      ) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const msgId = uuidv4();
      const ts = nowISO();

      await query(
        `
        INSERT INTO messages (id, conversation_id, sender_id, body, created_at, read_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        `,
        [msgId, conversationId, userId, body, ts]
      );

      await query(
        `
        UPDATE conversations
        SET updated_at = ?,
            last_message_at = ?,
            last_message_preview = ?
        WHERE id = ?
        `,
        [ts, ts, body.slice(0, 120), conversationId]
      );

      res.json({ ok: true, messageId: msgId, createdAt: ts });
    } catch (e) {
      console.error("POST /api/chats/:conversationId/messages error:", e);
      res.status(500).json({ error: "No se pudo enviar el mensaje" });
    }
  }
);

export default router;
