import express from 'express';
import { query } from '../db.js';

const router = express.Router();

// POST /api/contacto  → guardar mensaje de contacto
router.post('/', async (req, res) => {
  try {
    const { nombre, email, mensaje } = req.body;

    if (!nombre || !email || !mensaje) {
      return res.status(400).json({ error: 'Faltan campos' });
    }

    const now = new Date().toISOString();

    await query(
      `INSERT INTO mensajes (id, nombre, email, mensaje, fecha)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
      [nombre, email, mensaje, now]
    );

    res.status(201).json({ mensaje: 'Enviado correctamente' });
  } catch (error) {
    console.error('POST /api/contacto', error);
    res.status(500).json({ error: 'Error al guardar el mensaje' });
  }
});

export default router;
