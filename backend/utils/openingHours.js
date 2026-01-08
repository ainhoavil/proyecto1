// backend/utils/openingHours.js
// Reglas de horario del centro + helpers de fecha/hora (Europe/Madrid)

const MADRID_TZ = "Europe/Madrid";

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function dayOfWeekFromISODate(fechaISO) {
  // fechaISO: YYYY-MM-DD
  // Usamos UTC para evitar desplazamientos por zona horaria (el DOW es estable para una fecha civil).
  const m = String(fechaISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0)); // mediodía UTC para robustez
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getUTCDay(); // 0=domingo ... 6=sábado
}

export function validateReservationSlot(fecha, hora) {
  const fechaISO = String(fecha || "").trim();
  const dow = dayOfWeekFromISODate(fechaISO);
  if (dow == null) return { ok: false, code: "BAD_DATE", message: "Fecha inválida (YYYY-MM-DD)" };

  if (dow === 0) {
    return { ok: false, code: "NO_SUNDAY", message: "No se puede reservar los domingos" };
  }

  // Sábado: última hora permitida 13:00 (incluida)
  if (dow === 6) {
    const [hRaw, mRaw = "0"] = String(hora || "00:00").split(":");
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      return { ok: false, code: "BAD_TIME", message: "Hora inválida (HH:MM)" };
    }
    const minutes = h * 60 + m;
    if (minutes > 13 * 60) {
      return {
        ok: false,
        code: "SAT_AFTER_13",
        message: "Los sábados la última hora de reserva es a las 13:00",
      };
    }
  }

  return { ok: true };
}

export function filterHourSlotsForFecha(fecha, slots) {
  const dow = dayOfWeekFromISODate(String(fecha || "").trim());
  if (dow == null) return Array.isArray(slots) ? slots : [];

  if (dow === 0) return []; // domingo cerrado

  if (dow === 6) {
    const arr = Array.isArray(slots) ? slots : [];
    return arr.filter((s) => {
      const [hRaw, mRaw = "0"] = String(s || "").split(":");
      const h = Number(hRaw);
      const m = Number(mRaw);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
      return h * 60 + m <= 13 * 60;
    });
  }

  return Array.isArray(slots) ? slots : [];
}

export function madridNowParts() {
  const dt = new Date();
  // Extraemos partes en Europe/Madrid via Intl (evita depender del TZ del servidor)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(dt);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");

  const dateISO = y && mo && d ? `${y}-${mo}-${d}` : null;
  const timeHHMM = h && mi ? `${pad2(h)}:${pad2(mi)}` : null;

  return { dateISO, timeHHMM };
}

export function nowMadridDateISO() {
  return madridNowParts().dateISO;
}

export function nowMadridTimeHHMM() {
  return madridNowParts().timeHHMM;
}

export function isFutureOrTodayNotPassed({ fecha, hora, allDay = false }) {
  const today = nowMadridDateISO();
  const nowTime = nowMadridTimeHHMM();
  if (!today || !nowTime) return true; // fallback: no filtramos

  const f = String(fecha || "").trim();
  if (!f) return false;

  if (f > today) return true;
  if (f < today) return false;

  // hoy
  if (allDay) return true;
  const h = String(hora || "").trim();
  if (!h) return true; // si no hay hora, lo tratamos como válido para hoy
  // Comparación lexicográfica segura si HH:MM tiene 0-padding
  return h >= nowTime;
}
