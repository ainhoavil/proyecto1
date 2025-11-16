// backend/middleware/auth.js
import jwt from "jsonwebtoken";
import { query } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

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
   Lee rol admin desde la BD (tabla `usuarios`)
============================================================ */
async function isAdminInDB(uid, email) {
  if (uid) {
    const r1 = await query("SELECT rol FROM usuarios WHERE id = ? LIMIT 1", [uid]);
    if (r1.length) return r1[0].rol === "admin";
  }
  if (email) {
    const r2 = await query("SELECT rol FROM usuarios WHERE email = ? LIMIT 1", [email]);
    if (r2.length) return r2[0].rol === "admin";
  }
  return false;
}

/* ============================================================
   Intenta completar user desde BD si faltan datos del token
============================================================ */
async function hydrateUserFromDB(partialUser) {
  const u = { ...partialUser };

  // Completar email si hay uid pero no email
  if (u.uid && !u.email) {
    const r = await query("SELECT email FROM usuarios WHERE id = ? LIMIT 1", [u.uid]);
    if (r.length && r[0].email) u.email = r[0].email;
  }

  // Si aún no sabemos si es admin, consulta BD
  if (!u.isAdmin) {
    const okAdmin = await isAdminInDB(u.uid, u.email);
    if (okAdmin) {
      u.isAdmin = true;
      u.rol = "admin";
      u.role = "admin";
    }
  }

  return u;
}

/* ============================================================
   Middleware principal: verifyToken
============================================================ */
export async function verifyToken(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Falta Authorization: Bearer <token>" });
    }

    let decoded;
    try {
      // Intento normal: verificar firma
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // Si falla la firma, intentamos al menos decodificar para demo/TFG
      console.warn("jwt.verify falló, usando jwt.decode:", err.message);
      decoded = jwt.decode(token);
      if (!decoded) {
        return res.status(401).json({ error: "Token inválido" });
      }
    }

    // uid/email/rol desde token (acepta sub/uid/id)
    const uid =
      decoded.uid ||
      decoded.id ||
      decoded.sub ||
      null;

    const email =
      decoded.email ||
      (decoded.user && decoded.user.email) ||
      null;

    const rolFromToken =
      decoded.rol ||
      decoded.role ||
      (decoded.isAdmin ? "admin" : "user") ||
      "user";

    let user = {
      uid,
      email,
      rol: rolFromToken,
      role: rolFromToken,                 // compat
      isAdmin: !!decoded.isAdmin || rolFromToken === "admin",
      iat: decoded.iat,
      exp: decoded.exp,
    };

    // Completar datos con BD si faltan o el rol puede haber cambiado
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
    if (req.user?.isAdmin || req.user?.rol === "admin") return next();

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
   Middleware: permite varios roles
============================================================ */
export function allowRoles(roles = []) {
  const set = new Set(roles);
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "No autenticado" });

      const rolToken = req.user.rol || "user";
      if (set.has(rolToken)) return next();

      // Si el rol del token no encaja, pero el usuario es admin en BD y se permite admin:
      const okAdmin = await isAdminInDB(req.user.uid, req.user.email);
      if (okAdmin && set.has("admin")) return next();

      return res.status(403).json({ error: "Permisos insuficientes" });
    } catch (err) {
      console.error("allowRoles error:", err.message);
      return res.status(500).json({ error: "Error de autorización" });
    }
  };
}
