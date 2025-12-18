import express from "express";
import { query } from "../db.js";
import { verifyToken, allowRoles } from "../middleware/auth.js";

const router = express.Router();

/* ============================================================
   GET /api/trainers/eligible
   Devuelve TODOS los usuarios con rol = 'adiestrador'
   (cliente / user / admin)
============================================================ */
router.get(
  "/eligible",
  verifyToken,
  allowRoles(["admin", "client", "user", "adiestrador"]),
  async (_req, res) => {
    try {
      const rows = await query(
        `SELECT id AS uid, email
           FROM usuarios
          WHERE rol = 'adiestrador'
          ORDER BY email ASC`
      );

      res.json(rows);
    } catch (err) {
      console.error("GET /api/trainers/eligible error:", err);
      res.status(500).json({
        error: "No se pudo cargar la lista de adiestradores",
      });
    }
  }
);

export default router;
