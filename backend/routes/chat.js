// backend/routes/chat.js
// ============================================================
// Chat Cliente–Adiestrador
// ✅ 1 conversación por PAREJA (trainer_id + client_id)
// ✅ Mensajes con adjuntos (fotos / vídeos / archivos)
// ✅ Mantiene compatibilidad con el endpoint /by-reserva/:id
//
// EXTRA:
// ✅ Lista de chats del usuario: GET /api/chats
// ✅ Borrado lógico por usuario: DELETE /api/chats/:conversationId
// ✅ En mensajes devuelve senderName + senderPhotoUrl (para avatar en UI)
//
// FIX IMPORTANTE:
// ✅ Soporta distintos nombres de columnas en la tabla reservas
//    (uid / user_id / cliente_id / client_id, trainer_id / entrenador_id / adiestrador_id, status / estado, etc.)
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
// Nota: normalizamos sinónimos (confirmada/confirmado, pendiente, etc.) a estados canónicos.
const CHAT_ALLOWED_STATUSES = new Set(["confirmed", "pending_user", "pending"]);

function canonStatus(s) {
  const x = String(s || "").toLowerCase().trim();

  // Pending (centro)
  if (x === "pendiente") return "pending";

  // Pending user (cliente)
  if (
    x === "pending-user" ||
    x === "pending user" ||
    x === "pendiente_usuario" ||
    x === "pendiente usuario" ||
    x === "pendiente_user"
  ) {
    return "pending_user";
  }

  // Confirmed
  if (
    x === "confirmada" ||
    x === "confirmado" ||
    x === "aceptada" ||
    x === "aceptado" ||
    x === "accepted"
  ) {
    return "confirmed";
  }

  // Cancelled
  if (x === "cancelada" || x === "cancelado" || x === "canceled") return "cancelled";

  // Rejected
  if (x === "rechazada" || x === "rechazado") return "rejected";

  return x;
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
        last_message_preview TEXT,

        -- ✅ borrado lógico por usuario
        deleted_by_trainer_at TEXT,
        deleted_by_client_at TEXT
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
      console.warn("[chat] No se pudo asegurar columna attachments:", e?.message || e);
    }

    // Si existían conversations antiguas sin columnas de borrado lógico, las añadimos.
    try {
      const cols = await query(`PRAGMA table_info(conversations)`);
      const names = new Set(cols.map((c) => String(c.name || "").toLowerCase()));

      if (!names.has("deleted_by_trainer_at")) {
        await query(`ALTER TABLE conversations ADD COLUMN deleted_by_trainer_at TEXT`);
      }
      if (!names.has("deleted_by_client_at")) {
        await query(`ALTER TABLE conversations ADD COLUMN deleted_by_client_at TEXT`);
      }
    } catch (e) {
      console.warn("[chat] No se pudo asegurar columnas de borrado lógico:", e?.message || e);
    }
  })();

  return schemaPromise;
}

let legacyMigrationDone = false;

async function migrateLegacyConversations() {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  try {
    const convs = await query(
      `SELECT id, reserva_id, trainer_id, client_id, created_at, updated_at, last_message_at FROM conversations`
    );

    if (!Array.isArray(convs) || convs.length === 0) return;

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

      let canonical = list.find((x) => String(x.reserva_id || "") === key);
      if (!canonical) {
        canonical = [...list].sort((a, b) => {
          const ta = String(a.last_message_at || a.updated_at || a.created_at || "");
          const tb = String(b.last_message_at || b.updated_at || b.created_at || "");
          return tb.localeCompare(ta);
        })[0];
      }

      const canonicalId = String(canonical.id);

      if (String(canonical.reserva_id || "") !== key) {
        await query(`UPDATE conversations SET reserva_id = ?, updated_at = ? WHERE id = ?`, [
          key,
          nowISO(),
          canonicalId,
        ]);
      }

      for (const other of list) {
        const otherId = String(other.id);
        if (otherId === canonicalId) continue;

        await query(`UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`, [canonicalId, otherId]);
        await query(`DELETE FROM conversations WHERE id = ?`, [otherId]);
      }

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
// RESERVAS SCHEMA DETECTION (FIX)
// ============================================================

let reservasColsPromise = null;

async function getReservasColMap() {
  if (reservasColsPromise) return reservasColsPromise;

  reservasColsPromise = (async () => {
    try {
      const cols = await query(`PRAGMA table_info(reservas)`);
      const map = new Map(); // lower -> original
      for (const c of cols || []) {
        const name = String(c.name || "").trim();
        if (!name) continue;
        map.set(name.toLowerCase(), name);
      }
      return map;
    } catch (e) {
      console.warn("[chat] No se pudo leer schema de reservas:", e?.message || e);
      return new Map();
    }
  })();

  return reservasColsPromise;
}

function qIdent(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9_]+$/.test(s)) return null;
  return `"${s}"`;
}

function pickCol(colMap, candidates) {
  for (const cand of candidates) {
    const key = String(cand || "").toLowerCase().trim();
    if (colMap.has(key)) return colMap.get(key);
  }
  return null;
}

function buildTrainerExpr(colMap) {
  const trainer1 = pickCol(colMap, ["trainer_id", "trainer_uid"]);
  const trainer2 = pickCol(colMap, ["entrenador_id", "entrenador_uid"]);
  const trainer3 = pickCol(colMap, ["adiestrador_id", "adiestrador_uid"]);

  const parts = [qIdent(trainer1), qIdent(trainer2), qIdent(trainer3)].filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];

  // Si hay varias posibles columnas, preferimos el primer valor no-nulo.
  return `COALESCE(${parts.join(", ")})`;
}


function buildStatusExpr(colMap) {
  const st1 = pickCol(colMap, ["status"]);
  const st2 = pickCol(colMap, ["estado"]);

  const s1 = qIdent(st1);
  const s2 = qIdent(st2);

  if (s1 && s2) return `COALESCE(${s1}, ${s2})`;
  if (s1) return `${s1}`;
  if (s2) return `${s2}`;
  return null;
}

function buildClientCol(colMap) {
  return pickCol(colMap, ["uid", "client_id", "cliente_id", "user_id", "usuario_id"]);
}

function buildReservaIdCol(colMap) {
  return pickCol(colMap, ["id", "reserva_id"]);
}


function buildEmailCol(colMap) {
  return pickCol(colMap, ["email", "correo", "mail"]);
}

function isEmailLike(v) {
  return /@/.test(String(v || ""));
}

/**
 * Resuelve un identificador "legacy" (users.id, users.uid, usuarios.id, email)
 * a un UID canónico (el que viaja en el JWT: users.uid / usuarios.id).
 */
async function resolveCanonicalUid({ value, email } = {}) {
  const v = String(value || "").trim();
  const vLower = v ? v.toLowerCase() : "";
  const e = String(email || "").trim().toLowerCase();

  // 1) Intentar resolver por el valor recibido
  if (v) {
    try {
      const u = await query(
        `SELECT uid FROM users WHERE uid = ? OR id = ? OR email = ? LIMIT 1`,
        [v, v, vLower]
      );
      if (u.length && u[0]?.uid) return String(u[0].uid);
    } catch {
      // ignore
    }

    try {
      const ru = await query(
        `SELECT id FROM usuarios WHERE id = ? OR email = ? LIMIT 1`,
        [v, vLower]
      );
      if (ru.length && ru[0]?.id) return String(ru[0].id);
    } catch {
      // ignore
    }
  }

  // 2) Intentar resolver por email (si existe)
  if (e) {
    try {
      const u2 = await query(`SELECT uid FROM users WHERE email = ? LIMIT 1`, [e]);
      if (u2.length && u2[0]?.uid) return String(u2[0].uid);
    } catch {
      // ignore
    }

    try {
      const ru2 = await query(`SELECT id FROM usuarios WHERE email = ? LIMIT 1`, [e]);
      if (ru2.length && ru2[0]?.id) return String(ru2[0].id);
    } catch {
      // ignore
    }
  }

  return null;
}

// ============================================================
// HELPERS
// ============================================================

async function relationshipExists(trainerId, clientId) {
  const colMap = await getReservasColMap();
  if (!colMap.size) return false;

  const clientCol = buildClientCol(colMap);
  const trainerExpr = buildTrainerExpr(colMap);
  const statusExpr = buildStatusExpr(colMap);
  if (!clientCol || !trainerExpr) return false;

  const clientQ = qIdent(clientCol);
  if (!clientQ) return false;

  // Para el WHERE del trainer usamos las columnas reales que existan (OR)
  const trainerCols = [];
  for (const cand of ["trainer_id", "trainer_uid", "entrenador_id", "entrenador_uid", "adiestrador_id", "adiestrador_uid"]) {
    const c = pickCol(colMap, [cand]);
    const qc = qIdent(c);
    if (qc) trainerCols.push(qc);
  }
  if (!trainerCols.length) return false;

  const statusSel = statusExpr ? `${statusExpr} AS status` : `NULL AS status`;
  const fechaCol = pickCol(colMap, ["fecha", "date"]);
  const horaCol = pickCol(colMap, ["hora", "hour"]);
  const fechaQ = qIdent(fechaCol);
  const horaQ = qIdent(horaCol);

  const orderBy =
    fechaQ && horaQ
      ? `ORDER BY ${fechaQ} DESC, ${horaQ} DESC`
      : fechaQ
      ? `ORDER BY ${fechaQ} DESC`
      : ``;

  const trainerWhere = trainerCols.map((c) => `${c} = ?`).join(" OR ");

  const rows = await query(
    `
      SELECT id, ${statusSel}
      FROM reservas
      WHERE ${clientQ} = ?
        AND (${trainerWhere})
      ${orderBy}
      LIMIT 50
    `,
    [String(clientId), ...trainerCols.map(() => String(trainerId))]
  );

  if (!rows.length) return false;

  for (const r of rows) {
    const st = canonStatus(r.status);
    if (!st) return true;
    if (CHAT_ALLOWED_STATUSES.has(st)) return true;
  }
  return false;
}


async function getOrCreateConversationByPair({ trainerId, clientId, aliasKeys = [] }) {
  const key = pairKey(trainerId, clientId);

  // Si venimos de datos legacy, puede existir ya una conversación con una key "mal formada".
  const keys = [key, ...(Array.isArray(aliasKeys) ? aliasKeys : [])]
    .map((k) => String(k || "").trim())
    .filter(Boolean);

  const uniq = [...new Set(keys)];

  if (uniq.length) {
    const ph = uniq.map(() => "?").join(", ");
    const existing = await query(
      `SELECT id, reserva_id, trainer_id, client_id FROM conversations WHERE reserva_id IN (${ph}) LIMIT 1`,
      uniq
    );

    if (existing.length) {
      const c = existing[0];
      const needUpdate =
        String(c.reserva_id || "") !== key ||
        String(c.trainer_id || "") !== String(trainerId) ||
        String(c.client_id || "") !== String(clientId);

      if (needUpdate) {
        await query(
          `UPDATE conversations SET reserva_id = ?, trainer_id = ?, client_id = ?, updated_at = ? WHERE id = ?`,
          [key, String(trainerId), String(clientId), nowISO(), String(c.id)]
        );
      }

      return { conversationId: c.id, exists: true };
    }
  }

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



async function restoreConversationForUser({ conversationId, userId }) {
  const rows = await query(
    `
      SELECT trainer_id, client_id, deleted_by_trainer_at, deleted_by_client_at
      FROM conversations
      WHERE id = ?
      LIMIT 1
    `,
    [String(conversationId)]
  );
  if (!rows.length) return;

  const c = rows[0];
  const trainerId = String(c.trainer_id || "");
  const clientId = String(c.client_id || "");
  const uid = String(userId || "");
  const ts = nowISO();

  if (uid && uid === trainerId && String(c.deleted_by_trainer_at || "").trim()) {
    await query(`UPDATE conversations SET deleted_by_trainer_at = NULL, updated_at = ? WHERE id = ?`, [
      ts,
      conversationId,
    ]);
  }
  if (uid && uid === clientId && String(c.deleted_by_client_at || "").trim()) {
    await query(`UPDATE conversations SET deleted_by_client_at = NULL, updated_at = ? WHERE id = ?`, [
      ts,
      conversationId,
    ]);
  }
}

async function ensureCanAccessConversation({ conversationId, userId, role, allowDeleted = false }) {
  const conv = await query(
    `
      SELECT id, trainer_id, client_id, deleted_by_trainer_at, deleted_by_client_at
      FROM conversations
      WHERE id = ?
      LIMIT 1
    `,
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

  if (!isAdmin && !allowDeleted) {
    const deletedByTrainer = String(c.deleted_by_trainer_at || "").trim();
    const deletedByClient = String(c.deleted_by_client_at || "").trim();
    if (userId === trainerId && deletedByTrainer) {
      const err = new Error("Chat no encontrado");
      err.status = 404;
      throw err;
    }
    if (userId === clientId && deletedByClient) {
      const err = new Error("Chat no encontrado");
      err.status = 404;
      throw err;
    }
  }

  return { trainerId, clientId };
}

async function verifyAttachmentsOwnership({ userId, attachments }) {
  if (!attachments.length) return;

  if (attachments.length > 5) {
    const err = new Error("Demasiados archivos (máx 5 por mensaje)");
    err.status = 400;
    throw err;
  }

  for (const a of attachments) {
    const rows = await query(`SELECT id, mime FROM files WHERE id = ? AND owner_uid = ? LIMIT 1`, [
      String(a.id),
      String(userId),
    ]);
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

router.get(
  "/",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureChatSchema();
      await migrateLegacyConversations();

      const role = getUserRole(req);
      const isAdmin = role === "admin";

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const targetUserId = isAdmin && req.query.userId ? String(req.query.userId).trim() : userId;
      if (!targetUserId) return res.status(400).json({ error: "userId requerido" });

      const rows = await query(
        `
          SELECT
            c.id AS conversationId,
            c.trainer_id AS trainerId,
            c.client_id AS clientId,
            c.last_message_at AS lastMessageAt,
            c.last_message_preview AS lastMessagePreview,
            c.updated_at AS updatedAt,
            CASE WHEN c.trainer_id = ? THEN c.client_id ELSE c.trainer_id END AS otherId,
            COALESCE(u.nombre, u.email, '') AS otherName,
            u.email AS otherEmail,
            u.foto AS otherPhotoUrl
          FROM conversations c
          LEFT JOIN users u
            ON (u.uid = CASE WHEN c.trainer_id = ? THEN c.client_id ELSE c.trainer_id END)
            OR (u.id  = CASE WHEN c.trainer_id = ? THEN c.client_id ELSE c.trainer_id END)
          WHERE
            (
              c.trainer_id = ?
              AND (c.deleted_by_trainer_at IS NULL OR c.deleted_by_trainer_at = '')
            )
            OR
            (
              c.client_id = ?
              AND (c.deleted_by_client_at IS NULL OR c.deleted_by_client_at = '')
            )
          ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
          LIMIT 100
        `,
        [targetUserId, targetUserId, targetUserId, targetUserId, targetUserId]
      );

      res.json({ items: rows });
    } catch (e) {
      console.error("GET /api/chats error:", e);
      res.status(500).json({ error: "No se pudieron cargar los chats" });
    }
  }
);

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

      // ✅ Detectar schema real de reservas
      const colMap = await getReservasColMap();
      const idCol = buildReservaIdCol(colMap);
      const clientCol = buildClientCol(colMap);
      const trainerExpr = buildTrainerExpr(colMap);
      const statusExpr = buildStatusExpr(colMap);


      const emailCol = buildEmailCol(colMap);
      const emailQ = qIdent(emailCol);
      const emailSel = emailQ ? `${emailQ} AS email` : `NULL AS email`;
      const idQ = qIdent(idCol);
      const clientQ = qIdent(clientCol);

      if (!idQ) {
        return res.status(500).json({ error: "Tabla reservas sin columna id (o reserva_id)" });
      }
      if (!trainerExpr) {
        return res.status(500).json({ error: "Tabla reservas sin columnas de entrenador (trainer_id / entrenador_id / adiestrador_id)" });
      }
      if (!clientQ) {
        return res.status(500).json({ error: "Tabla reservas sin columna de cliente (uid / user_id / cliente_id / client_id)" });
      }

      const statusSel = statusExpr ? `${statusExpr} AS status` : `NULL AS status`;

      // 1) Cargar reserva con columnas reales
      const rr = await query(
        `
          SELECT
            ${idQ} AS id,
            ${clientQ} AS clientId,
            ${trainerExpr} AS trainerId,
            ${statusSel},
            ${emailSel}
          FROM reservas
          WHERE ${idQ} = ?
          LIMIT 1
        `,
        [reservaId]
      );

      if (!rr.length) {
        return res.status(404).json({ error: "Reserva no encontrada" });
      }

      const r = rr[0];
      const status = canonStatus(r.status);
      if (status && !CHAT_ALLOWED_STATUSES.has(status)) {
        return res.status(403).json({
          error: "Chat no disponible para el estado actual de la reserva",
          status,
        });
      }

      
      const clientRaw = String(r.clientId || "").trim();
      const trainerRaw = String(r.trainerId || "").trim();
      const reservaEmail = String(r.email || "").trim().toLowerCase();
      const userEmail = String(req.user?.email || "").trim().toLowerCase();
      
      if (!clientRaw || !trainerRaw) {
        return res.status(400).json({
          error: "Reserva incompleta (faltan participantes)",
          clientId: !!clientRaw,
          trainerId: !!trainerRaw,
        });
      }
      
      // ✅ Resolver IDs canónicos (tokens usan uid compartido; reservas antiguas podían guardar users.id o email)
      const resolvedClientId =
        (await resolveCanonicalUid({ value: clientRaw, email: reservaEmail })) ||
        (reservaEmail ? await resolveCanonicalUid({ email: reservaEmail }) : null) ||
        null;
      
      const resolvedTrainerId =
        (await resolveCanonicalUid({ value: trainerRaw })) ||
        (isEmailLike(trainerRaw) ? await resolveCanonicalUid({ email: trainerRaw }) : null) ||
        null;
      
      const clientId = resolvedClientId || clientRaw;
      const trainerId = resolvedTrainerId || trainerRaw;
      
      // 2) Permiso: solo cliente o adiestrador de esa reserva (admin también)
      const isAdmin = getUserRole(req) === "admin";
      
      const canById = userId === clientId || userId === trainerId;
      const canByEmail = !!userEmail && !!reservaEmail && userEmail === reservaEmail;
      
      if (!isAdmin && !canById && !canByEmail) {
        return res.status(403).json({ error: "Sin permisos para este chat" });
      }
      
      // Si entra por email (legacy) y el id del cliente no coincide, amarramos al uid autenticado
      const effectiveClientId = canByEmail && clientId !== userId ? userId : clientId;
      
      // 3) Obtener/crear conversación por pareja (con aliases para migrar conversaciones legacy)
      const aliasKeys = [];
      if (trainerRaw && clientRaw) aliasKeys.push(pairKey(trainerRaw, clientRaw));
      if (trainerId && clientRaw && trainerId !== trainerRaw) aliasKeys.push(pairKey(trainerId, clientRaw));
      if (trainerRaw && effectiveClientId && effectiveClientId !== clientRaw)
        aliasKeys.push(pairKey(trainerRaw, effectiveClientId));
      
      const out = await getOrCreateConversationByPair({
        trainerId,
        clientId: effectiveClientId,
        aliasKeys,
      });
      await restoreConversationForUser({ conversationId: out.conversationId, userId });

      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-reserva/:reservaId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

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

      const isAdmin = getUserRole(req) === "admin";
      const clientId = isAdmin ? String(req.body?.clientId || userId).trim() : userId;

      if (!clientId) return res.status(400).json({ error: "clientId requerido" });

      if (!isAdmin) {
        const ok = await relationshipExists(trainerId, clientId);
        if (!ok) return res.status(403).json({ error: "Sin relación previa con este adiestrador" });
      }

      const out = await getOrCreateConversationByPair({ trainerId, clientId });

      await restoreConversationForUser({ conversationId: out.conversationId, userId: clientId });

      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-trainer/:trainerId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

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

      await restoreConversationForUser({ conversationId: out.conversationId, userId: trainerId });

      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-client/:clientId error:", e);
      res.status(500).json({ error: "No se pudo abrir el chat" });
    }
  }
);

router.delete(
  "/:conversationId",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureChatSchema();

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "No autorizado" });

      const conversationId = String(req.params.conversationId || "").trim();
      if (!conversationId) return res.status(400).json({ error: "conversationId requerido" });

      const role = getUserRole(req);

      const { trainerId, clientId } = await ensureCanAccessConversation({
        conversationId,
        userId,
        role,
        allowDeleted: true,
      });

      if (role === "admin" && userId !== trainerId && userId !== clientId) {
        return res.status(403).json({ error: "Solo los participantes pueden borrar este chat" });
      }

      const ts = nowISO();
      if (String(userId) === String(trainerId)) {
        await query(`UPDATE conversations SET deleted_by_trainer_at = ?, updated_at = ? WHERE id = ?`, [
          ts,
          ts,
          conversationId,
        ]);
      } else if (String(userId) === String(clientId)) {
        await query(`UPDATE conversations SET deleted_by_client_at = ?, updated_at = ? WHERE id = ?`, [
          ts,
          ts,
          conversationId,
        ]);
      }

      return res.json({ ok: true });
    } catch (e) {
      const st = e?.status || 500;
      console.error("DELETE /api/chats/:conversationId error:", e);
      res.status(st).json({ error: e?.message || "No se pudo borrar el chat" });
    }
  }
);

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
                m.id,
                m.conversation_id AS conversationId,
                m.sender_id AS senderId,
                m.body,
                m.attachments,
                m.created_at AS createdAt,
                m.read_at AS readAt,
                COALESCE(u.nombre, u.email, '') AS senderName,
                u.foto AS senderPhotoUrl
              FROM messages m
              LEFT JOIN users u
                ON u.uid = m.sender_id OR u.id = m.sender_id
              WHERE m.conversation_id = ?
                AND m.created_at < ?
              ORDER BY m.created_at DESC
              LIMIT 30
            `
          : `
              SELECT
                m.id,
                m.conversation_id AS conversationId,
                m.sender_id AS senderId,
                m.body,
                m.attachments,
                m.created_at AS createdAt,
                m.read_at AS readAt,
                COALESCE(u.nombre, u.email, '') AS senderName,
                u.foto AS senderPhotoUrl
              FROM messages m
              LEFT JOIN users u
                ON u.uid = m.sender_id OR u.id = m.sender_id
              WHERE m.conversation_id = ?
              ORDER BY m.created_at DESC
              LIMIT 30
            `,
        before ? [conversationId, before] : [conversationId]
      );

      const items = [...rows].reverse().map((m) => ({
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
              last_message_preview = ?,
              deleted_by_trainer_at = NULL,
              deleted_by_client_at = NULL
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
