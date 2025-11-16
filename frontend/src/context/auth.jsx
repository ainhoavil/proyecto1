import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http } from '../helpers/http';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [role, setRole] = useState(() => localStorage.getItem('rol') || 'user');
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  const isAuthenticated = !!token;

  useEffect(() => {
    let cancel = false;

    async function verify() {
      if (!token) return;
      setLoading(true);
      try {
        const me = await http('/api/auth/me', { auth: true });

        if (cancel) return;

        const rawUser = me?.user || me || null;
        const nextRole =
          rawUser?.role ||
          rawUser?.rol ||
          role ||
          'user';

        const nextUser = rawUser || user || null;

        setRole(nextRole);
        setUser(nextUser);

        localStorage.setItem('rol', nextRole);
        localStorage.setItem('user', JSON.stringify(nextUser));
      } catch (e) {
        // No borramos el token aquí para no liar redirecciones
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    verify();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function loginSuccess(payload) {
    // payload viene normalmente de /api/auth/login
    // en tu backend: { token, email, rol }
    const t = payload?.token || null;
    if (!t) return;

    const rawUser = payload.user || null;
    const nextRole =
      payload.rol ||
      payload.role ||
      rawUser?.role ||
      rawUser?.rol ||
      'user';

    const nextUser =
      rawUser || {
        email: payload.email || null,
        role: nextRole,
        isAdmin: nextRole === 'admin',
      };

    setToken(t);
    setRole(nextRole);
    setUser(nextUser);

    localStorage.setItem('token', t);
    localStorage.setItem('rol', nextRole);
    localStorage.setItem('usuarioLogueado', '1'); // compat con código viejo si queda algo
    localStorage.setItem('user', JSON.stringify(nextUser));
  }

  function logout() {
    setToken(null);
    setRole('user');
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('rol');
    localStorage.removeItem('usuarioLogueado');
    localStorage.removeItem('user');
  }

  const value = useMemo(
    () => ({
      token,
      role,
      user,
      isAuthenticated,
      loading,
      loginSuccess,
      logout,
    }),
    [token, role, user, isAuthenticated, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
