// backend/utils/bloqueosSchema.js
import { query } from "../db.js";

let _ensuring = null;

/**
 * Garantiza que la tabla "bloqueos" existe y tiene las columnas mínimas.
 * Se usa desde distintos endpoints (reservas, trainers, agenda, bloqueos) para evitar errores
 * cuando la BD aún no tiene la tabla.
 */
export async function ensureBloqueosSchema() {
  if (_ensuring) return _ensuring;

  _ensuring = (async () => {
    // Base table (mínima)
    await query(`
      CREATE TABLE IF NOT EXISTS bloqueos (
        id         TEXT,
        fecha      TEXT NOT NULL,
        hora       TEXT NOT NULL,
        trainer_id TEXT,
        created_at TEXT,
        is_all_day INTEGER DEFAULT 0,
        all_day    INTEGER DEFAULT 0
      )
    `);

    // Índices útiles
    await query(`CREATE INDEX IF NOT EXISTS idx_bloqueos_fecha ON bloqueos(fecha)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_bloqueos_trainer ON bloqueos(trainer_id)`);

    // Backfill columnas si la tabla existía con otro schema
    let cols = [];
    try {
      cols = await query("PRAGMA table_info(bloqueos)");
    } catch {
      cols = [];
    }
    const has = new Set((cols || []).map((c) => String(c?.name || "").toLowerCase()));

    const stmts = [];
    if (!has.has("id")) stmts.push("ALTER TABLE bloqueos ADD COLUMN id TEXT");
    if (!has.has("trainer_id")) stmts.push("ALTER TABLE bloqueos ADD COLUMN trainer_id TEXT");
    if (!has.has("created_at")) stmts.push("ALTER TABLE bloqueos ADD COLUMN created_at TEXT");
    if (!has.has("is_all_day"))
      stmts.push("ALTER TABLE bloqueos ADD COLUMN is_all_day INTEGER DEFAULT 0");
    if (!has.has("all_day"))
      stmts.push("ALTER TABLE bloqueos ADD COLUMN all_day INTEGER DEFAULT 0");

    for (const s of stmts) {
      try {
        await query(s);
      } catch {
        // Ignorar: en SQLite algunas alter pueden fallar por restricciones; la base ya está creada.
      }
    }
  })().finally(() => {
    _ensuring = null;
  });

  return _ensuring;
}
