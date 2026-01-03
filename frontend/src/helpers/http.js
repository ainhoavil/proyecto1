// frontend/src/helpers/http.js
import { getToken } from "./auth";

const API_BASE_RAW = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(
  /\/+$/,
  ""
);

// Si el usuario puso VITE_API_URL con /api al final, lo soportamos sin romper rutas
const BASE_HAS_API_SUFFIX = /\/api$/i.test(API_BASE_RAW);

// Base final (sin trailing slash)
const API_BASE = API_BASE_RAW;

/** Normaliza el path y mapea bookings -> reservas */
function rewritePath(path) {
  if (/^https?:\/\//i.test(path)) return path; // absoluto => no tocar

  let p = String(path || "");
  if (!p.startsWith("/")) p = "/" + p;

  // Separar pathname de query/hash para tocar solo el pathname
  const m = p.match(/^([^?#]*)(.*)$/);
  let pathname = m ? m[1] : p;
  const suffix = m ? m[2] : "";

  // Compat: bookings -> reservas
  pathname = pathname.replace(/^\/api\/bookings\b/i, "/api/reservas");
  pathname = pathname.replace(/^\/bookings\b/i, "/api/reservas");

  if (BASE_HAS_API_SUFFIX) {
    // Si la base ya termina en /api, quitamos /api del path para evitar /api/api
    pathname = pathname.replace(/^\/api\b/i, "");
    if (!pathname.startsWith("/")) pathname = "/" + pathname;
  } else {
    // Si la base NO tiene /api, lo añadimos al path
    if (!/^\/api\//i.test(pathname)) pathname = "/api" + pathname;
  }

  pathname = pathname.replace(/\/{2,}/g, "/");
  return pathname + suffix;
}

function isPlainObject(v) {
  return (
    v &&
    typeof v === "object" &&
    !(v instanceof FormData) &&
    !(v instanceof URLSearchParams) &&
    !(v instanceof Blob) &&
    !(v instanceof ArrayBuffer)
  );
}

export async function http(
  path,
  {
    method = "GET",
    data,
    auth = false,
    headers = {},
    query = null,
    credentials = "include",
    timeoutMs = 15000,
  } = {}
) {
  const rPath = rewritePath(path);
  const isAbsolute = /^https?:\/\//i.test(rPath);

  const base = isAbsolute ? "" : API_BASE;
  let url = isAbsolute ? rPath : `${base}${rPath}`;

  // Querystring (objeto -> ?a=b)
  if (query && typeof query === "object") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const q = qs.toString();
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }

  const finalHeaders = { Accept: "application/json", ...headers };

  if (auth) {
    const token = getToken();
    if (token && !finalHeaders.Authorization) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  let body;
  if (data === undefined || data === null) {
    body = undefined;
  } else if (data instanceof FormData) {
    body = data;
  } else if (data instanceof URLSearchParams) {
    if (!finalHeaders["Content-Type"]) {
      finalHeaders["Content-Type"] =
        "application/x-www-form-urlencoded;charset=UTF-8";
    }
    body = data;
  } else if (typeof data === "string") {
    if (!finalHeaders["Content-Type"]) {
      finalHeaders["Content-Type"] = "text/plain;charset=UTF-8";
    }
    body = data;
  } else if (isPlainObject(data)) {
    if (!finalHeaders["Content-Type"]) {
      finalHeaders["Content-Type"] = "application/json;charset=UTF-8";
    }
    body = JSON.stringify(data);
  } else {
    if (!finalHeaders["Content-Type"]) {
      finalHeaders["Content-Type"] = "application/json;charset=UTF-8";
    }
    body = JSON.stringify(data);
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      body,
      credentials,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error("No se pudo conectar con el servidor.");
    err.cause = e;
    err.status = 0;
    err.httpStatus = 0;
    err.data = null;
    err.responseData = null;
    throw err;
  } finally {
    clearTimeout(t);
  }

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  let payload;
  try {
    payload =
      res.status === 204 ? null : isJson ? await res.json() : await res.text();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = new Error(
      (payload && (payload.error || payload.message)) || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.httpStatus = res.status;
    err.data = payload;
    err.responseData = payload;
    throw err;
  }

  return payload;
}

export const get = (p, opts) => http(p, { ...opts, method: "GET" });
export const post = (p, data, opts) => http(p, { ...opts, method: "POST", data });
export const put = (p, data, opts) => http(p, { ...opts, method: "PUT", data });
export const del = (p, opts) => http(p, { ...opts, method: "DELETE" });
