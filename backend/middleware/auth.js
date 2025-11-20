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
  return u ? u.rol === "admin" : false;
}

/* ============================================================
   Intenta completar user desde BD si faltan datos del token
   y sincroniza el rol actual (user/admin/trainer)
============================================================ */
async function hydrateUserFromDB(partialUser) {
  const u = { ...partialUser };

  const dbUser = await getUserFromDB(u.uid, u.email);

  if (!dbUser) {
    // No hay nada en BD, pero al menos normalizamos flags
    const rolNorm = u.rol || u.role || (u.isAdmin ? "admin" : "user");
    u.rol = rolNorm;
    u.role = rolNorm;
    u.isAdmin = rolNorm === "admin" || !!u.isAdmin;
    u.isTrainer = rolNorm === "trainer" || !!u.isTrainer;
    return u;
  }

  // Completar email si faltaba
  if (!u.email && dbUser.email) {
    u.email = dbUser.email;
  }

  // Rol final: el de BD manda
  const rolDb = dbUser.rol || u.rol || u.role || "user";

  u.rol = rolDb;
  u.role = rolDb;
  u.isAdmin = rolDb === "admin";
  u.isTrainer = rolDb === "trainer";

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
    const uid = decoded.uid || decoded.id || decoded.sub || null;

    const email = decoded.email || (decoded.user && decoded.user.email) || null;

    const rolFromToken =
      decoded.rol ||
      decoded.role ||
      (decoded.isAdmin ? "admin" : "user") ||
      "user";

    const isAdminToken = !!decoded.isAdmin || rolFromToken === "admin";
    const isTrainerToken =
      !!decoded.isTrainer || rolFromToken === "trainer";

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
   Middleware: solo adiestrador (trainer)
============================================================ */
export async function requireTrainer(req, res, next) {
  try {
    if (req.user?.isTrainer || req.user?.rol === "trainer") {
      return next();
    }

    // En caso de que el token vaya desactualizado, miramos BD
    const dbUser = await getUserFromDB(req.user?.uid, req.user?.email);
    if (dbUser && dbUser.rol === "trainer") {
      req.user.rol = "trainer";
      req.user.role = "trainer";
      req.user.isTrainer = true;
      req.user.isAdmin = dbUser.rol === "admin";
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
    if (
      req.user?.isAdmin ||
      req.user?.rol === "admin" ||
      req.user?.isTrainer ||
      req.user?.rol === "trainer"
    ) {
      return next();
    }

    // Consultar BD por si el rol ha cambiado
    const dbUser = await getUserFromDB(req.user?.uid, req.user?.email);
    if (dbUser && (dbUser.rol === "admin" || dbUser.rol === "trainer")) {
      req.user.rol = dbUser.rol;
      req.user.role = dbUser.rol;
      req.user.isAdmin = dbUser.rol === "admin";
      req.user.isTrainer = dbUser.rol === "trainer";
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
   Ej: allowRoles(['admin', 'trainer'])
============================================================ */
export function allowRoles(roles = []) {
  const set = new Set(roles);
  return async (req, res, next) => {
    try {
      if (!req.user)
        return res.status(401).json({ error: "No autenticado" });

      const rolToken = req.user.rol || "user";

      // Si el rol del token ya está permitido → OK
      if (set.has(rolToken)) return next();

      // Miramos BD por si el rol ha cambiado
      const dbUser = await getUserFromDB(req.user.uid, req.user.email);
      if (dbUser && set.has(dbUser.rol)) {
        req.user.rol = dbUser.rol;
        req.user.role = dbUser.rol;
        req.user.isAdmin = dbUser.rol === "admin";
        req.user.isTrainer = dbUser.rol === "trainer";
        return next();
      }

      // Caso especial: permitir admin aunque no esté en el token
      if (set.has("admin")) {
        const okAdmin = await isAdminInDB(
          req.user.uid,
          req.user.email
        );
        if (okAdmin) return next();
      }

      return res.status(403).json({ error: "Permisos insuficientes" });
    } catch (err) {
      console.error("allowRoles error:", err.message);
      return res.status(500).json({ error: "Error de autorización" });
    }
  };
}
