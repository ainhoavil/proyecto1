// backend/routes/reservas.js  (ESM)
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

/* ===================== Config ===================== */
const BUSINESS_HOURS = { start: 9, end: 21, skipHours: new Set([14, 15]) };

/* ===================== Helpers ===================== */
const nowISO = () => new Date().toISOString();
const toMin = (hhmm) => {
  const [h, m = 0] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const fromMin = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const overlaps = (aStart, aDur, bStart, bDur) => {
  const a1 = toMin(aStart), a2 = a1 + Number(aDur || 60);
  const b1 = toMin(bStart), b2 = b1 + Number(bDur || 60);
  return a1 < b2 && b1 < a2;
};
const parseJSONSafe = (v, fb = {}) => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : (v ?? fb);
  } catch {
    return fb;
  }
};

async function tx(run) {
  try {
    await query('BEGIN IMMEDIATE');
    const r = await run();
    await query('COMMIT');
    return r;
  } catch (e) {
    await query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/* ===================== Permisos notas hilo ===================== */
async function canSeeReservation(req, reservaId) {
  const r = (await query(
    `SELECT id, uid, email FROM reservas WHERE id=? LIMIT 1`,
    [reservaId]
  ))[0];

  if (!r) return { ok: false };

  const isAdmin = !!req.user?.isAdmin;
  const isOwner =
    (r.uid && req.user?.uid && r.uid === req.user.uid) ||
    (r.email && req.user?.email && r.email === req.user.email);

  return { ok: isAdmin || isOwner };
}

/* ===================== Disponibilidad ===================== */
// GET /api/reservas/disponibilidad?fecha=YYYY-MM-DD
router.get('/disponibilidad', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta fecha (YYYY-MM-DD)' });

    const slots = [];
    for (let h = BUSINESS_HOURS.start; h < BUSINESS_HOURS.end; h++) {
      if (BUSINESS_HOURS.skipHours.has(h)) continue;
      slots.push(`${String(h).padStart(2, '0')}:00`);
    }

    const reservas = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [fecha]);

    const ocupadasSet = new Set();
    for (const r of reservas) {
      const dur = Number(r.durationMin || 60);
      const steps = Math.max(1, Math.ceil(dur / 60));
      for (let i = 0; i < steps; i++) {
        ocupadasSet.add(fromMin(toMin(String(r.hora)) + i * 60));
      }
    }
    for (const b of bloqueos) ocupadasSet.add(String(b.hora));

    const libres = slots.filter((s) => !ocupadasSet.has(s));
    const ocupadas = Array.from(ocupadasSet);

    res.json({ fecha, libres, ocupadas });
  } catch (e) {
    console.error('GET /reservas/disponibilidad', e);
    res.status(500).json({ error: 'No se pudo calcular disponibilidad' });
  }
});

/* ===================== Crear (usuario) ===================== */
// POST /api/reservas
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      email, fecha, hora, durationMin = 60,
      servicioId, servicioTitulo, modalidad, duration,
      price, currency, perro, telefono, direccion, pricing,
      paqueteId, userNote = null,
    } = req.body;

    const uid = req.user?.uid || null;
    const emailNorm = String(email || req.user?.email || '').trim();
    if (!uid || !emailNorm || !fecha || !hora) {
      return res.status(400).json({ error: 'Faltan campos (login/email/fecha/hora)' });
    }

    // Fallback del servicio
    let servicioTituloSafe = servicioTitulo || null;
    if (!servicioTituloSafe && servicioId) {
      try {
        const trows = await query(
          `SELECT COALESCE(title, titulo, name) AS t
             FROM servicios
            WHERE id = ? OR _id = ? OR uuid = ?
            LIMIT 1`,
          [String(servicioId), String(servicioId), String(servicioId)]
        );
        servicioTituloSafe = trows[0]?.t || null;
      } catch {
        // ignore
      }
    }

    // Colisiones
    const existentes = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [fecha]);

    if (
      existentes.some((r) => String(r.hora) === String(hora)) ||
      bloqueos.some((b) => String(b.hora) === String(hora))
    )
      return res.status(409).json({ error: 'Hora ya reservada o bloqueada' });

    if (
      existentes.some((r) =>
        overlaps(String(hora), Number(durationMin), String(r.hora), Number(r.durationMin || 60))
      )
    )
      return res.status(409).json({ error: 'Franja solapada' });

    const id = uuidv4();
    const ts = nowISO();
    const pricingJson = pricing ? JSON.stringify(pricing) : null;
    const status = 'pending';

    if (paqueteId) {
      await tx(async () => {
        const pRows = await query(
          `SELECT id, user_id AS userId, status, saldo
             FROM paquetes
            WHERE id = ? LIMIT 1`,
          [String(paqueteId)]
        );
        if (!pRows.length) throw new Error('Paquete no existe');
        const p = pRows[0];
        if (p.status !== 'active') throw new Error('Paquete no activo');
        if (p.userId && p.userId !== uid) throw new Error('El paquete no pertenece al usuario');

        const saldo = parseJSONSafe(p.saldo, { total: 1, usadas: 0, pendientes: 0 });
        if (
          (Number(saldo.usadas || 0) + Number(saldo.pendientes || 0)) >=
          Number(saldo.total || 1)
        )
          throw new Error('Saldo agotado');

        await query(
          `INSERT INTO reservas
            (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note,
             created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
            currency || 'EUR',
            perro || null,
            telefono || null,
            direccion || null,
            pricingJson,
            String(paqueteId),
            status,
            'paquete',
            userNote,
            ts,
            ts,
          ]
        );

        saldo.pendientes = Number(saldo.pendientes || 0) + 1;

        await query(
          `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
          [JSON.stringify(saldo), ts, String(paqueteId)]
        );
      });
    } else {
      await query(
        `INSERT INTO reservas
          (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
           price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note,
           created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          currency || 'EUR',
          perro || null,
          telefono || null,
          direccion || null,
          pricingJson,
          null,
          status,
          'directo',
          userNote,
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
              cancel_reason AS cancelReason, created_at AS createdAt,
              updated_at AS updatedAt
         FROM reservas WHERE id = ?`,
      [id]
    );

    const r = rows[0] || {};
    res.status(201).json({
      ...r,
      pricing: parseJSONSafe(r.pricing, null),
    });
  } catch (e) {
    console.error('POST /reservas', e);
    res.status(500).json({ error: e?.message || 'No se pudo crear la reserva' });
  }
});

/* ===================== Crear reserva (admin) ===================== */
// POST /api/reservas/admin
router.post('/admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      email, fecha, hora, durationMin = 60,
      servicioId, servicioTitulo, modalidad, duration,
      price, currency, perro, telefono, direccion, pricing,
      paqueteId, status: statusBody, adminNote = null, userNote = null,
    } = req.body;

    const emailNorm = String(email || '').trim();
    if (!emailNorm || !fecha || !hora)
      return res.status(400).json({ error: 'Faltan campos (email/fecha/hora)' });

    // fallback del título
    let servicioTituloSafe = servicioTitulo || null;
    if (!servicioTituloSafe && servicioId) {
      try {
        const trows = await query(
          `SELECT COALESCE(title, titulo, name) AS t
             FROM servicios
            WHERE id = ? OR _id = ? OR uuid = ?
            LIMIT 1`,
          [String(servicioId), String(servicioId), String(servicioId)]
        );
        servicioTituloSafe = trows[0]?.t || null;
      } catch {
        // ignore
      }
    }

    // Colisiones
    const existentes = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha=?`, [fecha]);

    if (
      existentes.some((r) => String(r.hora) === String(hora)) ||
      bloqueos.some((b) => String(b.hora) === String(hora))
    )
      return res.status(409).json({ error: 'Hora ya reservada o bloqueada' });

    if (
      existentes.some((r) =>
        overlaps(String(hora), Number(durationMin), String(r.hora), Number(r.durationMin || 60))
      )
    )
      return res.status(409).json({ error: 'Franja solapada' });

    const id = uuidv4();
    const ts = nowISO();
    const pricingJson = pricing ? JSON.stringify(pricing) : null;
    const status = statusBody || 'pending';

    await query(
      `INSERT INTO reservas
        (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
         price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin,
         user_note, admin_note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        currency || 'EUR',
        perro || null,
        telefono || null,
        direccion || null,
        pricingJson,
        paqueteId || null,
        status,
        'admin',
        userNote,
        adminNote,
        ts,
        ts,
      ]
    );

    res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error('POST /reservas/admin', e);
    res.status(500).json({ error: e?.message || 'No se pudo crear (admin)' });
  }
});

/* ===================== Mis reservas (usuario) ===================== */
// GET /api/reservas/mias
router.get('/mias', verifyToken, async (req, res) => {
  try {
    const { uid, email } = req.user || {};
    if (!uid && !email) return res.status(401).json({ error: 'No autenticado' });

    const rows = await query(
      `SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
              servicio_id AS servicioId, servicio_titulo AS servicioTitulo,
              modalidad, duration, price, currency, perro, telefono, direccion,
              pricing, paquete_id AS paqueteId,
              status, origin, user_note AS userNote,
              admin_note AS adminNote, cancel_reason AS cancelReason,
              created_at AS createdAt, updated_at AS updatedAt
         FROM reservas
        WHERE (uid = ? OR email = ?)
        ORDER BY fecha DESC, hora DESC
        LIMIT 200`,
      [uid || null, email || null]
    );

    res.json(
      rows.map((r) => ({
        ...r,
        pricing: parseJSONSafe(r.pricing, null),
      }))
    );
  } catch (e) {
    console.error('GET /reservas/mias', e);
    res.status(500).json({ error: 'No se pudo obtener reservas' });
  }
});

/* ===================== Listado admin ===================== */
// GET /api/reservas?status=...&email=...&limit=...
router.get('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status = 'all', email = '', limit = 300 } = req.query;
    const where = [];
    const params = [];

    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(String(status));
    }
    if (email) {
      where.push('email = ?');
      params.push(String(email).trim());
    }

    const sql = `
      SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
             servicio_id AS servicioId, servicio_titulo AS servicioTitulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id AS paqueteId,
             status, origin, user_note AS userNote, admin_note AS adminNote, cancel_reason AS cancelReason,
             created_at AS createdAt, updated_at AS UpdatedAt
        FROM reservas
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY fecha DESC, hora DESC
       LIMIT ?`;
    params.push(Math.min(Number(limit || 300), 1000));

    const rows = await query(sql, params);

    res.json(
      rows.map((r) => ({
        ...r,
        pricing: parseJSONSafe(r.pricing, null),
      }))
    );
  } catch (e) {
    console.error('GET /reservas', e);
    res.status(500).json({ error: 'No se pudo obtener reservas' });
  }
});

/* ===================== NOTAS TIPO HILO ===================== */

// GET /api/reservas/:id/notes
router.get('/:id/notes', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const perm = await canSeeReservation(req, id);
    if (!perm.ok) return res.status(403).json({ error: 'Sin permisos' });

    const rows = await query(
      `SELECT id, author, text, created_at AS createdAt
         FROM reserva_notas
        WHERE reserva_id=? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [id]
    );

    res.json(rows);
  } catch (e) {
    console.error('GET /reservas/:id/notes', e);
    res.status(500).json({ error: 'No se pudieron obtener notas' });
  }
});

// POST /api/reservas/:id/notes
router.post('/:id/notes', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text = '' } = req.body || {};

    const perm = await canSeeReservation(req, id);
    if (!perm.ok) return res.status(403).json({ error: 'Sin permisos' });

    const author = req.user?.isAdmin ? 'admin' : 'user';
    const nid = uuidv4();
    const ts = nowISO();

    await query(
      `INSERT INTO reserva_notas (id, reserva_id, author, text, created_at)
         VALUES (?,?,?,?,?)`,
      [nid, id, author, String(text).trim(), ts]
    );

    res.status(201).json({
      id: nid,
      author,
      text: String(text).trim(),
      createdAt: ts,
    });
  } catch (e) {
    console.error('POST /reservas/:id/notes', e);
    res.status(500).json({ error: 'No se pudo crear nota' });
  }
});

// DELETE /api/reservas/:id/notes/:noteId
router.delete('/:id/notes/:noteId', verifyToken, async (req, res) => {
  try {
    const { id, noteId } = req.params;

    const perm = await canSeeReservation(req, id);
    if (!perm.ok) return res.status(403).json({ error: 'Sin permisos' });

    const row = (
      await query(
        `SELECT id, author
           FROM reserva_notas
          WHERE id=? AND reserva_id=? AND deleted_at IS NULL
          LIMIT 1`,
        [noteId, id]
      )
    )[0];

    if (!row) return res.status(404).json({ error: 'Nota no encontrada' });

    if (!(req.user?.isAdmin || row.author === 'user'))
      return res.status(403).json({ error: 'No puedes borrar esta nota' });

    await query(`UPDATE reserva_notas SET deleted_at=? WHERE id=?`, [nowISO(), noteId]);

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /reservas/:id/notes/:noteId', e);
    res.status(500).json({ error: 'No se pudo borrar la nota' });
  }
});

/* ===================== Acciones directas ===================== */

// PATCH /api/reservas/:id/confirm (admin)
router.patch('/:id/confirm', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note = '' } = req.body || {};
    await query(
      `UPDATE reservas
          SET status='confirmed',
              admin_note=COALESCE(?,admin_note),
              updated_at=?
        WHERE id=?`,
      [note, nowISO(), id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /reservas/:id/confirm', e);
    res.status(500).json({ error: 'No se pudo confirmar' });
  }
});

// PATCH /api/reservas/:id/reject (admin)
router.patch('/:id/reject', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note = '' } = req.body || {};

    const rRows = await query(
      `SELECT id, paquete_id AS paqueteId, status
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
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
        const pRows = await query(
          `SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`,
          [r.paqueteId]
        );
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
          if (['pending', 'confirmed'].includes(r.status))
            saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
          await query(
            `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
            [JSON.stringify(saldo), nowISO(), r.paqueteId]
          );
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
    console.error('PATCH /reservas/:id/reject', e);
    res.status(500).json({ error: 'No se pudo rechazar' });
  }
});

// PATCH /api/reservas/:id/cancel (owner o admin)
router.patch('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = '' } = req.body || {};

    const rRows = await query(
      `SELECT id, uid, email, paquete_id AS paqueteId, status
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
    const r = rRows[0];

    const isAdmin = !!req.user?.isAdmin;
    const isOwner =
      (r.uid && req.user?.uid && r.uid === req.user.uid) ||
      (r.email && req.user?.email && r.email === req.user.email);
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos' });

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
        const pRows = await query(
          `SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`,
          [r.paqueteId]
        );
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
          if (['pending', 'confirmed'].includes(r.status))
            saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
          await query(
            `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
            [JSON.stringify(saldo), nowISO(), r.paqueteId]
          );
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
    console.error('PATCH /reservas/:id/cancel', e);
    res.status(500).json({ error: 'No se pudo cancelar' });
  }
});

// DELETE /api/reservas/:id
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const rRows = await query(
      `SELECT id, uid, email, paquete_id AS paqueteId, status
         FROM reservas WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
    const r = rRows[0];

    const isAdmin = !!req.user?.isAdmin;
    const isOwner =
      (r.uid && req.user?.uid && r.uid === req.user.uid) ||
      (r.email && req.user?.email && r.email === req.user.email);
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos' });

    if (isAdmin) {
      const note = 'Eliminada por admin';
      await query(
        `UPDATE reservas
            SET status='rejected',
                admin_note=COALESCE(?,admin_note),
                updated_at=?
         WHERE id=?`,
        [note, nowISO(), id]
      );
      if (r.paqueteId && ['pending', 'confirmed'].includes(r.status)) {
        const pRows = await query(
          `SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`,
          [r.paqueteId]
        );
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
          saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
          await query(
            `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
            [JSON.stringify(saldo), nowISO(), r.paqueteId]
          );
        }
      }
    } else {
      await query(
        `UPDATE reservas
            SET status='cancelled',
                cancel_reason='eliminada-por-usuario',
                updated_at=?
         WHERE id=?`,
        [nowISO(), id]
      );
      if (r.paqueteId && ['pending', 'confirmed'].includes(r.status)) {
        const pRows = await query(
          `SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`,
          [r.paqueteId]
        );
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
          saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
          await query(
            `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
            [JSON.stringify(saldo), nowISO(), r.paqueteId]
          );
        }
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /reservas/:id', e);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

/* ===== PATCH genérico (para notas/admin desde el front) ===== */
// PATCH /api/reservas/:id
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote = null, adminNoteAppend = false, cancelReason = null } =
      req.body || {};
    if (!status && adminNote === null) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    // Confirmar / rechazar / cancelar igual que en los handlers directos
    if (status === 'confirmed' && req.user?.isAdmin) {
      await query(
        `UPDATE reservas
            SET status='confirmed',
                admin_note=COALESCE(?,admin_note),
                updated_at=?
         WHERE id=?`,
        [adminNote || '', nowISO(), id]
      );
      return res.json({ ok: true });
    }

    if (status === 'rejected' && req.user?.isAdmin) {
      const rRows = await query(
        `SELECT id, paquete_id AS paqueteId, status
           FROM reservas WHERE id=? LIMIT 1`,
        [id]
      );
      if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
      const r = rRows[0];

      if (r.paqueteId) {
        await tx(async () => {
          await query(
            `UPDATE reservas
                SET status='rejected',
                    admin_note=COALESCE(?,admin_note),
                    updated_at=?
             WHERE id=?`,
            [adminNote || '', nowISO(), id]
          );
          const pRows = await query(
            `SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`,
            [r.paqueteId]
          );
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
            if (['pending', 'confirmed'].includes(r.status))
              saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
            await query(
              `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
              [JSON.stringify(saldo), nowISO(), r.paqueteId]
            );
          }
        });
      } else {
        await query(
          `UPDATE reservas
              SET status='rejected',
                  admin_note=COALESCE(?,admin_note),
                  updated_at=?
           WHERE id=?`,
          [adminNote || '', nowISO(), id]
        );
      }
      return res.json({ ok: true });
    }

    if (status === 'cancelled') {
      const rRows = await query(
        `SELECT id, uid, email, paquete_id AS paqueteId, status
           FROM reservas WHERE id=? LIMIT 1`,
        [id]
      );
      if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
      const r = rRows[0];

      const isAdmin = !!req.user?.isAdmin;
      const isOwner =
        (r.uid && req.user?.uid && r.uid === req.user.uid) ||
        (r.email && req.user?.email && r.email === req.user.email);
      if (!isAdmin && !isOwner)
        return res.status(403).json({ error: 'Sin permisos para cancelar' });

      if (r.paqueteId) {
        await tx(async () => {
          await query(
            `UPDATE reservas
                SET status='cancelled',
                    cancel_reason=COALESCE(?,cancel_reason),
                    updated_at=?
             WHERE id=?`,
            [cancelReason || '', nowISO(), id]
          );
          const pRows = await query(
            `SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`,
            [r.paqueteId]
          );
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total: 1, usadas: 0, pendientes: 0 });
            if (['pending', 'confirmed'].includes(r.status))
              saldo.pendientes = Math.max(0, Number(saldo.pendientes || 0) - 1);
            await query(
              `UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`,
              [JSON.stringify(saldo), nowISO(), r.paqueteId]
            );
          }
        });
      } else {
        await query(
          `UPDATE reservas
              SET status='cancelled',
                  cancel_reason=COALESCE(?,cancel_reason),
                  updated_at=?
           WHERE id=?`,
          [cancelReason || '', nowISO(), id]
        );
      }
      return res.json({ ok: true });
    }

    // Solo actualizar nota admin (sin cambiar estado)
    if (req.user?.isAdmin && adminNote !== null) {
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
        await query(
          `UPDATE reservas
              SET admin_note=?,
                  updated_at=?
           WHERE id=?`,
          [adminNote, nowISO(), id]
        );
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Status no permitido' });
  } catch (e) {
    console.error('PATCH /reservas/:id (generic)', e);
    res.status(500).json({ error: 'No se pudo actualizar' });
  }
});

/* ===================== Bloqueos ===================== */
// POST /api/reservas/bloqueos
router.post('/bloqueos', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { fecha, hora } = req.body;
    if (!fecha || !hora) return res.status(400).json({ error: 'Faltan campos' });

    await query(
      `INSERT INTO bloqueos (id, fecha, hora, created_at)
       VALUES (?,?,?,?)`,
      [uuidv4(), fecha, hora, nowISO()]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /reservas/bloqueos', e);
    res.status(500).json({ error: 'No se pudo crear bloqueo' });
  }
});

// DELETE /api/reservas/bloqueos?fecha=YYYY-MM-DD&hora=HH:MM
router.delete('/bloqueos', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { fecha, hora } = req.query;
    if (!fecha || !hora) return res.status(400).json({ error: 'Faltan fecha y hora' });

    const rows = await query(
      `SELECT id FROM bloqueos WHERE fecha=? AND hora=?`,
      [fecha, hora]
    );
    if (!rows.length) return res.status(404).json({ error: 'Bloqueo no encontrado.' });

    await query(`DELETE FROM bloqueos WHERE fecha=? AND hora=?`, [fecha, hora]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /reservas/bloqueos', e);
    res.status(500).json({ error: 'No se pudo eliminar el bloqueo.' });
  }
});

export default router;
