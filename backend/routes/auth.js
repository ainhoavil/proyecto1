// backend/routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { nanoid } from 'nanoid';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Faltan email y/o password' });

    const exists = await query(
      'SELECT 1 FROM users WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    if (exists.length) return res.status(409).json({ error: 'Email ya registrado' });

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid();
    await query(
      'INSERT INTO users (id, uid, email, created_at, updated_at) VALUES (?, ?, ?, datetime("now"), datetime("now"))',
      [nanoid(), uid, email.trim().toLowerCase()]
    );

    const token = jwt.sign({ sub: uid, email: email.trim().toLowerCase() }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ ok: true, token, email: email.trim().toLowerCase() });
  } catch (e) {
    console.error('[REGISTER] ERROR', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Faltan campos' });

    const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [email.trim().toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Usuario no encontrado' });

    const user = rows[0];

    // Si tienes login con password (bcrypt)
    if (user.password_hash) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // ⚡ Asegurarse de que exista el registro en la tabla 'users'
    const checkUser = await query('SELECT id FROM users WHERE uid = ? LIMIT 1', [user.uid]);
    if (!checkUser.length) {
      await query(
        'INSERT INTO users (uid, email, created_at, updated_at) VALUES (?, ?, datetime("now"), datetime("now"))',
        [user.uid, user.email]
      );
    }

    const token = jwt.sign({ sub: user.uid, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: user.email });
  } catch (e) {
    console.error('[LOGIN] ERROR', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
