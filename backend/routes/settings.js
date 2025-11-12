import express from 'express';
import { query } from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const TABLE = 'settings';

const DEFAULT_TOPBAR = {
  schedule: 'Horario: 9h a 21h de L a V, Sáb de 10h a 14h',
  email: 'info@dogform.com',
  phone: '612345678',
  social: { instagram: '', facebook: '' },
};

const DEFAULT_PRICING = {
  packs: [
    { id: 'pack4', label: 'Pack 4 sesiones (-10%)', sessions: 4, discountPct: 10 },
    { id: 'pack6', label: 'Pack 6 sesiones (-15%)', sessions: 6, discountPct: 15 },
  ],
  extras: [
    { id: 'eval',  label: 'Evaluación inicial', price: 40 },
    { id: 'paseo', label: 'Paseo educativo',    price: 25 },
  ],
};

function parseJSONSafe(v, fb = null) {
  try { return v ? JSON.parse(v) : fb; } catch { return fb; }
}

async function getSetting(key) {
  const rows = await query(`SELECT data FROM ${TABLE} WHERE key = ? LIMIT 1`, [key]);
  return rows.length ? parseJSONSafe(rows[0].data, null) : null;
}

async function setSetting(key, obj) {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO ${TABLE} (key, data, updated_at)
     VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
    [key, JSON.stringify(obj ?? {}), now]
  );
}

// ===== TOPBAR =====

// GET /api/settings/topbar (público)
router.get('/topbar', async (_req, res) => {
  try {
    const data = (await getSetting('topbar')) ?? DEFAULT_TOPBAR;
    res.json(data);
  } catch (e) {
    console.error('GET /api/settings/topbar', e);
    res.status(500).json({ error: 'No se pudo cargar el topbar' });
  }
});

// PUT /api/settings/topbar (admin)
router.put('/topbar', verifyToken, requireAdmin, async (req, res) => {
  try {
    const prev = (await getSetting('topbar')) ?? DEFAULT_TOPBAR;
    const { schedule, email, phone, social } = req.body || {};

    const next = {
      ...prev,
      ...(schedule != null ? { schedule } : {}),
      ...(email    != null ? { email }    : {}),
      ...(phone    != null ? { phone }    : {}),
      ...(social   != null ? {
        social: {
          instagram: social?.instagram ?? prev.social?.instagram ?? '',
          facebook:  social?.facebook  ?? prev.social?.facebook  ?? ''
        }
      } : {}),
      updatedAt: new Date().toISOString(),
    };

    await setSetting('topbar', next);
    res.json({ ok: true, data: next });
  } catch (e) {
    console.error('PUT /api/settings/topbar', e);
    res.status(500).json({ error: 'No se pudo guardar el topbar' });
  }
});

// ===== PRICING =====

// GET /api/settings/pricing (público)
router.get('/pricing', async (_req, res) => {
  try {
    const data = (await getSetting('pricing')) ?? DEFAULT_PRICING;
    res.json(data);
  } catch (e) {
    console.error('GET /api/settings/pricing', e);
    res.status(500).json({ error: 'No se pudo cargar pricing' });
  }
});

export default router;
