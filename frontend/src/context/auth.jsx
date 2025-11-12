import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http } from '../helpers/http';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [role, setRole] = useState(() => localStorage.getItem('rol') || 'guest');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(false); // ojo: empezamos en false

  const isAuthenticated = !!token;

  useEffect(() => {
    let cancel = false;
    async function verify() {
      if (!token) return; // sin token, nada que verificar
      setLoading(true);
      try {
        // si tu backend no tiene /auth/me, esto fallará. No deslogues en ese caso.
        const me = await http('/api/auth/me', { auth: true });
        if (cancel) return;
        const nextRole = me?.role || me?.user?.role || role || 'client';
        const nextUser = me?.user || me || user || null;
        setRole(nextRole);
        setUser(nextUser);
        localStorage.setItem('rol', nextRole);
        localStorage.setItem('user', JSON.stringify(nextUser));
      } catch (e) {
        // si realmente tu token es inválido, muchas vistas fallarán con 401 y ya haremos logout manual
        // NO borramos el token aquí para no crear bucles de redirect si el endpoint no existe
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    verify();
    return () => { cancel = true; };
    // eslint-disable-next-line
  }, [token]);

  function loginSuccess({ token: t, role: r = 'client', user: u = null }) {
    setToken(t);
    setRole(r);
    setUser(u);
    localStorage.setItem('token', t || '');
    localStorage.setItem('rol', r);
    localStorage.setItem('usuarioLogueado', '1');
    localStorage.setItem('user', JSON.stringify(u));
  }

  function logout() {
    setToken(null);
    setRole('guest');
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('rol');
    localStorage.removeItem('usuarioLogueado');
    localStorage.removeItem('user');
  }

  const value = useMemo(() => ({
    token, role, user, isAuthenticated, loading,
    loginSuccess, logout,
  }), [token, role, user, isAuthenticated, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
