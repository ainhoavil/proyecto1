// backend/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { nanoid } from "nanoid";
import { verifyToken, requireAdmin } from "../middleware/auth.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";
const ROLES = ["user", "admin", "adiestrador"];

/* ============================================================
   Firma un token JWT coherente con verifyToken
============================================================ */
function signToken({ uid, email, rol = "user" }) {
  const payload = {
    sub: uid,
    uid,
    email,
    rol,
    isAdmin: rol === "admin",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/* ============================================================
   Asegura existencia en tabla usuarios
============================================================ */
async function ensureUsuariosRow({ uid, email, rol = "user" }) {
  const r = await query(
    "SELECT id FROM usuarios WHERE id = ? OR email = ? LIMIT 1",
    [uid, email]
  );
  if (!r.length) {
    await query(
      `INSERT INTO usuarios (id, email, rol, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [uid, email, rol]
    );
  } else if (rol && rol !== "user") {
    await query(
      `UPDATE usuarios SET rol = ?, updated_at = datetime('now') WHERE id = ?`,
      [rol, r[0].id]
    );
  }
}

/* ============================================================
   POST /api/auth/register
============================================================ */
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "Faltan email y/o password" });

    const emailNorm = email.trim().toLowerCase();

    const exists = await query("SELECT 1 FROM users WHERE email = ? LIMIT 1", [
      emailNorm,
    ]);
    if (exists.length)
      return res.status(409).json({ error: "Email ya registrado" });

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid();

    await query(
      `INSERT INTO users (id, uid, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [nanoid(), uid, emailNorm, hash]
    );

    await ensureUsuariosRow({ uid, email: emailNorm, rol: "user" });

    const token = signToken({ uid, email: emailNorm, rol: "user" });
    res.status(201).json({ ok: true, token, email: emailNorm });
  } catch (e) {
    console.error("[REGISTER] ERROR", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   POST /api/auth/login
============================================================ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "Faltan campos" });

    const emailNorm = email.trim().toLowerCase();
    const rows = await query("SELECT * FROM users WHERE email = ? LIMIT 1", [
      emailNorm,
    ]);
    if (!rows.length)
      return res.status(401).json({ error: "Usuario no encontrado" });

    const user = rows[0];

    // compara contraseña
    if (user.password_hash) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // rol desde 'usuarios'
    let rol = "user";
    const ru = await query(
      "SELECT rol FROM usuarios WHERE id = ? OR email = ? LIMIT 1",
      [user.uid, user.email]
    );
    if (ru.length) rol = ru[0].rol || "user";
    else await ensureUsuariosRow({ uid: user.uid, email: user.email, rol });

    const token = signToken({ uid: user.uid, email: user.email, rol });
    res.json({ token, email: user.email, rol });
  } catch (e) {
    console.error("[LOGIN] ERROR", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   POST /api/auth/role  (admin)  → { uid, rol }
   Cambia rol: 'user' | 'admin' | 'adiestrador'
============================================================ */
router.post("/role", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { uid, rol } = req.body || {};
    if (!uid || !rol)
      return res.status(400).json({ error: "Faltan uid o rol" });

    if (!ROLES.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    // Buscar en usuarios y/o users
    const uRows = await query(
      "SELECT id, email FROM usuarios WHERE id = ? LIMIT 1",
      [uid]
    );

    let emailFromDB = null;

    if (!uRows.length) {
      // Intentar buscarlo en tabla users por uid
      const rowsUsers = await query(
        "SELECT uid, email FROM users WHERE uid = ? LIMIT 1",
        [uid]
      );
      if (!rowsUsers.length) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      emailFromDB = rowsUsers[0].email;
      // Creamos fila en usuarios con ese rol
      await ensureUsuariosRow({ uid, email: emailFromDB, rol });
    } else {
      emailFromDB = uRows[0].email;
      await query(
        `UPDATE usuarios
            SET rol = ?, updated_at = datetime('now')
          WHERE id = ?`,
        [rol, uid]
      );
    }

    // (opcional) aquí luego podremos añadir audit_log: role.change
    res.json({ ok: true, uid, rol });
  } catch (e) {
    console.error("[ROLE] ERROR", e);
    res.status(500).json({ error: "No se pudo cambiar el rol" });
  }
});

/* ============================================================
   GET /api/auth/me   ←  NECESARIO para el front
============================================================ */
router.get("/me", verifyToken, async (req, res) => {
  try {
    const uid = req.user?.uid || req.user?.id || req.user?.sub || null;
    const email = req.user?.email || null;
    const rol = req.user?.rol || req.user?.role || "user";
    const isAdmin = !!(req.user?.isAdmin || rol === "admin");

    if (!uid) return res.status(401).json({ error: "Token inválido" });

    res.json({
      ok: true,
      user: { uid, email, role: rol, isAdmin },
    });
  } catch (err) {
    console.error("[ME] ERROR", err);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
