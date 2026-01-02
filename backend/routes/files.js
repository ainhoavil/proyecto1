// backend/routes/files.js
import express from "express";
import multer from "multer";
import crypto from "crypto";
import { query } from "../db.js";
import jwt from "jsonwebtoken";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

// ============================================================
// Asegurar tabla files (BLOB en BD)
// ============================================================
async function ensureFilesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes BLOB NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_uid)`);

  // Si la tabla existía de antes sin created_at, lo añadimos.
  try {
    const cols = await query(`PRAGMA table_info(files)`);
    const hasCreatedAt = Array.isArray(cols)
      ? cols.some((c) => String(c.name || "").toLowerCase() === "created_at")
      : false;
    if (!hasCreatedAt) {
      await query(`ALTER TABLE files ADD COLUMN created_at TEXT`);
    }
  } catch (e) {
    console.warn("[files] No se pudo asegurar columna created_at:", e?.message || e);
  }
}

// Ejecutamos al cargar el router
await ensureFilesTable();

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

    // Nota: guardar vídeos en BD puede crecer rápido.
    // Para MVP lo dejamos en 25MB (ajusta si lo necesitas).
    const MAX = 25 * 1024 * 1024; // 25MB
    if (req.file.size > MAX) {
      return res
        .status(413)
        .json({ error: "Archivo demasiado grande (máx 25MB)" });
    }

    // Validación MIME (ampliada)
    const allowed = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
      "image/avif",
      "image/x-icon",

      // Vídeo (chat)
      "video/mp4",
      "video/webm",
      "video/quicktime", // .mov
      "video/ogg",

      // Documentos comunes (chat)
      "application/pdf",
      "text/plain",
    ]);

    const mime = (req.file.mimetype || "application/octet-stream").toLowerCase();
    console.log("🖼 MIME recibido en /upload-db:", mime);

    if (!allowed.has(mime)) {
      return res.status(415).json({ error: "Tipo no permitido" });
    }

    const id = crypto.randomUUID();
    const bytes = req.file.buffer; // Buffer (Node) -> libsql acepta Buffer/Uint8Array

    await query(
      `INSERT INTO files(id, owner_uid, mime, bytes, created_at) VALUES(?, ?, ?, ?, datetime('now'))`,
      [id, req.user.sub, mime, bytes]
    );

    const url = `/api/files/${id}`;
    res.json({ id, url, mime, size: req.file.size, name: req.file.originalname || null });
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
    await query(
      `DELETE FROM files WHERE id = ? AND owner_uid = ?`,
      [id, req.user.sub]
    );

    res.json({ ok: true, id });
  } catch (err) {
    console.error("DELETE /api/files/:id error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
