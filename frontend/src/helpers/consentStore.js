// frontend/src/helpers/cookieConsent.js

const KEY = "df_cookie_consent_v1";
const VERSION = 1;

/**
 * Estructura:
 * {
 *   version: 1,
 *   decidedAt: ISO string,
 *   essential: true,
 *   preferences: boolean,
 *   analytics: boolean,
 *   marketing: boolean
 * }
 */

export const defaultConsent = {
  version: VERSION,
  decidedAt: null,
  essential: true,
  preferences: false,
  analytics: false,
  marketing: false,
};

export const isBrowser = () => typeof window !== "undefined";

export function readConsent() {
  if (!isBrowser()) return null;

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) return null;

    return {
      ...defaultConsent,
      ...parsed,
      essential: true,
    };
  } catch {
    return null;
  }
}

export function hasDecided() {
  const c = readConsent();
  return Boolean(c?.decidedAt);
}

export function writeConsent(consent) {
  if (!isBrowser()) return;

  const payload = {
    version: VERSION,
    decidedAt: new Date().toISOString(),
    essential: true,
    preferences: Boolean(consent.preferences),
    analytics: Boolean(consent.analytics),
    marketing: Boolean(consent.marketing),
  };

  localStorage.setItem(KEY, JSON.stringify(payload));

  // Cookie opcional (útil si luego quieres leerlo en backend)
  setCookie(
    "df_cookie_consent",
    encodeURIComponent(JSON.stringify(payload)),
    180
  );

  window.dispatchEvent(
    new CustomEvent("df:cookie-consent-updated", { detail: payload })
  );
}

export function clearConsent() {
  if (!isBrowser()) return;
  localStorage.removeItem(KEY);
  setCookie("df_cookie_consent", "", -1);
  window.dispatchEvent(new Event("df:cookie-consent-cleared"));
}

function setCookie(name, value, days) {
  if (!isBrowser()) return;

  const expires = new Date();
  expires.setDate(expires.getDate() + days);

  document.cookie = `${name}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}
