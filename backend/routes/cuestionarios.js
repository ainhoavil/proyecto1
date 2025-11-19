// backend/routes/cuestionarios.js
import express from 'express';
import { query } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Helper: parsea JSON seguro
function parseJSONSafe(text, fallback = {}) {
  try { return text ? JSON.parse(text) : fallback; }
  catch { return fallback; }
}

// GET /api/cuestionarios/mios
router.get('/mios', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    if (!uid) return res.status(401).json({ error: 'No autenticado' });

    const { perroId, servicioId } = req.query;
    const params = [uid];
    let sql = `
      SELECT
        id,
        user_id     AS userId,
        perro_id    AS perroId,
        servicio_id AS servicioId,
        answers,
        status,
        created_at  AS createdAt,
        updated_at  AS updatedAt
      FROM cuestionarios
      WHERE user_id = ?
    `;

    if (perroId) { sql += ' AND perro_id = ?'; params.push(perroId); }
    if (servicioId) { sql += ' AND servicio_id = ?'; params.push(servicioId); }
    sql += ' ORDER BY updated_at DESC';

    const rows = await query(sql, params);
    const data = rows.map(r => ({ ...r, answers: parseJSONSafe(r.answers) }));
    return res.json(data);
  } catch (e) {
    console.error('GET /cuestionarios/mios', e);
    return res.status(500).json({ error: 'No se pudo obtener' });
  }
});

// POST /api/cuestionarios  (upsert por userId+perroId+servicioId)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    if (!uid) return res.status(401).json({ error: 'No autenticado' });

    const { perroId, servicioId, answers, status } = req.body;
    if (!perroId || !servicioId) {
      return res.status(400).json({ error: 'Falta perroId o servicioId' });
    }

    const normalizedStatus = status === 'complete' ? 'complete' : 'incomplete';
    const now = new Date().toISOString();

    const prev = await query(
      `SELECT id FROM cuestionarios
       WHERE user_id = ? AND perro_id = ? AND servicio_id = ?
       LIMIT 1`,
      [uid, perroId, servicioId]
    );

    if (prev.length === 0) {
      const id = uuidv4();
      await query(
        `INSERT INTO cuestionarios
         (id, user_id, perro_id, servicio_id, answers, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, uid, perroId, servicioId, JSON.stringify(answers || {}), normalizedStatus, now, now]
      );

      const rows = await query(
        `SELECT
           id, user_id AS userId, perro_id AS perroId, servicio_id AS servicioId,
           answers, status, created_at AS createdAt, updated_at AS updatedAt
         FROM cuestionarios WHERE id = ?`,
        [id]
      );
      const r = rows[0];
      return res.status(201).json({ ...r, answers: parseJSONSafe(r.answers) });
    } else {
      const id = prev[0].id;
      await query(
        `UPDATE cuestionarios
           SET answers = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [JSON.stringify(answers || {}), normalizedStatus, now, id]
      );

      const rows = await query(
        `SELECT
           id, user_id AS userId, perro_id AS perroId, servicio_id AS servicioId,
           answers, status, created_at AS createdAt, updated_at AS updatedAt
         FROM cuestionarios WHERE id = ?`,
        [id]
      );
      const r = rows[0];
      return res.json({ ...r, answers: parseJSONSafe(r.answers) });
    }
  } catch (e) {
    console.error('POST /cuestionarios', e);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
});

export default router;
