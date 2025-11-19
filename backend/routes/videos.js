import express from 'express';
import { query } from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// GET /api/videos -> lista vídeos públicos
router.get('/', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT
         id,
         title,
         url,
         tier,
         created_at AS createdAt
       FROM videos
       WHERE tier = 'public'
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /api/videos error:', e);
    res.status(500).json({ error: 'No se pudieron cargar los vídeos' });
  }
});

// POST /api/videos -> crea un vídeo {title, url, tier} (SOLO ADMIN)
router.post('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { title, url, tier } = req.body || {};
    if (!title || !url || !tier) {
      return res.status(400).json({ error: 'Faltan campos (title, url, tier)' });
    }
    const t = String(tier) === 'private' ? 'private' : 'public';
    const id = uuidv4();
    const now = new Date().toISOString();

    await query(
      `INSERT INTO videos (id, title, url, tier, created_at)
       VALUES (?,?,?,?,?)`,
      [id, String(title), String(url), t, now]
    );

    res.status(201).json({ ok: true, id });
  } catch (e) {
    console.error('POST /api/videos error:', e);
    res.status(500).json({ error: 'No se pudo crear el vídeo' });
  }
});

// DELETE /api/videos/:id -> borrar vídeo (SOLO ADMIN)
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await query(`DELETE FROM videos WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/videos/:id error:', e);
    res.status(500).json({ error: 'No se pudo borrar el vídeo' });
  }
});

export default router;
