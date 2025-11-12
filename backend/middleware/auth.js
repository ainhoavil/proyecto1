// backend/middleware/auth.js
import jwt from 'jsonwebtoken';
import { query } from '../db.js';

if (!process.env.JWT_SECRET) {
  throw new Error('❌ Falta JWT_SECRET en backend/.env');
}

/** =================== Utilidad: extrae el token Bearer =================== */
function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/** =================== Comprueba si el usuario es admin en BD =================== */
async function isAdminInDB(uid, email) {
  if (uid) {
    const r1 = await query('SELECT rol FROM usuarios WHERE id = ? LIMIT 1', [uid]);
    if (r1.length) return r1[0].rol === 'admin';
  }
  if (email) {
    const r2 = await query('SELECT rol FROM usuarios WHERE email = ? LIMIT 1', [email]);
    if (r2.length) return r2[0].rol === 'admin';
  }
  return false;
}

/** =================== Middleware: verifica JWT y adjunta req.user =================== */
export async function verifyToken(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Falta Authorization: Bearer <token>' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const rol = decoded.rol || decoded.role || 'user';

    // base del usuario desde el token
    req.user = {
      uid: decoded.uid || decoded.id || null,
      email: decoded.email || decoded.user?.email || null,
      rol,
      role: rol,                  // compatibilidad
      isAdmin: rol === 'admin',   // flag principal que usa reservas.js
      iat: decoded.iat,
      exp: decoded.exp,
    };

    // comprobación adicional en BD, por si el token no traía admin
    if (!req.user.isAdmin) {
      const okDB = await isAdminInDB(req.user.uid, req.user.email);
      if (okDB) req.user.isAdmin = true;
    }

    return next();
  } catch (err) {
    console.error('❌ verifyToken error:', err.message);
    return res.status(401).json({ error: 'Token inválido' });
  }
}

/** =================== Middleware: exige rol admin =================== */
export async function requireAdmin(req, res, next) {
  try {
    // si el token ya indica admin, pasa
    if (req.user?.isAdmin || req.user?.rol === 'admin') {
      return next();
    }

    // comprobación extra desde BD
    const ok = await isAdminInDB(req.user?.uid, req.user?.email);
    if (ok) return next();

    return res.status(403).json({ error: 'Permisos insuficientes' });
  } catch (err) {
    console.error('❌ requireAdmin error:', err.message);
    return res.status(500).json({ error: 'Error de autorización' });
  }
}

/** =================== Middleware: permite varios roles =================== */
export function allowRoles(roles = []) {
  const set = new Set(roles);
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });
      const rolToken = req.user.rol || 'user';

      if (set.has(rolToken)) return next();

      const okAdmin = await isAdminInDB(req.user.uid, req.user.email);
      if (okAdmin && set.has('admin')) return next();

      return res.status(403).json({ error: 'Permisos insuficientes' });
    } catch (err) {
      console.error('❌ allowRoles error:', err.message);
      return res.status(500).json({ error: 'Error de autorización' });
    }
  };
}
