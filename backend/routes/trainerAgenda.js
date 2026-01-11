import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";
import { ensureBloqueosSchema } from "../utils/bloqueosSchema.js";
import { notifyReservationCreated } from "../services/notifications.js";

const router = express.Router();

const nowISO = () => new Date().toISOString();

function padHHMM(x) {
  if (!x) return x;
  const [h, m = "00"] = String(x).split(":");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayOfWeekFromFecha(fecha) {
  if (!fecha) return null;
  const [Y, M, D] = String(fecha).split("-").map(Number);
  if (!Y || !M || !D) return null;
  return new Date(Y, (M || 1) - 1, D).getDay(); // 0=domingo ... 6=sábado
}

function isReservaSlotAllowed(fecha, hora) {
  const dow = dayOfWeekFromFecha(fecha);
  if (dow === 0) {
    return { ok: false, reason: "NO_SUNDAY", msg: "No se puede reservar los domingos" };
  }

  if (dow === 6) {
    const [hRaw, mRaw = "0"] = String(hora || "00:00").split(":");
    const h = Number(hRaw);
    const m = Number(mRaw);
    // Última hora permitida: 13:00
    if (Number.isFinite(h) && (h > 13 || (h === 13 && Number.isFinite(m) && m > 0))) {
      return {
        ok: false,
        reason: "SAT_AFTER_13",
        msg: "Los sábados la última hora de reserva es a las 13:00",
      };
    }
  }

  return { ok: true };
}

function overlaps(startA, durA, startB, durB) {
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };
  const a0 = toMin(startA);
  const a1 = a0 + Number(durA || 0);
  const b0 = toMin(startB);
  const b1 = b0 + Number(durB || 0);
  return a0 < b1 && b0 < a1;
}

async function bloqueosHasTrainerIdColumn() {
  try {
    await ensureBloqueosSchema();
    const cols = await query(`PRAGMA table_info(bloqueos)`);
    return cols.some((c) => String(c.name).toLowerCase() === "trainer_id");
  } catch {
    return false;
  }
}

let _bloqueosHasAllDay = null;
async function bloqueosHasAllDayColumn() {
  if (_bloqueosHasAllDay !== null) return _bloqueosHasAllDay;
  try {
    await ensureBloqueosSchema();
    const cols = await query(`PRAGMA table_info(bloqueos)`);
    _bloqueosHasAllDay = cols.some(
      (c) => String(c.name).toLowerCase() === "is_all_day"
    );
  } catch {
    _bloqueosHasAllDay = false;
  }
  return _bloqueosHasAllDay;
}

/* ============================================================
   POST /api/reservas/trainer-create
   Crea una reserva desde la agenda del adiestrador.
   Roles: adiestrador / admin

   Body:
     {
       clienteId,
       servicioId,
       fecha,
       hora,
       modalidad,
       durationMin,
       telefono,
       direccion,
       perro,
       status
     }
============================================================ */
router.post(
  "/trainer-create",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const role = String(req.user?.role || req.user?.rol || "");
      const authedId = String(req.user?.id || req.user?.uid || "");
      if (!authedId) return res.status(401).json({ error: "No autorizado" });

      const trainerId =
        role === "admin" && req.body?.trainerId
          ? String(req.body.trainerId)
          : authedId;

      const clienteId = String(req.body?.clienteId || "").trim();
      const servicioId = String(req.body?.servicioId || "").trim();
      const fecha = String(req.body?.fecha || "").trim();
      const hora = padHHMM(String(req.body?.hora || "").trim());
      const modalidad = String(req.body?.modalidad || "presencial").trim();
      const durationMin = Number(req.body?.durationMin || 60);

      const telefono = req.body?.telefono != null ? String(req.body.telefono) : null;
      const direccion = req.body?.direccion != null ? String(req.body.direccion) : null;
      const perro = req.body?.perro != null ? String(req.body.perro) : null;

      // Las reservas creadas por un adiestrador deben ser confirmadas por el cliente.
      // (Admin puede forzar otro estado, pero por defecto también queda en pending_user.)
      let status = String(req.body?.status || "pending_user").trim();
      if (role !== "admin") status = "pending_user";

      if (!clienteId || !servicioId || !fecha || !hora) {
        return res.status(400).json({ error: "Faltan campos (cliente/servicio/fecha/hora)" });
      }

      // Regla de negocio: no reservas domingos; sábados última hora 13:00
      const allowedSlot = isReservaSlotAllowed(fecha, hora);
      if (!allowedSlot.ok) {
        return res.status(400).json({ error: allowedSlot.msg || "Hora no permitida" });
      }

      // 1) email del cliente
      const urows = await query(`SELECT id, email FROM usuarios WHERE id = ? LIMIT 1`, [
        clienteId,
      ]);
      if (!urows.length) return res.status(404).json({ error: "Cliente no encontrado" });
      const email = String(urows[0]?.email || "").trim();

      // 2) título del servicio
      let servicioTitulo = null;
      try {
        const srows = await query(
          `SELECT title AS t
             FROM servicios
            WHERE id = ?
            LIMIT 1`,
          [servicioId]
        );
        servicioTitulo = srows[0]?.t ? String(srows[0].t) : null;
      } catch {
        servicioTitulo = null;
      }
      if (!servicioTitulo) servicioTitulo = servicioId; // fallback (no ideal, pero evita "vacío")

      // 3) conflictos (solo para este trainer)
      const existentes = await query(
        `SELECT hora, COALESCE(duration_min,60) AS durationMin
           FROM reservas
          WHERE fecha = ?
            AND trainer_id = ?
            AND status IN ('pending','pending_user','confirmed')`,
        [fecha, trainerId]
      );

      const hasTrainerCol = await bloqueosHasTrainerIdColumn();
      const hasAllDayCol = await bloqueosHasAllDayColumn();
      const bloqueos = hasTrainerCol
        ? await query(
            hasAllDayCol
              ? `SELECT hora, COALESCE(is_all_day,0) AS allDay FROM bloqueos WHERE fecha=? AND (trainer_id=? OR trainer_id IS NULL OR trainer_id='')`
              : `SELECT hora FROM bloqueos WHERE fecha=? AND (trainer_id=? OR trainer_id IS NULL OR trainer_id='')`,
            [fecha, trainerId]
          )
        : await query(
            hasAllDayCol
              ? `SELECT hora, COALESCE(is_all_day,0) AS allDay FROM bloqueos WHERE fecha=?`
              : `SELECT hora FROM bloqueos WHERE fecha=?`,
            [fecha]
          );

      if (
        existentes.some((r) => String(r.hora) === String(hora)) ||
        bloqueos.some((b) => Number(b?.allDay || 0) === 1) ||
        bloqueos.some((b) => String(b.hora) === String(hora))
      ) {
        return res.status(409).json({ error: "Hora ya reservada o bloqueada" });
      }

      if (
        existentes.some((r) =>
          overlaps(String(hora), durationMin, String(r.hora), Number(r.durationMin || 60))
        )
      ) {
        return res.status(409).json({ error: "Franja solapada" });
      }

      // 4) insertar
      const id = uuidv4();
      const ts = nowISO();

      await query(
        `INSERT INTO reservas
          (id, uid, email, fecha, hora, duration_min,
           servicio_id, servicio_titulo,
           modalidad, duration,
           price, currency,
           perro, telefono, direccion,
           pricing, paquete_id,
           status, origin,
           user_note, admin_note,
           trainer_id,
           created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          clienteId,
          email,
          fecha,
          hora,
          durationMin,
          servicioId,
          servicioTitulo,
          modalidad,
          null,
          null,
          "EUR",
          perro,
          telefono,
          direccion,
          null,
          null,
          status,
          "trainer",
          null,
          null,
          trainerId,
          ts,
          ts,
        ]
      );

      const rows = await query(
        `SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
                servicio_id AS servicioId, servicio_titulo AS servicioTitulo,
                modalidad, status, trainer_id AS trainerId,
                perro, telefono, direccion,
                created_at AS createdAt, updated_at AS updatedAt
           FROM reservas
          WHERE id = ? LIMIT 1`,
        [id]
      );

      // Notificaciones por email (cliente +, si aplica, adiestrador)
      void notifyReservationCreated(id);

      res.status(201).json(rows[0] || { id });
    } catch (e) {
      console.error("POST /api/reservas/trainer-create", e);
      res.status(500).json({ error: "No se pudo crear la reserva" });
    }
  }
);

export default router
// GET /api/reservas/trainer/day?fecha=YYYY-MM-DD
router.get(
  "/trainer/day",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha } = req.query || {};
      const trainerId = String(req.user?.id || req.user?.uid || "");
      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      // Detecta columnas reales por compatibilidad
      const cols = await query("PRAGMA table_info(reservas)");
      const has = (name) => Array.isArray(cols) && cols.some((c) => String(c?.name) === name);

      const trainerCol = has("trainer_id") ? "trainer_id" : has("trainerId") ? "trainerId" : "trainer_id";
      const durationCol = has("duration_min") ? "duration_min" : has("durationMin") ? "durationMin" : null;
      const servicioCol = has("servicio_titulo")
        ? "servicio_titulo"
        : has("servicioTitulo")
        ? "servicioTitulo"
        : null;
      const perroCol = has("perro") ? "perro" : null;
      const uidCol = has("uid") ? "uid" : null;
      const emailCol = has("email") ? "email" : null;
      const modalidadCol = has("modalidad") ? "modalidad" : null;
      const statusCol = has("status") ? "status" : null;

      const sql = `
        SELECT
          id,
          fecha,
          hora,
          ${durationCol ? `${durationCol} AS durationMin` : "NULL AS durationMin"},
          ${statusCol ? `${statusCol} AS status` : "NULL AS status"},
          ${modalidadCol ? `${modalidadCol} AS modalidad` : "NULL AS modalidad"},
          ${servicioCol ? `${servicioCol} AS servicioTitulo` : "NULL AS servicioTitulo"},
          ${emailCol ? `${emailCol} AS email` : "NULL AS email"},
          ${uidCol ? `${uidCol} AS uid` : "NULL AS uid"},
          ${perroCol ? `${perroCol} AS perro` : "NULL AS perro"}
        FROM reservas
        WHERE ${trainerCol} = ?
          AND fecha = ?
          ${statusCol ? "AND status IN ('pending','pending_user','confirmed')" : ""}
        ORDER BY hora ASC
      `;

      const rows = await query(sql, [trainerId, String(fecha).slice(0, 10)]);
      res.json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error("GET /api/reservas/trainer/day", e);
      res.status(500).json({ error: "No se pudo cargar la agenda del día" });
    }
  }
);

/* Mis reservas (adiestrador) - compat */
// GET /api/reservas/mias-trainer?limit=300
router.get(
  "/mias-trainer",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const myId = String(req.user?.id || req.user?.uid || "");
      if (!myId) return res.status(401).json({ error: "No autorizado" });

      const limit = Math.min(Number(req.query?.limit || 300), 1000);

      const cols = await query("PRAGMA table_info(reservas)");
      const has = (name) => Array.isArray(cols) && cols.some((c) => String(c?.name) === name);

      const trainerCol = has("trainer_id") ? "trainer_id" : has("trainerId") ? "trainerId" : "trainer_id";
      const durationCol = has("duration_min") ? "duration_min" : has("durationMin") ? "durationMin" : null;
      const servicioCol = has("servicio_titulo")
        ? "servicio_titulo"
        : has("servicioTitulo")
        ? "servicioTitulo"
        : null;
      const perroCol = has("perro") ? "perro" : null;
      const uidCol = has("uid") ? "uid" : null;
      const emailCol = has("email") ? "email" : null;
      const modalidadCol = has("modalidad") ? "modalidad" : null;
      const statusCol = has("status") ? "status" : null;

      const sql = `
        SELECT
          id,
          fecha,
          hora,
          ${durationCol ? `${durationCol} AS durationMin` : "NULL AS durationMin"},
          ${statusCol ? `${statusCol} AS status` : "NULL AS status"},
          ${modalidadCol ? `${modalidadCol} AS modalidad` : "NULL AS modalidad"},
          ${servicioCol ? `${servicioCol} AS servicioTitulo` : "NULL AS servicioTitulo"},
          ${emailCol ? `${emailCol} AS email` : "NULL AS email"},
          ${uidCol ? `${uidCol} AS uid` : "NULL AS uid"},
          ${perroCol ? `${perroCol} AS perro` : "NULL AS perro"}
        FROM reservas
        WHERE ${trainerCol} = ?
          ${statusCol ? "AND status IN ('pending','pending_user','confirmed')" : ""}
        ORDER BY fecha DESC, hora DESC
        LIMIT ?
      `;
      const rows = await query(sql, [myId, limit]);
      res.json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error("GET /api/reservas/mias-trainer", e);
      res.status(500).json({ error: "No se pudieron cargar las reservas" });
    }
  }
);

;
