import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { http } from "../helpers/http";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [role, setRole] = useState(() => localStorage.getItem("rol") || "user");
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  const isAuthenticated = !!token;

  // ============================================================
  // VERIFICAR TOKEN CON /api/auth/me
  // ============================================================
  useEffect(() => {
    let cancel = false;

    async function verify() {
      if (!token) return;
      setLoading(true);

      try {
        const me = await http("/api/auth/me", { auth: true });
        if (cancel) return;

        const rawUser = me?.user || null;

        const nextRole =
          rawUser?.role ||
          rawUser?.rol ||
          role ||
          "user";

        const nextUser = {
          uid: rawUser?.uid || null,
          email: rawUser?.email || null,
          role: nextRole,
          isAdmin: nextRole === "admin",
        };

        setRole(nextRole);
        setUser(nextUser);

        localStorage.setItem("rol", nextRole);
        localStorage.setItem("user", JSON.stringify(nextUser));
      } catch (e) {
        // No quitamos token automáticamente
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    verify();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line
  }, [token]);

  // ============================================================
  // LOGIN SUCCESS —> ARREGLADO TOTALMENTE
  // ============================================================
  function loginSuccess(payload) {
    const t = payload?.token || null;
    if (!t) return;

    const nextRole =
      payload.rol ||
      payload.role ||
      "user";

    const nextUser = {
      uid: payload.uid || payload.user?.uid || null,     // 🔥 UID CORRECTO
      email: payload.email || payload.user?.email || null,
      role: nextRole,
      isAdmin: nextRole === "admin",
    };

    setToken(t);
    setRole(nextRole);
    setUser(nextUser);

    localStorage.setItem("token", t);
    localStorage.setItem("rol", nextRole);
    localStorage.setItem("user", JSON.stringify(nextUser));
    localStorage.setItem("usuarioLogueado", "1"); // legacy
  }

  // ============================================================
  // LOGOUT
  // ============================================================
  function logout() {
    setToken(null);
    setRole("user");
    setUser(null);

    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    localStorage.removeItem("user");
    localStorage.removeItem("usuarioLogueado");
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
