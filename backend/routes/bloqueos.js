import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { isFutureOrTodayNotPassed } from "../utils/openingHours.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";
import { notifyReservationRejected } from "../services/notifications.js";

const router = express.Router();

const nowISO = () => new Date().toISOString();

let _bloqueosColsPromise = null;
async function getBloqueosCols() {
  if (!_bloqueosColsPromise) {
    _bloqueosColsPromise = query("PRAGMA table_info(bloqueos)")
      .then((rows) => (Array.isArray(rows) ? rows.map((r) => r.name) : []))
      .catch(() => []);
  }
  return _bloqueosColsPromise;
}

async function ensureBloqueosSchema() {
  // Migración "suave": añadimos columnas si faltan. Si ya existen, no pasa nada.
  try {
    await query(`CREATE TABLE IF NOT EXISTS bloqueos (
      id TEXT PRIMARY KEY,
      fecha TEXT NOT NULL,
      hora TEXT DEFAULT '',
      trainer_id TEXT,
      is_all_day INTEGER DEFAULT 0,
      created_at TEXT
    )`);

    const cols = await getBloqueosCols();
    const stmts = [];
    if (!cols.includes("id")) stmts.push("ALTER TABLE bloqueos ADD COLUMN id TEXT");
    if (!cols.includes("trainer_id")) stmts.push("ALTER TABLE bloqueos ADD COLUMN trainer_id TEXT");
    if (!cols.includes("created_at")) stmts.push("ALTER TABLE bloqueos ADD COLUMN created_at TEXT");
    // En el proyecto ya se usa "is_all_day" en otros endpoints; mantenemos compatibilidad.
    if (!cols.includes("is_all_day")) stmts.push("ALTER TABLE bloqueos ADD COLUMN is_all_day INTEGER DEFAULT 0");
    // Algunos patches antiguos añadían "all_day". Si existe, lo seguimos soportando.
    if (!cols.includes("all_day")) stmts.push("ALTER TABLE bloqueos ADD COLUMN all_day INTEGER DEFAULT 0");
    for (const sql of stmts) {
      try {
        await query(sql);
      } catch (_) {}
    }
    if (stmts.length) _bloqueosColsPromise = null;
  } catch (_) {}
}

function isAdminReq(req) {
  const r = String(req.user?.role || req.user?.rol || "").toLowerCase();
  return Boolean(req.user?.isAdmin) || r === "admin";
}

function pickTrainerId(req) {
  const id = req.user?.uid || req.user?.id || "";
  return String(id || "");
}

function isAllDayBody(body) {
  return Boolean(
    body?.allDay ??
      body?.all_day ??
      body?.isAllDay ??
      body?.diaCompleto ??
      body?.fullDay ??
      body?.full_day ??
      body?.is_all_day
  );
}

function normFecha(f) {
  const raw = String(f || "").trim();
  if (!raw) return "";
  // acepta "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // acepta "DD/MM/YYYY"
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return raw.slice(0, 10);
}

function normHora(h) {
  const s = String(h || "").trim();
  if (!s) return "";
  // admite "HH:MM" o "HH:MM:SS"
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  // admite "9:00" -> "09:00"
  if (/^\d{1}:\d{2}$/.test(s)) return `0${s}`;
  return s.slice(0, 5);
}

/* ===================== Auto-rechazo de reservas por bloqueo (admin) ===================== */

let _reservasColsPromise = null;
async function getReservasCols() {
  if (_reservasColsPromise) return _reservasColsPromise;
  _reservasColsPromise = query("PRAGMA table_info(reservas)")
    .then((rows) => (Array.isArray(rows) ? rows.map((r) => r.name) : []))
    .catch(() => []);
  return _reservasColsPromise;
}

function pickFirstExisting(cols, candidates) {
  const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
  for (const c of candidates) {
    if (set.has(String(c).toLowerCase())) return c;
  }
  return null;
}

function parseJSONSafe(value, fallback) {
  try {
    if (value == null || value === "") return fallback;
    const v = typeof value === "string" ? JSON.parse(value) : value;
    return v && typeof v === "object" ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

async function autoRejectConflictingReservations({
  fecha,
  hora,
  allDay,
  scope,
  trainerId,
  note = "Auto-rechazada por bloqueo",
} = {}) {
  try {
    const cols = await getReservasCols();
    const statusCol = pickFirstExisting(cols, ["status"]);
    const fechaCol = pickFirstExisting(cols, ["fecha", "date"]);
    const horaCol = pickFirstExisting(cols, ["hora", "time"]);
    const trainerCol = pickFirstExisting(cols, ["trainer_id", "entrenador_id", "trainerId", "trainer_id"]);
    const paqueteCol = pickFirstExisting(cols, ["paquete_id", "paqueteId", "package_id"]);

    if (!statusCol || !fechaCol) return { count: 0, ids: [] };

    let sql = `SELECT id,
      ${paqueteCol ? `${paqueteCol} AS paqueteId,` : "NULL AS paqueteId,"}
      ${statusCol} AS status
      ${trainerCol ? `, ${trainerCol} AS trainerId` : "" }
      FROM reservas
      WHERE ${fechaCol} = ?
        AND ${statusCol} IN ('pending','pending_user','confirmed')`;

    const params = [fecha];

    if (!allDay && horaCol) {
      sql += ` AND ${horaCol} = ?`;
      params.push(hora);
    }

    // Scope: global (todos) o por trainer
    if (String(scope || "").toLowerCase() !== "global" && trainerCol) {
      sql += ` AND ${trainerCol} = ?`;
      params.push(String(trainerId || ""));
    }

    const rows = await query(sql, params);
    const ids = (rows || []).map((r) => String(r.id)).filter(Boolean);
    if (!ids.length) return { count: 0, ids: [] };

    for (const r of rows) {
      const reservaId = String(r.id || "");
      if (!reservaId) continue;

      // 1) Marcar reserva como rechazada
      try {
        await query(
          `UPDATE reservas
             SET status='rejected',
                 admin_note=?,
                 updated_at=?
           WHERE id=?`,
          [note, nowISO(), reservaId]
        );
      } catch (e) {
        console.error("autoReject: update reserva", reservaId, e);
        continue;
      }

      // 2) Ajuste de saldo en paquetes (best-effort)
      const paqueteId = r.paqueteId != null ? String(r.paqueteId) : "";
      if (paqueteId) {
        try {
          const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [paqueteId]);
          if (pRows?.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
            saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
            await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
              JSON.stringify(saldo),
              nowISO(),
              paqueteId,
            ]);
          }
        } catch (e) {
          console.error("autoReject: update paquete", paqueteId, e);
        }
      }

      // 3) Email best-effort
      try {
        void notifyReservationRejected(reservaId, { note });
      } catch (_) {}
    }

    return { count: ids.length, ids };
  } catch (e) {
    console.error("autoRejectConflictingReservations", e);
    return { count: 0, ids: [] };
  }
}

function normalizeBlockRow(row) {
  if (!row) return row;
  const r = { ...row };
  if (r.is_all_day != null) r.is_all_day = Number(r.is_all_day) ? 1 : 0;
  if (r.all_day != null) r.all_day = Number(r.all_day) ? 1 : 0;
  // Conveniencia para frontend
  if (r.allDay == null) r.allDay = Boolean(Number(r.is_all_day ?? r.all_day ?? 0));
  if (r.hora == null) r.hora = "";
  return r;
}

function buildSelectCols(cols) {
  const hasId = cols.includes("id");
  const hasTrainer = cols.includes("trainer_id");
  const hasCreatedAt = cols.includes("created_at");
  const hasIsAllDay = cols.includes("is_all_day");
  const hasAllDay = cols.includes("all_day");
  const allDayCol = hasIsAllDay ? "is_all_day" : hasAllDay ? "all_day" : null;

  const selectCols = [];
  if (hasId) selectCols.push("id");
  selectCols.push("fecha", "hora");
  if (hasTrainer) selectCols.push("trainer_id");
  if (allDayCol) {
    // Normalizamos a "is_all_day" hacia el frontend
    if (allDayCol === "is_all_day") selectCols.push("is_all_day");
    else selectCols.push("all_day AS is_all_day");
  }
  if (hasCreatedAt) selectCols.push("created_at");

  return { selectCols, hasId, hasTrainer, hasCreatedAt, allDayCol };
}

/**
 * GET /api/bloqueos/day?fecha=YYYY-MM-DD
 * Adiestrador: devuelve bloqueos SOLO de su agenda.
 * Admin: devuelve sus propios bloqueos (no se usa en el panel admin; usar /admin/*).
 */
router.get(
  "/day",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      await ensureBloqueosSchema();
      const fecha = normFecha(req.query?.fecha ?? req.query?.date ?? req.query?.dia);
      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });

      const cols = await getBloqueosCols();
      const { selectCols, hasTrainer, allDayCol } = buildSelectCols(cols);

      const params = [fecha];
      let sql = `SELECT ${selectCols.join(", ")} FROM bloqueos WHERE fecha = ?`;

      if (hasTrainer) {
        const trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
        sql += " AND trainer_id = ?";
        params.push(trainerId);
      }

      const orderAllDay = allDayCol
        ? `CASE WHEN ${allDayCol} = 1 THEN 0 ELSE 1 END`
        : "CASE WHEN hora IS NULL OR hora = '' THEN 0 ELSE 1 END";

      sql += ` ORDER BY ${orderAllDay} ASC, hora ASC`;

      const rows = await query(sql, params);
      const normalized = (rows || []).map(normalizeBlockRow);
      const filtered = normalized.filter((b) =>
        isFutureOrTodayNotPassed({ fecha: b.fecha, hora: b.hora, allDay: b.allDay })
      );
      res.json(filtered);
    } catch (e) {
      console.error("GET /bloqueos/day", e);
      res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
    }
  }
);

/**
 * GET /api/bloqueos/admin/list
 * Devuelve TODOS los bloqueos (globales + por adiestrador), ordenados por fecha (cercano -> lejano).
 */
router.get(
  "/admin/list",
  verifyToken,
  allowRoles(["admin"]),
  async (req, res) => {
    try {
      await ensureBloqueosSchema();
      const cols = await getBloqueosCols();
      const { selectCols, allDayCol } = buildSelectCols(cols);

      const orderAllDay = allDayCol
        ? `CASE WHEN ${allDayCol} = 1 THEN 0 ELSE 1 END`
        : "CASE WHEN hora IS NULL OR hora = '' THEN 0 ELSE 1 END";

      const rows = await query(
        `SELECT ${selectCols.join(", ")} FROM bloqueos
         ORDER BY fecha ASC, ${orderAllDay} ASC, hora ASC`
      );
      const normalized = (rows || []).map(normalizeBlockRow);
      const filtered = normalized.filter((b) =>
        isFutureOrTodayNotPassed({ fecha: b.fecha, hora: b.hora, allDay: b.allDay })
      );
      res.json(filtered);
    } catch (e) {
      console.error("GET /bloqueos/admin/list", e);
      res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
    }
  }
);

/**
 * GET /api/bloqueos/admin/day?fecha=YYYY-MM-DD[&trainerId=...]
 * Devuelve bloqueos del día (globales + por adiestrador). Optional: trainerId para filtrar.
 */
router.get(
  "/admin/day",
  verifyToken,
  allowRoles(["admin"]),
  async (req, res) => {
    try {
      await ensureBloqueosSchema();
      const fecha = normFecha(req.query?.fecha ?? req.query?.date ?? req.query?.dia);
      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });

      const cols = await getBloqueosCols();
      const { selectCols, hasTrainer, allDayCol } = buildSelectCols(cols);

      const params = [fecha];
      let sql = `SELECT ${selectCols.join(", ")} FROM bloqueos WHERE fecha = ?`;

      if (hasTrainer) {
        const tid = String(req.query?.trainerId ?? req.query?.trainer_id ?? "").trim();
        if (tid) {
          sql += " AND trainer_id = ?";
          params.push(tid);
        }
      }

      const orderAllDay = allDayCol
        ? `CASE WHEN ${allDayCol} = 1 THEN 0 ELSE 1 END`
        : "CASE WHEN hora IS NULL OR hora = '' THEN 0 ELSE 1 END";

      sql += ` ORDER BY ${orderAllDay} ASC, hora ASC`;

      const rows = await query(sql, params);
      const normalized = (rows || []).map(normalizeBlockRow);
      const filtered = normalized.filter((b) =>
        isFutureOrTodayNotPassed({ fecha: b.fecha, hora: b.hora, allDay: b.allDay })
      );
      res.json(filtered);
    } catch (e) {
      console.error("GET /bloqueos/admin/day", e);
      res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
    }
  }
);

async function createBloqueo(req, res) {
  try {
    await ensureBloqueosSchema();

    const fecha = normFecha(req.body?.fecha ?? req.body?.date ?? req.body?.dia);
    const allDay = isAllDayBody(req.body);
    const hora = allDay ? "" : normHora(req.body?.hora ?? req.body?.time);
    // Solo aplica para admin: "global" o "trainer" (cualquier valor != global se interpreta como por adiestrador)
    const scope = String(req.body?.scope || "global").toLowerCase();

    if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
    if (!allDay && !hora) return res.status(400).json({ error: "Falta hora (HH:MM)" });

    const cols = await getBloqueosCols();
    const { hasTrainer, hasId, hasCreatedAt, allDayCol } = buildSelectCols(cols);

    // Trainer ID (solo si la tabla lo soporta)
    let trainerId = null;
    if (hasTrainer) {
      if (isAdminReq(req)) {
        const tid = String(req.body?.trainerId ?? req.body?.trainer_id ?? "").trim();
        trainerId = scope === "global" || !tid ? null : tid;
      } else {
        // adiestrador: siempre su agenda
        trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
      }
    }

    // evitar duplicados
    const dupParams = [fecha, hora];
    let dupSql = "SELECT 1 FROM bloqueos WHERE fecha = ? AND hora = ?";
    if (hasTrainer) {
      if (trainerId == null) {
        dupSql += " AND trainer_id IS NULL";
      } else {
        dupSql += " AND trainer_id = ?";
        dupParams.push(String(trainerId));
      }
    }
    if (allDayCol) {
      // si es día completo, lo consideramos duplicado si hay otro día completo para ese scope
      dupSql += ` AND ${allDayCol} = ?`;
      dupParams.push(allDay ? 1 : 0);
    }
    const dup = await query(dupSql, dupParams);
    if (dup?.length) return res.status(409).json({ error: "Ya está bloqueada" });

    const insertCols = [];
    const values = [];
    const params = [];

    if (hasId) {
      insertCols.push("id");
      values.push("?");
      params.push(uuidv4());
    }

    insertCols.push("fecha");
    values.push("?");
    params.push(fecha);

    insertCols.push("hora");
    values.push("?");
    // IMPORTANTE: para día completo guardamos "" (no NULL) para esquemas legacy con NOT NULL
    params.push(allDay ? "" : hora);

    if (allDayCol) {
      insertCols.push(allDayCol);
      values.push("?");
      params.push(allDay ? 1 : 0);
    }

    if (hasTrainer) {
      insertCols.push("trainer_id");
      values.push("?");
      params.push(trainerId == null ? null : String(trainerId));
    }

    if (hasCreatedAt) {
      insertCols.push("created_at");
      values.push("?");
      params.push(nowISO());
    }

    await query(
      `INSERT INTO bloqueos (${insertCols.join(", ")}) VALUES (${values.join(", ")})`,
      params
    );

    // Si el admin crea un bloqueo, y ya existían reservas para ese día/hora (o día completo),
    // las rechazamos automáticamente (incluye confirmadas).
    let autoRejected = { count: 0, ids: [] };
    if (isAdminReq(req)) {
      const scopeNorm = scope || "global";
      autoRejected = await autoRejectConflictingReservations({
        fecha,
        hora,
        allDay,
        scope: scopeNorm,
        trainerId: scopeNorm === "global" ? null : trainerId,
        note: allDay
          ? "Auto-rechazada por bloqueo (día completo)"
          : "Auto-rechazada por bloqueo (hora)",
      });
    }

    res.status(201).json({ ok: true, autoRejected: autoRejected.count });
  } catch (e) {
    console.error("POST /bloqueos", e);
    res.status(500).json({ error: "No se pudo crear el bloqueo" });
  }
}

/**
 * POST /api/bloqueos
 * Adiestrador: crea bloqueo en su agenda.
 * Admin: crea bloqueo global o por adiestrador (trainerId, scope) y por hora o día completo (allDay).
 */
router.post(
  "/",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => createBloqueo(req, res)
);

/**
 * POST /api/bloqueos/admin
 * Alias admin.
 */
router.post(
  "/admin",
  verifyToken,
  allowRoles(["admin"]),
  async (req, res) => createBloqueo(req, res)
);

/**
 * DELETE /api/bloqueos (por fecha/hora)
 * Body: { fecha, hora } o { fecha, allDay:true }
 * - Adiestrador: borra solo en su agenda.
 * - Admin: borra global (por defecto) o por trainerId (si se especifica).
 */
router.delete(
  "/",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      await ensureBloqueosSchema();

      const fecha = normFecha(
        req.body?.fecha ?? req.body?.date ?? req.query?.fecha ?? req.query?.date
      );
      const allDay = isAllDayBody(req.body) || String(req.query?.allDay || "").toLowerCase() === "true";
      const hora = allDay
        ? ""
        : normHora(req.body?.hora ?? req.body?.time ?? req.query?.hora ?? req.query?.time);

      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
      if (!allDay && !hora) return res.status(400).json({ error: "Falta hora (HH:MM)" });

      const cols = await getBloqueosCols();
      const { hasTrainer, allDayCol } = buildSelectCols(cols);

      const delHora = allDay ? "" : hora;
      const params = [fecha, delHora];
      let sql = "DELETE FROM bloqueos WHERE fecha = ? AND hora = ?";

      if (allDayCol) {
        sql += ` AND ${allDayCol} = ?`;
        params.push(allDay ? 1 : 0);
      } else if (allDay) {
        // sin columna de día completo, lo tratamos como "hora vacía"
      }

      if (hasTrainer) {
        if (isAdminReq(req)) {
          const scope = String(req.body?.scope ?? req.query?.scope ?? "").toLowerCase();
          const tidRaw = req.body?.trainerId ?? req.body?.trainer_id ?? req.query?.trainerId ?? req.query?.trainer_id ?? "";
          const tid = String(tidRaw || "").trim();
          if (!tid || scope === "global") {
            sql += " AND trainer_id IS NULL";
          } else {
            sql += " AND trainer_id = ?";
            params.push(tid);
          }
        } else {
          const trainerId = pickTrainerId(req);
          if (!trainerId) return res.status(401).json({ error: "No autorizado" });
          sql += " AND trainer_id = ?";
          params.push(trainerId);
        }
      }

      await query(sql, params);
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /bloqueos", e);
      res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
    }
  }
);

/**
 * DELETE /api/bloqueos/:id
 * Admin: borra cualquiera.
 * Adiestrador: borra solo si pertenece a su agenda (si hay trainer_id).
 */
router.delete(
  "/:id",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      await ensureBloqueosSchema();
      const id = String(req.params?.id || "").trim();
      if (!id) return res.status(400).json({ error: "Falta id" });

      const cols = await getBloqueosCols();
      const hasId = cols.includes("id");
      const hasTrainer = cols.includes("trainer_id");
      if (!hasId) return res.status(400).json({ error: "ID no soportado" });

      const params = [id];
      let sql = "DELETE FROM bloqueos WHERE id = ?";

      if (hasTrainer && !isAdminReq(req)) {
        const trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
        sql += " AND trainer_id = ?";
        params.push(trainerId);
      }

      await query(sql, params);
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /bloqueos/:id", e);
      res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
    }
  }
);

/**
 * DELETE /api/bloqueos/admin/:id
 * Alias admin (para compatibilidad con frontend).
 */
router.delete(
  "/admin/:id",
  verifyToken,
  allowRoles(["admin"]),
  async (req, res) => {
    try {
      await ensureBloqueosSchema();
      const id = String(req.params?.id || "").trim();
      if (!id) return res.status(400).json({ error: "Falta id" });

      const cols = await getBloqueosCols();
      const hasId = cols.includes("id");
      if (!hasId) return res.status(400).json({ error: "ID no soportado" });

      await query("DELETE FROM bloqueos WHERE id = ?", [id]);
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /bloqueos/admin/:id", e);
      res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
    }
  }
);

export default router;
