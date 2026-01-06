// backend/utils/availability.js
// Utilidades de disponibilidad por adiestrador y modo "ANY" (cualquiera).
// Diseñado para ser tolerante a variaciones de esquema en Turso/libSQL.

import { query } from "../db.js";

const ACTIVE_STATUSES = new Set([
  "pending",
  "pending_user",
  "confirmed",
  // compatibilidad histórica
  "pendiente",
  "pendiente_usuario",
]);

let _reservasColsCache = null;
let _bloqueosColsCache = null;

function toLowerSet(cols) {
  return new Set((cols || []).map((c) => String(c || "").toLowerCase()));
}

async function getTableCols(table) {
  const rows = await query(`PRAGMA table_info(${table})`);
  return (rows || []).map((r) => r?.name).filter(Boolean);
}

async function getReservasCols() {
  if (_reservasColsCache) return _reservasColsCache;
  try {
    _reservasColsCache = await getTableCols("reservas");
  } catch {
    _reservasColsCache = [];
  }
  return _reservasColsCache;
}

async function getBloqueosCols() {
  if (_bloqueosColsCache) return _bloqueosColsCache;
  try {
    _bloqueosColsCache = await getTableCols("bloqueos");
  } catch {
    _bloqueosColsCache = [];
  }
  return _bloqueosColsCache;
}

function pickCol(cols, candidates) {
  const map = new Map();
  for (const col of cols || []) {
    map.set(String(col).toLowerCase(), col);
  }
  for (const cand of candidates || []) {
    const hit = map.get(String(cand).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function qIdent(name) {
  if (!name) return null;
  return `"${String(name).replace(/"/g, '""')}"`;
}

export function padHHMM(x) {
  if (x == null) return x;
  const s = String(x).trim();
  if (!s) return s;
  // admite "HH:MM" o "HH:MM:SS"
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  // admite "9:00" -> "09:00"
  if (/^\d{1}:\d{2}$/.test(s)) return `0${s}`;
  return s;
}

function toMin(hhmm) {
  const [h, m = 0] = String(hhmm || "00:00").split(":").map(Number);
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}

function overlaps(aStart, aDur, bStart, bDur) {
  const a0 = toMin(aStart);
  const a1 = a0 + Number(aDur || 60);
  const b0 = toMin(bStart);
  const b1 = b0 + Number(bDur || 60);
  return a0 < b1 && b0 < a1;
}

function isAllDayBlock(row) {
  // Si "hora" no existe o viene vacío/null, lo tratamos como día completo
  const hora = padHHMM(row?.hora);
  if (!hora) return true;

  // flags comunes
  const flags = [
    row?.all_day,
    row?.allDay,
    row?.is_all_day,
    row?.isAllDay,
    row?.full_day,
    row?.fullDay,
    row?.dia_completo,
    row?.diaCompleto,
  ];
  if (flags.some((v) => v === 1 || v === true || String(v) === "1")) return true;

  const t = String(row?.tipo || row?.type || "").toLowerCase();
  if (t && (t.includes("day") || t.includes("dia") || t.includes("allday"))) return true;

  return false;
}

export async function listAllTrainerIds() {
  const rows = await query(
    `SELECT id FROM usuarios WHERE rol = 'adiestrador' ORDER BY id ASC`
  );
  return (rows || []).map((r) => String(r?.id || "").trim()).filter(Boolean);
}

export async function listEligibleTrainerIds({ servicioId, modalidad }) {
  const mod = modalidad ? String(modalidad) : null;
  if (!servicioId) return await listAllTrainerIds();

  try {
    const rows = await query(
      `
      SELECT DISTINCT u.id AS id
        FROM usuarios u
        JOIN trainer_servicios ts ON ts.trainer_id = u.id
       WHERE u.rol = 'adiestrador'
         AND ts.enabled = 1
         AND ts.servicio_id = ?
         AND (
           ts.modalidad IS NULL
           OR ts.modalidad = ''
           OR ? IS NULL
           OR ts.modalidad = ?
         )
       ORDER BY u.id ASC
      `,
      [String(servicioId), mod, mod]
    );

    const ids = (rows || [])
      .map((r) => String(r?.id || "").trim())
      .filter(Boolean);
    if (ids.length) return ids;
  } catch {
    // ignore
  }

  // fallback
  return await listAllTrainerIds();
}

export async function buildAvailabilityIndex({ fecha, excludeReservaId = null }) {
  const f = String(fecha || "").slice(0, 10);
  if (!f) {
    return {
      fecha: f,
      globalAllDay: false,
      globalBlocks: new Set(),
      trainerAllDay: new Set(),
      trainerBlocks: new Map(),
      reservasByTrainer: new Map(),
      unassignedReservas: [],
    };
  }

  // --- Bloqueos
  let bloqueos = [];
  try {
    // leemos * para tolerancia a esquema; filtramos en memoria
    bloqueos = await query(`SELECT * FROM bloqueos WHERE fecha = ?`, [f]);
  } catch {
    bloqueos = [];
  }

  const globalBlocks = new Set();
  const trainerBlocks = new Map();
  const trainerAllDay = new Set();
  let globalAllDay = false;

  // resolvemos nombre de columna trainer_id si existe
  const bCols = await getBloqueosCols();
  const bTrainerCol = pickCol(bCols, ["trainer_id", "trainerId", "trainer"]) || null;

  for (const b of bloqueos || []) {
    const bt = bTrainerCol ? String(b?.[bTrainerCol] || "").trim() : "";
    const hora = padHHMM(b?.hora);
    const allDay = isAllDayBlock({ ...b, hora });
    const isGlobal = !bt;

    if (isGlobal) {
      if (allDay) {
        globalAllDay = true;
      } else if (hora) {
        globalBlocks.add(hora);
      }
    } else {
      if (allDay) {
        trainerAllDay.add(bt);
      } else if (hora) {
        if (!trainerBlocks.has(bt)) trainerBlocks.set(bt, new Set());
        trainerBlocks.get(bt).add(hora);
      }
    }
  }

  // --- Reservas
  const rCols = await getReservasCols();
  const trainerCol = pickCol(rCols, ["trainer_id", "trainerId"]) || "trainer_id";
  const fechaCol = pickCol(rCols, ["fecha"]) || "fecha";
  const horaCol = pickCol(rCols, ["hora"]) || "hora";
  const durationCol = pickCol(rCols, ["duration_min", "durationMin"]) || null;
  const statusCol = pickCol(rCols, ["status"]) || null;
  const idCol = pickCol(rCols, ["id"]) || "id";

  const select = [
    `${qIdent(idCol)} AS id`,
    `${qIdent(horaCol)} AS hora`,
    durationCol ? `COALESCE(${qIdent(durationCol)},60) AS durationMin` : `60 AS durationMin`,
    `${qIdent(trainerCol)} AS trainerId`,
  ];
  if (statusCol) select.push(`${qIdent(statusCol)} AS status`);

  const params = [f];
  let whereExclude = "";
  if (excludeReservaId) {
    whereExclude = ` AND ${qIdent(idCol)} <> ?`;
    params.push(String(excludeReservaId));
  }

  let reservas = [];
  try {
    reservas = await query(
      `
      SELECT ${select.join(", ")}
        FROM reservas
       WHERE ${qIdent(fechaCol)} = ?
       ${whereExclude}
      `,
      params
    );
  } catch {
    reservas = [];
  }

  const reservasByTrainer = new Map();
  const unassignedReservas = [];

  for (const r of reservas || []) {
    if (statusCol) {
      const st = String(r?.status || "").toLowerCase();
      if (!ACTIVE_STATUSES.has(st)) continue;
    }

    const tid = String(r?.trainerId || "").trim();
    const hora = padHHMM(r?.hora);
    const dur = Number(r?.durationMin || 60);
    if (!hora) continue;

    const item = { hora, durationMin: dur };
    if (!tid || tid === "any") {
      unassignedReservas.push(item);
      continue;
    }

    if (!reservasByTrainer.has(tid)) reservasByTrainer.set(tid, []);
    reservasByTrainer.get(tid).push(item);
  }

  return {
    fecha: f,
    globalAllDay,
    globalBlocks,
    trainerAllDay,
    trainerBlocks,
    reservasByTrainer,
    unassignedReservas,
  };
}

export function isTrainerAvailable(index, { trainerId, hora, durationMin = 60 }) {
  const tid = String(trainerId || "").trim();
  const h = padHHMM(hora);
  const dur = Number(durationMin || 60);
  if (!tid || !h) return true;

  if (index?.globalAllDay) return false;
  if (index?.trainerAllDay?.has(tid)) return false;

  // bloqueos globales por hora
  for (const bh of index?.globalBlocks || []) {
    if (overlaps(h, dur, bh, 60)) return false;
  }

  // bloqueos por trainer por hora
  const tb = index?.trainerBlocks?.get(tid);
  if (tb) {
    for (const bh of tb) {
      if (overlaps(h, dur, bh, 60)) return false;
    }
  }

  // reservas del trainer
  const rr = index?.reservasByTrainer?.get(tid) || [];
  for (const r of rr) {
    if (overlaps(h, dur, r.hora, r.durationMin)) return false;
  }

  return true;
}

export function getAnyAvailability(index, { eligibleTrainerIds, hora, durationMin = 60 }) {
  const ids = Array.isArray(eligibleTrainerIds)
    ? eligibleTrainerIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const h = padHHMM(hora);
  const dur = Number(durationMin || 60);
  if (!h) {
    return {
      isAvailableAny: true,
      availableCount: ids.length,
      freeTrainerCount: ids.length,
      floatingCount: 0,
    };
  }

  if (index?.globalAllDay) {
    return {
      isAvailableAny: false,
      availableCount: 0,
      freeTrainerCount: 0,
      floatingCount: 0,
    };
  }

  let freeTrainerCount = 0;
  for (const tid of ids) {
    if (isTrainerAvailable(index, { trainerId: tid, hora: h, durationMin: dur })) {
      freeTrainerCount += 1;
    }
  }

  // Reservas sin trainer asignado ("floating capacity")
  let floatingCount = 0;
  for (const r of index?.unassignedReservas || []) {
    if (overlaps(h, dur, r.hora, r.durationMin)) floatingCount += 1;
  }

  const availableCount = Math.max(0, freeTrainerCount - floatingCount);
  return {
    isAvailableAny: availableCount > 0,
    availableCount,
    freeTrainerCount,
    floatingCount,
  };
}
