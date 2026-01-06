import { normalizeEmail } from "./admin";


function normalizeRole(raw) {
  const r = String(raw || "").trim().toLowerCase();
  if (!r) return "client";
  if (r === "user" || r === "usuario" || r === "cliente") return "client";
  if (r === "trainer") return "adiestrador";
  return r;
}

/* ======================================================
   TOKEN
====================================================== */
export function getToken() {
  return localStorage.getItem("token") || null;
}

export function setToken(token) {
  if (token) localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

/* ======================================================
   Sesión
====================================================== */
export function isLogged() {
  return !!getToken();
}

/* ======================================================
   Decodificar JWT
====================================================== */
function decodeToken(token) {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

/* ======================================================
   Obtener rol desde token
====================================================== */
export function getRole() {
  const token = getToken();
  if (!token) return "client";

  const p = decodeToken(token);
  if (!p) return "client";

  // rol viene en p.rol según backend
  return normalizeRole(p.rol || p.role || "client");
}

/* ======================================================
   Helpers de rol
====================================================== */
export function isAdmin() {
  return getRole() === "admin";
}

export function isTrainer() {
  return getRole() === "adiestrador";
}

export function isUser() {
  return getRole() === "user";
}

/* ======================================================
   Email logueado
====================================================== */
export function getLoggedEmailNorm() {
  const token = getToken();
  if (!token) return null;

  const p = decodeToken(token);
  return p?.email ? normalizeEmail(p.email) : null;
}
