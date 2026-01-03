// backend/routes/files.js
import express from "express";
import multer from "multer";
import crypto from "crypto";
import { query } from "../db.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
    console.warn(
      "[files] No se pudo asegurar columna created_at:",
      e?.message || e
    );
  }
}

await ensureFilesTable();

// ============================================================
// POST /api/upload-db
// multipart/form-data con campo "file"
// Devuelve { id, url, mime, size, name }
// ============================================================
router.post("/upload-db", verifyToken, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta file" });

    const MAX = 25 * 1024 * 1024; // 25MB
    if (req.file.size > MAX) {
      return res
        .status(413)
        .json({ error: "Archivo demasiado grande (máx 25MB)" });
    }

    const allowed = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
      "image/avif",
      "image/x-icon",

      // Vídeo
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/ogg",

      // Docs
      "application/pdf",
      "text/plain",
    ]);

    const mime = (req.file.mimetype || "application/octet-stream").toLowerCase();
    if (!allowed.has(mime)) {
      return res.status(415).json({ error: "Tipo no permitido" });
    }

    const id = crypto.randomUUID();
    const bytes = req.file.buffer;

    // El verifyToken del proyecto deja el uid aquí
    const ownerUid = req.user?.uid || req.user?.sub || req.user?.id;
    if (!ownerUid) return res.status(401).json({ error: "Token sin UID" });

    await query(
      `INSERT INTO files(id, owner_uid, mime, bytes, created_at)
       VALUES(?, ?, ?, ?, datetime('now'))`,
      [id, ownerUid, mime, bytes]
    );

    const url = `/api/files/${id}`;
    return res.json({
      id,
      url,
      mime,
      size: req.file.size,
      name: req.file.originalname || null,
    });
  } catch (err) {
    console.error("POST /api/upload-db error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

// ============================================================
// GET /api/files/:id
// ============================================================
router.get("/files/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const rows = await query(
      `SELECT mime, bytes FROM files WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).send("Not found");

    const { mime, bytes } = rows[0];

    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(Buffer.from(bytes));
  } catch (err) {
    console.error("GET /api/files/:id error:", err);
    return res.status(500).send("Error interno");
  }
});

// ============================================================
// DELETE /api/files/:id (solo dueño)
// ============================================================
router.delete("/files/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;

    const ownerUid = req.user?.uid || req.user?.sub || req.user?.id;
    if (!ownerUid) return res.status(401).json({ error: "Token sin UID" });

    await query(`DELETE FROM files WHERE id = ? AND owner_uid = ?`, [
      id,
      ownerUid,
    ]);

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("DELETE /api/files/:id error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
