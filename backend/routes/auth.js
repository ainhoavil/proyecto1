// backend/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { nanoid } from "nanoid";
import { verifyToken, requireAdmin } from "../middleware/auth.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";
const ROLES = ["client", "user", "admin", "adiestrador"];

/* ============================================================
   🛠️ ASEGURAR TABLAS (se ajusta a tu esquema real)
============================================================ */
async function ensureAuthTables() {
  // 1. Tabla de credenciales (Login)
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      uid TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT,
      telefono TEXT,
      direccion TEXT,
      notas TEXT,
      foto TEXT,
      created_at TEXT,
      updated_at TEXT,
      prefix TEXT,
      role TEXT DEFAULT 'client'
    )
  `);

  // 2. Tabla de perfil / roles
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'client',
      created_at TEXT NOT NULL
    )
  `);
}

// Ejecutamos al cargar el archivo
await ensureAuthTables();

/* ============================================================
   Firma un token JWT
============================================================ */
function signToken({ uid, email, rol = "client" }) {
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
   Asegura existencia en tabla usuarios (Helper)
============================================================ */
async function ensureUsuariosRow({ uid, email, rol = "client", passwordHash }) {
  const r = await query(
    "SELECT id FROM usuarios WHERE id = ? OR email = ? LIMIT 1",
    [uid, email]
  );
  if (!r.length) {
    await query(
      `INSERT INTO usuarios (id, email, password_hash, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, email, passwordHash || "", rol]
    );
  } else if (rol && rol !== "client") {
    await query(
      `UPDATE usuarios SET rol = ? WHERE id = ?`,
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
    if (!email || !password) {
      return res.status(400).json({ error: "Faltan email y/o password" });
    }

    const emailNorm = email.trim().toLowerCase();

    // Verificar si ya existe en users
    const exists = await query(
      "SELECT 1 FROM users WHERE email = ? LIMIT 1",
      [emailNorm]
    );
    if (exists.length) {
      return res.status(409).json({ error: "Email ya registrado" });
    }

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid(); // ID compartido entre ambas tablas

    // 1. Insertar en users (login + algunos datos básicos)
    await query(
      `INSERT INTO users (
         id, uid, email, password_hash, nombre, created_at, updated_at, role
       )
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'client')`,
      [nanoid(), uid, emailNorm, hash, name || ""]
    );

    // 2. Insertar en usuarios (según tu tabla real)
    await query(
      `INSERT INTO usuarios (id, email, password_hash, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, emailNorm, hash, "client"]
    );

    const token = signToken({ uid, email: emailNorm, rol: "client" });

    res.status(201).json({
      ok: true,
      token,
      email: emailNorm,
      rol: "client",
      user: { uid, email: emailNorm, role: "client" },
    });
  } catch (e) {
    console.error("[REGISTER] ERROR", e);
    res.status(500).json({ error: "Error del servidor al registrar" });
  }
});

/* ============================================================
   POST /api/auth/login (Público)
============================================================ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Faltan campos" });
    }

    const emailNorm = email.trim().toLowerCase();
    const rows = await query(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [emailNorm]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = rows[0];

    if (!user.password_hash) {
      return res.status(401).json({
        error: "Esta cuenta no tiene contraseña válida.",
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Contraseña incorrecta" });

    // Obtener rol desde 'usuarios'
    let rol = "client";
    const ru = await query(
      "SELECT rol FROM usuarios WHERE id = ? OR email = ? LIMIT 1",
      [user.uid, user.email]
    );
    if (ru.length) rol = ru[0].rol || "client";
    else await ensureUsuariosRow({
      uid: user.uid,
      email: user.email,
      rol,
      passwordHash: user.password_hash,
    });

    // Truco para admin demo
    if (emailNorm === "admin@demo.com") rol = "admin";

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
      `SELECT u.id AS uid, u.email, us.nombre, us.role AS rol, us.created_at, us.telefono
       FROM users us
       LEFT JOIN usuarios u ON u.id = us.uid
       ORDER BY us.created_at DESC`
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
    const { email, password, name, rol = "client" } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email y contraseña obligatorios" });
    }

    const emailNorm = email.trim().toLowerCase();
    const exists = await query(
      "SELECT 1 FROM users WHERE email = ? LIMIT 1",
      [emailNorm]
    );
    if (exists.length)
      return res.status(409).json({ error: "Email ya existe" });

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid();

    await query(
      `INSERT INTO users (id, uid, email, password_hash, nombre, created_at, updated_at, role)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      [nanoid(), uid, emailNorm, hash, name || "", rol]
    );

    await query(
      `INSERT INTO usuarios (id, email, password_hash, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, emailNorm, hash, rol]
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
    if (!ROLES.includes(rol))
      return res.status(400).json({ error: "Rol inválido" });

    await query(`UPDATE usuarios SET rol = ? WHERE id = ?`, [rol, uid]);
    await query(`UPDATE users SET role = ? WHERE uid = ?`, [rol, uid]);

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
      return res
        .status(400)
        .json({ error: "Faltan la contraseña actual y/o la nueva." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "Mínimo 6 caracteres." });
    }

    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const rows = await query(
      "SELECT id, password_hash FROM users WHERE uid = ? LIMIT 1",
      [uid]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Usuario no encontrado" });

    const user = rows[0];
    const ok = await bcrypt.compare(
      String(currentPassword),
      String(user.password_hash || "")
    );
    if (!ok)
      return res
        .status(400)
        .json({ error: "Contraseña actual incorrecta." });

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await query(
      "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
      [newHash, user.id]
    );

    // Opcional: reflejar también en usuarios
    await query(
      "UPDATE usuarios SET password_hash = ? WHERE id = ?",
      [newHash, uid]
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
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Token inválido" });
    res.json({ ok: true, user: req.user });
  } catch (err) {
    console.error("[ME] ERROR", err);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
