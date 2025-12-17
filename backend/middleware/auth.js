// backend/middleware/auth.js
import jwt from "jsonwebtoken";
import { query } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

/* ============================================================
   Normaliza roles (BD manda) y soporta alias:
   - trainer -> adiestrador
============================================================ */
function normalizeRole(raw) {
  const r = String(raw || "").trim().toLowerCase();
  if (!r) return "user";
  if (r === "trainer") return "adiestrador"; // alias
  if (r === "adiestrador") return "adiestrador";
  if (r === "admin") return "admin";
  if (r === "client") return "client";
  if (r === "user") return "user";
  return r;
}

/* ============================================================
   Extrae el token (Authorization: Bearer ... o cookie `token`)
============================================================ */
function getBearerToken(req) {
  const auth = req.headers?.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) return m[1];

  // Opcional: si usas cookie-parser y sirves el token en cookie
  const cookieTok = req.cookies?.token;
  if (cookieTok && typeof cookieTok === "string" && cookieTok.trim()) {
    return cookieTok.trim();
  }

  return null;
}

/* ============================================================
   Lee usuario completo desde la BD (tabla `usuarios`)
   Devuelve { id, email, rol } o null
============================================================ */
async function getUserFromDB(uid, email) {
  if (!uid && !email) return null;

  let rows = [];
  if (uid) {
    rows = await query(
      "SELECT id, email, rol FROM usuarios WHERE id = ? LIMIT 1",
      [uid]
    );
  }
  if (!rows.length && email) {
    rows = await query(
      "SELECT id, email, rol FROM usuarios WHERE email = ? LIMIT 1",
      [email]
    );
  }
  return rows[0] || null;
}

/* ============================================================
   Lee rol admin desde la BD (tabla `usuarios`)
============================================================ */
async function isAdminInDB(uid, email) {
  const u = await getUserFromDB(uid, email);
  return u ? normalizeRole(u.rol) === "admin" : false;
}

/* ============================================================
   Completa user desde BD si faltan datos del token
   y sincroniza el rol actual (admin / adiestrador / user / client)
============================================================ */
async function hydrateUserFromDB(partialUser) {
  const u = { ...partialUser };

  const dbUser = await getUserFromDB(u.uid, u.email);

  if (!dbUser) {
    // No hay nada en BD, normalizamos lo que venga del token
    const rolNorm = normalizeRole(u.rol || u.role || (u.isAdmin ? "admin" : "user"));
    u.rol = rolNorm;
    u.role = rolNorm;
    u.isAdmin = rolNorm === "admin" || !!u.isAdmin;
    u.isTrainer = rolNorm === "adiestrador" || !!u.isTrainer;
    return u;
  }

  // Completar email si faltaba
  if (!u.email && dbUser.email) {
    u.email = dbUser.email;
  }

  // Rol final: el de BD manda
  const rolDb = normalizeRole(dbUser.rol || u.rol || u.role || "user");

  u.rol = rolDb;
  u.role = rolDb;
  u.isAdmin = rolDb === "admin";
  u.isTrainer = rolDb === "adiestrador";

  return u;
}

/* ============================================================
   Middleware principal: verifyToken
============================================================ */
export async function verifyToken(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ error: "Falta Authorization: Bearer <token>" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // fallback para entornos demo/TFG
      console.warn("jwt.verify falló, usando jwt.decode:", err.message);
      decoded = jwt.decode(token);
      if (!decoded) {
        return res.status(401).json({ error: "Token inválido" });
      }
    }

    // uid/email/rol desde token (acepta sub/uid/id)
    const uid = decoded.uid || decoded.id || decoded.sub || null;
    const email = decoded.email || (decoded.user && decoded.user.email) || null;

    const rolFromTokenRaw =
      decoded.rol ||
      decoded.role ||
      (decoded.isAdmin ? "admin" : "user") ||
      "user";

    const rolFromToken = normalizeRole(rolFromTokenRaw);

    const isAdminToken = !!decoded.isAdmin || rolFromToken === "admin";
    const isTrainerToken =
      !!decoded.isTrainer || rolFromToken === "adiestrador";

    let user = {
      uid,
      email,
      rol: rolFromToken,
      role: rolFromToken, // compat
      isAdmin: isAdminToken,
      isTrainer: isTrainerToken,
      iat: decoded.iat,
      exp: decoded.exp,
    };

    // Completar datos con BD y sincronizar rol actual
    user = await hydrateUserFromDB(user);

    req.user = user;
    return next();
  } catch (err) {
    console.error("verifyToken error:", err.message);
    return res.status(401).json({ error: "Token inválido" });
  }
}

/* ============================================================
   Middleware: solo admin
============================================================ */
export async function requireAdmin(req, res, next) {
  try {
    const rol = normalizeRole(req.user?.rol);
    if (req.user?.isAdmin || rol === "admin") return next();

    // Único caso: el token no trae admin pero BD sí
    const ok = await isAdminInDB(req.user?.uid, req.user?.email);
    if (ok) return next();

    return res.status(403).json({ error: "Permisos insuficientes" });
  } catch (err) {
    console.error("requireAdmin error:", err.message);
    return res.status(500).json({ error: "Error de autorización" });
  }
}

/* ============================================================
   Middleware: solo adiestrador
============================================================ */
export async function requireTrainer(req, res, next) {
  try {
    const rol = normalizeRole(req.user?.rol);
    if (req.user?.isTrainer || rol === "adiestrador") {
      return next();
    }

    // Si token desactualizado, miramos BD
    const dbUser = await getUserFromDB(req.user?.uid, req.user?.email);
    if (dbUser && normalizeRole(dbUser.rol) === "adiestrador") {
      req.user.rol = "adiestrador";
      req.user.role = "adiestrador";
      req.user.isTrainer = true;
      req.user.isAdmin = normalizeRole(dbUser.rol) === "admin";
      return next();
    }

    return res.status(403).json({ error: "Solo para adiestradores" });
  } catch (err) {
    console.error("requireTrainer error:", err.message);
    return res.status(500).json({ error: "Error de autorización" });
  }
}

/* ============================================================
   Middleware: adiestrador O admin
============================================================ */
export async function requireTrainerOrAdmin(req, res, next) {
  try {
    const rol = normalizeRole(req.user?.rol);

    if (
      req.user?.isAdmin ||
      rol === "admin" ||
      req.user?.isTrainer ||
      rol === "adiestrador"
    ) {
      return next();
    }

    const dbUser = await getUserFromDB(req.user?.uid, req.user?.email);
    const rolDb = normalizeRole(dbUser?.rol);
    if (rolDb === "admin" || rolDb === "adiestrador") {
      req.user.rol = rolDb;
      req.user.role = rolDb;
      req.user.isAdmin = rolDb === "admin";
      req.user.isTrainer = rolDb === "adiestrador";
      return next();
    }

    return res
      .status(403)
      .json({ error: "Solo adiestradores o administradores" });
  } catch (err) {
    console.error("requireTrainerOrAdmin error:", err.message);
    return res.status(500).json({ error: "Error de autorización" });
  }
}

/* ============================================================
   Middleware genérico: permite varios roles
   Ej: allowRoles(['admin', 'adiestrador'])
============================================================ */
export function allowRoles(roles = []) {
  const normalized = roles.map(normalizeRole);
  const set = new Set(normalized);

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "No autenticado" });
      }

      const rolToken = normalizeRole(req.user.rol || "user");

      // Si el rol del token ya está permitido → OK
      if (set.has(rolToken)) return next();

      // Miramos BD por si rol cambió
      const dbUser = await getUserFromDB(req.user.uid, req.user.email);
      const rolDb = normalizeRole(dbUser?.rol);

      if (rolDb && set.has(rolDb)) {
        req.user.rol = rolDb;
        req.user.role = rolDb;
        req.user.isAdmin = rolDb === "admin";
        req.user.isTrainer = rolDb === "adiestrador";
        return next();
      }

      // Caso especial: permitir admin aunque no esté en el token
      if (set.has("admin")) {
        const okAdmin = await isAdminInDB(req.user.uid, req.user.email);
        if (okAdmin) return next();
      }

      return res.status(403).json({ error: "Permisos insuficientes" });
    } catch (err) {
      console.error("allowRoles error:", err.message);
      return res.status(500).json({ error: "Error de autorización" });
    }
  };
}
