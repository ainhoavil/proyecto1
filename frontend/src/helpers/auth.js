import { normalizeEmail } from './admin';

export function isLogged() {
  return !!localStorage.getItem('usuarioLogueado');
}

export function getRole() {
  return localStorage.getItem('rol') || 'client';
}

export function getLoggedEmailNorm() {
  return normalizeEmail(localStorage.getItem('usuarioLogueado'));
}
