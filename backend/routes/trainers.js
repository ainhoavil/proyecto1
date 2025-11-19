// backend/routes/trainers.js
import express from "express";
import { query } from "../db.js";
import { verifyToken, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   GET /api/trainers  (solo admin)
   Lista usuarios con rol = 'adiestrador'
============================================================ */
router.get("/", verifyToken, requireAdmin, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id AS uid,
              email,
              nombre,
              rol
         FROM usuarios
        WHERE rol = 'adiestrador'
        ORDER BY nombre IS NULL, nombre ASC, email ASC`
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /api/trainers error:", err);
    res.status(500).json({ error: "No se pudo obtener la lista de adiestradores" });
  }
});

export default router;
