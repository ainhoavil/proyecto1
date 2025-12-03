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
   🛠️ ASEGURAR TABLAS (Corrección del error de registro)
   Crea las tablas 'users' y 'usuarios' si no existen.
============================================================ */
async function ensureAuthTables() {
  // 1. Tabla de credenciales (Login)
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,           -- ID interno (uuid)
      uid TEXT UNIQUE NOT NULL,      -- ID público compartido con usuarios.id
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  // 2. Tabla de perfil (Roles y Datos)
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,           -- Coincide con users.uid
      email TEXT UNIQUE NOT NULL,
      nombre TEXT,
      rol TEXT DEFAULT 'user',
      telefono TEXT,
      direccion TEXT,
      foto TEXT,
      notas TEXT,
      prefix TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  
  // console.log("✅ Tablas de autenticación aseguradas");
}
// Ejecutamos al cargar el archivo
await ensureAuthTables();

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
   Asegura existencia en tabla usuarios (Helper)
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
   POST /api/auth/register (Público)
============================================================ */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "Faltan email y/o password" });

    const emailNorm = email.trim().toLowerCase();

    // Verificar si ya existe
    const exists = await query("SELECT 1 FROM users WHERE email = ? LIMIT 1", [
      emailNorm,
    ]);
    if (exists.length)
      return res.status(409).json({ error: "Email ya registrado" });

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid(); // ID compartido entre ambas tablas

    // 1. Insertar en users (Auth)
    await query(
      `INSERT INTO users (id, uid, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [nanoid(), uid, emailNorm, hash]
    );

    // 2. Insertar en usuarios (Perfil)
    await query(
      `INSERT INTO usuarios (id, email, nombre, rol, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [uid, emailNorm, name || '', "user"]
    );

    const token = signToken({ uid, email: emailNorm, rol: "user" });
    
    // Devolver rol explícito para que el frontend lo pille bien
    res.status(201).json({ 
      ok: true, 
      token, 
      email: emailNorm, 
      rol: "user",
      user: { uid, email: emailNorm, role: 'user' } 
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
    if (!email || !password)
      return res.status(400).json({ error: "Faltan campos" });

    const emailNorm = email.trim().toLowerCase();
    const rows = await query("SELECT * FROM users WHERE email = ? LIMIT 1", [
      emailNorm,
    ]);

    if (!rows.length)
      return res.status(401).json({ error: "Usuario no encontrado" });

    const user = rows[0];

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

    // TRUCO: Si es admin@demo.com forzamos admin (puedes quitarlo cuando ya tengas usuarios creados)
    if (emailNorm === 'admin@demo.com') rol = 'admin';

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

    await query(
      `INSERT INTO users (id, uid, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [nanoid(), uid, emailNorm, hash]
    );

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
    if (!uid || !rol) return res.status(400).json({ error: "Faltan uid o rol" });
    if (!ROLES.includes(rol)) return res.status(400).json({ error: "Rol inválido" });

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
      return res.status(400).json({ error: "Mínimo 6 caracteres." });
    }

    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const rows = await query("SELECT id, password_hash FROM users WHERE uid = ? LIMIT 1", [uid]);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    const user = rows[0];
    const ok = await bcrypt.compare(String(currentPassword), String(user.password_hash || ""));
    if (!ok) return res.status(400).json({ error: "Contraseña actual incorrecta." });

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await query("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [newHash, user.id]);

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