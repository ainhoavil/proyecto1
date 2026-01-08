// backend/routes/reservasCompat.js
// Rutas de compatibilidad para no romper el frontend cuando cambian los endpoints.
// Se monta DESPUÉS de routes/reservas.js: solo responde si la ruta no existe allí.

import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

async function tableCols(table) {
  try {
    const cols = await query(`PRAGMA table_info(${table})`);
    return (cols || []).map((c) => String(c?.name || "").toLowerCase());
  } catch {
    return [];
  }
}

async function pickReservasCols() {
  const cols = await tableCols("reservas");
  const has = (n) => cols.includes(String(n).toLowerCase());
  return {
    uid: has("uid") ? "uid" : has("user_id") ? "user_id" : "uid",
    email: has("email") ? "email" : "email",
    trainer: has("trainer_id") ? "trainer_id" : has("trainerid") ? "trainerId" : "trainer_id",
    durationMin: has("duration_min")
      ? "duration_min"
      : has("durationmin")
      ? "durationMin"
      : null,
    servicioId: has("servicio_id")
      ? "servicio_id"
      : has("servicioid")
      ? "servicioId"
      : null,
    servicioTitulo: has("servicio_titulo")
      ? "servicio_titulo"
      : has("serviciotitulo")
      ? "servicioTitulo"
      : null,
    paqueteId: has("paquete_id")
      ? "paquete_id"
      : has("paqueteid")
      ? "paqueteId"
      : null,
    cancelReason: has("cancel_reason")
      ? "cancel_reason"
      : has("cancelreason")
      ? "cancelReason"
      : null,
    userNote: has("user_note")
      ? "user_note"
      : has("usernote")
      ? "userNote"
      : null,
    adminNote: has("admin_note")
      ? "admin_note"
      : has("adminnote")
      ? "adminNote"
      : null,
    createdAt: has("created_at")
      ? "created_at"
      : has("createdat")
      ? "createdAt"
      : null,
    updatedAt: has("updated_at")
      ? "updated_at"
      : has("updatedat")
      ? "updatedAt"
      : null,
  };
}

function safeJson(v) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/reservas/mias
// ---------------------------------------------------------------------------
router.get("/mias", verifyToken, async (req, res) => {
  try {
    const uid = req.user?.uid ? String(req.user.uid) : null;
    const email = req.user?.email ? String(req.user.email).trim() : null;
    if (!uid && !email) return res.status(401).json({ error: "No autenticado" });

    const c = await pickReservasCols();

    // Nota: usamos OR por compatibilidad con reservas antiguas sin uid
    const where = [];
    const args = [];
    if (uid) {
      where.push(`${c.uid} = ?`);
      args.push(uid);
    }
    if (email) {
      where.push(`${c.email} = ?`);
      args.push(email);
    }
    if (!where.length) return res.status(401).json({ error: "No autenticado" });

    const rows = await query(
      `SELECT
        id,
        ${c.uid} AS uid,
        ${c.email} AS email,
        fecha,
        hora,
        ${c.durationMin ? `${c.durationMin} AS durationMin` : "NULL AS durationMin"},
        ${c.servicioId ? `${c.servicioId} AS servicioId` : "NULL AS servicioId"},
        ${c.servicioTitulo ? `${c.servicioTitulo} AS servicioTitulo` : "NULL AS servicioTitulo"},
        modalidad,
        duration,
        price,
        currency,
        perro,
        telefono,
        direccion,
        pricing,
        ${c.paqueteId ? `${c.paqueteId} AS paqueteId` : "NULL AS paqueteId"},
        status,
        origin,
        ${c.userNote ? `${c.userNote} AS userNote` : "NULL AS userNote"},
        ${c.adminNote ? `${c.adminNote} AS adminNote` : "NULL AS adminNote"},
        ${c.cancelReason ? `${c.cancelReason} AS cancelReason` : "NULL AS cancelReason"},
        ${c.trainer} AS trainerId,
        ${c.createdAt ? `${c.createdAt} AS createdAt` : "NULL AS createdAt"},
        ${c.updatedAt ? `${c.updatedAt} AS updatedAt` : "NULL AS updatedAt"}
      FROM reservas
      WHERE ${where.map((w) => `(${w})`).join(" OR ")}
      ORDER BY fecha DESC, hora DESC
      LIMIT 500`,
      args
    );

    res.json(
      (rows || []).map((r) => ({
        ...r,
        pricing: safeJson(r.pricing),
      }))
    );
  } catch (e) {
    console.error("GET /api/reservas/mias (compat)", e);
    res.status(500).json({ error: "No se pudieron cargar tus reservas" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reservas/trainer?limit=300
// Alias compatible para la vista de adiestrador.
// ---------------------------------------------------------------------------
router.get(
  "/trainer",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query?.limit || 300), 1), 1000);
      const role = String(req.user?.role || req.user?.rol || "").toLowerCase();

      // Adiestrador: usa su propio uid. Admin: puede forzar trainerId por query.
      const trainerId =
        role === "admin" && req.query?.trainerId
          ? String(req.query.trainerId)
          : String(req.user?.uid || "");

      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const c = await pickReservasCols();

      const rows = await query(
        `SELECT
          id,
          ${c.uid} AS uid,
          ${c.email} AS email,
          fecha,
          hora,
          ${c.durationMin ? `${c.durationMin} AS durationMin` : "NULL AS durationMin"},
          ${c.servicioId ? `${c.servicioId} AS servicioId` : "NULL AS servicioId"},
          ${c.servicioTitulo ? `${c.servicioTitulo} AS servicioTitulo` : "NULL AS servicioTitulo"},
          modalidad,
          duration,
          price,
          currency,
          perro,
          telefono,
          direccion,
          pricing,
          ${c.paqueteId ? `${c.paqueteId} AS paqueteId` : "NULL AS paqueteId"},
          status,
          origin,
          ${c.userNote ? `${c.userNote} AS userNote` : "NULL AS userNote"},
          ${c.adminNote ? `${c.adminNote} AS adminNote` : "NULL AS adminNote"},
          ${c.cancelReason ? `${c.cancelReason} AS cancelReason` : "NULL AS cancelReason"},
          ${c.trainer} AS trainerId,
          ${c.createdAt ? `${c.createdAt} AS createdAt` : "NULL AS createdAt"},
          ${c.updatedAt ? `${c.updatedAt} AS updatedAt` : "NULL AS updatedAt"}
        FROM reservas
        WHERE ${c.trainer} = ?
        ORDER BY fecha DESC, hora DESC
        LIMIT ?`,
        [trainerId, limit]
      );

      res.json(
        (rows || []).map((r) => ({
          ...r,
          pricing: safeJson(r.pricing),
        }))
      );
    } catch (e) {
      console.error("GET /api/reservas/trainer (compat)", e);
      res.status(500).json({ error: "No se pudieron cargar las reservas" });
    }
  }
);

// Alias por si el frontend usa este nombre
router.get(
  "/mias-trainer",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query?.limit || 300), 1), 1000);
      const role = String(req.user?.role || req.user?.rol || "").toLowerCase();

      const trainerId =
        role === "admin" && req.query?.trainerId
          ? String(req.query.trainerId)
          : String(req.user?.uid || "");

      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const c = await pickReservasCols();

      const rows = await query(
        `SELECT
          id,
          ${c.uid} AS uid,
          ${c.email} AS email,
          fecha,
          hora,
          ${c.durationMin ? `${c.durationMin} AS durationMin` : "NULL AS durationMin"},
          ${c.servicioId ? `${c.servicioId} AS servicioId` : "NULL AS servicioId"},
          ${c.servicioTitulo ? `${c.servicioTitulo} AS servicioTitulo` : "NULL AS servicioTitulo"},
          modalidad,
          duration,
          price,
          currency,
          perro,
          telefono,
          direccion,
          pricing,
          ${c.paqueteId ? `${c.paqueteId} AS paqueteId` : "NULL AS paqueteId"},
          status,
          origin,
          ${c.userNote ? `${c.userNote} AS userNote` : "NULL AS userNote"},
          ${c.adminNote ? `${c.adminNote} AS adminNote` : "NULL AS adminNote"},
          ${c.cancelReason ? `${c.cancelReason} AS cancelReason` : "NULL AS cancelReason"},
          ${c.trainer} AS trainerId,
          ${c.createdAt ? `${c.createdAt} AS createdAt` : "NULL AS createdAt"},
          ${c.updatedAt ? `${c.updatedAt} AS updatedAt` : "NULL AS updatedAt"}
        FROM reservas
        WHERE ${c.trainer} = ?
        ORDER BY fecha DESC, hora DESC
        LIMIT ?`,
        [trainerId, limit]
      );

      res.json(
        (rows || []).map((r) => ({
          ...r,
          pricing: safeJson(r.pricing),
        }))
      );
    } catch (e) {
      console.error("GET /api/reservas/mias-trainer (compat)", e);
      res.status(500).json({ error: "No se pudieron cargar las reservas" });
    }
  }
);

export default router;
