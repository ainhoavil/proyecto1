// backend/utils/validators.js
// Validaciones comunes (sin dependencias externas)

export function isValidEmail(email) {
  const s = String(email || "").trim().toLowerCase();
  // Regex razonable (no pretende validar todos los casos RFC, pero evita basura)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export function countLetters(text) {
  const s = String(text || "");
  const letters = s.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g);
  return letters ? letters.length : 0;
}

export function hasMinLetters(text, min = 2) {
  return countLetters(text) >= min;
}

export function normalizeSpanishPhone(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  // Quita espacios, guiones, paréntesis, etc. Conserva + solo al principio
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+34")) s = s.slice(3);
  // Si viene como 34XXXXXXXXX (11 dígitos), recorta prefijo
  if (/^34\d{9}$/.test(s)) s = s.slice(2);
  // Ya sin prefijos: solo dígitos
  s = s.replace(/\D/g, "");
  return s;
}

export function isValidSpanishPhone(raw) {
  const norm = normalizeSpanishPhone(raw);
  return /^\d{9}$/.test(norm);
}

export function isStrongPassword(pw) {
  const s = String(pw || "");
  if (s.length < 8) return false;
  const hasLetter = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(s);
  const hasNumber = /\d/.test(s);
  return hasLetter && hasNumber;
}
