// backend/routes/perros.js
import express from "express";
import { query } from "../db.js";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

// --- middleware auth ---
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });

  try {
    const token = h.replace("Bearer ", "");
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// ✅ GET /api/perros
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.sub;

    const rows = await query(
      `SELECT
         id,
         user_id AS userId,
         nombre,
         raza,
         nacimiento,
         castrado,
         notas,
         avatar_url AS avatarURL,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM perros
       WHERE user_id = ? AND archived = 0
       ORDER BY nombre ASC`,
      [userId]
    );

    res.json({ items: rows });
  } catch (e) {
    console.error("GET /perros", e);
    res.status(500).json({ error: "No se pudo obtener" });
  }
});

// ✅ POST /api/perros
router.post("/", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { nombre, raza, nacimiento, castrado, notas, avatarURL } = req.body;

    if (!nombre || !raza || !nacimiento)
      return res.status(400).json({ error: "Datos obligatorios faltantes" });

    const id = uuidv4();
    const now = new Date().toISOString();

    await query(
      `INSERT INTO perros (
        id, user_id, nombre, raza, nacimiento, castrado,
        notas, avatar_url, archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        userId,
        nombre.trim(),
        raza.trim(),
        nacimiento,
        castrado ? 1 : 0,
        notas || "",
        avatarURL || "",
        now,
        now,
      ]
    );

    res.status(201).json({
      item: {
        id,
        userId,
        nombre,
        raza,
        nacimiento,
        castrado: !!castrado,
        notas,
        avatarURL,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (e) {
    console.error("POST /perros", e);
    res.status(500).json({ error: "No se pudo crear" });
  }
});

// ✅ PATCH /api/perros/:id
router.patch("/:id", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const up = req.body;
    const sets = [];
    const params = [];

    if (up.nombre !== undefined) { sets.push("nombre = ?"); params.push(up.nombre); }
    if (up.raza !== undefined) { sets.push("raza = ?"); params.push(up.raza); }
    if (up.nacimiento !== undefined) { sets.push("nacimiento = ?"); params.push(up.nacimiento); }
    if (up.castrado !== undefined) { sets.push("castrado = ?"); params.push(up.castrado ? 1 : 0); }
    if (up.notas !== undefined) { sets.push("notas = ?"); params.push(up.notas); }
    if (up.avatarURL !== undefined) { sets.push("avatar_url = ?"); params.push(up.avatarURL); }

    sets.push("updated_at = ?"); params.push(new Date().toISOString());

    params.push(id, userId);

    await query(
      `UPDATE perros SET ${sets.join(", ")}
       WHERE id = ? AND user_id = ?`,
      params
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /perros/:id", e);
    res.status(500).json({ error: "No se pudo actualizar" });
  }
});

// ✅ DELETE /api/perros/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const now = new Date().toISOString();
    await query(
      `UPDATE perros SET archived = 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [now, id, userId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /perros/:id", e);
    res.status(500).json({ error: "No se pudo eliminar" });
  }
});

export default router;
