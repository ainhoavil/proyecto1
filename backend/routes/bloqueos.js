import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const nowISO = () => new Date().toISOString();

/* ==========================================================
   🛠️ Esquema bloqueos (migraciones suaves)

   Objetivo:
   - Unificar bloqueos de adiestrador y admin en una sola tabla.
   - Soportar:
     - trainer_id NULL => global
     - is_all_day = 1 (hora puede ser NULL)

   Nota: CREATE TABLE IF NOT EXISTS no altera tablas existentes.
========================================================== */

let _ensureBloqueosPromise = null;

async function ensureBloqueosTable() {
  // Evitar carreras si este módulo se importa varias veces
  if (_ensureBloqueosPromise) return _ensureBloqueosPromise;

  _ensureBloqueosPromise = (async () => {
    // Tabla base (si no existía)
    await query(`
      CREATE TABLE IF NOT EXISTS bloqueos (
        id TEXT PRIMARY KEY,
        fecha TEXT NOT NULL,
        hora TEXT,
        trainer_id TEXT,
        is_all_day INTEGER DEFAULT 0,
        created_by_role TEXT,
        created_at TEXT
      )
    `);

    const info = await query(`PRAGMA table_info(bloqueos)`);
    const cols = new Set((Array.isArray(info) ? info : []).map((r) => String(r?.name || "")));

    const ensureCol = async (name, defSql) => {
      if (cols.has(name)) return;
      await query(`ALTER TABLE bloqueos ADD COLUMN ${defSql}`);
      cols.add(name);
    };

    // Migraciones suaves para instalaciones antiguas
    await ensureCol("trainer_id", "trainer_id TEXT");
    await ensureCol("is_all_day", "is_all_day INTEGER DEFAULT 0");
    await ensureCol("created_by_role", "created_by_role TEXT");
    await ensureCol("created_at", "created_at TEXT");

    // Índices útiles (idempotentes)
    await query(`CREATE INDEX IF NOT EXISTS idx_bloqueos_fecha ON bloqueos(fecha)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_bloqueos_trainer_fecha ON bloqueos(trainer_id, fecha)`);
  })();

  return _ensureBloqueosPromise;
}

await ensureBloqueosTable();

let _bloqueosColsPromise = null;
async function getBloqueosCols() {
  if (!_bloqueosColsPromise) {
    _bloqueosColsPromise = query("PRAGMA table_info(bloqueos)")
      .then((rows) => (Array.isArray(rows) ? rows.map((r) => r.name) : []))
      .catch(() => []);
  }
  return _bloqueosColsPromise;
}

function pickTrainerId(req) {
  const id = req.user?.uid || req.user?.id || "";
  return String(id || "");
}

function normHora(h) {
  const s = String(h || "").trim();
  // admite "HH:MM" o "HH:MM:SS"
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  // admite "9:00" -> "09:00"
  if (/^\d{1}:\d{2}$/.test(s)) return `0${s}`;
  return s;
}

function normFecha(f) {
  const raw = String(f || "").trim();
  if (!raw) return "";

  // acepta YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  // acepta DD/MM/YYYY -> YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  // acepta YYYY/MM/DD -> YYYY-MM-DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) {
    return raw.replaceAll("/", "-");
  }

  return raw.slice(0, 10);
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "si" || s === "sí";
}

function normalizeBlockPayload(body = {}) {
  const fecha = normFecha(body?.fecha ?? body?.date ?? body?.dia);
  const trainerId = String(
    body?.trainerId ?? body?.trainer_id ?? body?.trainer ?? body?.trainerUid ?? ""
  ).trim();
  const scope = String(body?.scope ?? "").trim().toLowerCase();

  // all-day si:
  // - body.allDay / isAllDay / diaCompleto / fullDay / is_all_day
  // - o no viene hora
  const horaRaw = body?.hora ?? body?.time ?? body?.hour ?? null;
  const hora = horaRaw == null ? "" : normHora(horaRaw);
  const isAllDay =
    toBool(
      body?.allDay ??
        body?.isAllDay ??
        body?.diaCompleto ??
        body?.fullDay ??
        body?.full_day ??
        body?.is_all_day
    ) ||
    !hora;

  const isGlobal = scope === "global" || (!trainerId && scope !== "trainer");

  return {
    fecha,
    hora: isAllDay ? "" : hora,
    trainerId: isGlobal ? "" : trainerId,
    isAllDay,
    isGlobal,
  };
}

/**
 * GET /api/bloqueos/day?fecha=YYYY-MM-DD
 * Devuelve bloqueos del día (por trainer si existe trainer_id en tabla; si no, global).
 */
router.get(
  "/day",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      // Compat: algunos clientes envían date/dia/f en vez de fecha
      const fecha = normFecha(
        req.query?.fecha ?? req.query?.date ?? req.query?.dia ?? req.query?.f
      );
      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });

      const cols = await getBloqueosCols();
      const hasTrainer = cols.includes("trainer_id");
      const hasId = cols.includes("id");
      const hasAllDay = cols.includes("is_all_day");
      const hasCreatedAt = cols.includes("created_at");
      const hasCreatedByRole = cols.includes("created_by_role");

      const selectCols = [];
      if (hasId) selectCols.push("id");
      selectCols.push("fecha", "hora");
      if (hasTrainer) selectCols.push("trainer_id");
      if (hasAllDay) selectCols.push("is_all_day");
      if (hasCreatedByRole) selectCols.push("created_by_role");
      if (hasCreatedAt) selectCols.push("created_at");

      const params = [fecha];
      let sql = `SELECT ${selectCols.join(", ")} FROM bloqueos WHERE fecha = ?`;

      // Semántica:
      // - Adiestrador: ve sus bloqueos + globales (trainer_id IS NULL)
      // - Admin: por compat, si pide trainerId en query, filtra a (global + trainer). Si no, devuelve globales.
      if (hasTrainer) {
        const isAdmin = req.user?.isAdmin || String(req.user?.rol || "") === "admin";
        const qTrainer = String(req.query?.trainerId ?? req.query?.trainer_id ?? "").trim();
        if (isAdmin) {
          if (qTrainer) {
            sql += " AND (trainer_id IS NULL OR trainer_id = ?)";
            params.push(qTrainer);
          } else {
            sql += " AND trainer_id IS NULL";
          }
        } else {
          const trainerId = pickTrainerId(req);
          if (!trainerId) return res.status(401).json({ error: "No autorizado" });
          sql += " AND (trainer_id IS NULL OR trainer_id = ?)";
          params.push(trainerId);
        }
      }

      // Orden: día completo primero, luego por hora
      if (hasAllDay) sql += " ORDER BY is_all_day DESC, hora ASC";
      else sql += " ORDER BY hora ASC";

      const rows = await query(sql, params);
      res.json(rows || []);
    } catch (e) {
      console.error("GET /bloqueos/day", e);
      res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
    }
  }
);

/**
 * POST /api/bloqueos
 * Body: { fecha, hora }
 * Inserta bloqueo (por trainer si existe trainer_id; si no, global).
 */
router.post(
  "/",
  verifyToken,
  allowRoles(["adiestrador"]),
  async (req, res) => {
    try {
      const fecha = normFecha(req.body?.fecha ?? req.body?.date ?? req.body?.dia);
      const hora = normHora(req.body?.hora ?? req.body?.time);
      if (!fecha || !hora) return res.status(400).json({ error: "Faltan fecha/hora" });

      const cols = await getBloqueosCols();
      const hasTrainer = cols.includes("trainer_id");
      const hasId = cols.includes("id");
      const hasCreatedAt = cols.includes("created_at");

      const trainerId = hasTrainer ? pickTrainerId(req) : null;
      if (hasTrainer && !trainerId) return res.status(401).json({ error: "No autorizado" });

      // evitar duplicados
      const dupParams = [fecha, hora];
      let dupSql = "SELECT 1 FROM bloqueos WHERE fecha = ? AND hora = ?";
      if (hasTrainer) {
        dupSql += " AND trainer_id = ?";
        dupParams.push(String(trainerId));
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
      params.push(hora);

      if (hasTrainer) {
        insertCols.push("trainer_id");
        values.push("?");
        params.push(String(trainerId));
      }

      if (cols.includes("created_by_role")) {
        insertCols.push("created_by_role");
        values.push("?");
        params.push("adiestrador");
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
      res.status(500).json({ error: "No se pudo bloquear" });
    }
  }
);

/**
 * DELETE /api/bloqueos
 * Body: { fecha, hora }
 * (fallback) Query: ?fecha=YYYY-MM-DD&hora=HH:MM
 * Borra bloqueo (por trainer si existe trainer_id; si no, global).
 */
router.delete(
  "/",
  verifyToken,
  allowRoles(["adiestrador"]),
  async (req, res) => {
    try {
      // ✅ Compat:
      // - Algunos clientes NO envían body en DELETE (usan querystring)
      // - Otros envían body JSON (lo normal en este proyecto)
      // - Algunos usan claves alternativas (date/time)
      const fecha = normFecha(
        req.body?.fecha ?? req.body?.date ?? req.query?.fecha ?? req.query?.date
      );
      const hora = normHora(
        req.body?.hora ?? req.body?.time ?? req.query?.hora ?? req.query?.time
      );

      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
      if (!hora) return res.status(400).json({ error: "Falta hora (HH:MM)" });

      const cols = await getBloqueosCols();
      const hasTrainer = cols.includes("trainer_id");

      const params = [fecha, hora];
      let sql = "DELETE FROM bloqueos WHERE fecha = ? AND hora = ?";

      if (hasTrainer) {
        const trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
        sql += " AND trainer_id = ?";
        params.push(String(trainerId));
      }

      // Para evitar "ok" silencioso, comprobamos existencia
      const exists = await query(
        hasTrainer
          ? "SELECT 1 FROM bloqueos WHERE fecha = ? AND hora = ? AND trainer_id = ? LIMIT 1"
          : "SELECT 1 FROM bloqueos WHERE fecha = ? AND hora = ? LIMIT 1",
        params
      );
      if (!exists?.length) return res.status(404).json({ error: "Bloqueo no encontrado" });

      await query(sql, params);
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /bloqueos", e);
      res.status(500).json({ error: "No se pudo desbloquear" });
    }
  }
);

/* ===================== Admin (gestión completa) ===================== */

// GET /api/bloqueos/admin  -> lista TODOS los bloqueos, ordenados por fecha (cercano->lejano)
router.get("/admin", verifyToken, requireAdmin, async (_req, res) => {
  try {
    const cols = await getBloqueosCols();
    const select = ["id", "fecha", "hora"];
    if (cols.includes("trainer_id")) select.push("trainer_id");
    if (cols.includes("is_all_day")) select.push("is_all_day");
    if (cols.includes("created_by_role")) select.push("created_by_role");
    if (cols.includes("created_at")) select.push("created_at");

    const sql = `
      SELECT ${select.join(", ")}
      FROM bloqueos
      ORDER BY fecha ASC,
               COALESCE(is_all_day, 0) DESC,
               CASE WHEN hora IS NULL OR hora = '' THEN '99:99' ELSE hora END ASC
    `;
    const rows = await query(sql);
    res.json(rows || []);
  } catch (e) {
    console.error("GET /bloqueos/admin", e);
    res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
  }
});

// GET /api/bloqueos/admin/day?fecha=YYYY-MM-DD&trainerId=...
router.get("/admin/day", verifyToken, requireAdmin, async (req, res) => {
  try {
    const fecha = normFecha(req.query?.fecha ?? req.query?.date ?? req.query?.dia ?? req.query?.f);
    if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });

    const cols = await getBloqueosCols();
    const select = ["id", "fecha", "hora"];
    const hasTrainer = cols.includes("trainer_id");
    if (hasTrainer) select.push("trainer_id");
    if (cols.includes("is_all_day")) select.push("is_all_day");
    if (cols.includes("created_by_role")) select.push("created_by_role");
    if (cols.includes("created_at")) select.push("created_at");

    const params = [fecha];
    let sql = `SELECT ${select.join(", ")} FROM bloqueos WHERE fecha = ?`;

    const t = String(req.query?.trainerId ?? req.query?.trainer_id ?? "").trim();
    if (hasTrainer && t) {
      sql += " AND (trainer_id IS NULL OR trainer_id = ?)";
      params.push(t);
    }

    sql += " ORDER BY COALESCE(is_all_day,0) DESC, hora ASC";
    const rows = await query(sql, params);
    res.json(rows || []);
  } catch (e) {
    console.error("GET /bloqueos/admin/day", e);
    res.status(500).json({ error: "No se pudieron cargar los bloqueos" });
  }
});

// POST /api/bloqueos/admin
// Body: { fecha, hora? , allDay? , trainerId? , scope? }
router.post("/admin", verifyToken, requireAdmin, async (req, res) => {
  try {
    const p = normalizeBlockPayload(req.body || {});
    if (!p.fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
    if (!p.isAllDay && !p.hora) return res.status(400).json({ error: "Falta hora (HH:MM)" });

    const cols = await getBloqueosCols();
    const hasTrainer = cols.includes("trainer_id");
    const hasAllDay = cols.includes("is_all_day");
    const hasCreatedByRole = cols.includes("created_by_role");
    const hasCreatedAt = cols.includes("created_at");

    // Evitar duplicados (misma fecha + (hora o all-day) + trainer/global)
    const dupParams = [p.fecha];
    let dupSql = "SELECT 1 FROM bloqueos WHERE fecha = ?";
    if (hasAllDay) {
      dupSql += " AND is_all_day = ?";
      dupParams.push(p.isAllDay ? 1 : 0);
    } else {
      // Si no existe columna, consideramos all-day como hora vacía
      if (p.isAllDay) {
        dupSql += " AND (hora IS NULL OR hora = '')";
      }
    }
    if (!p.isAllDay) {
      dupSql += " AND hora = ?";
      dupParams.push(p.hora);
    }

    if (hasTrainer) {
      if (p.isGlobal) {
        dupSql += " AND trainer_id IS NULL";
      } else {
        dupSql += " AND trainer_id = ?";
        dupParams.push(p.trainerId);
      }
    }

    const dup = await query(dupSql, dupParams);
    if (dup?.length) return res.status(409).json({ error: "Ya está bloqueada" });

    const id = uuidv4();
    const insertCols = ["id", "fecha", "hora"];
    const values = ["?", "?", "?"];
    const params = [id, p.fecha, p.isAllDay ? null : p.hora];

    if (hasTrainer) {
      insertCols.push("trainer_id");
      values.push("?");
      params.push(p.isGlobal ? null : p.trainerId);
    }
    if (hasAllDay) {
      insertCols.push("is_all_day");
      values.push("?");
      params.push(p.isAllDay ? 1 : 0);
    }
    if (hasCreatedByRole) {
      insertCols.push("created_by_role");
      values.push("?");
      params.push("admin");
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

    res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error("POST /bloqueos/admin", e);
    res.status(500).json({ error: "No se pudo crear el bloqueo" });
  }
});

// PATCH /api/bloqueos/admin/:id (editar)
router.patch("/admin/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Falta id" });

    const p = normalizeBlockPayload(req.body || {});
    if (!p.fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
    if (!p.isAllDay && !p.hora) return res.status(400).json({ error: "Falta hora (HH:MM)" });

    const cols = await getBloqueosCols();
    const hasTrainer = cols.includes("trainer_id");
    const hasAllDay = cols.includes("is_all_day");

    // Existe?
    const exists = await query("SELECT 1 FROM bloqueos WHERE id = ? LIMIT 1", [id]);
    if (!exists?.length) return res.status(404).json({ error: "Bloqueo no encontrado" });

    const sets = ["fecha = ?", "hora = ?"];
    const params = [p.fecha, p.isAllDay ? null : p.hora];

    if (hasTrainer) {
      sets.push("trainer_id = ?");
      params.push(p.isGlobal ? null : p.trainerId);
    }
    if (hasAllDay) {
      sets.push("is_all_day = ?");
      params.push(p.isAllDay ? 1 : 0);
    }

    params.push(id);
    await query(`UPDATE bloqueos SET ${sets.join(", ")} WHERE id = ?`, params);

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /bloqueos/admin/:id", e);
    res.status(500).json({ error: "No se pudo editar el bloqueo" });
  }
});

// DELETE /api/bloqueos/admin/:id
router.delete("/admin/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Falta id" });

    const exists = await query("SELECT 1 FROM bloqueos WHERE id = ? LIMIT 1", [id]);
    if (!exists?.length) return res.status(404).json({ error: "Bloqueo no encontrado" });

    await query("DELETE FROM bloqueos WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /bloqueos/admin/:id", e);
    res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
  }
});

export default router;
