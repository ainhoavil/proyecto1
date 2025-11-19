import express from 'express';
import { query } from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Helper para JSON seguro
function parseJSONSafe(v, fb = {}) {
  try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb); }
  catch { return fb; }
}

// GET /api/paquetes/mios  -> paquetes activos del usuario
router.get('/mios', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    if (!uid) return res.status(401).json({ error: 'No autenticado' });

    const rows = await query(
      `SELECT
         id,
         user_id       AS userId,
         perro_id      AS perroId,
         servicio_id   AS servicioId,
         status,
         saldo,
         requires_questionnaire AS requiresQuestionnaire,
         price,
         currency,
         payment_ref   AS paymentRef,
         created_at    AS createdAt,
         updated_at    AS updatedAt,
         expires_at    AS expiresAt
       FROM paquetes
       WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC`,
      [uid]
    );

    const data = rows.map(r => ({
      ...r,
      saldo: parseJSONSafe(r.saldo, { total: 0, usadas: 0, pendientes: 0 }),
    }));

    return res.json(data);
  } catch (e) {
    console.error('GET /paquetes/mios', e);
    return res.status(500).json({ error: 'No se pudo obtener' });
  }
});

// POST /api/paquetes  -> crear paquete (normalmente tras pago)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    if (!uid) return res.status(401).json({ error: 'No autenticado' });

    const {
      perroId,
      servicioId,
      totalSesiones = 1,
      requiresQuestionnaire = false,
      expiresInDays = null,
      price = 0,
      currency = 'EUR',
      paymentRef = null,
    } = req.body;

    if (!perroId || !servicioId) {
      return res.status(400).json({ error: 'Faltan perroId/servicioId' });
    }

    // (Opcional) validar que el perro pertenece al usuario
    try {
      const perro = await query(
        'SELECT id FROM perros WHERE id = ? AND user_id = ? LIMIT 1',
        [perroId, uid]
      );
      if (perro.length === 0) {
        return res.status(400).json({ error: 'Perro no encontrado o no pertenece al usuario' });
      }
    } catch (_) {
      // si no tienes tabla perros, puedes eliminar este bloque
    }

    const now = new Date();
    const expiresAt = expiresInDays
      ? new Date(now.getTime() + Number(expiresInDays) * 86400000).toISOString()
      : null;

    const saldo = {
      total: Number(totalSesiones),
      usadas: 0,
      pendientes: 0,
    };

    const id = uuidv4();

    await query(
      `INSERT INTO paquetes
         (id, user_id, perro_id, servicio_id, status, saldo, requires_questionnaire,
          price, currency, payment_ref, created_at, updated_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        uid,
        perroId,
        servicioId,
        'active',
        JSON.stringify(saldo),
        !!requiresQuestionnaire ? 1 : 0,
        Number(price),
        currency,
        paymentRef,
        now.toISOString(),
        now.toISOString(),
        expiresAt,
      ]
    );

    const rows = await query(
      `SELECT
         id,
         user_id       AS userId,
         perro_id      AS perroId,
         servicio_id   AS servicioId,
         status,
         saldo,
         requires_questionnaire AS requiresQuestionnaire,
         price,
         currency,
         payment_ref   AS paymentRef,
         created_at    AS createdAt,
         updated_at    AS UpdatedAt,
         expires_at    AS expiresAt
       FROM paquetes
       WHERE id = ?`,
      [id]
    );

    const r = rows[0];
    return res.status(201).json({
      ...r,
      saldo: parseJSONSafe(r.saldo, { total: 0, usadas: 0, pendientes: 0 }),
    });
  } catch (e) {
    console.error('POST /paquetes', e);
    return res.status(500).json({ error: 'No se pudo crear el paquete' });
  }
});

// PUT /api/paquetes/:id  -> admin: actualizar estado/ajustes
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Whitelist de campos permitidos para actualizar
    const allowed = [
      'status',                 // 'active' | 'paused' | 'expired' | 'cancelled' ...
      'saldo',                  // { total, usadas, pendientes }
      'requiresQuestionnaire',  // boolean
      'price',
      'currency',
      'paymentRef',
      'expiresAt',
    ];

    const patch = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    patch.updatedAt = new Date().toISOString();

    // Construir SQL dinámico
    const sets = [];
    const params = [];

    if ('status' in patch) {
      sets.push('status = ?');
      params.push(String(patch.status));
    }
    if ('saldo' in patch) {
      sets.push('saldo = ?');
      params.push(JSON.stringify(patch.saldo || {}));
    }
    if ('requiresQuestionnaire' in patch) {
      sets.push('requires_questionnaire = ?');
      params.push(patch.requiresQuestionnaire ? 1 : 0);
    }
    if ('price' in patch) {
      sets.push('price = ?');
      params.push(Number(patch.price));
    }
    if ('currency' in patch) {
      sets.push('currency = ?');
      params.push(String(patch.currency));
    }
    if ('paymentRef' in patch) {
      sets.push('payment_ref = ?');
      params.push(patch.paymentRef);
    }
    if ('expiresAt' in patch) {
      sets.push('expires_at = ?');
      params.push(patch.expiresAt);
    }

    // siempre actualizar updated_at
    sets.push('updated_at = ?');
    params.push(patch.updatedAt);

    if (sets.length === 1) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(id);

    await query(
      `UPDATE paquetes
         SET ${sets.join(', ')}
       WHERE id = ?`,
      params
    );

    const rows = await query(
      `SELECT
         id,
         user_id       AS userId,
         perro_id      AS perroId,
         servicio_id   AS servicioId,
         status,
         saldo,
         requires_questionnaire AS requiresQuestionnaire,
         price,
         currency,
         payment_ref   AS paymentRef,
         created_at    AS createdAt,
         updated_at    AS updatedAt,
         expires_at    AS expiresAt
       FROM paquetes
       WHERE id = ?`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Paquete no encontrado' });

    const r = rows[0];
    return res.json({
      ...r,
      saldo: parseJSONSafe(r.saldo, { total: 0, usadas: 0, pendientes: 0 }),
    });
  } catch (e) {
    console.error('PUT /paquetes/:id', e);
    return res.status(500).json({ error: 'No se pudo actualizar' });
  }
});

export default router;
