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

function pickTrainerId(req) {
  const id = req.user?.uid || req.user?.id || "";
  return String(id || "");
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
      const { fecha } = req.query;
      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });

      const cols = await getBloqueosCols();
      const hasTrainer = cols.includes("trainer_id");
      const hasId = cols.includes("id");

      const selectCols = [];
      if (hasId) selectCols.push("id");
      selectCols.push("fecha", "hora");

      const params = [String(fecha)];
      let sql = `SELECT ${selectCols.join(", ")} FROM bloqueos WHERE fecha = ?`;

      if (hasTrainer) {
        const trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
        sql += " AND trainer_id = ?";
        params.push(trainerId);
      }

      sql += " ORDER BY hora ASC";

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
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha, hora } = req.body || {};
      if (!fecha || !hora) return res.status(400).json({ error: "Faltan fecha/hora" });

      const cols = await getBloqueosCols();
      const hasTrainer = cols.includes("trainer_id");
      const hasId = cols.includes("id");
      const hasCreatedAt = cols.includes("created_at");

      const trainerId = hasTrainer ? pickTrainerId(req) : null;
      if (hasTrainer && !trainerId) return res.status(401).json({ error: "No autorizado" });

      // evitar duplicados
      const dupParams = [String(fecha), String(hora)];
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
      params.push(String(fecha));

      insertCols.push("hora");
      values.push("?");
      params.push(String(hora));

      if (hasTrainer) {
        insertCols.push("trainer_id");
        values.push("?");
        params.push(String(trainerId));
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
 * Borra bloqueo (por trainer si existe trainer_id; si no, global).
 */
router.delete(
  "/",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha, hora } = req.body || {};
      if (!fecha || !hora) return res.status(400).json({ error: "Faltan fecha/hora" });

      const cols = await getBloqueosCols();
      const hasTrainer = cols.includes("trainer_id");

      const params = [String(fecha), String(hora)];
      let sql = "DELETE FROM bloqueos WHERE fecha = ? AND hora = ?";

      if (hasTrainer) {
        const trainerId = pickTrainerId(req);
        if (!trainerId) return res.status(401).json({ error: "No autorizado" });
        sql += " AND trainer_id = ?";
        params.push(String(trainerId));
      }

      await query(sql, params);
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /bloqueos", e);
      res.status(500).json({ error: "No se pudo desbloquear" });
    }
  }
);

export default router;
