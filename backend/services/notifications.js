// backend/services/notifications.js
// Notificaciones por email (reservas, notas, chat)
// - Se ejecutan en modo "best-effort": nunca deben romper la API
// - Si el mailer no está configurado, imprime un DEV LOG
import { query } from "../db.js";
import { sendReservationEmail, sendChatEmail } from "../utils/mailer.js";

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeStr(v) {
  return v == null ? "" : String(v);
}

function short(v, max = 180) {
  const s = safeStr(v).trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function money(price, currency) {
  const p = price == null ? "" : String(price);
  const c = safeStr(currency || "EUR").toUpperCase();
  if (!p) return "";
  return `${p} ${c}`;
}
// CHAT EMAIL THROTTLE (1 email / día / cliente)
// - Requisito: cuando el adiestrador envía mensajes, no saturar
let chatThrottleEnsured = false;

function getMadridDayStr(now = new Date()) {
  try {
    // YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // Fallback UTC
    return now.toISOString().slice(0, 10);
  }
}

async function ensureChatThrottleTable() {
  if (chatThrottleEnsured) return;
  await query(
    `
      CREATE TABLE IF NOT EXISTS chat_email_throttle (
        recipient_id TEXT PRIMARY KEY,
        last_sent_day TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  );
  chatThrottleEnsured = true;
}

async function getUserById(uid) {
  const id = safeStr(uid).trim();
  if (!id) return null;
  const rows = await query(
    `
      SELECT
        u.id,
        u.email,
        u.rol,
        COALESCE(us.nombre, '') AS nombre
      FROM usuarios u
      LEFT JOIN users us ON us.uid = u.id
      WHERE u.id = ?
      LIMIT 1
    `,
    [id]
  );
  return rows[0] || null;
}

async function listAdminEmails() {
  // Devuelve una lista de emails de administradores (pueden ser varios)
  // - Best-effort: si la tabla no existe o falla, devuelve []
  // - Dedupe y normaliza
  const out = new Set();

  // 1) Variable de entorno opcional (para instalaciones con 1 admin fijo)
  const envAdmin = normEmail(process.env.ADMIN_EMAIL || process.env.APP_ADMIN_EMAIL || "");
  if (envAdmin) out.add(envAdmin);

  try {
    const rows = await query(
      `SELECT email
         FROM usuarios
        WHERE LOWER(rol) = 'admin'
          AND email IS NOT NULL
          AND TRIM(email) <> ''`
    );
    for (const r of rows || []) {
      const e = normEmail(r?.email);
      if (e) out.add(e);
    }
  } catch {
    // ignore
  }

  return Array.from(out);
}

async function getReservaById(reservaId) {
  const id = safeStr(reservaId).trim();
  if (!id) return null;

  const rows = await query(
    `
      SELECT
        id,
        uid,
        email,
        fecha,
        hora,
        COALESCE(duration_min, 60) AS durationMin,
        servicio_titulo AS servicioTitulo,
        modalidad,
        perro,
        price,
        currency,
        user_note AS userNote,
        admin_note AS adminNote,
        cancel_reason AS cancelReason,
        status,
        origin,
        COALESCE(trainer_id, entrenador_id) AS trainerId
      FROM reservas
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

function formatPerroField(perroVal) {
  if (perroVal == null) return "";
  // Si ya viene como array/objeto
  if (Array.isArray(perroVal)) {
    const names = perroVal
      .map((p) => {
        if (!p) return "";
        if (typeof p === "string") return p.trim();
        if (typeof p === "object") return safeStr(p.nombre || p.name).trim();
        return "";
      })
      .filter(Boolean);
    return names.join(", ");
  }
  if (typeof perroVal === "object") {
    const n = safeStr(perroVal.nombre || perroVal.name).trim();
    return n;
  }

  // String (a veces llega como JSON serializado)
  const s = safeStr(perroVal).trim();
  if (!s) return "";

  const looksJson =
    (s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"));
  if (looksJson) {
    try {
      return formatPerroField(JSON.parse(s));
    } catch {
      // ignore
    }
  }

  // Intento extra: JSON con comillas simples
  if (s.includes("nombre") && (s.includes("{") || s.includes("["))) {
    try {
      return formatPerroField(JSON.parse(s.replace(/'/g, '"')));
    } catch {
      // ignore
    }
  }

  return s;
}

function buildReservaLines(r) {
  if (!r) return [];
  const lines = [];
  lines.push(`Fecha: ${r.fecha} · Hora: ${r.hora}`);
  if (r.servicioTitulo) lines.push(`Servicio: ${r.servicioTitulo}`);
  if (r.durationMin) lines.push(`Duración: ${r.durationMin} min`);
  if (r.modalidad) lines.push(`Modalidad: ${r.modalidad}`);
  if (r.price != null) lines.push(`Precio: ${r.price} ${r.currency || "EUR"}`);

  const perros = formatPerroField(r.perro);
  if (perros) lines.push(`Perro(s): ${perros}`);

  if (r.trainerName) lines.push(`Adiestrador: ${r.trainerName}`);

  return lines;
}

async function safeRun(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(`[notify] ${label} falló:`, e?.message || e);
  }
}
// RESERVAS
export async function notifyReservationCreated(reservaId) {
  await safeRun("notifyReservationCreated", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    if (!clientEmail) return;

    const status = String(r.status || "").toLowerCase();
    const origin = String(r.origin || "").toLowerCase();
    const needsUserAccept = status === "pending_user" || origin === "admin";

    // Resolver trainer (si hay)
    const trainer = r.trainerId ? await getUserById(r.trainerId) : null;
    const trainerEmail = normEmail(trainer?.email);
    const trainerName =
      safeStr(trainer?.nombre || trainer?.name || trainer?.displayName || trainer?.email || "")
        .trim() || safeStr(r.trainerName || "").trim();

    // 1) Cliente
    if (needsUserAccept) {
      await sendReservationEmail({
        to: clientEmail,
        subject: `${appName} · Confirma tu reserva`,
        title: "Reserva pendiente de tu confirmación",
        intro:
          "El centro ha creado/confirmado una reserva. Entra en DogForm para aceptarla o rechazarla.",
        lines: buildReservaLines({ ...r, trainerName }),
        actionPath: "/reservas",
        actionText: "Ir a mis reservas",
      });
    } else {
      await sendReservationEmail({
        to: clientEmail,
        subject: `${appName} · Reserva recibida`,
        title: "Reserva recibida",
        intro:
          "Hemos recibido tu solicitud. Te avisaremos cuando el centro la confirme.",
        lines: buildReservaLines({ ...r, trainerName }),
        actionPath: "/reservas",
        actionText: "Ver mis reservas",
      });
    }

    // 2) Adiestrador (si aplica)
    if (trainerEmail) {
      const who = trainerName ? `Hola ${trainerName},` : "Hola,";
      const pendingTxt = needsUserAccept
        ? " (pendiente de aceptación del cliente)"
        : " (pendiente)";

      await sendReservationEmail({
        to: trainerEmail,
        subject: `${appName} · Nueva reserva asignada`,
        title: "Nueva reserva asignada",
        intro: `${who} se te ha asignado una nueva reserva${pendingTxt}.`,
        lines: [...buildReservaLines({ ...r, trainerName }), `Cliente: ${clientEmail}`],
        actionPath: "/trainer-agenda",
        actionText: "Ver agenda",
      });
    }
  });
}

export async function notifyReservationCenterConfirmed(reservaId, { note } = {}) {
  await safeRun("notifyReservationCenterConfirmed", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    if (!clientEmail) return;

    const n = short(note || r.adminNote, 240);
    const extra = n ? [`Nota del centro: ${n}`] : [];

    await sendReservationEmail({
      to: clientEmail,
      subject: `${appName} · Confirma tu reserva`,
      title: "Reserva pendiente de tu confirmación",
      intro:
        "El centro ha confirmado tu solicitud. Entra en DogForm para aceptar o rechazar la reserva.",
      lines: [...buildReservaLines(r), ...extra].filter(Boolean),
      actionPath: "/reservas",
      actionText: "Ir a mis reservas",
    });
  });
}

// El centro confirma una reserva creada por el cliente (confirmación final, sin pedir más acciones)
export async function notifyReservationCenterApproved(reservaId, { note } = {}) {
  await safeRun("notifyReservationCenterApproved", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    if (!clientEmail) return;

    const n = short(note || r.adminNote, 240);
    const extra = n ? [`Nota del centro: ${n}`] : [];

    await sendReservationEmail({
      to: clientEmail,
      subject: `${appName} · Reserva confirmada`,
      title: "Reserva confirmada",
      intro: "El centro ha confirmado tu reserva.",
      lines: [...buildReservaLines(r), ...extra].filter(Boolean),
      actionPath: "/reservas",
      actionText: "Ver mis reservas",
    });
  });
}

export async function notifyReservationUserConfirmed(reservaId) {
  await safeRun("notifyReservationUserConfirmed", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    const trainer = r.trainerId ? await getUserById(r.trainerId) : null;
    const trainerEmail = normEmail(trainer?.email);

    const lines = buildReservaLines(r);
    if (trainer?.nombre) lines.push(`Adiestrador/a: ${trainer.nombre}`);

    if (clientEmail) {
      await sendReservationEmail({
        to: clientEmail,
        subject: `${appName} · Reserva confirmada`,
        title: "Reserva confirmada",
        intro: "Tu reserva ha quedado confirmada.",
        lines,
        actionPath: "/reservas",
        actionText: "Ver detalle",
      });
    }

    if (trainerEmail) {
      await sendReservationEmail({
        to: trainerEmail,
        subject: `${appName} · Reserva confirmada (cliente aceptó)`,
        title: "Reserva confirmada",
        intro: "El cliente ha confirmado la reserva.",
        lines: [
          ...lines,
          clientEmail ? `Cliente: ${clientEmail}` : "",
        ].filter(Boolean),
        actionPath: "/trainer-agenda",
        actionText: "Ver agenda",
      });
    }
  });
}

export async function notifyReservationRejected(reservaId, { note } = {}) {
  await safeRun("notifyReservationRejected", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    if (!clientEmail) return;

    const n = short(note || r.adminNote, 240);
    const extra = n ? [`Motivo/nota: ${n}`] : [];

    await sendReservationEmail({
      to: clientEmail,
      subject: `${appName} · Reserva rechazada`,
      title: "Reserva rechazada",
      intro:
        "El centro ha rechazado tu solicitud de reserva. Puedes crear una nueva reserva en otro horario.",
      lines: [...buildReservaLines(r), ...extra].filter(Boolean),
      actionPath: "/contratar",
      actionText: "Reservar otra hora",
    });

const trainer = r.trainerId ? await getUserById(r.trainerId) : null;
const trainerEmail = normEmail(trainer?.email);
if (trainerEmail) {
  await sendReservationEmail({
    to: trainerEmail,
    subject: `${appName} · Reserva rechazada`,
    title: "Reserva rechazada",
    intro: "El centro ha rechazado una reserva asignada a ti.",
    lines: [
      ...buildReservaLines(r),
      ...extra,
      clientEmail ? `Cliente: ${clientEmail}` : "",
    ].filter(Boolean),
    actionPath: "/trainer-agenda",
    actionText: "Ver agenda",
  });
}
  });
}

export async function notifyReservationCancelled(reservaId, { reason, by } = {}) {
  await safeRun("notifyReservationCancelled", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    const trainer = r.trainerId ? await getUserById(r.trainerId) : null;
    const trainerEmail = normEmail(trainer?.email);

    const why = short(reason || r.cancelReason, 240);
    const extra = why ? [`Motivo: ${why}`] : [];
    const lines = [...buildReservaLines(r), ...extra].filter(Boolean);

    // Cliente
    if (clientEmail) {
      const intro =
        by === "staff"
          ? "El centro ha cancelado la reserva."
          : "La reserva ha sido cancelada.";

      await sendReservationEmail({
        to: clientEmail,
        subject: `${appName} · Reserva cancelada`,
        title: "Reserva cancelada",
        intro,
        lines,
        actionPath: "/reservas",
        actionText: "Ver mis reservas",
      });
    }

    // Trainer
    if (trainerEmail) {
      await sendReservationEmail({
        to: trainerEmail,
        subject: `${appName} · Reserva cancelada`,
        title: "Reserva cancelada",
        intro: "Se ha cancelado una reserva asignada a ti.",
        lines: [
          ...lines,
          clientEmail ? `Cliente: ${clientEmail}` : "",
        ].filter(Boolean),
        actionPath: "/trainer-agenda",
        actionText: "Ver agenda",
      });
    }
  });
}

export async function notifyReservationNoteAdded({ reservaId, author, text } = {}) {
  await safeRun("notifyReservationNoteAdded", async () => {
    const r = await getReservaById(reservaId);
    if (!r) return;

    const appName = process.env.APP_NAME || "DogForm";
    const clientEmail = normEmail(r.email);
    const trainer = r.trainerId ? await getUserById(r.trainerId) : null;
    const trainerEmail = normEmail(trainer?.email);

    const note = short(text, 300);
    const lines = [...buildReservaLines(r), note ? `Nota: ${note}` : ""].filter(Boolean);

    // author: "user" | "admin" (en tu API)
    if (author === "user") {
      // Nota del cliente => avisamos al trainer
      if (trainerEmail) {
        await sendReservationEmail({
          to: trainerEmail,
          subject: `${appName} · Nueva nota del cliente`,
          title: "Nueva nota en una reserva",
          intro: "El cliente ha añadido una nota a la reserva.",
          lines: [
            ...lines,
            clientEmail ? `Cliente: ${clientEmail}` : "",
          ].filter(Boolean),
          actionPath: "/trainer-agenda",
          actionText: "Ver agenda",
        });
      }


// Nota del cliente => avisamos también a los administradores
const adminEmails = await listAdminEmails();
for (const adminTo of adminEmails) {
  if (!adminTo) continue;
  if (trainerEmail && adminTo === trainerEmail) continue;
  if (clientEmail && adminTo === clientEmail) continue;

  await sendReservationEmail({
    to: adminTo,
    subject: `${appName} · Nueva nota del cliente`,
    title: "Nueva nota en una reserva",
    intro: "Un cliente ha añadido una nota a una reserva.",
    lines: [
      ...lines,
      clientEmail ? `Cliente: ${clientEmail}` : "",
    ].filter(Boolean),
    actionPath: "/admin",
    actionText: "Ver reservas",
  });
}

      return;
    }

    // Nota del centro/trainer => avisamos al cliente
    if (clientEmail) {
      await sendReservationEmail({
        to: clientEmail,
        subject: `${appName} · Nueva nota en tu reserva`,
        title: "Nueva nota en tu reserva",
        intro: "Tienes una nueva nota del centro/adiestrador.",
        lines,
        actionPath: "/reservas",
        actionText: "Ver mis reservas",
      });
    }
  });
}
// CHAT
export async function notifyChatMessage({ conversationId, senderId, preview } = {}) {
  await safeRun("notifyChatMessage", async () => {
    const cid = safeStr(conversationId).trim();
    const sid = safeStr(senderId).trim();
    if (!cid || !sid) return;

    const convRows = await query(
      `SELECT id, trainer_id AS trainerId, client_id AS clientId FROM conversations WHERE id = ? LIMIT 1`,
      [cid]
    );
    if (!convRows.length) return;

    const conv = convRows[0];
    const trainerId = safeStr(conv.trainerId);
    const clientId = safeStr(conv.clientId);

    // Requisito: solo notificamos por email al CLIENTE cuando escribe el ADIESTRADOR
    // y, además, máximo 1 email por día por cliente.
    if (sid !== trainerId) return;
    const recipientId = clientId;

    const sender = await getUserById(sid);
    const recipient = await getUserById(recipientId);

    const to = normEmail(recipient?.email);
    if (!to) return;

    // Throttle 1/día
    await ensureChatThrottleTable();
    const today = getMadridDayStr(new Date());
    const thr = await query(
      `SELECT last_sent_day AS lastSentDay FROM chat_email_throttle WHERE recipient_id = ? LIMIT 1`,
      [recipientId]
    );
    if (thr?.[0]?.lastSentDay === today) return;

    const appName = process.env.APP_NAME || "DogForm";
    const senderName = sender?.nombre || sender?.email || "DogForm";

    await sendChatEmail({
      to,
      subject: `${appName} · Nuevo mensaje de ${senderName}`,
      title: "Nuevo mensaje",
      intro: `Tienes un nuevo mensaje de ${senderName}.`,
      preview: short(preview, 220),
      conversationId: cid,
    });

    const nowIso = new Date().toISOString();
    if (thr.length) {
      await query(
        `UPDATE chat_email_throttle SET last_sent_day = ?, updated_at = ? WHERE recipient_id = ?`,
        [today, nowIso, recipientId]
      );
    } else {
      await query(
        `INSERT INTO chat_email_throttle (recipient_id, last_sent_day, updated_at) VALUES (?, ?, ?)`,
        [recipientId, today, nowIso]
      );
    }
  });
}
