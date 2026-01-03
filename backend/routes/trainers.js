import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

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
      const { servicioId, modalidad } = req.query;
      const mod = modalidad ? String(modalidad) : null;

      const getAll = async () => {
        const rows = await query(
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
        return rows;
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
        rows = [];
      }

      if (!rows || rows.length === 0) {
        const fallback = await getAll();
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
    const rows = await query(`
      SELECT
        au.id AS trainerId,
        au.email AS email,

        COALESCE(
          NULLIF(tp.display_name, ''),
          NULLIF(up.nombre, ''),
          au.email
        ) AS displayName,

        COALESCE(
          NULLIF(tp.bio, ''),
          NULLIF(up.notas, ''),
          ''
        ) AS bio,

        COALESCE(
          NULLIF(tp.photo_url, ''),
          NULLIF(up.foto, ''),
          ''
        ) AS photoUrl,

        tp.experience_years AS experienceYears,
        tp.specialties AS specialties

      FROM usuarios au
      LEFT JOIN trainer_profiles tp
        ON tp.trainer_id = au.id
      LEFT JOIN users up
        ON up.uid = au.id

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
