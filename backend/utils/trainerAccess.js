// backend/utils/trainerAccess.js
// Helpers compartidos para permisos Adiestrador ↔ Cliente
// - Evita duplicar lógica en rutas (trainers, trainerNotes, etc.)
import { query } from "../db.js";

export function getAuthUserId(req) {
  return String(req.user?.uid || req.user?.id || req.user?.sub || "");
}

/**
 * Relación adiestrador–cliente: existe al menos una reserva que los conecta.
 * (No filtramos por status para que la relación no dependa de estados.)
 */
export async function trainerHasClient({ trainerId, clientId }) {
  const t = String(trainerId || "").trim();
  const c = String(clientId || "").trim();
  if (!t || !c) return false;

  const rows = await query(
    `
      SELECT 1
      FROM reservas
      WHERE uid = ?
        AND (trainer_id = ? OR entrenador_id = ?)
      LIMIT 1
    `,
    [c, t, t]
  );

  return rows.length > 0;
}

export async function dogBelongsToClient({ dogId, clientId }) {
  const d = String(dogId || "").trim();
  const c = String(clientId || "").trim();
  if (!d || !c) return false;

  try {
    const rows = await query(
      `SELECT 1 FROM perros WHERE id = ? AND user_id = ? LIMIT 1`,
      [d, c]
    );
    return rows.length > 0;
  } catch {
    // Si no existe tabla perros todavía o hay error, devolvemos false.
    return false;
  }
}

export function buildDateFromFechaHora(fecha, hora) {
  if (!fecha) return null;
  const [Y, M, D] = String(fecha).split("-").map(Number);
  const [h, m = 0] = String(hora || "00:00").split(":").map(Number);
  if (!Y || !M || !D) return null;
  return new Date(Y, (M || 1) - 1, D, h || 0, m || 0);
}
