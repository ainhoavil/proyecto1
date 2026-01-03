// frontend/src/components/CookieConsentModal.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/cookies.scss";
import {
  defaultConsent,
  hasDecided,
  readConsent,
  writeConsent,
} 
from "../helpers/consentStore";

export default function CookieConsentModal() {
  const initial = useMemo(() => readConsent() || defaultConsent, []);
  const [open, setOpen] = useState(false);

  const [prefs, setPrefs] = useState({
    essential: true,
    preferences: Boolean(initial.preferences),
    analytics: Boolean(initial.analytics),
    marketing: Boolean(initial.marketing),
  });

  // Abrir en primera carga si aún no hay decisión (DIRECTO EN CONFIG)
  useEffect(() => {
    if (!hasDecided()) {
      setOpen(true);
      // evita que aparezca “abajo raro” si el usuario está scrolleado
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
    }
  }, []);

  // Permite abrir desde Footer (Preferencias de cookies)
  useEffect(() => {
    const onOpen = () => {
      const current = readConsent() || defaultConsent;
      setPrefs({
        essential: true,
        preferences: Boolean(current.preferences),
        analytics: Boolean(current.analytics),
        marketing: Boolean(current.marketing),
      });

      setOpen(true);

      // sube arriba para que el modal quede “normal”
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      });
    };

    window.addEventListener("df:cookie-preferences-open", onOpen);
    return () => window.removeEventListener("df:cookie-preferences-open", onOpen);
  }, []);

  // Bloqueo scroll cuando modal abierto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const closeIfAlreadyDecided = () => {
    // Solo se permite cerrar con X/click fuera si YA hay decisión previa
    if (hasDecided()) setOpen(false);
  };

  const acceptAll = () => {
    writeConsent({ preferences: true, analytics: true, marketing: true });
    setOpen(false);
  };

  const rejectAll = () => {
    writeConsent({ preferences: false, analytics: false, marketing: false });
    setOpen(false);
  };

  const savePrefs = () => {
    writeConsent({
      preferences: prefs.preferences,
      analytics: prefs.analytics,
      marketing: prefs.marketing,
    });
    setOpen(false);
  };

  const goToPolicy = () => {
    // Cierra para que se pueda leer la política; como no hay decisión,
    // volverá a mostrarse al entrar de nuevo si no han guardado.
    setOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
  };

  if (!open) return null;

  return (
    <div
      className="df-cookies__backdrop"
      role="presentation"
      onMouseDown={closeIfAlreadyDecided}
    >
      <div
        className="df-cookies__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="df-cookies-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="df-cookies__header">
          <div>
            <p className="df-cookies__eyebrow">Preferencias</p>
            <h2 id="df-cookies-title" className="df-cookies__title">
              Cookies y privacidad
            </h2>
            <p className="df-cookies__subtitle">
              Utilizamos cookies propias y de terceros para el funcionamiento del sitio, guardar
              tus preferencias y, si lo autorizas, medir el uso y personalizar contenidos.
              Puedes aceptar, rechazar o configurar tus opciones.
            </p>
          </div>

          {hasDecided() && (
            <button
              className="df-cookies__iconBtn"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
            >
              ✕
            </button>
          )}
        </div>

        <div className="df-cookies__prefs">
          <div className="df-cookies__prefRow df-cookies__prefRow--disabled">
            <div>
              <h3>Cookies necesarias</h3>
              <p>
                Imprescindibles para que el sitio funcione correctamente y mantener la seguridad.
                No se pueden desactivar.
              </p>
            </div>
            <div className="df-cookies__toggle df-cookies__toggle--on" aria-hidden="true" />
          </div>

          <div className="df-cookies__prefRow">
            <div>
              <h3>Cookies de preferencias</h3>
              <p>
                Permiten recordar opciones como idioma, región o ajustes de interfaz.
              </p>
            </div>
            <label className="df-cookies__switch">
              <input
                type="checkbox"
                checked={prefs.preferences}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, preferences: e.target.checked }))
                }
              />
              <span className="df-cookies__slider" />
            </label>
          </div>

          <div className="df-cookies__prefRow">
            <div>
              <h3>Cookies de analítica</h3>
              <p>
                Nos ayudan a entender el uso del sitio (páginas visitadas, rendimiento) para mejorarlo.
              </p>
            </div>
            <label className="df-cookies__switch">
              <input
                type="checkbox"
                checked={prefs.analytics}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, analytics: e.target.checked }))
                }
              />
              <span className="df-cookies__slider" />
            </label>
          </div>

          <div className="df-cookies__prefRow">
            <div>
              <h3>Cookies de marketing</h3>
              <p>
                Permiten personalizar contenido y medir campañas publicitarias (si aplica).
              </p>
            </div>
            <label className="df-cookies__switch">
              <input
                type="checkbox"
                checked={prefs.marketing}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, marketing: e.target.checked }))
                }
              />
              <span className="df-cookies__slider" />
            </label>
          </div>
        </div>

        <div className="df-cookies__actions">
          <button className="df-cookies__btn df-cookies__btn--ghost" onClick={rejectAll}>
            Rechazar todo
          </button>

          <button className="df-cookies__btn df-cookies__btn--soft" onClick={savePrefs}>
            Guardar preferencias
          </button>

          <button className="df-cookies__btn df-cookies__btn--primary" onClick={acceptAll}>
            Aceptar todas
          </button>
        </div>

        <div className="df-cookies__footer">
          <Link className="df-cookies__link" to="/privacidad" onClick={goToPolicy}>
            Política de privacidad
          </Link>
          <span className="df-cookies__dot">•</span>
          <Link className="df-cookies__link" to="/aviso-legal" onClick={goToPolicy}>
            Aviso legal
          </Link>
          <span className="df-cookies__dot">•</span>
          <Link className="df-cookies__link" to="/cookies" onClick={goToPolicy}>
            Política de cookies
          </Link>
        </div>
      </div>
    </div>
  );
}
