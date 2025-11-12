import express from 'express';
import { query } from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const TABLE = 'servicios';

// GET /api/servicios  → lista (pública)
router.get('/', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT
         id,
         title,
         short,
         long,
         price,
         currency,
         duration,
         mode,
         featured,
         "order",
         image_url AS imageUrl,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM ${TABLE}
       ORDER BY "order" ASC, created_at ASC`
    );
    // featured se almacena como 0/1, lo exponemos como boolean
    const data = rows.map(r => ({ ...r, featured: !!r.featured }));
    res.json(data);
  } catch (e) {
    console.error('GET servicios', e);
    res.status(500).json({ error: 'No se pudieron cargar los servicios' });
  }
});

// POST /api/servicios  → crear (admin)
router.post('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      title,
      short,
      long,
      price,
      currency = 'EUR',
      duration,
      mode,
      featured = false,
      order = Date.now(),
      imageUrl = '',
    } = req.body || {};

    if (!title || !short) {
      return res.status(400).json({ error: 'title y short son obligatorios' });
    }

    const doc = {
      id: uuidv4(),
      title: String(title),
      short: String(short),
      long: long != null ? String(long) : null,
      price:
        price === '' || price === null || typeof price === 'undefined'
          ? null
          : Number(price),
      currency: String(currency || 'EUR'),
      duration: duration != null ? String(duration) : null,
      mode: mode != null ? String(mode) : null,
      featured: featured ? 1 : 0,
      order: Number(order) || Date.now(),
      imageUrl: String(imageUrl || ''),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await query(
      `INSERT INTO ${TABLE}
         (id, title, short, long, price, currency, duration, mode, featured, "order", image_url, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        doc.id,
        doc.title,
        doc.short,
        doc.long,
        doc.price,
        doc.currency,
        doc.duration,
        doc.mode,
        doc.featured,
        doc.order,
        doc.imageUrl,
        doc.createdAt,
        doc.updatedAt,
      ]
    );

    res.status(201).json({
      id: doc.id,
      title: doc.title,
      short: doc.short,
      long: doc.long,
      price: doc.price,
      currency: doc.currency,
      duration: doc.duration,
      mode: doc.mode,
      featured: !!doc.featured,
      order: doc.order,
      imageUrl: doc.imageUrl,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (e) {
    console.error('POST servicios', e);
    res.status(500).json({ error: 'No se pudo crear el servicio' });
  }
});

// PATCH /api/servicios/:id  → actualizar (admin)
router.patch('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // whitelist de campos
    const fields = [
      'title',
      'short',
      'long',
      'price',
      'currency',
      'duration',
      'mode',
      'featured',
      'order',
      'imageUrl',
    ];

    const patch = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        if (f === 'price') {
          const val = req.body[f];
          patch.price =
            val === '' || val === null || typeof val === 'undefined'
              ? null
              : Number(val);
        } else if (f === 'featured') {
          patch.featured = req.body[f] ? 1 : 0;
        } else if (f === 'order') {
          patch.order = Number(req.body[f]);
        } else if (f === 'imageUrl') {
          patch.imageUrl = String(req.body[f] || '');
        } else {
          patch[f] = req.body[f] != null ? String(req.body[f]) : null;
        }
      }
    }
    const updatedAt = new Date().toISOString();

    // construir UPDATE dinámico
    const sets = [];
    const params = [];
    if ('title' in patch) { sets.push('title = ?'); params.push(patch.title); }
    if ('short' in patch) { sets.push('short = ?'); params.push(patch.short); }
    if ('long' in patch) { sets.push('long = ?'); params.push(patch.long); }
    if ('price' in patch) { sets.push('price = ?'); params.push(patch.price); }
    if ('currency' in patch) { sets.push('currency = ?'); params.push(patch.currency); }
    if ('duration' in patch) { sets.push('duration = ?'); params.push(patch.duration); }
    if ('mode' in patch) { sets.push('mode = ?'); params.push(patch.mode); }
    if ('featured' in patch) { sets.push('featured = ?'); params.push(patch.featured); }
    if ('order' in patch) { sets.push('"order" = ?'); params.push(patch.order); }
    if ('imageUrl' in patch) { sets.push('image_url = ?'); params.push(patch.imageUrl); }

    sets.push('updated_at = ?'); params.push(updatedAt);
    params.push(id);

    if (sets.length === 1) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    await query(
      `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH servicios', e);
    res.status(500).json({ error: 'No se pudo actualizar el servicio' });
  }
});

// DELETE /api/servicios/:id  → borrar (admin)
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await query(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE servicios', e);
    res.status(500).json({ error: 'No se pudo borrar el servicio' });
  }
});

export default router;
