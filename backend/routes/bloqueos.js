import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

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
    const cols = await getBloqueosCols();
    const stmts = [];
    if (!cols.includes("id")) stmts.push("ALTER TABLE bloqueos ADD COLUMN id TEXT");
    if (!cols.includes("trainer_id")) stmts.push("ALTER TABLE bloqueos ADD COLUMN trainer_id TEXT");
    if (!cols.includes("created_at")) stmts.push("ALTER TABLE bloqueos ADD COLUMN created_at TEXT");
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

function normalizeBlockRow(row) {
  if (!row) return row;
  const r = { ...row };
  if (r.all_day != null) r.all_day = Number(r.all_day) ? 1 : 0;
  if (r.hora == null) r.hora = "";
  return r;
}

function buildSelectCols(cols) {
  const hasId = cols.includes("id");
  const hasTrainer = cols.includes("trainer_id");
  const hasCreatedAt = cols.includes("created_at");
  const hasAllDay = cols.includes("all_day");

  const selectCols = [];
  if (hasId) selectCols.push("id");
  selectCols.push("fecha", "hora");
  if (hasTrainer) selectCols.push("trainer_id");
  if (hasAllDay) selectCols.push("all_day");
  if (hasCreatedAt) selectCols.push("created_at");

  return { selectCols, hasId, hasTrainer, hasCreatedAt, hasAllDay };
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
      const { selectCols, hasTrainer, hasAllDay } = buildSelectCols(cols);

      const params = [fecha];
      let sql = `SELECT ${selectCols.join(", ")} FROM bloqueos WHERE fecha = ?`;

      if (hasTrainer) {
        const trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
        sql += " AND trainer_id = ?";
        params.push(trainerId);
      }

      const orderAllDay = hasAllDay
        ? "CASE WHEN all_day = 1 THEN 0 ELSE 1 END"
        : "CASE WHEN hora IS NULL OR hora = '' THEN 0 ELSE 1 END";

      sql += ` ORDER BY ${orderAllDay} ASC, hora ASC`;

      const rows = await query(sql, params);
      res.json((rows || []).map(normalizeBlockRow));
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
      const { selectCols, hasAllDay } = buildSelectCols(cols);

      const orderAllDay = hasAllDay
        ? "CASE WHEN all_day = 1 THEN 0 ELSE 1 END"
        : "CASE WHEN hora IS NULL OR hora = '' THEN 0 ELSE 1 END";

      const rows = await query(
        `SELECT ${selectCols.join(", ")} FROM bloqueos
         ORDER BY fecha ASC, ${orderAllDay} ASC, hora ASC`
      );
      res.json((rows || []).map(normalizeBlockRow));
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
      const { selectCols, hasTrainer, hasAllDay } = buildSelectCols(cols);

      const params = [fecha];
      let sql = `SELECT ${selectCols.join(", ")} FROM bloqueos WHERE fecha = ?`;

      if (hasTrainer) {
        const tid = String(req.query?.trainerId ?? req.query?.trainer_id ?? "").trim();
        if (tid) {
          sql += " AND trainer_id = ?";
          params.push(tid);
        }
      }

      const orderAllDay = hasAllDay
        ? "CASE WHEN all_day = 1 THEN 0 ELSE 1 END"
        : "CASE WHEN hora IS NULL OR hora = '' THEN 0 ELSE 1 END";

      sql += ` ORDER BY ${orderAllDay} ASC, hora ASC`;

      const rows = await query(sql, params);
      res.json((rows || []).map(normalizeBlockRow));
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

    if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
    if (!allDay && !hora) return res.status(400).json({ error: "Falta hora (HH:MM)" });

    const cols = await getBloqueosCols();
    const { hasTrainer, hasId, hasCreatedAt, hasAllDay } = buildSelectCols(cols);

    // Trainer ID (solo si la tabla lo soporta)
    let trainerId = null;
    if (hasTrainer) {
      if (isAdminReq(req)) {
        const scope = String(req.body?.scope || "").toLowerCase();
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
    if (hasAllDay) {
      // si es día completo, lo consideramos duplicado si hay otro día completo para ese scope
      dupSql += " AND all_day = ?";
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

    if (hasAllDay) {
      insertCols.push("all_day");
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

    res.status(201).json({ ok: true });
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
      const hasTrainer = cols.includes("trainer_id");
      const hasAllDay = cols.includes("all_day");

      const delHora = allDay ? "" : hora;
      const params = [fecha, delHora];
      let sql = "DELETE FROM bloqueos WHERE fecha = ? AND hora = ?";

      if (hasAllDay) {
        sql += " AND all_day = ?";
        params.push(allDay ? 1 : 0);
      } else if (allDay) {
        // sin columna all_day, lo tratamos como "hora vacía"
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
