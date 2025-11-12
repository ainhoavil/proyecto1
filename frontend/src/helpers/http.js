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

export async function http(
  path,
  {
    method = 'GET',
    data,
    auth = false,
    headers = {},
    query = null,
    credentials = 'same-origin',
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
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
  const isURLSearch = typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams;
  const isString = typeof data === 'string';

  const finalHeaders = { ...headers };

  // Autorización
  if (auth) {
    const token = localStorage.getItem('token');
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  // Content-Type por defecto:
  if (data !== undefined && data !== null) {
    if (isFormData) {
      // NO fijar Content-Type -> que lo ponga el navegador (con boundary)
    } else if (isURLSearch) {
      if (!finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      }
    } else if (isString) {
      // Si el llamador ya puso un Content-Type urlencoded o texto, respetarlo.
      if (!finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'text/plain;charset=UTF-8';
      }
    } else {
      // JSON por defecto
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
    }
  }

  // Body
  let body;
  if (data === undefined || data === null) {
    body = undefined;
  } else if (isFormData) {
    body = data;
  } else if (isURLSearch) {
    body = data; // se envía tal cual
  } else if (isString) {
    body = data; // tal cual (no JSON.stringify)
  } else {
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
