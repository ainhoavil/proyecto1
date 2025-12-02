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
   Firma un token JWT
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
    // Si ya existe, actualizamos el rol si es distinto de 'user'
    await query(
      `UPDATE usuarios SET rol = ?, updated_at = datetime('now') WHERE id = ?`,
      [rol, r[0].id]
    );
  }
}

/* ============================================================
   POST /api/auth/register (Público)
============================================================ */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
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

    // Tabla de auth (users)
    await query(
      `INSERT INTO users (id, uid, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [nanoid(), uid, emailNorm, hash]
    );

    // Tabla de perfil/roles (usuarios)
    await query(
      `INSERT INTO usuarios (id, email, nombre, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, emailNorm, name || '', "user"]
    );

    const token = signToken({ uid, email: emailNorm, rol: "user" });
    res.status(201).json({ ok: true, token, email: emailNorm, user: { email: emailNorm, role: 'user' } });
  } catch (e) {
    console.error("[REGISTER] ERROR", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   POST /api/auth/login (Público)
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

    // Validar hash
    if (!user.password_hash) {
      return res.status(401).json({
        error: "Esta cuenta no tiene contraseña válida.",
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Contraseña incorrecta" });

    // Obtener rol desde 'usuarios'
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
   RUTAS DE GESTIÓN (ADMIN ONLY)
============================================================ */

// GET /api/auth/users -> Listar todos los usuarios
router.get("/users", verifyToken, requireAdmin, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id AS uid, email, nombre, rol, created_at, telefono
       FROM usuarios
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error("[GET USERS] ERROR", e);
    res.status(500).json({ error: "Error al listar usuarios" });
  }
});

// POST /api/auth/users -> Crear usuario manualmente (con rol)
router.post("/users", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, name, rol = "user" } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "Email y contraseña obligatorios" });

    const emailNorm = email.trim().toLowerCase();
    const exists = await query("SELECT 1 FROM users WHERE email = ? LIMIT 1", [emailNorm]);
    if (exists.length) return res.status(409).json({ error: "Email ya existe" });

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid();

    // Insertar en auth
    await query(
      `INSERT INTO users (id, uid, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [nanoid(), uid, emailNorm, hash]
    );

    // Insertar en perfil
    await query(
      `INSERT INTO usuarios (id, email, nombre, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, emailNorm, name || '', rol]
    );

    res.status(201).json({ ok: true, message: "Usuario creado" });
  } catch (e) {
    console.error("[CREATE USER] ERROR", e);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

// POST /api/auth/role -> Cambiar rol
router.post("/role", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { uid, rol } = req.body || {};
    if (!uid || !rol)
      return res.status(400).json({ error: "Faltan uid o rol" });

    if (!ROLES.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    // Actualizar en 'usuarios'
    await query(`UPDATE usuarios SET rol = ? WHERE id = ?`, [rol, uid]);
    res.json({ ok: true, uid, rol });
  } catch (e) {
    console.error("[ROLE] ERROR", e);
    res.status(500).json({ error: "No se pudo cambiar el rol" });
  }
});

// DELETE /api/auth/users/:id -> Borrar usuario
router.delete("/users/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Borrar de auth y perfil
    await query("DELETE FROM users WHERE uid = ?", [id]);
    await query("DELETE FROM usuarios WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE USER] ERROR", e);
    res.status(500).json({ error: "Error al borrar usuario" });
  }
});

/* ============================================================
   PATCH /api/auth/password (Usuario: Cambiar contraseña)
============================================================ */
router.patch("/password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Faltan la contraseña actual y/o la nueva." });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres." });
    }

    const uid = req.user?.uid;
    const email = req.user?.email;

    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const rows = await query(
      `SELECT id, uid, email, password_hash
         FROM users
        WHERE uid = ? OR email = ?
        LIMIT 1`,
      [uid, email || ""]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = rows[0];

    const ok = await bcrypt.compare(String(currentPassword), String(user.password_hash || ""));
    if (!ok) return res.status(400).json({ error: "La contraseña actual no es correcta." });

    const newHash = await bcrypt.hash(String(newPassword), 10);

    await query(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      [newHash, user.id]
    );

    return res.json({ ok: true, message: "Contraseña actualizada" });
  } catch (err) {
    console.error("[PASSWORD] ERROR", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

/* ============================================================
   GET /api/auth/me
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