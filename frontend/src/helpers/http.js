// frontend/src/helpers/http.js

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

/** Normaliza el path y mapea bookings -> reservas bajo /api */
function rewritePath(path) {
  if (/^https?:\/\//i.test(path)) return path; // absoluto => no tocar
  let p = String(path || '');
  if (!p.startsWith('/')) p = '/' + p;

  // Compat
  p = p.replace(/^\/api\/bookings\b/i, '/api/reservas');
  p = p.replace(/^\/bookings\b/i, '/api/reservas');

  if (!/^\/api\//i.test(p)) p = '/api' + p;
  p = p.replace(/\/{2,}/g, '/');
  return p;
}

// Detecta objeto plano (para serializar a JSON)
function isPlainObject(v) {
  return (
    v &&
    typeof v === 'object' &&
    !(v instanceof FormData) &&
    !(v instanceof URLSearchParams) &&
    !(v instanceof Blob) &&
    !(v instanceof ArrayBuffer)
  );
}

export async function http(
  path,
  {
    method = 'GET',
    data,
    auth = false,
    headers = {},
    query = null,
    credentials = 'include', // útil si usas cookies; con Bearer no molesta
    timeoutMs = 15000,
  } = {}
) {
  const rPath = rewritePath(path);
  const isAbsolute = /^https?:\/\//i.test(rPath);
  const base = isAbsolute ? '' : API_BASE;
  let url = isAbsolute ? rPath : `${base}${rPath}`;

  // Querystring
  if (query && typeof query === 'object') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const q = qs.toString();
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  }

  // ==== Headers / Body
  const finalHeaders = { Accept: 'application/json', ...headers };

  // Autorización
  if (auth) {
    const token = localStorage.getItem('token');
    if (token && !finalHeaders.Authorization) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  // Content-Type y body
  let body;
  if (data === undefined || data === null) {
    body = undefined;
  } else if (data instanceof FormData) {
    // No fijar Content-Type: el navegador añade el boundary
    body = data;
  } else if (data instanceof URLSearchParams) {
    if (!finalHeaders['Content-Type']) {
      finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    body = data;
  } else if (typeof data === 'string') {
    if (!finalHeaders['Content-Type']) {
      finalHeaders['Content-Type'] = 'text/plain;charset=UTF-8';
    }
    body = data;
  } else if (isPlainObject(data)) {
    if (!finalHeaders['Content-Type']) {
      finalHeaders['Content-Type'] = 'application/json;charset=UTF-8';
    }
    body = JSON.stringify(data);
  } else {
    // Caso raro: tipos no previstos -> intenta serializar a JSON
    if (!finalHeaders['Content-Type']) {
      finalHeaders['Content-Type'] = 'application/json;charset=UTF-8';
    }
    body = JSON.stringify(data);
  }

  // Timeout
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
    const err = new Error('No se pudo conectar con el servidor.');
    err.cause = e;
    err.status = 0;
    err.data = null;
    throw err;
  } finally {
    clearTimeout(t);
  }

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  let payload;
  try {
    payload = res.status === 204 ? null : isJson ? await res.json() : await res.text();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = new Error((payload && (payload.error || payload.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = payload;
    throw err;
  }

  return payload;
}

// Atajos
export const get  = (p, opts)       => http(p, { ...opts, method: 'GET' });
export const post = (p, data, opts) => http(p, { ...opts, method: 'POST', data });
export const put  = (p, data, opts) => http(p, { ...opts, method: 'PUT', data });
export const del  = (p, opts)       => http(p, { ...opts, method: 'DELETE' });
