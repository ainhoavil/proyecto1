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
const toMin = (hhmm) => { const [h, m = 0] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const fromMin = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const overlaps = (aStart, aDur, bStart, bDur) => {
  const a1 = toMin(aStart), a2 = a1 + Number(aDur || 60);
  const b1 = toMin(bStart), b2 = b1 + Number(bDur || 60);
  return a1 < b2 && b1 < a2;
};
const parseJSONSafe = (v, fb = {}) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb); } catch { return fb; } };
async function tx(run) { try { await query('BEGIN IMMEDIATE'); const r = await run(); await query('COMMIT'); return r; } catch (e) { await query('ROLLBACK').catch(()=>{}); throw e; } }

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
      for (let i = 0; i < steps; i++) ocupadasSet.add(fromMin(toMin(String(r.hora)) + i * 60));
    }
    for (const b of bloqueos) ocupadasSet.add(String(b.hora));

    const ocupadas = Array.from(ocupadasSet);
    const libres = slots.filter(s => !ocupadasSet.has(s));
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
      paqueteId, userNote = null
    } = req.body;

    const uid = req.user?.uid || null;
    const emailNorm = String(email || req.user?.email || '').trim();
    if (!uid || !emailNorm || !fecha || !hora) {
      return res.status(400).json({ error: 'Faltan campos (login/email/fecha/hora)' });
    }

    // Colisiones
    const existentes = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [fecha]);
    if (existentes.some(r => String(r.hora) === String(hora)) || bloqueos.some(b => String(b.hora) === String(hora)))
      return res.status(409).json({ error: 'Hora ya reservada o bloqueada' });
    if (existentes.some(r => overlaps(String(hora), Number(durationMin), String(r.hora), Number(r.durationMin || 60))))
      return res.status(409).json({ error: 'Franja solapada' });

    const id = uuidv4(); const ts = nowISO();
    const pricingJson = pricing ? JSON.stringify(pricing) : null;
    const status = 'pending';

    if (paqueteId) {
      await tx(async () => {
        const pRows = await query(`SELECT id, user_id AS userId, status, saldo FROM paquetes WHERE id = ? LIMIT 1`, [String(paqueteId)]);
        if (!pRows.length) throw new Error('Paquete no existe');
        const p = pRows[0];
        if (p.status !== 'active') throw new Error('Paquete no activo');
        if (p.userId && p.userId !== uid) throw new Error('El paquete no pertenece al usuario');
        const saldo = parseJSONSafe(p.saldo, { total: 1, usadas: 0, pendientes: 0 });
        if ((Number(saldo.usadas||0)+Number(saldo.pendientes||0)) >= Number(saldo.total||1)) throw new Error('Saldo agotado');

        await query(
          `INSERT INTO reservas
            (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, uid, emailNorm, fecha, hora, Number(durationMin), servicioId||null, servicioTitulo||null, modalidad||null, duration||null,
           price??null, currency||'EUR', perro||null, telefono||null, direccion||null, pricingJson, String(paqueteId), status, 'paquete', userNote, ts, ts]
        );

        saldo.pendientes = Number(saldo.pendientes||0) + 1;
        await query(`UPDATE paquetes SET saldo = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(saldo), ts, String(paqueteId)]);
      });
    } else {
      await query(
        `INSERT INTO reservas
          (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
           price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, uid, emailNorm, fecha, hora, Number(durationMin), servicioId||null, servicioTitulo||null, modalidad||null, duration||null,
         price??null, currency||'EUR', perro||null, telefono||null, direccion||null, pricingJson, null, status, 'directo', userNote, ts, ts]
      );
    }

    const rows = await query(
      `SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
              servicio_id AS servicioId, servicio_titulo AS servicioTitulo, modalidad, duration,
              price, currency, perro, telefono, direccion, pricing, paquete_id AS paqueteId,
              status, origin, user_note AS userNote, admin_note AS adminNote, cancel_reason AS cancelReason,
              created_at AS createdAt, updated_at AS updatedAt
         FROM reservas WHERE id = ?`,
      [id]
    );
    const r = rows[0] || {};
    res.status(201).json({ ...r, pricing: parseJSONSafe(r.pricing, null) });
  } catch (e) {
    console.error('POST /reservas', e);
    res.status(500).json({ error: e?.message || 'No se pudo crear la reserva' });
  }
});

/* ===================== Crear (admin para otro email) ===================== */
// POST /api/reservas/admin
router.post('/admin', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      email, fecha, hora, durationMin = 60,
      servicioId, servicioTitulo, modalidad, duration,
      price, currency, perro, telefono, direccion, pricing,
      paqueteId, status: statusBody, adminNote = null, userNote = null
    } = req.body;

    const emailNorm = String(email || '').trim();
    if (!emailNorm || !fecha || !hora)
      return res.status(400).json({ error: 'Faltan campos (email/fecha/hora)' });

    // Colisiones
    const existentes = await query(
      `SELECT hora, COALESCE(duration_min,60) AS durationMin
         FROM reservas
        WHERE fecha = ? AND status IN ('pending','confirmed')`,
      [fecha]
    );
    const bloqueos = await query(`SELECT hora FROM bloqueos WHERE fecha = ?`, [fecha]);
    if (existentes.some(r => String(r.hora) === String(hora)) || bloqueos.some(b => String(b.hora) === String(hora)))
      return res.status(409).json({ error: 'Hora ya reservada o bloqueada' });
    if (existentes.some(r => overlaps(String(hora), Number(durationMin), String(r.hora), Number(r.durationMin || 60))))
      return res.status(409).json({ error: 'Franja solapada' });

    const id = uuidv4(); const ts = nowISO();
    const pricingJson = pricing ? JSON.stringify(pricing) : null;
    const status = statusBody || 'pending';

    if (paqueteId) {
      await tx(async () => {
        const pRows = await query(`SELECT id, status, saldo FROM paquetes WHERE id = ? LIMIT 1`, [String(paqueteId)]);
        if (!pRows.length) throw new Error('Paquete no existe');
        const p = pRows[0];
        if (p.status !== 'active') throw new Error('Paquete no activo');
        const saldo = parseJSONSafe(p.saldo, { total: 1, usadas: 0, pendientes: 0 });
        if ((Number(saldo.usadas||0)+Number(saldo.pendientes||0)) >= Number(saldo.total||1)) throw new Error('Saldo agotado');

        await query(
          `INSERT INTO reservas
            (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note, admin_note, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, null, emailNorm, fecha, hora, Number(durationMin), servicioId||null, servicioTitulo||null, modalidad||null, duration||null,
           price??null, currency||'EUR', perro||null, telefono||null, direccion||null, pricingJson, String(paqueteId), status, 'admin', userNote, adminNote, ts, ts]
        );

        saldo.pendientes = Number(saldo.pendientes||0) + (status === 'pending' || status === 'confirmed' ? 1 : 0);
        await query(`UPDATE paquetes SET saldo = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(saldo), ts, String(paqueteId)]);
      });
    } else {
      await query(
        `INSERT INTO reservas
          (id, uid, email, fecha, hora, duration_min, servicio_id, servicio_titulo, modalidad, duration,
           price, currency, perro, telefono, direccion, pricing, paquete_id, status, origin, user_note, admin_note, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, null, emailNorm, fecha, hora, Number(durationMin), servicioId||null, servicioTitulo||null, modalidad||null, duration||null,
         price??null, currency||'EUR', perro||null, telefono||null, direccion||null, pricingJson, null, status, 'admin', userNote, adminNote, ts, ts]
      );
    }

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
              servicio_id AS servicioId, servicio_titulo AS servicioTitulo, modalidad, duration,
              price, currency, perro, telefono, direccion, pricing, paquete_id AS paqueteId,
              status, origin, user_note AS userNote, admin_note AS adminNote, cancel_reason AS cancelReason,
              created_at AS createdAt, updated_at AS updatedAt
         FROM reservas
        WHERE (uid = ? OR email = ?)
        ORDER BY fecha DESC, hora DESC
        LIMIT 200`,
      [uid||null, email||null]
    );
    res.json(rows.map(r => ({ ...r, pricing: parseJSONSafe(r.pricing, null) })));
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
    const where = []; const params = [];
    if (status && status !== 'all') { where.push('status = ?'); params.push(String(status)); }
    if (email) { where.push('email = ?'); params.push(String(email).trim()); }
    const sql = `
      SELECT id, uid, email, fecha, hora, duration_min AS durationMin,
             servicio_id AS servicioId, servicio_titulo AS servicioTitulo, modalidad, duration,
             price, currency, perro, telefono, direccion, pricing, paquete_id AS paqueteId,
             status, origin, user_note AS userNote, admin_note AS adminNote, cancel_reason AS cancelReason,
             created_at AS createdAt, updated_at AS updatedAt
        FROM reservas
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY fecha DESC, hora DESC
       LIMIT ?`;
    params.push(Math.min(Number(limit||300), 1000));
    const rows = await query(sql, params);
    res.json(rows.map(r => ({ ...r, pricing: parseJSONSafe(r.pricing, null) })));
  } catch (e) {
    console.error('GET /reservas', e);
    res.status(500).json({ error: 'No se pudo obtener reservas' });
  }
});

/* ===================== Notas ===================== */
// PATCH /api/reservas/:id/user-note   (owner o admin)
router.patch('/:id/user-note', verifyToken, async (req, res) => {
  try {
    const { id } = req.params; const { note = '' } = req.body || {};
    const rRows = await query(`SELECT id, uid FROM reservas WHERE id=? LIMIT 1`, [id]);
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
    const r = rRows[0];
    const isAdmin = !!req.user?.isAdmin; const isOwner = r.uid && req.user?.uid && r.uid === req.user.uid;
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos' });

    await query(`UPDATE reservas SET user_note=?, updated_at=? WHERE id=?`, [note, nowISO(), id]);
    res.json({ ok: true });
  } catch (e) { console.error('PATCH /reservas/:id/user-note', e); res.status(500).json({ error: 'No se pudo guardar la nota' }); }
});

// PATCH /api/reservas/:id/admin-note  (admin, con append opcional)
router.patch('/:id/admin-note', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params; const { note = '', append = false } = req.body || {};
    if (append) {
      // Concatena con separador " · " si ya hubiera nota
      await query(
        `UPDATE reservas
            SET admin_note = TRIM(COALESCE(admin_note,'') || CASE WHEN ?<>'' THEN CASE WHEN admin_note IS NULL OR admin_note='' THEN ? ELSE ' · '||? END ELSE '' END),
                updated_at = ?
          WHERE id = ?`,
        [note, note, note, nowISO(), id]
      );
    } else {
      await query(`UPDATE reservas SET admin_note=?, updated_at=? WHERE id=?`, [note, nowISO(), id]);
    }
    res.json({ ok: true });
  } catch (e) { console.error('PATCH /reservas/:id/admin-note', e); res.status(500).json({ error: 'No se pudo guardar la nota' }); }
});

/* ===================== Acciones ===================== */
// PATCH /api/reservas/:id/confirm (admin)
router.patch('/:id/confirm', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params; const { note = '' } = req.body || {};
    await query(
      `UPDATE reservas SET status='confirmed', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`,
      [note, nowISO(), id]
    );
    res.json({ ok: true });
  } catch (e) { console.error('PATCH /reservas/:id/confirm', e); res.status(500).json({ error: 'No se pudo confirmar' }); }
});

// PATCH /api/reservas/:id/reject (admin)
router.patch('/:id/reject', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params; const { note = '' } = req.body || {};
    const rRows = await query(`SELECT id, paquete_id AS paqueteId, status FROM reservas WHERE id=? LIMIT 1`, [id]);
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
    const r = rRows[0];

    if (r.paqueteId) {
      await tx(async () => {
        await query(`UPDATE reservas SET status='rejected', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`, [note, nowISO(), id]);
        const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [r.paqueteId]);
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total:1, usadas:0, pendientes:0 });
          if (['pending','confirmed'].includes(r.status)) saldo.pendientes = Math.max(0, Number(saldo.pendientes||0) - 1);
          await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [JSON.stringify(saldo), nowISO(), r.paqueteId]);
        }
      });
    } else {
      await query(`UPDATE reservas SET status='rejected', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`, [note, nowISO(), id]);
    }
    res.json({ ok: true });
  } catch (e) { console.error('PATCH /reservas/:id/reject', e); res.status(500).json({ error: 'No se pudo rechazar' }); }
});

// PATCH /api/reservas/:id/cancel (owner o admin)
router.patch('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const { id } = req.params; const { reason = '' } = req.body || {};
    const rRows = await query(`SELECT id, uid, paquete_id AS paqueteId, status FROM reservas WHERE id=? LIMIT 1`, [id]);
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
    const r = rRows[0];
    const isAdmin = !!req.user?.isAdmin; const isOwner = r.uid && req.user?.uid && r.uid === req.user.uid;
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos para cancelar' });

    if (r.paqueteId) {
      await tx(async () => {
        await query(`UPDATE reservas SET status='cancelled', cancel_reason=COALESCE(?,cancel_reason), updated_at=? WHERE id=?`, [reason||null, nowISO(), id]);
        const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [r.paqueteId]);
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total:1, usadas:0, pendientes:0 });
          if (['pending','confirmed'].includes(r.status)) saldo.pendientes = Math.max(0, Number(saldo.pendientes||0) - 1);
          await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [JSON.stringify(saldo), nowISO(), r.paqueteId]);
        }
      });
    } else {
      await query(`UPDATE reservas SET status='cancelled', cancel_reason=COALESCE(?,cancel_reason), updated_at=? WHERE id=?`, [reason||null, nowISO(), id]);
    }
    res.json({ ok: true });
  } catch (e) { console.error('PATCH /reservas/:id/cancel', e); res.status(500).json({ error: 'No se pudo cancelar' }); }
});

// DELETE /api/reservas/:id
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const rRows = await query(`SELECT id, uid, paquete_id AS paqueteId, status FROM reservas WHERE id=? LIMIT 1`, [id]);
    if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
    const r = rRows[0];
    const isAdmin = !!req.user?.isAdmin; const isOwner = r.uid && req.user?.uid && r.uid === req.user.uid;
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos' });

    if (isAdmin) {
      // como reject
      const note = 'Eliminada por admin';
      await query(`UPDATE reservas SET status='rejected', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`, [note, nowISO(), id]);
      if (r.paqueteId && ['pending','confirmed'].includes(r.status)) {
        const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [r.paqueteId]);
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total:1, usadas:0, pendientes:0 });
          saldo.pendientes = Math.max(0, Number(saldo.pendientes||0) - 1);
          await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [JSON.stringify(saldo), nowISO(), r.paqueteId]);
        }
      }
    } else {
      // como cancel
      await query(`UPDATE reservas SET status='cancelled', cancel_reason='eliminada-por-usuario', updated_at=? WHERE id=?`, [nowISO(), id]);
      if (r.paqueteId && ['pending','confirmed'].includes(r.status)) {
        const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [r.paqueteId]);
        if (pRows.length) {
          const saldo = parseJSONSafe(pRows[0].saldo, { total:1, usadas:0, pendientes:0 });
          saldo.pendientes = Math.max(0, Number(saldo.pendientes||0) - 1);
          await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [JSON.stringify(saldo), nowISO(), r.paqueteId]);
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /reservas/:id', e); res.status(500).json({ error: 'No se pudo eliminar' }); }
});

/* ===== PATCH genérico (bridge para el frontend) ===== */
// PATCH /api/reservas/:id  (admin: confirmed/rejected; user/admin: cancelled)
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote = null, adminNoteAppend = false, cancelReason = null } = req.body || {};
    if (!status) return res.status(400).json({ error: 'Falta status' });

    if (status === 'confirmed' && req.user?.isAdmin) {
      await query(`UPDATE reservas SET status='confirmed', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`, [adminNote||'', nowISO(), id]);
      return res.json({ ok: true });
    }
    if (status === 'rejected' && req.user?.isAdmin) {
      // Reusar lógica de /reject (con transacción por paquete)
      const rRows = await query(`SELECT id, paquete_id AS paqueteId, status FROM reservas WHERE id=? LIMIT 1`, [id]);
      if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
      const r = rRows[0];
      if (r.paqueteId) {
        await tx(async () => {
          await query(`UPDATE reservas SET status='rejected', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`, [adminNote||'', nowISO(), id]);
          const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [r.paqueteId]);
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total:1, usadas:0, pendientes:0 });
            if (['pending','confirmed'].includes(r.status)) saldo.pendientes = Math.max(0, Number(saldo.pendientes||0) - 1);
            await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [JSON.stringify(saldo), nowISO(), r.paqueteId]);
          }
        });
      } else {
        await query(`UPDATE reservas SET status='rejected', admin_note=COALESCE(?,admin_note), updated_at=? WHERE id=?`, [adminNote||'', nowISO(), id]);
      }
      return res.json({ ok: true });
    }
    if (status === 'cancelled') {
      // Reusar lógica de /cancel
      const rRows = await query(`SELECT id, uid, paquete_id AS paqueteId, status FROM reservas WHERE id=? LIMIT 1`, [id]);
      if (!rRows.length) return res.status(404).json({ error: 'Reserva no encontrada' });
      const r = rRows[0];
      const isAdmin = !!req.user?.isAdmin; const isOwner = r.uid && req.user?.uid && r.uid === req.user.uid;
      if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos para cancelar' });

      if (r.paqueteId) {
        await tx(async () => {
          await query(`UPDATE reservas SET status='cancelled', cancel_reason=COALESCE(?,cancel_reason), updated_at=? WHERE id=?`, [cancelReason||'', nowISO(), id]);
          const pRows = await query(`SELECT id, saldo FROM paquetes WHERE id=? LIMIT 1`, [r.paqueteId]);
          if (pRows.length) {
            const saldo = parseJSONSafe(pRows[0].saldo, { total:1, usadas:0, pendientes:0 });
            if (['pending','confirmed'].includes(r.status)) saldo.pendientes = Math.max(0, Number(saldo.pendientes||0) - 1);
            await query(`UPDATE paquetes SET saldo=?, updated_at=? WHERE id=?`, [JSON.stringify(saldo), nowISO(), r.paqueteId]);
          }
        });
      } else {
        await query(`UPDATE reservas SET status='cancelled', cancel_reason=COALESCE(?,cancel_reason), updated_at=? WHERE id=?`, [cancelReason||'', nowISO(), id]);
      }
      return res.json({ ok: true });
    }

    // Edición solo de nota admin por el bridge (opcional)
    if (req.user?.isAdmin && adminNote !== null) {
      if (adminNoteAppend) {
        await query(
          `UPDATE reservas
              SET admin_note = TRIM(COALESCE(admin_note,'') || CASE WHEN ?<>'' THEN CASE WHEN admin_note IS NULL OR admin_note='' THEN ? ELSE ' · '||? END ELSE '' END),
                  updated_at = ?
            WHERE id = ?`,
          [adminNote, adminNote, adminNote, nowISO(), id]
        );
      } else {
        await query(`UPDATE reservas SET admin_note=?, updated_at=? WHERE id=?`, [adminNote, nowISO(), id]);
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Status no permitido' });
  } catch (e) { console.error('PATCH /reservas/:id (generic)', e); res.status(500).json({ error: 'No se pudo actualizar' }); }
});

/* ===================== Bloqueos ===================== */
// POST /api/reservas/bloqueos
router.post('/bloqueos', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { fecha, hora } = req.body;
    if (!fecha || !hora) return res.status(400).json({ error: 'Faltan campos' });
    await query(`INSERT INTO bloqueos (id, fecha, hora, created_at) VALUES (?,?,?,?)`, [uuidv4(), fecha, hora, nowISO()]);
    res.json({ ok: true });
  } catch (e) { console.error('POST /reservas/bloqueos', e); res.status(500).json({ error: 'No se pudo crear bloqueo' }); }
});

// DELETE /api/reservas/bloqueos?fecha=YYYY-MM-DD&hora=HH:MM
router.delete('/bloqueos', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { fecha, hora } = req.query;
    if (!fecha || !hora) return res.status(400).json({ error: 'Faltan fecha y hora' });
    const rows = await query(`SELECT id FROM bloqueos WHERE fecha=? AND hora=?`, [fecha, hora]);
    if (!rows.length) return res.status(404).json({ error: 'Bloqueo no encontrado.' });
    await query(`DELETE FROM bloqueos WHERE fecha=? AND hora=?`, [fecha, hora]);
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /reservas/bloqueos', e); res.status(500).json({ error: 'No se pudo eliminar el bloqueo.' }); }
});

export default router;
