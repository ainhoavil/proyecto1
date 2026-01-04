// backend/routes/reservas.js
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { verifyToken, requireAdmin, allowRoles } from "../middleware/auth.js";
import trainerAgendaRoutes from "./trainerAgenda.js";

const router = express.Router();

/* ===================== Introspección esquema reservas ===================== */
// Compatibilidad entre esquemas (trainer_id vs trainerId, uid vs user_id, etc.)
// Evita 500 si la BD tiene columnas con nombres distintos.
let _reservasColsCache = null;

async function getReservasCols() {
  if (_reservasColsCache) return _reservasColsCache;
  try {
    const cols = await query(`PRAGMA table_info(reservas)`);
    _reservasColsCache = (cols || []).map((c) => ({
      name: c?.name,
      lname: String(c?.name || "").toLowerCase(),
    }));
  } catch (e) {
    _reservasColsCache = [];
  }
  return _reservasColsCache;
}

function pickCol(cols, candidatesLower) {
  const hit = (cols || []).find((c) => candidatesLower.includes(c.lname));
  return hit?.name || null;
}

function qIdent(name) {
  // Quote identifier safely for SQLite/libSQL
  if (!name) return null;
  return `"${String(name).replace(/"/g, '""')}"`;
}


/* ===================== Config ===================== */
const BUSINESS_HOURS = { start: 9, end: 21, skipHours: new Set([14, 15]) };

/* ===================== Helpers ===================== */
const nowISO = () => new Date().toISOString();
const MS_24H = 24 * 60 * 60 * 1000;

const toMin = (hhmm) => {
  const [h, m = 0] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
const overlaps = (aStart, aDur, bStart, bDur) => {
  const a1 = toMin(aStart),
    a2 = a1 + Number(aDur || 60);
  const b1 = toMin(bStart),
    b2 = b1 + Number(bDur || 60);
  return a1 < b2 && b1 < a2;
};
const parseJSONSafe = (v, fb = {}) => {
  try {
    return typeof v === "string" ? JSON.parse(v) : v ?? fb;
  } catch {
    return fb;
  }
};

function buildDateFromFechaHora(fecha, hora) {
  if (!fecha) return null;
  const [Y, M, D] = String(fecha).split("-").map(Number);
  const [h, m = 0] = String(hora || "00:00").split(":").map(Number);
  if (!Y || !M || !D) return null;
  return new Date(Y, (M || 1) - 1, D, h || 0, m || 0);
}

function isPast(fecha, hora) {
  const d = buildDateFromFechaHora(fecha, hora);
  if (!d) return false;
  return d.getTime() < Date.now();
}

function puedeCancelar24h(fecha, hora) {
  const d = buildDateFromFechaHora(fecha, hora);
  if (!d) return false;
  return d.getTime() - Date.now() > MS_24H;
}

async function autoExpireIfPast(rows) {
  for (const r of rows) {
    const s = String(r.status || "").toLowerCase();
    if (
      (s === "pending" ||
        s === "pendiente" ||
        s === "pending_user" ||
        s === "pendiente_usuario") &&
      isPast(r.fecha, r.hora)
    ) {
      await query(
        `UPDATE reservas
            SET status='rejected',
                cancel_reason=COALESCE(cancel_reason,'auto-expirada'),
                updated_at=?
         WHERE id=?`,
        [nowISO(), r.id]
      );
      r.status = "rejected";
      if (!r.cancelReason) r.cancelReason = "auto-expirada";
    }
  }
}

async function tx(run) {
  try {
    await query("BEGIN IMMEDIATE");
    const r = await run();
    await query("COMMIT");
    return r;
  } catch (e) {
    await query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/* ===================== Bloqueos / disponibilidad por adiestrador ===================== */
let _bloqueosHasTrainerId = null;

async function bloqueosHasTrainerIdColumn() {
  if (_bloqueosHasTrainerId !== null) return _bloqueosHasTrainerId;
  try {
    const cols = await query(`PRAGMA table_info(bloqueos)`);
    _bloqueosHasTrainerId = (cols || []).some(
      (c) => String(c?.name || "").toLowerCase() === "trainer_id"
    );
  } catch {
    _bloqueosHasTrainerId = false;
  }
  return _bloqueosHasTrainerId;
}

async function isTrainerAvailableForSlot({ trainerId, fecha, hora, durationMin = 60, excludeReservaId = null }) {
  const tid = String(trainerId || "").trim();
  if (!tid || !fecha || !hora) return true;

  // Reservas solapadas del mismo trainer
  const params = [String(fecha), tid];
  let whereExclude = "";
  if (excludeReservaId) {
    whereExclude = " AND id <> ?";
    params.push(String(excludeReservaId));
  }

  const reservas = await query(
    `SELECT id, hora, COALESCE(duration_min,60) AS durationMin
       FROM reservas
      WHERE fecha = ?
        AND trainer_id = ?
        AND status IN ('pending','pending_user','confirmed')
        ${whereExclude}`,
    params
  );

  for (const r of reservas || []) {
    if (overlaps(String(hora), Number(durationMin || 60), String(r.hora), Number(r.durationMin || 60))) {
      return false;
    }
  }

  // Bloqueos (globales o por trainer)
  const hasTrainerCol = await bloqueosHasTrainerIdColumn();
  if (hasTrainerCol) {
    const bloqueos = await query(
      `SELECT hora, trainer_id AS trainerId
         FROM bloqueos
        WHERE fecha = ?`,
      [String(fecha)]
    );
    for (const b of bloqueos || []) {
      const bt = String(b?.trainerId || "").trim();
      const isGlobal = !bt;
      if (isGlobal || bt === tid) {
        if (overlaps(String(hora), Number(durationMin || 60), String(b.hora), 60)) return false;
      }
    }
  } else {
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [String(fecha)]);
    for (const b of bloqueos || []) {
      if (overlaps(String(hora), Number(durationMin || 60), String(b.hora), 60)) return false;
    }
  }

  return true;
}

/* ===================== Permisos notas hilo ===================== */
async function canSeeReservation(req, reservaId) {
  const r = (
    await query(
      `SELECT id, uid, email
         FROM reservas
        WHERE id = ?
        LIMIT 1`,
      [reservaId]
    )
  )[0];

  if (!r) return { ok: false };

  const rol = req.user?.rol || req.user?.role || "user";

  const isAdmin = !!req.user?.isAdmin || rol === "admin";
  const isTrainer = rol === "adiestrador";
  const isOwner =
    (r.uid && req.user?.uid && r.uid === req.user.uid) ||
    (r.email && req.user?.email && r.email === req.user.email);

  // Admin, Adiestrador y Dueño pueden ver las notas
  return { ok: isAdmin || isTrainer || isOwner };
}

/* ===================== Trainer assignment ===================== */
/**
 * Tabla esperada:
 * trainer_servicios(id, trainer_id, servicio_id, modalidad, enabled, created_at, updated_at)
 * - modalidad NULL o '' => vale para cualquier modalidad
 */

// ✅ NUEVO: fallback a "todos los adiestradores" (coherente con /api/trainers/eligible actual)
async function getAllTrainers() {
  try {
    return await query(
      `SELECT id, email, nombre
         FROM usuarios
        WHERE rol = 'adiestrador'
        ORDER BY nombre IS NULL, nombre ASC, email ASC`
    );
  } catch {
    return await query(
      `SELECT id, email
         FROM usuarios
        WHERE rol = 'adiestrador'
        ORDER BY email ASC`
    );
  }
}

async function getEligibleTrainers({ servicioId, modalidad }) {
  const mod = modalidad ? String(modalidad) : null;

  if (!servicioId) {
    return await getAllTrainers();
  }

  let rows = [];
  try {
    rows = await query(
      `
      SELECT u.id, u.email, u.nombre
        FROM usuarios u
        JOIN trainer_servicios ts
          ON ts.trainer_id = u.id
       WHERE u.rol = 'adiestrador'
         AND ts.enabled = 1
         AND ts.servicio_id = ?
         AND (
              ts.modalidad IS NULL
              OR ts.modalidad = ''
              OR ? IS NULL
              OR ts.modalidad = ?
         )
       ORDER BY u.nombre IS NULL, u.nombre ASC, u.email ASC
      `,
      [String(servicioId), mod, mod]
    );
  } catch {
    rows = [];
  }

  if (!rows || rows.length === 0) {
    return await getAllTrainers();
  }

  return rows;
}

function pickRandomTrainer(eligibleRows) {
  if (!eligibleRows || eligibleRows.length === 0) return null;
  const idx = Math.floor(Math.random() * eligibleRows.length);
  return eligibleRows[idx];
}

async function validateTrainerExistsAndIsTrainer(trainerId) {
  const row = (
    await query(`SELECT id, rol FROM usuarios WHERE id=? LIMIT 1`, [String(trainerId)])
  )[0];
  return !!row && row.rol === "adiestrador";
}

async function resolveTrainerIdOrFail({ trainerId, servicioId, modalidad }) {
  const reqT = trainerId == null ? "" : String(trainerId).trim();

  // Si el usuario no elige adiestrador (o marca "cualquiera"),
  // dejamos la reserva SIN adiestrador asignado para que el admin lo adjudique.
  if (!reqT || reqT === "any") return null;

  if (reqT) {
    const okTrainer = await validateTrainerExistsAndIsTrainer(reqT);
    if (!okTrainer) {
      const err = new Error("Trainer inválido");
      err.statusCode = 400;
      throw err;
    }

    // (Opcional) si hay filtros de servicio/modalidad, validamos compatibilidad.
    try {
      const eligible = await getEligibleTrainers({ servicioId, modalidad });
      if (Array.isArray(eligible) && eligible.length) {
        const okEligible = eligible.some((t) => String(t?.id || "") === String(reqT));
        if (!okEligible) {
          const err = new Error("Trainer no compatible con el servicio/modalidad");
          err.statusCode = 400;
          throw err;
        }
      }
    } catch {
      // si no podemos validar elegibilidad por esquema, no bloqueamos
    }

    return reqT;
  }

  return null;
}

/* ===================== Disponibilidad ===================== */
// GET /api/reservas/disponibilidad?fecha=YYYY-MM-DD&trainerId=&durationMin=
router.get("/disponibilidad", async (req, res) => {
  try {
    const { fecha, trainerId = "", durationMin = 60 } = req.query;
    if (!fecha) {
      return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
    }

    const slots = [];
    for (let h = BUSINESS_HOURS.start; h < BUSINESS_HOURS.end; h++) {
      if (BUSINESS_HOURS.skipHours.has(h)) continue;
      slots.push(`${String(h).padStart(2, "0")}:00`);
    }

    const params = [fecha];
    let whereTrainer = "";

    if (trainerId && trainerId !== "any") {
      whereTrainer = " AND trainer_id = ?";
      params.push(String(trainerId));
    }

    const reservas = await query(
      `
      SELECT hora, COALESCE(duration_min,60) AS durationMin
        FROM reservas
       WHERE fecha = ?
         AND status IN ('pending','pending_user','confirmed')
         ${whereTrainer}
      `,
      params
    );

    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [fecha]);

    const ocupadas = new Set();

    for (const r of reservas) {
      const start = toMin(r.hora);
      const end = start + Number(r.durationMin || 60);
      for (let t = start; t < end; t += 60) {
        ocupadas.add(fromMin(t));
      }
    }

    for (const b of bloqueos) ocupadas.add(String(b.hora));

    const libres = slots.filter((slot) => {
      const start = toMin(slot);
      const end = start + Number(durationMin || 60);
      for (let t = start; t < end; t += 60) {
        if (ocupadas.has(fromMin(t))) return false;
      }
      return true;
    });

    res.json({ fecha, libres, ocupadas: Array.from(ocupadas) });
  } catch (e) {
    console.error("GET /reservas/disponibilidad", e);
    res.status(500).json({ error: "No se pudo calcular disponibilidad" });
  }
});

/* ===================== Crear (usuario) ===================== */
// POST /api/reservas
router.post("/", verifyToken, async (req, res) => {
  try {
    const {
      email,
      fecha,
      hora,
      durationMin = 60,
      servicioId,
      servicioTitulo,
      modalidad,
      duration,
      price,
      currency,
      perro,
      telefono,
      direccion,
      pricing,
      paqueteId,
      userNote = null,
      trainerId, // '<id>' | 'any' | undefined
    } = req.body;

    const uid = req.user?.uid || null;
    const emailNorm = String(email || req.user?.email || "").trim();
    if (!uid || !emailNorm || !fecha || !hora) {
      return res.status(400).json({ error: "Faltan campos (login/email/fecha/hora)" });
    }

    // Fallback del servicio
    let servicioTituloSafe = servicioTitulo || null;
    if (!servicioTituloSafe && servicioId) {
      try {
        const trows = await query(
          `SELECT title AS t FROM servicios WHERE id = ?
            LIMIT 1`,
          [String(servicioId)]
        );
        servicioTituloSafe = trows[0]?.t || null;
      } catch {
        // ignore
      }
    }

    // Colisiones (sistema actual por franja global)
    const existentes = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','pending_user','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [fecha]);

    if (
      existentes.some((r) => String(r.hora) === String(hora)) ||
      bloqueos.some((b) => String(b.hora) === String(hora))
    ) {
      return res.status(409).json({ error: "Hora ya reservada o bloqueada" });
    }

    if (
      existentes.some((r) =>
        overlaps(String(hora), Number(durationMin), String(r.hora), Number(r.durationMin || 60))
      )
    ) {
      return res.status(409).json({ error: "Franja solapada" });
    }

    const trainerIdFinal = await resolveTrainerIdOrFail({ trainerId, servicioId, modalidad });

    // Si se asigna un adiestrador, validamos que esté disponible en esa franja.
    if (trainerIdFinal) {
      const ok = await isTrainerAvailableForSlot({
        trainerId: trainerIdFinal,
        fecha: r.fecha,
        hora: r.hora,
        durationMin: r.durationMin || 60,
        excludeReservaId: id,
      });
      if (!ok) {
        const err = new Error("Adiestrador no disponible en esa franja");
        err.statusCode = 409;
        throw err;
      }
    }

    const id = uuidv4();
    const ts = nowISO();
    const pricingJson = pricing ? JSON.stringify(pricing) : null;
    const status = "pending";

    if (paqueteId) {
      await tx(async () => {
        const pRows = await query(
          `SELECT id, user_id AS userId, status, saldo
             FROM paquetes
            WHERE id = ? LIMIT 1`,
          [String(paqueteId)]
        );
        if (!pRows.length) throw new Error("Paquete no existe");
        const p = pRows[0];
        if (p.status !== "active") throw new Error("Paquete no activo");
        if (p.userId && p.userId !== uid) throw new Error("El paquete no pertenece al usuario");

        const saldo = parseJSONSafe(p.saldo, { total: 1, usadas: 0, pendientes: 0 });
        if (
          Number(saldo.usadas || 0) + Number(saldo.pendientes || 0) >= Number(saldo.total || 1)
        ) {
          throw new Error("Saldo agotado");
        }

        await query(
          `INSERT INTO reservas
            (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note,
             trainer_id,
             created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            uid,
            emailNorm,
            fecha,
            hora,
            Number(durationMin),
            servicioId || null,
            servicioTituloSafe,
            modalidad || null,
            duration || null,
            price ?? null,
            currency || "EUR",
            perro || null,
            telefono || null,
            direccion || null,
            pricingJson,
            String(paqueteId),
            status,
            "paquete",
            userNote,
            trainerIdFinal,
            ts,
            ts,
          ]
        );

        saldo.pendientes = Number(saldo.pendientes || 0) + 1;

        await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
          JSON.stringify(saldo),
          ts,
          String(paqueteId),
        ]);
      });
    } else {
      await query(
        `INSERT INTO reservas
          (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
           price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note,
           trainer_id,
           created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          uid,
          emailNorm,
          fecha,
          hora,
          Number(durationMin),
          servicioId || null,
          servicioTituloSafe,
          modalidad || null,
          duration || null,
          price ?? null,
          currency || "EUR",
          perro || null,
          telefono || null,
          direccion || null,
          pricingJson,
          null,
          status,
          "directo",
          userNote,
          trainerIdFinal,
          ts,
          ts,
        ]
      );
    }

    const rows = await query(
      `SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
              servicio_id AS servicioId, servicio_titulo AS servicioTitulo,
              modalidad, duration, price, currency, perro, telefono, direccion,
              pricing, paquete_id AS paqueteId, status, origin,
              user_note AS userNote, admin_note AS adminNote,
              cancel_reason AS cancelReason,
              trainer_id AS trainerId,
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM reservas WHERE id = ?`,
      [id]
    );

    const r = rows[0] || {};
    res.status(201).json({ ...r, pricing: parseJSONSafe(r.pricing, null) });
  } catch (e) {
    const code = e?.statusCode || 500;
    console.error("POST /reservas", e);
    res.status(code).json({ error: e?.message || "No se pudo crear la reserva" });
  }
});

/* ===================== Crear reserva (admin) ===================== */
// POST /api/reservas/admin
router.post("/admin", verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      email,
      fecha,
      hora,
      durationMin = 60,
      servicioId,
      servicioTitulo,
      modalidad,
      duration,
      price,
      currency,
      perro,
      telefono,
      direccion,
      pricing,
      paqueteId,
      status: statusBody,
      adminNote = null,
      userNote = null,
      trainerId,
    } = req.body;

    const emailNorm = String(email || "").trim();
    if (!emailNorm || !fecha || !hora) {
      return res.status(400).json({ error: "Faltan campos (email/fecha/hora)" });
    }

    let servicioTituloSafe = servicioTitulo || null;
    if (!servicioTituloSafe && servicioId) {
      try {
        const trows = await query(
          `SELECT title AS t FROM servicios WHERE id = ?
            LIMIT 1`,
          [String(servicioId)]
        );
        servicioTituloSafe = trows[0]?.t || null;
      } catch {
        // ignore
      }
    }

    const existentes = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','pending_user','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha=?`, [fecha]);

    if (
      existentes.some((r) => String(r.hora) === String(hora)) ||
      bloqueos.some((b) => String(b.hora) === String(hora))
    ) {
      return res.status(409).json({ error: "Hora ya reservada o bloqueada" });
    }

    if (
      existentes.some((r) =>
        overlaps(String(hora), Number(durationMin), String(r.hora), Number(r.durationMin || 60))
      )
    ) {
      return res.status(409).json({ error: "Franja solapada" });
    }

    const trainerIdFinal = await resolveTrainerIdOrFail({ trainerId, servicioId, modalidad });

    const id = uuidv4();
    const ts = nowISO();
    const pricingJson = pricing ? JSON.stringify(pricing) : null;
    const status = statusBody || "pending";

    await query(
      `INSERT INTO reservas
        (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
         price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin,
         user_note, admin_note,
         trainer_id,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        null,
        emailNorm,
        fecha,
        hora,
        Number(durationMin),
        servicioId || null,
        servicioTituloSafe,
        modalidad || null,
        duration || null,
        price ?? null,
        currency || "EUR",
        perro || null,
        telefono || null,
        direccion || null,
        pricingJson,
        paqueteId || null,
        status,
        "admin",
        userNote,
        adminNote,
        trainerIdFinal,
        ts,
        ts,
      ]
    );

    res.status(201).json({ ok: true, id, trainerId: trainerIdFinal });
  } catch (e) {
    const code = e?.statusCode || 500;
    console.error("POST /reservas/admin", e);
    res.status(code).json({ error: e?.message || "No se pudo crear (admin)" });
  }
});

/* ===================== Agenda diaria del adiestrador ===================== */
// GET /api/reservas/trainer/day?fecha=YYYY-MM-DD
router.get(
  "/trainer/day",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const { fecha } = req.query;
      const trainerId = String(req.user?.id || req.user?.uid || "");

      if (!fecha) return res.status(400).json({ error: "Falta fecha (YYYY-MM-DD)" });
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      // Detecta columnas reales (evita 500 si el esquema varía)
      const cols = await query("PRAGMA table_info(reservas)");
      const has = (name) => Array.isArray(cols) && cols.some((c) => String(c?.name) === name);

      const trainerCol = has("trainer_id") ? "trainer_id" : has("trainerId") ? "trainerId" : "trainer_id";
      const durationCol = has("duration_min") ? "duration_min" : has("durationMin") ? "durationMin" : null;
      const servicioCol = has("servicio_titulo") ? "servicio_titulo" : has("servicioTitulo") ? "servicioTitulo" : null;
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

      const rows = await query(sql, [trainerId, String(fecha)]);
      // Importante: NO parseamos JSON aquí. Si hay un 'perro' malformado, no debe tumbar la agenda.
      res.json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error("GET /reservas/trainer/day", e);
      res.status(500).json({
        error: "No se pudo cargar la agenda del adiestrador",
        detail: process.env.NODE_ENV !== "production" ? String(e?.message || e) : undefined,
      });
    }
  }
);


/* ===================== Mis reservas (adiestrador) ✅ NUEVO ===================== */
// GET /api/reservas/mias-trainer
router.get(
  "/mias-trainer",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const myId = String(req.user?.id || req.user?.uid || "");
      if (!myId) return res.status(401).json({ error: "No autorizado" });

      const rows = await query(
        `
        SELECT
          id,
          uid,
          email,
          fecha,
          hora,
          duration_min AS durationMin,
          servicio_id AS servicioId,
          servicio_titulo AS servicioTitulo,
          modalidad,
          duration,
          price,
          currency,
          perro,
          telefono,
          direccion,
          pricing,
          paquete_id AS paqueteId,
          status,
          origin,
          user_note AS userNote,
          admin_note AS adminNote,
          cancel_reason AS cancelReason,
          trainer_id AS trainerId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM reservas
        WHERE trainer_id = ?
        ORDER BY fecha DESC, hora DESC
        LIMIT 200
        `,
        [myId]
      );

      await autoExpireIfPast(rows);

      res.json(
        rows.map((r) => ({
          ...r,
          pricing: parseJSONSafe(r.pricing, null),
        }))
      );
    } catch (e) {
      console.error("GET /reservas/mias-trainer", e);
      res.status(500).json({ error: "No se pudieron cargar las reservas" });
    }
  }
);

/* ===================== Mis reservas (usuario) ===================== */
// GET /api/reservas/mias
router.get("/mias", verifyToken, async (req, res) => {
  try {
    const { uid, email } = req.user || {};
    if (!uid && !email) return res.status(401).json({ error: "No autenticado" });

    const rows = await query(
      `SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
              servicio_id AS servicioId, servicio_titulo AS servicioTitulo,
              modalidad, duration, price, currency, perro, telefono, direccion,
              pricing, paquete_id AS paqueteId,
              status, origin, user_note AS userNote,
              admin_note AS adminNote, cancel_reason AS cancelReason,
              trainer_id AS trainerId,
              created_at AS createdAt, updated_at AS updatedAt
         FROM reservas
        WHERE (uid = ? OR email = ?)
        ORDER BY fecha DESC, hora DESC
        LIMIT 200`,
      [uid || null, email || null]
    );

    await autoExpireIfPast(rows);

    res.json(
      rows.map((r) => ({
        ...r,
        pricing: parseJSONSafe(r.pricing, null),
      }))
    );
  } catch (e) {
    console.error("GET /reservas/mias", e);
    res.status(500).json({ error: "No se pudo obtener reservas" });
  }
});

/* ===================== Listado ADMIN / ADIESTRADOR ===================== */
// GET /api/reservas?status=...&email=...&limit=...
router.get(
  "/",
  verifyToken,
  allowRoles(["admin", "adiestrador"]),
  async (req, res) => {
    try {
      const { status = "all", email = "", limit = 300 } = req.query;
      const where = [];
      const params = [];

      if (status && status !== "all") {
        where.push("status = ?");
        params.push(String(status));
      }
      if (email) {
        where.push("email = ?");
        params.push(String(email).trim());
      }

      const sql = `
      SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
             servicio_id AS servicioId, servicio_titulo AS servicioTitulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id AS paqueteId,
             status, origin, user_note AS userNote, admin_note AS adminNote, cancel_reason AS cancelReason,
             trainer_id AS trainerId,
             created_at AS createdAt, updated_at AS updatedAt
        FROM reservas
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY fecha DESC, hora DESC
       LIMIT ?`;
      params.push(Math.min(Number(limit || 300), 1000));

      const rows = await query(sql, params);

      await autoExpireIfPast(rows);

      res.json(
        rows.map((r) => ({
          ...r,
          pricing: parseJSONSafe(r.pricing, null),
        }))
      );
    } catch (e) {
      console.error("GET /reservas", e);
      res.status(500).json({ error: "No se pudo obtener reservas" });
    }
  }
);

/* ===================== NOTAS TIPO HILO ===================== */

// GET /api/reservas/:id/notes
router.get("/:id/notes", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const perm = await canSeeReservation(req, id);
    if (!perm.ok) return res.status(403).json({ error: "Sin permisos" });

    const rows = await query(
      `SELECT id, author, text, created_at AS createdAt
         FROM reserva_notas
        WHERE reserva_id=? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [id]
    );

    res.json(rows);
  } catch (e) {
    console.error("GET /reservas/:id/notes", e);
    res.status(500).json({ error: "No se pudieron obtener notas" });
  }
});

// POST /api/reservas/:id/notes
router.post("/:id/notes", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text = "" } = req.body || {};

    const perm = await canSeeReservation(req, id);
    if (!perm.ok) return res.status(403).json({ error: "Sin permisos" });

    const rol = req.user?.rol || req.user?.role || "user";

    let author = "user";
    if (rol === "adiestrador") {
      author = "admin";
    } else if (req.user?.isAdmin || rol === "admin") {
      author = "admin";
    }

    const nid = uuidv4();
    const ts = nowISO();

    await query(
      `INSERT INTO reserva_notas (id, reserva_id, author, text, created_at)
         VALUES (?,?,?,?,?)`,
      [nid, id, author, String(text).trim(), ts]
    );

    res.status(201).json({ id: nid, author, text: String(text).trim(), createdAt: ts });
  } catch (e) {
    console.error("POST /reservas/:id/notes", e);
    res.status(500).json({ error: "No se pudo crear nota" });
  }
});

// DELETE /api/reservas/:id/notes/:noteId
router.delete("/:id/notes/:noteId", verifyToken, async (req, res) => {
  try {
    const { id, noteId } = req.params;

    const perm = await canSeeReservation(req, id);
    if (!perm.ok) return res.status(403).json({ error: "Sin permisos" });

    const row = (
      await query(
        `SELECT id, author
           FROM reserva_notas
          WHERE id=? AND reserva_id=? AND deleted_at IS NULL
          LIMIT 1`,
        [noteId, id]
      )
    )[0];

    if (!row) return res.status(404).json({ error: "Nota no encontrada" });

    const rol = req.user?.rol || req.user?.role || "user";
    const isStaff = req.user?.isAdmin || rol === "admin" || rol === "adiestrador";

    if (!(isStaff || row.author === "user")) {
      return res.status(403).json({ error: "No puedes borrar esta nota" });
    }

    await query(`UPDATE reserva_notas SET deleted_at=? WHERE id=?`, [nowISO(), noteId]);

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /reservas/:id/notes/:noteId", e);
    res.status(500).json({ error: "No se pudo borrar la nota" });
  }
});

/* ===================== Acciones directas (Admin / Adiestrador) ===================== */

// PATCH /api/reservas/:id/confirm  (CONFIRMA EL CENTRO → pasa a pending_user)
router.patch(
  "/:id/confirm",
  verifyToken,
  allowRoles(["admin", "adiestrador"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { note = "" } = req.body || {};
      await query(
        `UPDATE reservas
          SET status='pending_user',
              admin_note=COALESCE(?,admin_note),
              updated_at=?
        WHERE id=?`,
        [note, nowISO(), id]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error("PATCH /reservas/:id/confirm", e);
      res.status(500).json({ error: "No se pudo confirmar" });
    }
  }
);

// PATCH /api/reservas/:id/reject (centro)
router.patch(
  "/:id/reject",
  verifyToken,
  allowRoles(["admin", "adiestrador"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { note = "" } = req.body || {};

      const rRows = await query(
        `SELECT id, paquete_id AS paqueteId, status
         FROM reservas WHERE id=? LIMIT 1`,
        [id]
      );
      if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });
      const r = rRows[0];

      if (r.paqueteId) {
        await tx(async () => {
          await query(
            `UPDATE reservas
              SET status='rejected',
                  admin_note=COALESCE(?,admin_note),
                  updated_at=?
            WHERE id=?`,
            [note, nowISO(), id]
          );
          const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [
            r.paqueteId,
          ]);
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
            if (["pending", "pending_user", "confirmed"].includes(r.status)) {
              saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
            }
            await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
              JSON.stringify(saldo),
              nowISO(),
              r.paqueteId,
            ]);
          }
        });
      } else {
        await query(
          `UPDATE reservas
            SET status='rejected',
                admin_note=COALESCE(?,admin_note),
                updated_at=?
         WHERE id=?`,
          [note, nowISO(), id]
        );
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("PATCH /reservas/:id/reject", e);
      res.status(500).json({ error: "No se pudo rechazar" });
    }
  }
);

/* ===== Acciones del USUARIO después de que el centro confirma ===== */

// PATCH /api/reservas/:id/user-confirm  (usuario acepta → confirmed)
router.patch("/:id/user-confirm", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const rRows = await query(
      `SELECT id, uid, email, status, trainer_id AS trainerId
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });

    const r = rRows[0];
    const isOwner =
      (r.uid && req.user?.uid && r.uid === req.user.uid) ||
      (r.email && req.user?.email && r.email === req.user.email);
    if (!isOwner) return res.status(403).json({ error: "Sin permisos" });

    if (String(r.status) !== "pending_user") {
      return res.status(400).json({
        error: "La reserva no está pendiente de confirmación por el usuario",
      });
    }

    if (!r.trainerId) {
      return res.status(400).json({ error: "La reserva no tiene trainer asignado" });
    }

    await query(`UPDATE reservas SET status='confirmed', updated_at=? WHERE id=?`, [nowISO(), id]);

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /reservas/:id/user-confirm", e);
    res.status(500).json({ error: "No se pudo confirmar la reserva" });
  }
});

// PATCH /api/reservas/:id/user-reject  (usuario rechaza → cancelled)
router.patch("/:id/user-reject", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "" } = req.body || {};

    const rRows = await query(
      `SELECT id, uid, email, paquete_id AS paqueteId, status, fecha, hora
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });
    const r = rRows[0];

    const isOwner =
      (r.uid && req.user?.uid && r.uid === req.user.uid) ||
      (r.email && req.user?.email && r.email === req.user.email);
    if (!isOwner) return res.status(403).json({ error: "Sin permisos" });

    if (String(r.status) !== "pending_user") {
      return res.status(400).json({
        error: "La reserva no está pendiente de confirmación por el usuario",
      });
    }

    if (!puedeCancelar24h(r.fecha, r.hora)) {
      return res.status(400).json({ error: "No se puede rechazar con menos de 24h" });
    }

    if (r.paqueteId) {
      await tx(async () => {
        await query(
          `UPDATE reservas
              SET status='cancelled',
                  cancel_reason=COALESCE(?,cancel_reason),
                  updated_at=?
            WHERE id=?`,
          [reason || "rechazado por usuario", nowISO(), id]
        );
        const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [
          r.paqueteId,
        ]);
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
          if (["pending", "pending_user", "confirmed"].includes(r.status)) {
            saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
          }
          await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
            JSON.stringify(saldo),
            nowISO(),
            r.paqueteId,
          ]);
        }
      });
    } else {
      await query(
        `UPDATE reservas
            SET status='cancelled',
                cancel_reason=COALESCE(?,cancel_reason),
                updated_at=?
         WHERE id=?`,
        [reason || "rechazado por usuario", nowISO(), id]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /reservas/:id/user-reject", e);
    res.status(500).json({ error: "No se pudo rechazar la reserva" });
  }
});

/* ===================== Cancelar (owner o admin) ===================== */

// PATCH /api/reservas/:id/cancel (owner o admin)
router.patch("/:id/cancel", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "" } = req.body || {};

    const rRows = await query(
      `SELECT id, uid, email, paquete_id AS paqueteId, status, fecha, hora
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });
    const r = rRows[0];

    const rol = req.user?.rol || req.user?.role || "user";
    const isAdmin = !!req.user?.isAdmin || rol === "admin";
    const isOwner =
      (r.uid && req.user?.uid && r.uid === req.user.uid) ||
      (r.email && req.user?.email && r.email === req.user.email);

    if (!isAdmin && !isOwner) return res.status(403).json({ error: "Sin permisos" });

    if (!isAdmin && !puedeCancelar24h(r.fecha, r.hora)) {
      return res.status(400).json({ error: "No se puede cancelar con menos de 24h" });
    }

    if (r.paqueteId) {
      await tx(async () => {
        await query(
          `UPDATE reservas
              SET status='cancelled',
                  cancel_reason=COALESCE(?,cancel_reason),
                  updated_at=?
            WHERE id=?`,
          [reason || null, nowISO(), id]
        );
        const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [
          r.paqueteId,
        ]);
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
          if (["pending", "pending_user", "confirmed"].includes(r.status)) {
            saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
          }
          await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
            JSON.stringify(saldo),
            nowISO(),
            r.paqueteId,
          ]);
        }
      });
    } else {
      await query(
        `UPDATE reservas
            SET status='cancelled',
                cancel_reason=COALESCE(?,cancel_reason),
                updated_at=?
         WHERE id=?`,
        [reason || null, nowISO(), id]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /reservas/:id/cancel", e);
    res.status(500).json({ error: "No se pudo cancelar" });
  }
});

// DELETE /api/reservas/:id (solo admin)
router.delete("/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const rRows = await query(
      `SELECT id, paquete_id AS paqueteId, status
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });
    const r = rRows[0];

    const st = String(r.status || "").toLowerCase();
    const puedeBorrar =
      st === "cancelled" ||
      st === "cancelada" ||
      st === "rejected" ||
      st === "rechazada" ||
      st === "deleted" ||
      st === "eliminada";

    if (!puedeBorrar) {
      return res.status(400).json({
        error: "Solo se pueden borrar reservas canceladas o rechazadas",
      });
    }

    await query(`DELETE FROM reservas WHERE id=?`, [id]);

    res.json({ ok: true, id });
  } catch (e) {
    console.error("DELETE /reservas/:id", e);
    res.status(500).json({ error: "No se pudo eliminar" });
  }
});

/* ===================== Admin: cambiar trainer asignado (2.5) ===================== */
// PATCH /api/reservas/:id/trainer  (solo admin)
router.patch("/:id/trainer", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { trainerId, mode } = req.body || {};

    const r = (
      await query(
        `SELECT id,
                servicio_id AS servicioId,
                modalidad,
                fecha,
                hora,
                COALESCE(duration_min,60) AS durationMin
           FROM reservas
          WHERE id=? LIMIT 1`,
        [id]
      )
    )[0];

    if (!r) return res.status(404).json({ error: "Reserva no encontrada" });

    const servicioId = r.servicioId;
    const modalidad = mode ?? r.modalidad;

    const trainerIdFinal = await resolveTrainerIdOrFail({ trainerId, servicioId, modalidad });

    // Si se asigna un trainer, aseguramos que está disponible para esa franja.
    if (trainerIdFinal) {
      const ok = await isTrainerAvailableForSlot({
        trainerId: trainerIdFinal,
        fecha: r.fecha,
        hora: r.hora,
        durationMin: r.durationMin || 60,
        excludeReservaId: id,
      });
      if (!ok) {
        const err = new Error("Adiestrador no disponible para esa fecha/hora");
        err.statusCode = 409;
        throw err;
      }
    }

    await query(`UPDATE reservas SET trainer_id=?, updated_at=? WHERE id=?`, [
      trainerIdFinal,
      nowISO(),
      id,
    ]);

    res.json({ ok: true, trainerId: trainerIdFinal });
  } catch (e) {
    const code = e?.statusCode || 500;
    console.error("PATCH /reservas/:id/trainer", e);
    res.status(code).json({ error: e?.message || "No se pudo cambiar el trainer" });
  }
});

/* ===== PATCH genérico (para notas/admin desde el front) ===== */
router.patch("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote = null, adminNoteAppend = false, cancelReason = null } = req.body || {};
    if (!status && adminNote === null) return res.status(400).json({ error: "Nada que actualizar" });

    const rol = req.user?.rol || req.user?.role || "user";
    const isAdmin = !!req.user?.isAdmin || rol === "admin";
    const isTrainer = rol === "adiestrador";
    const isStaff = isAdmin || isTrainer;

    if (status === "confirmed" && isStaff) {
      await query(
        `UPDATE reservas
            SET status='pending_user',
                admin_note=COALESCE(?,admin_note),
                updated_at=?
         WHERE id=?`,
        [adminNote || "", nowISO(), id]
      );
      return res.json({ ok: true });
    }

    if (status === "rejected" && isStaff) {
      const rRows = await query(
        `SELECT id, paquete_id AS paqueteId, status
           FROM reservas WHERE id=? LIMIT 1`,
        [id]
      );
      if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });
      const r = rRows[0];

      if (r.paqueteId) {
        await tx(async () => {
          await query(
            `UPDATE reservas
                SET status='rejected',
                    admin_note=COALESCE(?,admin_note),
                    updated_at=?
             WHERE id=?`,
            [adminNote || "", nowISO(), id]
          );
          const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [
            r.paqueteId,
          ]);
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
            if (["pending", "pending_user", "confirmed"].includes(r.status)) {
              saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
            }
            await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
              JSON.stringify(saldo),
              nowISO(),
              r.paqueteId,
            ]);
          }
        });
      } else {
        await query(
          `UPDATE reservas
              SET status='rejected',
                  admin_note=COALESCE(?,admin_note),
                  updated_at=?
           WHERE id=?`,
          [adminNote || "", nowISO(), id]
        );
      }
      return res.json({ ok: true });
    }

    if (status === "cancelled") {
      const rRows = await query(
        `SELECT id, uid, email, paquete_id AS paqueteId, status, fecha, hora
           FROM reservas WHERE id=? LIMIT 1`,
        [id]
      );
      if (!rRows.length) return res.status(404).json({ error: "Reserva no encontrada" });
      const r = rRows[0];

      const isOwner =
        (r.uid && req.user?.uid && r.uid === req.user.uid) ||
        (r.email && req.user?.email && r.email === req.user.email);
      if (!isAdmin && !isOwner) return res.status(403).json({ error: "Sin permisos para cancelar" });

      if (!isAdmin && !puedeCancelar24h(r.fecha, r.hora)) {
        return res.status(400).json({ error: "No se puede cancelar con menos de 24h" });
      }

      if (r.paqueteId) {
        await tx(async () => {
          await query(
            `UPDATE reservas
                SET status='cancelled',
                    cancel_reason=COALESCE(?,cancel_reason),
                    updated_at=?
             WHERE id=?`,
            [cancelReason || "", nowISO(), id]
          );
          const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [
            r.paqueteId,
          ]);
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
            if (["pending", "pending_user", "confirmed"].includes(r.status)) {
              saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
            }
            await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [
              JSON.stringify(saldo),
              nowISO(),
              r.paqueteId,
            ]);
          }
        });
      } else {
        await query(
          `UPDATE reservas
              SET status='cancelled',
                  cancel_reason=COALESCE(?,cancel_reason),
                  updated_at=?
           WHERE id=?`,
          [cancelReason || "", nowISO(), id]
        );
      }
      return res.json({ ok: true });
    }

    if (isStaff && adminNote !== null) {
      if (adminNoteAppend) {
        await query(
          `UPDATE reservas
              SET admin_note = TRIM(
                    COALESCE(admin_note,'') ||
                    CASE
                      WHEN ?<>'' THEN
                        CASE
                          WHEN admin_note IS NULL OR admin_note=''
                            THEN ?
                          ELSE ' · '||?
                        END
                      ELSE ''
                    END
                  ),
                  updated_at = ?
            WHERE id = ?`,
          [adminNote, adminNote, adminNote, nowISO(), id]
        );
      } else {
        await query(`UPDATE reservas SET admin_note=?, updated_at=? WHERE id=?`, [
          adminNote,
          nowISO(),
          id,
        ]);
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Status no permitido" });
  } catch (e) {
    console.error("PATCH /reservas/:id (generic)", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

/* ===================== Bloqueos ===================== */
// POST /api/reservas/bloqueos
router.post("/bloqueos", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { fecha, hora } = req.body;
    if (!fecha || !hora) return res.status(400).json({ error: "Faltan campos" });

    await query(`INSERT INTO bloqueos (id, fecha, hora, created_at) VALUES (?,?,?,?)`, [
      uuidv4(),
      fecha,
      hora,
      nowISO(),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /reservas/bloqueos", e);
    res.status(500).json({ error: "No se pudo crear bloqueo" });
  }
});

// DELETE /api/reservas/bloqueos?fecha=YYYY-MM-DD&hora=HH:MM
router.delete("/bloqueos", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { fecha, hora } = req.query;
    if (!fecha || !hora) return res.status(400).json({ error: "Faltan fecha y hora" });

    const rows = await query(`SELECT id FROM bloqueos WHERE fecha=? AND hora=?`, [fecha, hora]);
    if (!rows.length) return res.status(404).json({ error: "Bloqueo no encontrado." });

    await query(`DELETE FROM bloqueos WHERE fecha=? AND hora=?`, [fecha, hora]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /reservas/bloqueos", e);
    res.status(500).json({ error: "No se pudo eliminar el bloqueo." });
  }
});


/* ===================== Extensiones agenda (adiestrador) ===================== */
// Monta POST /api/reservas/trainer-create (y otros endpoints del adiestrador)
router.use(trainerAgendaRoutes);

export default router;
