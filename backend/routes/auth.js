// backend/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import axios from "axios";
import { query } from "../db.js";
import { nanoid } from "nanoid";
import { verifyToken, requireAdmin } from "../middleware/auth.js";
import {
  sendPasswordResetEmail,
  sendAccountCreatedEmail,
  sendWelcomeEmail,
  sendRoleChangedEmail,
  sendAccountDeletedEmail,
} from "../utils/mailer.js";
import { isValidEmail, hasMinLetters, isValidSpanishPhone, normalizeSpanishPhone, isStrongPassword } from "../utils/validators.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";
const ROLES = ["client", "user", "admin", "adiestrador"];

/* ============================================================
   Bootstrap de Admin por .env (para no quedarte sin admin)
   - backend/.env: ADMIN_EMAILS=tuemail@gmail.com,otro@...
   - En el primer login/registro con ese email, se actualiza BD a rol=admin
============================================================ */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isBootstrapAdmin(email = "") {
  const e = String(email || "").trim().toLowerCase();
  return !!e && ADMIN_EMAILS.includes(e);
}

async function promoteToAdminIfNeeded({ uid, email }) {
  if (!isBootstrapAdmin(email)) return false;

  // Actualiza ambas tablas (users y usuarios) por uid/email
  await query(`UPDATE usuarios SET rol = 'admin' WHERE id = ? OR email = ?`, [
    uid,
    String(email || "").trim().toLowerCase(),
  ]);
  await query(`UPDATE users SET role = 'admin' WHERE uid = ? OR email = ?`, [
    uid,
    String(email || "").trim().toLowerCase(),
  ]);
  return true;
}


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

  // === Migraciones suaves (ALTER TABLE si faltan columnas) ===
  // Nota: CREATE TABLE IF NOT EXISTS NO actualiza tablas existentes.
  const ensureColumn = async (table, columnName, definitionSql) => {
    const info = await query(`PRAGMA table_info(${table})`);
    const exists = (info || []).some(
      (c) => String(c?.name || "").toLowerCase() === String(columnName).toLowerCase()
    );
    if (!exists) {
      await query(`ALTER TABLE ${table} ADD COLUMN ${definitionSql}`);
    }
  };

  // Para login con Google (GIS / ID Token)
  await ensureColumn("users", "google_sub", "google_sub TEXT");
  await ensureColumn(
    "users",
    "auth_provider",
    "auth_provider TEXT DEFAULT 'local'"
  );

  // Campos usados en notificaciones / panel admin
  await ensureColumn("users", "nombre", "nombre TEXT");
  await ensureColumn("users", "role", "role TEXT DEFAULT 'client'");

  // Índices (idempotentes)
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub)`
  );

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

  // 3. Tokens para recuperación de contraseña
  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_prt_uid ON password_reset_tokens(uid)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_prt_hash ON password_reset_tokens(token_hash)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_prt_email ON password_reset_tokens(email)`);
}

// Ejecutamos al cargar el archivo
await ensureAuthTables();

async function getUserContactByUid(uid) {
  const uidSafe = String(uid || "").trim();
  if (!uidSafe) return { email: null, nombre: null };

  try {
    const r1 = await query(
      "SELECT email, nombre FROM users WHERE uid = ? LIMIT 1",
      [uidSafe]
    );
    if (Array.isArray(r1) && r1.length) {
      return { email: r1[0]?.email || null, nombre: r1[0]?.nombre || null };
    }
  } catch (_) {
    // ignore and fallback
  }

  try {
    const r2 = await query(
      "SELECT email FROM usuarios WHERE id = ? LIMIT 1",
      [uidSafe]
    );
    if (Array.isArray(r2) && r2.length) {
      return { email: r2[0]?.email || null, nombre: null };
    }
  } catch (_) {
    // ignore
  }

  return { email: null, nombre: null };
}

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
    isTrainer: rol === "adiestrador",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/* ============================================================
   ✅ Login con Google (Google Identity Services)
   - Frontend env:  VITE_GOOGLE_CLIENT_ID
   - Backend env:   GOOGLE_CLIENT_ID
   Flujo:
     1) El frontend obtiene un ID token (credential) con GIS.
     2) El backend valida firma/audience/issuer y crea/inicia sesión.
============================================================ */

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";

let googleCertsCache = {
  certs: null,
  expiresAt: 0,
};

function parseMaxAgeSeconds(cacheControl) {
  const cc = String(cacheControl || "");
  const m = cc.match(/max-age=(\d+)/i);
  return m ? Number(m[1]) : 0;
}

async function getGoogleCerts({ force = false } = {}) {
  const now = Date.now();
  if (!force && googleCertsCache.certs && now < googleCertsCache.expiresAt) {
    return googleCertsCache.certs;
  }

  const resp = await axios.get(GOOGLE_CERTS_URL, {
    timeout: 7000,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  if (resp.status !== 200 || !resp.data) {
    throw new Error("No se pudieron obtener los certificados de Google");
  }

  const maxAge = parseMaxAgeSeconds(resp.headers?.["cache-control"]);
  // Si no hay max-age, cachea poco para no martillear
  const ttlMs = (maxAge > 0 ? maxAge : 3600) * 1000;

  googleCertsCache = {
    certs: resp.data,
    expiresAt: now + ttlMs,
  };

  return googleCertsCache.certs;
}

async function verifyGoogleIdToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    const e = new Error("Falta GOOGLE_CLIENT_ID en el backend (.env)");
    e.statusCode = 500;
    throw e;
  }

  const decoded = jwt.decode(String(idToken || ""), { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) {
    const e = new Error("ID token inválido");
    e.statusCode = 401;
    throw e;
  }

  // Obtener cert correspondiente al kid
  let certs = await getGoogleCerts();
  let cert = certs?.[kid];
  if (!cert) {
    // Rotación de keys: fuerza refresh
    certs = await getGoogleCerts({ force: true });
    cert = certs?.[kid];
  }
  if (!cert) {
    const e = new Error("No se encontró el certificado para verificar el token");
    e.statusCode = 401;
    throw e;
  }

  try {
    const payload = jwt.verify(String(idToken), cert, {
      algorithms: ["RS256"],
      audience: GOOGLE_CLIENT_ID,
      issuer: GOOGLE_ISSUERS,
    });
    return payload;
  } catch (err) {
    const e = new Error("ID token inválido o expirado");
    e.statusCode = 401;
    e.cause = err;
    throw e;
  }
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
    await query(`UPDATE usuarios SET rol = ? WHERE id = ?`, [rol, r[0].id]);
  }
}

// ✅ Email real: usa backend/utils/mailer.js

/* ============================================================
   POST /api/auth/register (Público)
   - Aquí ya puedes exigir nombre si quieres (prioridad futura).
   - Si todavía no lo quieres obligatorio, quita la validación de name.
============================================================ */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name, telefono } = req.body || {};

    const emailNorm = String(email || "").trim().toLowerCase();
    const phoneNorm = normalizeSpanishPhone(telefono);

    if (!emailNorm || !password) {
      return res.status(400).json({ error: "Faltan email y/o password" });
    }
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ error: "Email inválido" });
    }
    if (!name || !String(name).trim() || !hasMinLetters(String(name), 2)) {
      return res
        .status(400)
        .json({ error: "El nombre debe tener al menos 2 letras" });
    }
    if (!telefono || !String(telefono).trim()) {
      return res.status(400).json({ error: "El teléfono es obligatorio" });
    }
    if (!isValidSpanishPhone(telefono)) {
      return res.status(400).json({
        error:
          "Teléfono inválido. Debe ser un número español de 9 dígitos (puedes incluir +34).",
      });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: "La contraseña debe tener mínimo 8 caracteres e incluir letras y números.",
      });
    }


    const rolBootstrap = isBootstrapAdmin(emailNorm) ? "admin" : "client";

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

    // 1. Insertar en users
    await query(
      `INSERT INTO users (
         id, uid, email, password_hash, nombre, telefono, created_at, updated_at, role
       )
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      [nanoid(), uid, emailNorm, hash, String(name).trim(), phoneNorm, rolBootstrap]
    );

    // 2. Insertar en usuarios
    await query(
      `INSERT INTO usuarios (id, email, password_hash, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, emailNorm, hash, rolBootstrap]
    );

    const token = signToken({ uid, email: emailNorm, rol: rolBootstrap });

    // Email de bienvenida (best-effort)
    void sendWelcomeEmail({ to: emailNorm, name: String(name).trim(), role: rolBootstrap });

    res.status(201).json({
      ok: true,
      token,
      email: emailNorm,
      rol: rolBootstrap,
      user: { uid, email: emailNorm, role: rolBootstrap, nombre: String(name).trim() },
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
    const rows = await query("SELECT * FROM users WHERE email = ? LIMIT 1", [
      emailNorm,
    ]);

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
    else
      await ensureUsuariosRow({
        uid: user.uid,
        email: user.email,
        rol,
        passwordHash: user.password_hash,
      });

    // Truco para admin demo
    await promoteToAdminIfNeeded({ uid: user.uid, email: emailNorm });
    if (isBootstrapAdmin(emailNorm)) rol = "admin";

    const token = signToken({ uid: user.uid, email: user.email, rol });
    res.json({ token, email: user.email, rol });
  } catch (e) {
    console.error("[LOGIN] ERROR", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   POST /api/auth/google (Público)
   body: { credential }
   - credential es el ID token (JWT) devuelto por Google Identity Services.
   - Si el email existe, vincula google_sub.
   - Si no existe, crea cuenta "client".
============================================================ */
router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ error: "Falta credential" });
    }

    const payload = await verifyGoogleIdToken(credential);

    const email = String(payload?.email || "").trim().toLowerCase();
    const rolBootstrap = isBootstrapAdmin(email) ? "admin" : "client";
    const emailVerified = payload?.email_verified;
    const googleSub = String(payload?.sub || "").trim();

    if (!email || !googleSub) {
      return res.status(401).json({ error: "Token sin email válido" });
    }
    if (emailVerified === false || emailVerified === "false") {
      return res
        .status(401)
        .json({ error: "Email de Google no verificado" });
    }

    const nombre =
      String(payload?.name || payload?.given_name || "").trim() || null;
    const foto = String(payload?.picture || "").trim() || null;

    // 1) Buscar por google_sub o email
    const rows = await query(
      `SELECT *
         FROM users
        WHERE google_sub = ? OR email = ?
        LIMIT 1`,
      [googleSub, email]
    );

    let user = rows[0] || null;

    // 2) Crear si no existe
    if (!user) {
      const uid = nanoid();
      const id = nanoid();
      const emptyHash = ""; // NOT NULL en schema, pero se permite vacío

      await query(
        `INSERT INTO users (
           id, uid, email, password_hash,
           nombre, foto,
           created_at, updated_at,
           role, google_sub, auth_provider
         )
         VALUES (
           ?, ?, ?, ?,
           ?, ?,
           datetime('now'), datetime('now'),
           ?, ?, 'google'
         )`,
        [id, uid, email, emptyHash, nombre, foto, rolBootstrap, googleSub]
      );

      user = {
        uid,
        email,
        password_hash: emptyHash,
      };

      // Asegura rol/perfil en tabla usuarios
      await ensureUsuariosRow({ uid, email, rol: rolBootstrap, passwordHash: "" });
    } else {
      // 3) Vincula/actualiza datos si ya existía
      await query(
        `UPDATE users
            SET google_sub = COALESCE(google_sub, ?),
                auth_provider = CASE
                  WHEN auth_provider IS NULL OR auth_provider = '' THEN 'google'
                  ELSE auth_provider
                END,
                nombre = COALESCE(?, nombre),
                foto = COALESCE(?, foto),
                updated_at = datetime('now')
          WHERE uid = ?`,
        [googleSub, nombre, foto, user.uid]
      );
    }

    // 4) Rol desde BD (tabla usuarios manda)
    let rol = "client";
    const ru = await query(
      "SELECT rol FROM usuarios WHERE id = ? OR email = ? LIMIT 1",
      [user.uid, email]
    );
    if (ru.length) rol = ru[0].rol || "client";
    else {
      await ensureUsuariosRow({
        uid: user.uid,
        email,
        rol,
        passwordHash: user.password_hash || "",
      });
    }

    // Truco para admin demo
    await promoteToAdminIfNeeded({ uid: user.uid, email });
    if (isBootstrapAdmin(email)) rol = "admin";

    const token = signToken({ uid: user.uid, email, rol });
    return res.json({
      token,
      uid: user.uid,
      email,
      rol,
      user: { uid: user.uid, email, rol, nombre, foto },
    });
  } catch (e) {
    const status = e?.statusCode || 500;
    console.error("[GOOGLE LOGIN] ERROR", e?.cause || e);
    return res.status(status).json({ error: e?.message || "Server error" });
  }
});

/* ============================================================
   ✅ POST /api/auth/forgot-password (Público)
   - Respuesta genérica (no filtra si existe el email)
   - Guarda SOLO hash del token
============================================================ */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};

    // Respuesta genérica SIEMPRE
    const generic = {
      ok: true,
      message: "Si el email existe, enviaremos instrucciones.",
    };

    if (!email) return res.json(generic);

    const emailNorm = String(email).trim().toLowerCase();

    // Buscar usuario
    const rows = await query(
      "SELECT uid, email FROM users WHERE email = ? LIMIT 1",
      [emailNorm]
    );

    // No reveles si existe
    if (!rows.length) return res.json(generic);

    const { uid } = rows[0];

    // Token en claro para URL (solo se devuelve/usa fuera), en BD guardamos hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const minutes = Number(process.env.PASSWORD_RESET_MINUTES || 30);
    const expiresAtISO = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const ip =
      req.headers["x-forwarded-for"]?.toString() ||
      req.socket?.remoteAddress ||
      "";
    const userAgent = req.headers["user-agent"] || "";

    // Guardar token
    await query(
      `INSERT INTO password_reset_tokens
        (id, uid, email, token_hash, expires_at, used_at, created_at, ip, user_agent)
       VALUES
        (?, ?, ?, ?, ?, NULL, datetime('now'), ?, ?)`,
      [nanoid(), uid, emailNorm, tokenHash, expiresAtISO, ip, userAgent]
    );

    // Construir URL frontend
    const baseFront = (process.env.FRONTEND_URL || "http://localhost:5173")
      .toString()
      .replace(/\/+$/, "");

    const resetUrl = `${baseFront}/reset-password?token=${rawToken}`;

    // ✅ Envío real (si no está configurado, hará DEV LOG sin romper)
    await sendPasswordResetEmail({ to: emailNorm, resetUrl, minutes });

    return res.json(generic);
  } catch (e) {
    console.error("[FORGOT-PASSWORD] ERROR", e);
    // Siempre genérico
    return res.json({
      ok: true,
      message: "Si el email existe, enviaremos instrucciones.",
    });
  }
});

/* ============================================================
   ✅ POST /api/auth/reset-password (Público)
   body: { token, newPassword }
============================================================ */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ error: "Token y nueva contraseña requeridos" });
    }

    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ error: "La contraseña debe tener al menos 8 caracteres" });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");

    const rows = await query(
      `SELECT id, uid, email, expires_at, used_at
         FROM password_reset_tokens
        WHERE token_hash = ?
        LIMIT 1`,
      [tokenHash]
    );

    if (!rows.length) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    const row = rows[0];
    if (row.used_at) {
      return res.status(400).json({ error: "Token ya utilizado" });
    }

    const expMs = new Date(row.expires_at).getTime();
    if (Number.isNaN(expMs) || Date.now() > expMs) {
      return res.status(400).json({ error: "Token inválido o expirado" });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);

    // Actualiza en users
    await query(
      `UPDATE users
          SET password_hash = ?, updated_at = datetime('now')
        WHERE uid = ?`,
      [hash, row.uid]
    );

    // Refleja en usuarios
    await query(`UPDATE usuarios SET password_hash = ? WHERE id = ?`, [
      hash,
      row.uid,
    ]);

    // Marca token como usado
    await query(
      `UPDATE password_reset_tokens
          SET used_at = datetime('now')
        WHERE id = ?`,
      [row.id]
    );

    return res.json({
      ok: true,
      message: "Contraseña actualizada. Ya puedes iniciar sesión.",
    });
  } catch (e) {
    console.error("[RESET-PASSWORD] ERROR", e);
    return res.status(500).json({ error: "Error interno" });
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
    if (!email || !password || !name) {
      return res.status(400).json({
        error: "Email, contraseña y nombre obligatorios",
      });
    }

    const emailNorm = email.trim().toLowerCase();
    const exists = await query(
      "SELECT 1 FROM users WHERE email = ? LIMIT 1",
      [emailNorm]
    );
    if (exists.length)
      return res.status(409).json({ error: "Email ya existe" });

    if (!ROLES.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    const hash = await bcrypt.hash(password, 10);
    const uid = nanoid();

    await query(
      `INSERT INTO users (id, uid, email, password_hash, nombre, created_at, updated_at, role)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      [nanoid(), uid, emailNorm, hash, String(name).trim(), rol]
    );

    await query(
      `INSERT INTO usuarios (id, email, password_hash, rol, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uid, emailNorm, hash, rol]
    );

    // Email de bienvenida + credenciales (best-effort)
    void sendAccountCreatedEmail({
      to: emailNorm,
      email: emailNorm,
      tempPassword: password,
      role: rol,
    });

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

    const u = await getUserContactByUid(uid);

    await query(`UPDATE usuarios SET rol = ? WHERE id = ?`, [rol, uid]);
    await query(`UPDATE users SET role = ? WHERE uid = ?`, [rol, uid]);

    // Email informando del cambio de rol (best-effort)
    if (u.email) {
      void sendRoleChangedEmail({ to: u.email, name: u.nombre, role: rol });
    }

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

    // Recuperar email/nombre antes de borrar (para notificación)
    const u = await getUserContactByUid(id);

    await query("DELETE FROM users WHERE uid = ?", [id]);
    await query("DELETE FROM usuarios WHERE id = ?", [id]);

    // Email confirmación borrado (best-effort)
    if (u.email) {
      void sendAccountDeletedEmail({ to: u.email, name: u.nombre });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE USER] ERROR", e);
    res.status(500).json({ error: "Error al borrar usuario" });
  }
});
// DELETE /api/auth/me -> Borrar mi propia cuenta (cliente/adiestrador/admin)
router.delete("/me", verifyToken, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const u = await getUserContactByUid(uid);
    const email = (u.email || req.user?.email || "").trim().toLowerCase();

    await query("DELETE FROM users WHERE uid = ?", [uid]);
    await query("DELETE FROM usuarios WHERE id = ?", [uid]);

    if (email) {
      void sendAccountDeletedEmail({ to: email, name: u.nombre });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE ME] ERROR", e);
    res.status(500).json({ error: "Error al borrar la cuenta" });
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

    await query("UPDATE usuarios SET password_hash = ? WHERE id = ?", [
      newHash,
      uid,
    ]);

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