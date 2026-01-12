import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";
import { ensureBloqueosSchema } from "../utils/bloqueosSchema.js";

const router = express.Router();

/* ===================== schema (trainer_profiles) ===================== */

let _trainerProfilesSchemaReady = false;
let _trainerProfilesSchemaPromise = null;

async function ensureTrainerProfilesSchema() {
  if (_trainerProfilesSchemaReady) return;
  if (_trainerProfilesSchemaPromise) return _trainerProfilesSchemaPromise;

  _trainerProfilesSchemaPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS trainer_profiles (
        trainer_id TEXT PRIMARY KEY,
        display_name TEXT,
        bio TEXT,
        photo_url TEXT,
        experience_years INTEGER,
        specialties TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    const cols = await query("PRAGMA table_info(trainer_profiles)");
    const names = new Set((cols || []).map((c) => c.name));

    const addCol = async (name, type) => {
      if (names.has(name)) return;
      await query(`ALTER TABLE trainer_profiles ADD COLUMN ${name} ${type}`);
      names.add(name);
    };

    await addCol("display_name", "TEXT");
    await addCol("bio", "TEXT");
    await addCol("photo_url", "TEXT");
    await addCol("experience_years", "INTEGER");
    await addCol("specialties", "TEXT");
    await addCol("created_at", "TEXT");
    await addCol("updated_at", "TEXT");

    _trainerProfilesSchemaReady = true;
  })().finally(() => {
    if (!_trainerProfilesSchemaReady) _trainerProfilesSchemaPromise = null;
  });

  return _trainerProfilesSchemaPromise;
}

/* ===================== users fallback (safe joins) ===================== */

const _colsCache = new Map();

function _colName(row) {
  return String(row?.name ?? row?.NAME ?? row?.Name ?? "").trim();
}

async function getCols(tableName) {
  if (_colsCache.has(tableName)) return _colsCache.get(tableName);
  try {
    const cols = await query(`PRAGMA table_info(${tableName})`);
    const names = Array.isArray(cols) ? cols.map(_colName).filter(Boolean) : [];
    _colsCache.set(tableName, names);
    return names;
  } catch {
    _colsCache.set(tableName, []);
    return [];
  }
}

function pickFirst(cols, candidates = []) {
  const set = new Set((cols || []).map((c) => String(c).toLowerCase()));
  for (const c of candidates) {
    if (set.has(String(c).toLowerCase())) return c;
  }
  return null;
}

function nullableTextExpr(alias, col) {
  if (!col) return null;
  return `NULLIF(${alias}.${col}, '')`;
}

async function getTrainerExprConfig() {
  const usuariosCols = await getCols("usuarios");
  const auNameCol = pickFirst(usuariosCols, ["nombre", "name", "display_name", "full_name"]);
  const auNotesCol = pickFirst(usuariosCols, ["notas", "notes", "bio", "descripcion", "description"]);
  const auPhotoCol = pickFirst(usuariosCols, ["foto", "photo_url", "avatar_url", "avatarURL", "photo", "avatar"]);

  const usersCols = await getCols("users");
  const upJoinCol = pickFirst(usersCols, ["uid", "id", "user_id"]);
  const upNameCol = pickFirst(usersCols, ["nombre", "name", "display_name", "full_name"]);
  const upNotesCol = pickFirst(usersCols, ["notas", "notes", "bio", "descripcion", "description"]);
  const upPhotoCol = pickFirst(usersCols, ["foto", "photo_url", "avatar_url", "avatarURL", "photo", "avatar"]);

  const hasUsersJoin = Boolean(upJoinCol && (upNameCol || upNotesCol || upPhotoCol));

  const displayNameParts = [
    nullableTextExpr("tp", "display_name"),
    nullableTextExpr("au", auNameCol),
    hasUsersJoin ? nullableTextExpr("up", upNameCol) : null,
    "au.email",
  ].filter(Boolean);

  const bioParts = [
    nullableTextExpr("tp", "bio"),
    nullableTextExpr("au", auNotesCol),
    hasUsersJoin ? nullableTextExpr("up", upNotesCol) : null,
    "''",
  ].filter(Boolean);

  const photoParts = [
    nullableTextExpr("tp", "photo_url"),
    nullableTextExpr("au", auPhotoCol),
    hasUsersJoin ? nullableTextExpr("up", upPhotoCol) : null,
    "''",
  ].filter(Boolean);

  return {
    joinSql: hasUsersJoin ? `LEFT JOIN users up ON up.${upJoinCol} = au.id` : "",
    displayNameExpr: `COALESCE(${displayNameParts.join(", ")})`,
    bioExpr: `COALESCE(${bioParts.join(", ")})`,
    photoExpr: `COALESCE(${photoParts.join(", ")})`,
  };
}

/* ============================================================
   Helpers: excluir "yo mismo" de listados de trainers
   (robusto por id y por email)
============================================================ */
function isTrainerRoleFromReq(req) {
  const r = String(req.user?.rol || req.user?.role || "").toLowerCase();
  return r === "adiestrador" || r === "trainer";
}

function getMeId(req) {
  return String(req.user?.uid ?? req.user?.id ?? req.user?._id ?? "").trim();
}

function getMeEmail(req) {
  return String(req.user?.email ?? "").trim().toLowerCase();
}

function filterOutSelfTrainer(rows, req) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return arr;

  if (!isTrainerRoleFromReq(req)) return arr;

  const meId = getMeId(req);
  const meEmail = getMeEmail(req);

  // Si no tenemos nada para comparar, no filtramos (pero normalmente email está)
  if (!meId && !meEmail) return arr;

  return arr.filter((t) => {
    const tid = String(t?.uid ?? t?.id ?? "").trim();
    const temail = String(t?.email ?? "").trim().toLowerCase();

    if (meId && tid && tid === meId) return false;
    if (meEmail && temail && temail === meEmail) return false;

    return true;
  });
}

/* ============================================================
   Helpers disponibilidad (bloqueos/reservas) por adiestrador
============================================================ */
let _bloqueosHasTrainerId = null;
let _bloqueosHasAllDay = null;

async function bloqueosHasTrainerIdColumn() {
  if (_bloqueosHasTrainerId !== null) return _bloqueosHasTrainerId;
  try {
    await ensureBloqueosSchema();
    const cols = await query(`PRAGMA table_info(bloqueos)`);
    _bloqueosHasTrainerId = (cols || []).some(
      (c) => String(c?.name || "").toLowerCase() === "trainer_id"
    );
  } catch {
    _bloqueosHasTrainerId = false;
  }
  return _bloqueosHasTrainerId;
}

async function bloqueosHasAllDayColumn() {
  if (_bloqueosHasAllDay !== null) return _bloqueosHasAllDay;
  try {
    await ensureBloqueosSchema();
    const cols = await query(`PRAGMA table_info(bloqueos)`);
    _bloqueosHasAllDay = (cols || []).some(
      (c) => String(c?.name || "").toLowerCase() === "is_all_day"
    );
  } catch {
    _bloqueosHasAllDay = false;
  }
  return _bloqueosHasAllDay;
}

function padHHMM(x) {
  if (!x) return x;
  const [h, m = "00"] = String(x).split(":");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const toMin = (hhmm) => {
  const [h, m = 0] = String(hhmm || "00:00").split(":").map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

const overlaps = (aStart, aDur, bStart, bDur) => {
  const a0 = toMin(aStart);
  const a1 = a0 + Number(aDur || 60);
  const b0 = toMin(bStart);
  const b1 = b0 + Number(bDur || 60);
  return a0 < b1 && b0 < a1;
};

/* ============================================================
   GET /api/trainers/eligible
   - Si NO hay servicioId → devuelve todos los adiestradores
   - Si hay servicioId (+ modalidad) → filtra por trainer_servicios
     y si no hay datos → fallback a todos
   Roles: admin / client / user / adiestrador
============================================================ */
router.get(
  "/eligible",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (req, res) => {
    try {
      await ensureTrainerProfilesSchema();
      const expr = await getTrainerExprConfig();
      const { servicioId, modalidad } = req.query;
      const mod = modalidad ? String(modalidad) : null;

      const getAll = async () => {
        const rows = await query(
          `
          SELECT
            au.id AS uid,
            au.email AS email,
            ${expr.displayNameExpr} AS displayName
          FROM usuarios au
          LEFT JOIN trainer_profiles tp
            ON tp.trainer_id = au.id
          ${expr.joinSql}
          WHERE au.rol = 'adiestrador'
          ORDER BY displayName ASC, au.email ASC
          `
        );
        // ✅ EXCLUIRME SI SOY ADIESTRADOR
        return filterOutSelfTrainer(rows, req);
      };

      // SIN FILTROS → TODOS
      if (!servicioId) {
        const rows = await getAll();
        return res.json(rows);
      }

      // CON FILTROS → COMPATIBLES
      let rows = [];
      try {
        rows = await query(
          `
          SELECT DISTINCT
            au.id AS uid,
            au.email AS email,
            ${expr.displayNameExpr} AS displayName
          FROM usuarios au
          JOIN trainer_servicios ts
            ON ts.trainer_id = au.id
          LEFT JOIN trainer_profiles tp
            ON tp.trainer_id = au.id
          ${expr.joinSql}
          WHERE au.rol = 'adiestrador'
            AND ts.enabled = 1
            AND ts.servicio_id = ?
            AND (
              ts.modalidad IS NULL
              OR ts.modalidad = ''
              OR ? IS NULL
              OR ts.modalidad = ?
            )
          ORDER BY displayName ASC, au.email ASC
          `,
          [String(servicioId), mod, mod]
        );
      } catch {
        rows = [];
      }

      // ✅ EXCLUIRME SI SOY ADIESTRADOR (también aquí)
      rows = filterOutSelfTrainer(rows, req);

      if (!rows || rows.length === 0) {
        const fallback = await getAll(); // ya filtra
        return res.json(fallback);
      }

      return res.json(rows);
    } catch (err) {
      console.error("GET /api/trainers/eligible error:", err);
      res.status(500).json({
        error: "No se pudo cargar la lista de adiestradores",
      });
    }
  }
);

/* ============================================================
   GET /api/trainers/available
   Devuelve SOLO los adiestradores disponibles en una franja.
   - Filtra por servicio/modalidad (si se pasa servicioId).
   - Excluye solapes con reservas activas del trainer.
   - Respeta bloqueos globales y (si existe columna) por trainer.
   Query:
     fecha=YYYY-MM-DD
     hora=HH:MM
     durationMin=60
     servicioId? modalidad? reservaId?
   Roles: admin
============================================================ */
router.get(
  "/available",
  verifyToken,
  allowRoles(["admin"]),
  async (req, res) => {
    try {
      await ensureTrainerProfilesSchema();
      const expr = await getTrainerExprConfig();
      const { fecha, hora, durationMin = 60, servicioId, modalidad, reservaId } = req.query;
      if (!fecha || !hora) {
        return res.status(400).json({ error: "Faltan fecha/hora" });
      }

      const h = padHHMM(String(hora));
      const dur = Number(durationMin || 60);
      const mod = modalidad ? String(modalidad) : null;

      // 1) Elegibles (misma lógica que /eligible)
      const getAll = async () => {
        return await query(
          `
          SELECT
            au.id AS uid,
            au.email AS email,
            COALESCE(
              NULLIF(tp.display_name, ''),
              NULLIF(up.nombre, ''),
              au.email
            ) AS displayName
          FROM usuarios au
          LEFT JOIN trainer_profiles tp
            ON tp.trainer_id = au.id
          LEFT JOIN users up
            ON up.uid = au.id
          WHERE au.rol = 'adiestrador'
          ORDER BY displayName ASC, au.email ASC
          `
        );
      };

      let eligible = [];
      if (!servicioId) {
        eligible = await getAll();
      } else {
        try {
          eligible = await query(
            `
            SELECT DISTINCT
              au.id AS uid,
              au.email AS email,
              COALESCE(
                NULLIF(tp.display_name, ''),
                NULLIF(up.nombre, ''),
                au.email
              ) AS displayName
            FROM usuarios au
            JOIN trainer_servicios ts
              ON ts.trainer_id = au.id
            LEFT JOIN trainer_profiles tp
              ON tp.trainer_id = au.id
            LEFT JOIN users up
              ON up.uid = au.id
            WHERE au.rol = 'adiestrador'
              AND ts.enabled = 1
              AND ts.servicio_id = ?
              AND (
                ts.modalidad IS NULL
                OR ts.modalidad = ''
                OR ? IS NULL
                OR ts.modalidad = ?
              )
            ORDER BY displayName ASC, au.email ASC
            `,
            [String(servicioId), mod, mod]
          );
        } catch {
          eligible = [];
        }

        if (!eligible || eligible.length === 0) {
          eligible = await getAll();
        }
      }

      // 2) Reservas activas por trainer (excluyendo la reserva actual si se pasa)
      const rParams = [String(fecha)];
      let whereExclude = "";
      if (reservaId) {
        whereExclude = " AND id <> ?";
        rParams.push(String(reservaId));
      }

      const reservas = await query(
        `
        SELECT id, trainer_id AS trainerId, hora, COALESCE(duration_min,60) AS durationMin
          FROM reservas
         WHERE fecha = ?
           AND status IN ('pending','pending_user','confirmed')
           AND trainer_id IS NOT NULL
           AND trainer_id <> ''
           ${whereExclude}
        `,
        rParams
      );

      const byTrainer = new Map();
      for (const r of reservas || []) {
        const tid = String(r.trainerId || '').trim();
        if (!tid) continue;
        const arr = byTrainer.get(tid) || [];
        arr.push({ hora: String(r.hora), durationMin: Number(r.durationMin || 60) });
        byTrainer.set(tid, arr);
      }

      // 3) Bloqueos
      const hasTrainerCol = await bloqueosHasTrainerIdColumn();
      const hasAllDayCol = await bloqueosHasAllDayColumn();
      let bloqueos = [];
      if (hasTrainerCol) {
        bloqueos = await query(
          hasAllDayCol
            ? `SELECT hora, trainer_id AS trainerId, COALESCE(is_all_day,0) AS allDay FROM bloqueos WHERE fecha=?`
            : `SELECT hora, trainer_id AS trainerId FROM bloqueos WHERE fecha=?`,
          [String(fecha)]
        );
      } else {
        bloqueos = await query(
          hasAllDayCol
            ? `SELECT hora, COALESCE(is_all_day,0) AS allDay FROM bloqueos WHERE fecha=?`
            : `SELECT hora FROM bloqueos WHERE fecha=?`,
          [String(fecha)]
        );
      }

      // Bloqueos de día completo
      let allDayGlobal = false;
      const allDayByTrainer = new Set();
      if (hasAllDayCol) {
        for (const b of bloqueos || []) {
          if (Number(b?.allDay || 0) !== 1) continue;
          if (hasTrainerCol) {
            const bt = String(b?.trainerId || "").trim();
            if (!bt) allDayGlobal = true;
            else allDayByTrainer.add(bt);
          } else {
            allDayGlobal = true;
          }
        }
      }

      // 4) Filtrado final
      const out = [];
      for (const t of eligible || []) {
        const tid = String(t?.uid || '').trim();
        if (!tid) continue;

        // Bloqueos (global o por trainer)
        let blocked = false;
        if (hasAllDayCol && (allDayGlobal || allDayByTrainer.has(tid))) blocked = true;

        // Bloqueos por hora (global o por trainer)
        if (!blocked) {
          for (const b of bloqueos || []) {
            if (hasAllDayCol && Number(b?.allDay || 0) === 1) continue;
            const bh = String(b?.hora || '').trim();
            if (!bh) continue;
            if (hasTrainerCol) {
              const bt = String(b?.trainerId || '').trim();
              const isGlobal = !bt;
              if (isGlobal || bt === tid) {
                if (overlaps(h, dur, bh, 60)) {
                  blocked = true;
                  break;
                }
              }
            } else {
              if (overlaps(h, dur, bh, 60)) {
                blocked = true;
                break;
              }
            }
          }
        }
        if (blocked) continue;

        // Reservas solapadas
        const mine = byTrainer.get(tid) || [];
        let busy = false;
        for (const r of mine) {
          if (overlaps(h, dur, r.hora, r.durationMin)) {
            busy = true;
            break;
          }
        }
        if (busy) continue;

        out.push(t);
      }

      res.json(out);
    } catch (err) {
      console.error("GET /api/trainers/available error:", err);
      res.status(500).json({ error: "No se pudo calcular disponibilidad" });
    }
  }
);

/* ============================================================
   GET /api/trainers/me/clients
   Devuelve los clientes del adiestrador autenticado
   Roles: adiestrador / admin
============================================================ */
router.get(
  "/me/clients",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.uid || req.user?.id || "");
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      // reservas.uid = usuarios.id (cliente)
      // IMPORTANTE: devolvemos también perros + última/próxima sesión
      const clientRows = await query(
        `
        SELECT DISTINCT
          cu.id AS id,
          cu.email AS email,
          COALESCE(NULLIF(up.nombre,''), cu.email) AS nombre
        FROM reservas r
        JOIN usuarios cu
          ON cu.id = r.uid
        LEFT JOIN users up
          ON up.uid = cu.id
        WHERE (r.trainer_id = ? OR r.entrenador_id = ?)
          AND r.uid IS NOT NULL
          AND r.status IN ('pending','pending_user','confirmed')
        ORDER BY nombre ASC, cu.email ASC
        `,
        [trainerId, trainerId]
      );

      if (!clientRows.length) return res.json([]);

      const items = clientRows.map((r) => ({
        id: r.id,
        email: r.email,
        nombre: r.nombre,
        displayName: r.nombre,
        perros: [],
        ultimaReserva: null,
        proximaReserva: null,
      }));

      const map = new Map(items.map((c) => [String(c.id), c]));
      const clientIds = items.map((c) => String(c.id));

      // ====== Perros de todos los clientes (1 query) ======
      try {
        const placeholders = clientIds.map(() => "?").join(",");
        const dogRows = await query(
          `
          SELECT id, user_id AS ownerId, nombre, raza
          FROM perros
          WHERE user_id IN (${placeholders})
          ORDER BY nombre COLLATE NOCASE ASC
          `,
          clientIds
        );

        for (const d of dogRows) {
          const owner = map.get(String(d.ownerId));
          if (!owner) continue;
          owner.perros.push({
            id: d.id,
            nombre: d.nombre,
            raza: d.raza,
          });
        }
      } catch {
        // Si la tabla perros no existe todavía o falla, ignoramos.
      }

      // ====== Última / próxima reserva (1 query) ======
      try {
        const placeholders = clientIds.map(() => "?").join(",");
        const rows = await query(
          `
          SELECT uid, fecha, hora, status
          FROM reservas
          WHERE (trainer_id = ? OR entrenador_id = ?)
            AND uid IN (${placeholders})
            AND status IN ('pending','pending_user','confirmed')
            AND fecha IS NOT NULL
            AND hora IS NOT NULL
          `,
          [trainerId, trainerId, ...clientIds]
        );

        const now = Date.now();
        const best = new Map(); // uid -> {lastMs, lastIso, nextMs, nextIso}

        const toDate = (fecha, hora) => {
          const [Y, M, D] = String(fecha || "").split("-").map(Number);
          const [h, m = 0] = String(hora || "00:00").split(":").map(Number);
          if (!Y || !M || !D) return null;
          return new Date(Y, M - 1, D, h || 0, m || 0);
        };

        for (const r of rows) {
          const uid = String(r.uid || "");
          if (!uid) continue;
          const d = toDate(r.fecha, r.hora);
          if (!d || Number.isNaN(d.getTime())) continue;

          const ms = d.getTime();
          const iso = d.toISOString();

          const cur = best.get(uid) || {
            lastMs: null,
            lastIso: null,
            nextMs: null,
            nextIso: null,
          };

          if (ms <= now) {
            if (cur.lastMs === null || ms > cur.lastMs) {
              cur.lastMs = ms;
              cur.lastIso = iso;
            }
          } else {
            if (cur.nextMs === null || ms < cur.nextMs) {
              cur.nextMs = ms;
              cur.nextIso = iso;
            }
          }

          best.set(uid, cur);
        }

        for (const [uid, v] of best.entries()) {
          const c = map.get(uid);
          if (!c) continue;
          c.ultimaReserva = v.lastIso;
          c.proximaReserva = v.nextIso;
        }
      } catch {
        // ignore
      }

      res.json(items);
    } catch (err) {
      console.error("GET /api/trainers/me/clients error:", err);
      res.status(500).json({
        error: "No se pudieron cargar los clientes del adiestrador",
      });
    }
  }
);

/* ============================================================
   GET /api/trainers/me/clients/:clientId
   Detalle de cliente asignado (con perros)
   Roles: adiestrador / admin
============================================================ */
router.get(
  "/me/clients/:clientId",
  verifyToken,
  allowRoles(["adiestrador", "admin"]),
  async (req, res) => {
    try {
      const trainerId = String(req.user?.uid || req.user?.id || "");
      if (!trainerId) return res.status(401).json({ error: "No autorizado" });

      const clientId = String(req.params.clientId || "").trim();
      if (!clientId) return res.status(400).json({ error: "clientId requerido" });

      // Permiso: debe existir relación por reservas
      const rel = await query(
        `
          SELECT 1
          FROM reservas
          WHERE uid = ?
            AND (trainer_id = ? OR entrenador_id = ?)
          LIMIT 1
        `,
        [clientId, trainerId, trainerId]
      );
      if (!rel.length) return res.status(403).json({ error: "Sin permisos" });

      const u = await query(
        `
          SELECT
            cu.id AS id,
            cu.email AS email,
            COALESCE(NULLIF(up.nombre,''), cu.email) AS nombre,
            COALESCE(NULLIF(up.telefono,''), '') AS telefono,
            COALESCE(NULLIF(up.direccion,''), '') AS direccion,
            COALESCE(NULLIF(up.foto,''), '') AS foto,
            COALESCE(NULLIF(up.prefix,''), '') AS prefix,
            COALESCE(NULLIF(up.notas,''), '') AS profileNotes,
            up.created_at AS profileCreatedAt,
            up.updated_at AS profileUpdatedAt
          FROM usuarios cu
          LEFT JOIN users up ON up.uid = cu.id
          WHERE cu.id = ?
          LIMIT 1
        `,
        [clientId]
      );
      if (!u.length) return res.status(404).json({ error: "Cliente no encontrado" });

      let perros = [];
      try {
        const dogRows = await query(
          `
            SELECT
              id,
              nombre,
              raza,
              nacimiento,
              castrado,
              notas,
              COALESCE(avatar_url, avatarURL) AS avatarURL,
              created_at AS createdAt,
              updated_at AS updatedAt
            FROM perros
            WHERE user_id = ?
            ORDER BY nombre COLLATE NOCASE ASC
          `,
          [clientId]
        );
        perros = dogRows.map((d) => ({
          id: d.id,
          nombre: d.nombre,
          raza: d.raza,
          nacimiento: d.nacimiento,
          castrado: !!d.castrado,
          notas: d.notas,
          avatarURL: d.avatarURL,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }));
      } catch {
        perros = [];
      }

      res.json({
        id: u[0].id,
        email: u[0].email,
        nombre: u[0].nombre,
        telefono: u[0].telefono || "",
        direccion: u[0].direccion || "",
        foto: u[0].foto || "",
        prefix: u[0].prefix || "",
        profileNotes: u[0].profileNotes || "",
        profile: {
          id: u[0].id,
          email: u[0].email,
          nombre: u[0].nombre,
          telefono: u[0].telefono || "",
          direccion: u[0].direccion || "",
          foto: u[0].foto || "",
          prefix: u[0].prefix || "",
          notas: u[0].profileNotes || "",
          createdAt: u[0].profileCreatedAt || null,
          updatedAt: u[0].profileUpdatedAt || null,
        },
        perros,
      });
    } catch (err) {
      console.error("GET /api/trainers/me/clients/:clientId error:", err);
      res.status(500).json({ error: "No se pudo cargar el cliente" });
    }
  }
);

/* ============================================================
   GET /api/trainers/public
   Listado público de adiestradores (con perfil + fallback a users)
============================================================ */
router.get("/public", async (_req, res) => {
  try {
    await ensureTrainerProfilesSchema();
    const expr = await getTrainerExprConfig();

    const rows = await query(`
      SELECT
        au.id AS trainerId,
        au.email AS email,

        ${expr.displayNameExpr} AS displayName,

        ${expr.bioExpr} AS bio,

        ${expr.photoExpr} AS photoUrl,

        tp.experience_years AS experienceYears,
        tp.specialties AS specialties

      FROM usuarios au
      LEFT JOIN trainer_profiles tp
        ON tp.trainer_id = au.id
      ${expr.joinSql}

      WHERE au.rol = 'adiestrador'
      ORDER BY displayName ASC, au.email ASC
    `);

    const data = rows.map((r) => {
      let specialties = [];
      if (r.specialties) {
        try {
          const parsed = JSON.parse(r.specialties);
          specialties = Array.isArray(parsed) ? parsed : [String(parsed)];
        } catch {
          specialties = [String(r.specialties)];
        }
      }

      return {
        trainerId: r.trainerId,
        email: r.email,
        displayName: r.displayName,
        bio: r.bio || "",
        photoUrl: r.photoUrl || "",
        experienceYears:
          r.experienceYears === null || r.experienceYears === undefined
            ? null
            : Number(r.experienceYears),
        specialties,
      };
    });

    res.json(data);
  } catch (err) {
    console.error("GET /api/trainers/public error:", err);
    res.status(500).json({ error: "No se pudo cargar el listado" });
  }
});

export default router;
