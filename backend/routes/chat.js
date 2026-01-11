// backend/routes/chat.js
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
// ✅ Detecta tabla usuarios/users para nombres/fotos sin romper
// ✅ Detecta columna owner en files (owner_uid / owner_id / user_id / uid)
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";
import { notifyChatMessage } from "../services/notifications.js";

const router = express.Router();
const nowISO = () => new Date().toISOString();

// 👇 Tu auth a veces usa id, otras uid. Esto lo hace robusto.
const getUserId = (req) => String(req.user?.id || req.user?.uid || "");

// 👇 Tu rol puede venir como rol o role.
const getUserRole = (req) =>
  String(req.user?.rol || req.user?.role || "").toLowerCase();
// CONFIG
const CHAT_ALLOWED_STATUSES = new Set(["confirmed", "pending", "pending_user"]);

function canonStatus(raw) {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return "";
  if (
    [
      "confirmed",
      "confirmada",
      "confirmado",
      "aceptada",
      "aceptado",
      "pagada",
      "pagado",
      "paid",
    ].includes(s)
  )
    return "confirmed";
  if (["pending", "pendiente"].includes(s)) return "pending";
  if (
    [
      "pending_user",
      "pending-user",
      "pendiente_cliente",
      "pendiente-cliente",
    ].includes(s)
  )
    return "pending_user";
  if (["cancelled", "cancelada", "cancelado"].includes(s)) return "cancelled";
  if (["rejected", "rechazada", "rechazado"].includes(s)) return "rejected";
  return s;
}
function normStatus(s) {
  return canonStatus(s);
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
// IDENT / COLUMN HELPERS
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
// USERS TABLE DETECTION (usuarios / users) + column map
let usersMetaPromise = null;

async function getUsersMeta() {
  if (usersMetaPromise) return usersMetaPromise;

  usersMetaPromise = (async () => {
    try {
      const t = await query(`
        SELECT name
        FROM sqlite_master
        WHERE type='table' AND name IN ('users','usuarios')
        ORDER BY CASE name WHEN 'users' THEN 0 ELSE 1 END
        LIMIT 1
      `);

      const table = String(t?.[0]?.name || "").trim();
      if (!table) {
        return {
          table: null,
          idCols: [],
          nameCol: null,
          emailCol: null,
          photoCol: null,
        };
      }

      const cols = await query(`PRAGMA table_info(${table})`);
      const map = new Map();
      for (const c of cols || []) {
        const name = String(c.name || "").trim();
        if (!name) continue;
        map.set(name.toLowerCase(), name);
      }

      const id1 = pickCol(map, ["uid"]);
      const id2 = pickCol(map, ["id"]);
      const idCols = [id1, id2].filter(Boolean);

      const nameCol = pickCol(map, [
        "nombre",
        "name",
        "full_name",
        "fullname",
        "username",
        "user_name",
      ]);
      const emailCol = pickCol(map, ["email", "mail", "correo"]);
      const photoCol = pickCol(map, [
        "foto",
        "photo",
        "avatar",
        "image",
        "imagen",
        "picture",
        "photo_url",
        "avatar_url",
      ]);

      return { table, idCols, nameCol, emailCol, photoCol };
    } catch (e) {
      console.warn("[chat] getUsersMeta falló:", e?.message || e);
      return { table: null, idCols: [], nameCol: null, emailCol: null, photoCol: null };
    }
  })();

  return usersMetaPromise;
}

function buildUserJoinOnAlias(aliasName, usersMeta) {
  // aliasName: e.g. "c.otherId" (sin placeholders)
  const table = usersMeta?.table;
  const idCols = Array.isArray(usersMeta?.idCols) ? usersMeta.idCols : [];
  if (!table || idCols.length === 0) {
    return {
      joinSql: "",
      selectSql: `'' AS otherName, '' AS otherEmail, '' AS otherPhotoUrl`,
    };
  }

  const onParts = [];
  for (const c of idCols) {
    const qc = qIdent(c);
    if (qc) onParts.push(`u.${qc} = ${aliasName}`);
  }
  if (!onParts.length) {
    return {
      joinSql: "",
      selectSql: `'' AS otherName, '' AS otherEmail, '' AS otherPhotoUrl`,
    };
  }

  const nameQ = qIdent(usersMeta.nameCol);
  const emailQ = qIdent(usersMeta.emailCol);
  const photoQ = qIdent(usersMeta.photoCol);

  const otherName =
    nameQ && emailQ
      ? `COALESCE(u.${nameQ}, u.${emailQ}, '')`
      : nameQ
      ? `COALESCE(u.${nameQ}, '')`
      : emailQ
      ? `COALESCE(u.${emailQ}, '')`
      : `''`;

  const otherEmail = emailQ ? `COALESCE(u.${emailQ}, '')` : `''`;
  const otherPhoto = photoQ ? `COALESCE(u.${photoQ}, '')` : `''`;

  return {
    joinSql: `LEFT JOIN ${table} u ON (${onParts.join(" OR ")})`,
    selectSql: `${otherName} AS otherName, ${otherEmail} AS otherEmail, ${otherPhoto} AS otherPhotoUrl`,
  };
}

function buildSenderJoin(usersMeta) {
  const table = usersMeta?.table;
  const idCols = Array.isArray(usersMeta?.idCols) ? usersMeta.idCols : [];
  if (!table || idCols.length === 0) {
    return { joinSql: "", senderSelectSql: `'' AS senderName, '' AS senderPhotoUrl` };
  }

  const onParts = [];
  for (const c of idCols) {
    const qc = qIdent(c);
    if (qc) onParts.push(`u.${qc} = m.sender_id`);
  }
  if (!onParts.length) {
    return { joinSql: "", senderSelectSql: `'' AS senderName, '' AS senderPhotoUrl` };
  }

  const nameQ = qIdent(usersMeta.nameCol);
  const emailQ = qIdent(usersMeta.emailCol);
  const photoQ = qIdent(usersMeta.photoCol);

  const senderName =
    nameQ && emailQ
      ? `COALESCE(u.${nameQ}, u.${emailQ}, '')`
      : nameQ
      ? `COALESCE(u.${nameQ}, '')`
      : emailQ
      ? `COALESCE(u.${emailQ}, '')`
      : `''`;

  const senderPhoto = photoQ ? `COALESCE(u.${photoQ}, '')` : `''`;

  return {
    joinSql: `LEFT JOIN ${table} u ON (${onParts.join(" OR ")})`,
    senderSelectSql: `${senderName} AS senderName, ${senderPhoto} AS senderPhotoUrl`,
  };
}
// SCHEMA (auto-create / auto-migrate)
let schemaPromise = null;
let conversationsIdIsInteger = false;
let messagesIdIsInteger = false;

async function ensureChatSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        reserva_id TEXT,
        trainer_id TEXT,
        client_id TEXT,
        created_at TEXT,
        updated_at TEXT,
        last_message_at TEXT,
        last_message_preview TEXT,
        deleted_by_trainer_at TEXT,
        deleted_by_client_at TEXT
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        sender_id TEXT,
        body TEXT,
        attachments TEXT,
        created_at TEXT,
        read_at TEXT
      )
    `);

    const convCols = await query(`PRAGMA table_info(conversations)`);
    const convNames = new Set(convCols.map((c) => String(c.name || "").toLowerCase()));

    const convIdCol = convCols.find((c) => String(c.name || "").toLowerCase() === "id");
    const convIdType = String(convIdCol?.type || "").toLowerCase();
    conversationsIdIsInteger = !!(
      convIdCol &&
      Number(convIdCol.pk) === 1 &&
      convIdType.includes("int")
    );

    const addConvCol = async (name, typeSql = "TEXT") => {
      if (convNames.has(name)) return;
      try {
        await query(`ALTER TABLE conversations ADD COLUMN "${name}" ${typeSql}`);
        convNames.add(name);
      } catch (e) {
        console.warn(`[chat] No se pudo añadir conversations.${name}:`, e?.message || e);
      }
    };

    await addConvCol("reserva_id");
    await addConvCol("trainer_id");
    await addConvCol("client_id");
    await addConvCol("created_at");
    await addConvCol("updated_at");
    await addConvCol("last_message_at");
    await addConvCol("last_message_preview");
    await addConvCol("deleted_by_trainer_at");
    await addConvCol("deleted_by_client_at");

    const msgCols = await query(`PRAGMA table_info(messages)`);
    const msgNames = new Set(msgCols.map((c) => String(c.name || "").toLowerCase()));

    const msgIdCol = msgCols.find((c) => String(c.name || "").toLowerCase() === "id");
    const msgIdType = String(msgIdCol?.type || "").toLowerCase();
    messagesIdIsInteger = !!(msgIdCol && Number(msgIdCol.pk) === 1 && msgIdType.includes("int"));

    const addMsgCol = async (name, typeSql = "TEXT") => {
      if (msgNames.has(name)) return;
      try {
        await query(`ALTER TABLE messages ADD COLUMN "${name}" ${typeSql}`);
        msgNames.add(name);
      } catch (e) {
        console.warn(`[chat] No se pudo añadir messages.${name}:`, e?.message || e);
      }
    };

    await addMsgCol("conversation_id");
    await addMsgCol("sender_id");
    await addMsgCol("body");
    await addMsgCol("attachments");
    await addMsgCol("created_at");
    await addMsgCol("read_at");

    const tryIndex = async (sql, label) => {
      try {
        await query(sql);
      } catch (e) {
        console.warn(`[chat] No se pudo crear índice ${label}:`, e?.message || e);
      }
    };

    if (convNames.has("reserva_id"))
      await tryIndex(
        `CREATE INDEX IF NOT EXISTS idx_conversations_reserva_id ON conversations("reserva_id")`,
        "idx_conversations_reserva_id"
      );
    if (convNames.has("trainer_id"))
      await tryIndex(
        `CREATE INDEX IF NOT EXISTS idx_conversations_trainer ON conversations("trainer_id")`,
        "idx_conversations_trainer"
      );
    if (convNames.has("client_id"))
      await tryIndex(
        `CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations("client_id")`,
        "idx_conversations_client"
      );
    if (msgNames.has("conversation_id"))
      await tryIndex(
        `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages("conversation_id")`,
        "idx_messages_conv"
      );
    if (msgNames.has("created_at"))
      await tryIndex(
        `CREATE INDEX IF NOT EXISTS idx_messages_created ON messages("created_at")`,
        "idx_messages_created"
      );
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
      if (!list.length) continue;

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

        await query(`UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`, [
          canonicalId,
          otherId,
        ]);
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
// RESERVAS SCHEMA DETECTION (robusto)
let reservasColsPromise = null;

async function getReservasColMap() {
  if (reservasColsPromise) return reservasColsPromise;

  reservasColsPromise = (async () => {
    try {
      const cols = await query(`PRAGMA table_info(reservas)`);
      const map = new Map();
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

function buildTrainerExpr(colMap) {
  const trainer1 = pickCol(colMap, ["trainer_id", "trainer_uid"]);
  const trainer2 = pickCol(colMap, ["entrenador_id", "entrenador_uid"]);
  const trainer3 = pickCol(colMap, ["adiestrador_id", "adiestrador_uid"]);

  const t1 = qIdent(trainer1);
  const t2 = qIdent(trainer2);
  const t3 = qIdent(trainer3);

  if (t1 && t2) return `COALESCE(${t1}, ${t2})`;
  if (t1) return `${t1}`;
  if (t2) return `${t2}`;
  if (t3) return `${t3}`;
  return null;
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
// HELPERS
async function relationshipExists(trainerId, clientId) {
  const colMap = await getReservasColMap();
  if (!colMap.size) return false;

  const clientCol = buildClientCol(colMap);
  const trainerExpr = buildTrainerExpr(colMap);
  const statusExpr = buildStatusExpr(colMap);

  if (!clientCol || !trainerExpr) return false;

  const clientQ = qIdent(clientCol);
  if (!clientQ) return false;

  const trainerCols = [];
  for (const cand of [
    "trainer_id",
    "trainer_uid",
    "entrenador_id",
    "entrenador_uid",
    "adiestrador_id",
    "adiestrador_uid",
  ]) {
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
      SELECT ${statusSel}
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
    const st = normStatus(r.status);
    if (!st) return true;
    if (CHAT_ALLOWED_STATUSES.has(st)) return true;
  }
  return false;
}

async function getOrCreateConversationByPair({ trainerId, clientId }) {
  const key = pairKey(trainerId, clientId);

  const existing = await query(`SELECT id FROM conversations WHERE reserva_id = ? LIMIT 1`, [key]);
  if (existing.length) {
    return { conversationId: existing[0].id, exists: true };
  }

  const ts = nowISO();

  // Compat: si la tabla legacy usa id INTEGER PRIMARY KEY, no podemos insertar UUID en `id`.
  if (conversationsIdIsInteger) {
    await query(
      `
        INSERT INTO conversations (
          reserva_id, trainer_id, client_id,
          created_at, updated_at, last_message_at, last_message_preview
        )
        VALUES (?, ?, ?, ?, ?, NULL, NULL)
      `,
      [key, String(trainerId), String(clientId), ts, ts]
    );

    const rr = await query(`SELECT last_insert_rowid() AS id`);
    const newId = String(rr?.[0]?.id || "").trim();
    if (!newId) throw new Error("No se pudo obtener id de conversación (last_insert_rowid vacío)");

    return { conversationId: newId, exists: false };
  }

  const convId = uuidv4();
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

// ---- Files owner column detection (para adjuntos) ----
let filesOwnerColPromise = null;
async function getFilesOwnerCol() {
  if (filesOwnerColPromise) return filesOwnerColPromise;
  filesOwnerColPromise = (async () => {
    try {
      const cols = await query(`PRAGMA table_info(files)`);
      const map = new Map();
      for (const c of cols || []) {
        const name = String(c.name || "").trim();
        if (!name) continue;
        map.set(name.toLowerCase(), name);
      }
      return pickCol(map, ["owner_uid", "owner_id", "user_id", "uid"]);
    } catch {
      return null;
    }
  })();
  return filesOwnerColPromise;
}

async function verifyAttachmentsOwnership({ userId, attachments }) {
  if (!attachments.length) return;

  if (attachments.length > 5) {
    const err = new Error("Demasiados archivos (máx 5 por mensaje)");
    err.status = 400;
    throw err;
  }

  const ownerCol = await getFilesOwnerCol();
  const ownerQ = qIdent(ownerCol);

  for (const a of attachments) {
    if (!ownerQ) {
      const err = new Error("Tabla files sin columna de propietario (owner_uid/owner_id/user_id/uid).");
      err.status = 500;
      throw err;
    }

    const rows = await query(`SELECT id FROM files WHERE id = ? AND ${ownerQ} = ? LIMIT 1`, [
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
// ENDPOINTS
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

      const targetUserId =
        isAdmin && req.query.userId ? String(req.query.userId).trim() : userId;
      if (!targetUserId) return res.status(400).json({ error: "userId requerido" });

      const usersMeta = await getUsersMeta();
      const { joinSql, selectSql } = buildUserJoinOnAlias("c.otherId", usersMeta);

      // Subquery para calcular otherId SIN duplicar placeholders en el JOIN
      const rows = await query(
        `
          SELECT
            c.id AS conversationId,
            c.trainer_id AS trainerId,
            c.client_id AS clientId,
            c.last_message_at AS lastMessageAt,
            c.last_message_preview AS lastMessagePreview,
            c.updated_at AS updatedAt,
            c.otherId AS otherId,
            ${selectSql}
          FROM (
            SELECT
              c.*,
              (CASE WHEN c.trainer_id = ? THEN c.client_id ELSE c.trainer_id END) AS otherId
            FROM conversations c
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
          ) c
          ${joinSql}
          ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
          LIMIT 100
        `,
        [targetUserId, targetUserId, targetUserId]
      );

      return res.json({ items: rows });
    } catch (e) {
      console.error("GET /api/chats error:", e);
      return res.status(500).json({ error: "No se pudieron cargar los chats" });
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
      if (!reservaId) return res.status(400).json({ error: "reservaId requerido" });

      const colMap = await getReservasColMap();
      const idCol = buildReservaIdCol(colMap);
      const clientCol = buildClientCol(colMap);
      const trainerExpr = buildTrainerExpr(colMap);
      const statusExpr = buildStatusExpr(colMap);

      const idQ = qIdent(idCol);
      const clientQ = qIdent(clientCol);

      if (!idQ)
        return res.status(500).json({ error: "Tabla reservas sin columna id (o reserva_id)" });
      if (!trainerExpr)
        return res.status(500).json({
          error:
            "Tabla reservas sin columnas de entrenador (trainer_id / entrenador_id / adiestrador_id)",
        });
      if (!clientQ)
        return res.status(500).json({
          error: "Tabla reservas sin columna de cliente (uid / user_id / cliente_id / client_id)",
        });

      const statusSel = statusExpr ? `${statusExpr} AS status` : `NULL AS status`;

      const rr = await query(
        `
          SELECT
            ${idQ} AS id,
            ${clientQ} AS clientId,
            ${trainerExpr} AS trainerId,
            ${statusSel}
          FROM reservas
          WHERE ${idQ} = ?
          LIMIT 1
        `,
        [reservaId]
      );

      if (!rr.length) return res.status(404).json({ error: "Reserva no encontrada" });

      const r = rr[0];
      const status = normStatus(r.status);
      if (status && !CHAT_ALLOWED_STATUSES.has(status)) {
        return res.status(403).json({
          error: "Chat no disponible para el estado actual de la reserva",
          status,
        });
      }

      const clientId = String(r.clientId || "").trim();
      const trainerId = String(r.trainerId || "").trim();
      if (!clientId || !trainerId) {
        return res.status(400).json({
          error: "Reserva incompleta (faltan participantes)",
          clientId: !!clientId,
          trainerId: !!trainerId,
        });
      }

      const isAdmin = getUserRole(req) === "admin";
      if (!isAdmin && userId !== clientId && userId !== trainerId) {
        return res.status(403).json({ error: "Sin permisos para este chat" });
      }

      const out = await getOrCreateConversationByPair({ trainerId, clientId });
      await restoreConversationForUser({ conversationId: out.conversationId, userId });

      return res.json(out);
    } catch (e) {
      console.error("POST /api/chats/by-reserva/:reservaId error:", e);
      return res.status(500).json({ error: e?.message || "No se pudo abrir el chat" });
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
      return res.status(500).json({ error: e?.message || "No se pudo abrir el chat" });
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
      return res.status(500).json({ error: e?.message || "No se pudo abrir el chat" });
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
      return res.status(st).json({ error: e?.message || "No se pudo borrar el chat" });
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
      if (!conversationId) return res.status(400).json({ error: "conversationId requerido" });

      await ensureCanAccessConversation({ conversationId, userId, role: getUserRole(req) });

      const before = req.query.before ? String(req.query.before) : null;

      const usersMeta = await getUsersMeta();
      const { joinSql, senderSelectSql } = buildSenderJoin(usersMeta);

      const sql = before
        ? `
            SELECT
              m.id,
              m.conversation_id AS conversationId,
              m.sender_id AS senderId,
              m.body,
              m.attachments,
              m.created_at AS createdAt,
              m.read_at AS readAt,
              ${senderSelectSql}
            FROM messages m
            ${joinSql}
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
              ${senderSelectSql}
            FROM messages m
            ${joinSql}
            WHERE m.conversation_id = ?
            ORDER BY m.created_at DESC
            LIMIT 30
          `;

      const rows = await query(sql, before ? [conversationId, before] : [conversationId]);

      const items = [...rows].reverse().map((m) => ({
        ...m,
        attachments: m.attachments ? safeJsonParse(m.attachments, []) : [],
      }));

      return res.json({
        items,
        nextBefore: rows.length ? rows[rows.length - 1].createdAt : null,
      });
    } catch (e) {
      const st = e?.status || 500;
      console.error("GET /api/chats/:conversationId/messages error:", e);
      return res.status(st).json({ error: e?.message || "No se pudieron cargar mensajes" });
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

      if (!conversationId) return res.status(400).json({ error: "conversationId requerido" });
      if (!bodyTrim && attachments.length === 0)
        return res.status(400).json({ error: "Mensaje vacío" });

      await ensureCanAccessConversation({ conversationId, userId, role: getUserRole(req) });
      await verifyAttachmentsOwnership({ userId, attachments });

      const ts = nowISO();
      const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;

      let msgId = null;

      // Compat: messages legacy con id INTEGER PRIMARY KEY
      if (messagesIdIsInteger) {
        await query(
          `
            INSERT INTO messages (
              conversation_id, sender_id, body, attachments, created_at, read_at
            )
            VALUES (?, ?, ?, ?, ?, NULL)
          `,
          [conversationId, userId, bodyTrim, attachmentsJson, ts]
        );

        const rr = await query(`SELECT last_insert_rowid() AS id`);
        msgId = String(rr?.[0]?.id || "").trim();
        if (!msgId) throw new Error("No se pudo obtener id de mensaje (last_insert_rowid vacío)");
      } else {
        msgId = uuidv4();
        await query(
          `
            INSERT INTO messages (
              id, conversation_id, sender_id, body, attachments, created_at, read_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL)
          `,
          [msgId, conversationId, userId, bodyTrim, attachmentsJson, ts]
        );
      }

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

      // Email al cliente (throttle 1/día) cuando escribe el adiestrador
      void notifyChatMessage({
        conversationId,
        senderId: userId,
        preview,
      });

      return res.json({ ok: true, messageId: msgId, createdAt: ts });
    } catch (e) {
      const st = e?.status || 500;
      console.error("POST /api/chats/:conversationId/messages error:", e);
      return res.status(st).json({ error: e?.message || "No se pudo enviar el mensaje" });
    }
  }
);

export default router;
