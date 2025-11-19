// backend/routes/files.js
import express from "express";
import multer from "multer";
import crypto from "crypto";
import { query } from "../db.js";
import jwt from "jsonwebtoken";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

// --- auth middleware (igual que en perfil) ---
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "No token" });
  const token = h.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// --- POST /api/upload-db ---
// Recibe multipart/form-data con campo "file", guarda BLOB en BD y devuelve { id, url, mime }
router.post("/upload-db", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta file" });

    const MAX = 5 * 1024 * 1024; // 5MB; ajusta a tu gusto
    if (req.file.size > MAX) {
      return res.status(413).json({ error: "Archivo demasiado grande (máx 5MB)" });
    }

    // Validación simple MIME
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const mime = req.file.mimetype || "application/octet-stream";
    if (!allowed.has(mime)) {
      return res.status(415).json({ error: "Tipo no permitido" });
    }

    const id = crypto.randomUUID();
    const bytes = req.file.buffer; // Buffer (Node) -> libsql acepta Buffer/Uint8Array

    await query(
      `INSERT INTO files(id, owner_uid, mime, bytes) VALUES(?, ?, ?, ?)`,
      [id, req.user.sub, mime, bytes]
    );

    const url = `/api/files/${id}`;
    res.json({ id, url, mime });
  } catch (err) {
    console.error("POST /api/upload-db error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// --- GET /api/files/:id ---
// Devuelve el binario con su Content-Type desde la BD
router.get("/files/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const rows = await query(
      `SELECT mime, bytes FROM files WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).send("Not found");

    const { mime, bytes } = rows[0];

    // Cabeceras útiles para cachear en cliente/edge
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    // En algunos drivers libsql, rows[0].bytes ya es Buffer/Uint8Array válido
    res.end(Buffer.from(bytes));
  } catch (err) {
    console.error("GET /api/files/:id error:", err);
    res.status(500).send("Error interno");
  }
});

// --- Opcional: DELETE /api/files/:id (solo dueño) ---
router.delete("/files/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;

    // Borra solo si es del dueño
    const result = await query(
      `DELETE FROM files WHERE id = ? AND owner_uid = ?`,
      [id, req.user.sub]
    );
    // libsql devuelve { success: true } o cambios; si necesitas filas afectadas, ajusta según tu helper
    res.json({ ok: true, id });
  } catch (err) {
    console.error("DELETE /api/files/:id error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
