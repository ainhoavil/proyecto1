import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { http } from "../helpers/http";

function normalizeRole(raw) {
  const r = String(raw || "").trim().toLowerCase();
  if (!r) return "client";
  if (r === "user" || r === "usuario" || r === "cliente") return "client";
  if (r === "trainer") return "adiestrador";
  return r;
}

const AUTH_KEYS = ["token", "rol", "user", "usuarioLogueado"];

function clearAuthStorage() {
  for (const k of AUTH_KEYS) {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  }
}

function getActiveStore() {
  if (localStorage.getItem("token")) return localStorage;
  if (sessionStorage.getItem("token")) return sessionStorage;
  return localStorage;
}

function readUserFromStore(store) {
  try {
    return JSON.parse(store.getItem("user") || "null");
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    return localStorage.getItem("token") || sessionStorage.getItem("token") || null;
  });

  const [role, setRole] = useState(() => {
    const store = getActiveStore();
    return normalizeRole(store.getItem("rol")) || "client";
  });

  const [user, setUser] = useState(() => {
    const store = getActiveStore();
    return readUserFromStore(store);
  });

  const [loading, setLoading] = useState(false);

  const isAuthenticated = !!token;

  // Verifica token con /api/auth/me (best-effort)
  useEffect(() => {
    let cancel = false;

    async function verify() {
      if (!token) return;
      setLoading(true);

      try {
        const me = await http("/api/auth/me", { auth: true });
        if (cancel) return;

        const rawUser = me?.user || null;

        const nextRole = rawUser?.role || rawUser?.rol || role || "user";

        const nextUser = {
          uid: rawUser?.uid || null,
          email: rawUser?.email || null,
          role: nextRole,
          isAdmin: nextRole === "admin",
        };

        setRole(normalizeRole(nextRole));
        setUser(nextUser);

        const store = getActiveStore();
        store.setItem("rol", normalizeRole(nextRole));
        store.setItem("user", JSON.stringify(nextUser));
      } catch {
        // best-effort: si falla, no invalidamos la sesión automáticamente
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

  // loginSuccess: guarda sesión en localStorage (recordar) o sessionStorage (no recordar)
  function loginSuccess(payload, opts = {}) {
    const t = payload?.token || null;
    if (!t) return;

    // Por defecto, mantenemos el comportamiento histórico: "recordar" (persistente)
    const remember = opts?.remember !== false;
    const store = remember ? localStorage : sessionStorage;

    const nextRole = payload.rol || payload.role || "user";

    const nextUser = {
      uid: payload.uid || payload.user?.uid || null,
      email: payload.email || payload.user?.email || null,
      role: nextRole,
      isAdmin: nextRole === "admin",
    };

    setToken(t);
    setRole(normalizeRole(nextRole));
    setUser(nextUser);

    // Limpia ambos storages antes de guardar el nuevo estado
    clearAuthStorage();

    store.setItem("token", t);
    store.setItem("rol", normalizeRole(nextRole));
    store.setItem("user", JSON.stringify(nextUser));
    store.setItem("usuarioLogueado", "1"); // legacy
  }

  function logout() {
    setToken(null);
    setRole("client");
    setUser(null);
    clearAuthStorage();
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
