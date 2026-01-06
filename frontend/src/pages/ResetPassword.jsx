// frontend/src/pages/ResetPassword.jsx
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { http } from "../helpers/http";

export default function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const token = params.get("token") || "";
  const nextParam = params.get("next") || "";

  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const loginHref = nextParam
    ? `/login?next=${encodeURIComponent(nextParam)}`
    : "/login";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setStatus({ type: "", message: "" });

    if (!token) {
      setStatus({ type: "err", message: "Falta el token. Abre el enlace correcto." });
      return;
    }
    const pw = String(pass1 || "");
    const strong =
      pw.length >= 8 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(pw) && /\d/.test(pw);
    if (!strong) {
      setStatus({
        type: "err",
        message:
          "La contraseña debe tener mínimo 8 caracteres e incluir letras y números.",
      });
      return;
    }
    if (pass1 !== pass2) {
      setStatus({ type: "err", message: "Las contraseñas no coinciden." });
      return;
    }

    setLoading(true);
    try {
      await http("/api/auth/reset-password", {
        method: "POST",
        data: { token, newPassword: pass1 },
      });

      setStatus({
        type: "ok",
        message: "Contraseña actualizada. Ya puedes iniciar sesión.",
      });

      // Redirige tras un momento (sin prometer tiempos: lo hacemos inmediato opcional)
      navigate(loginHref, { replace: true });
    } catch (err) {
      setStatus({
        type: "err",
        message: "No se pudo restablecer. El enlace puede haber expirado.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="access-page">
      <div className="access-page__container">
        <header className="access-header">
          <span className="access-header__eyebrow">NUEVA CONTRASEÑA</span>
          <h1 className="access-header__title">Crea una contraseña nueva</h1>
          <p className="access-header__lead">
            El enlace puede caducar. Si falla, solicita uno nuevo desde “He olvidado mi contraseña”.
          </p>
        </header>

        <div className="access-layout">
          <section className="access-card access-card--form">
            <div className="access-card__body">
              <h2 className="access-card__title">Restablecer</h2>
              <p className="access-card__subtitle">
                Mínimo 8 caracteres. Usa una contraseña que no utilices en otros sitios.
              </p>

              {status.message && (
                <div
                  className={
                    status.type === "ok"
                      ? "access-alert access-alert--success"
                      : "access-alert access-alert--error"
                  }
                  role="alert"
                >
                  {status.message}
                </div>
              )}

              <form className="access-form" onSubmit={handleSubmit} noValidate>
                <label className="access-field">
                  <span>Nueva contraseña</span>
                  <div className="access-password-row">
                    <input
                      type={show ? "text" : "password"}
                      value={pass1}
                      onChange={(e) => setPass1(e.target.value)}
                      required
                      autoComplete="new-password"
                      placeholder="Nueva contraseña"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="access-link-btn"
                    >
                      {show ? "Ocultar" : "Ver"}
                    </button>
                  </div>
                </label>

                <label className="access-field">
                  <span>Repetir contraseña</span>
                  <input
                    type={show ? "text" : "password"}
                    value={pass2}
                    onChange={(e) => setPass2(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Repite la nueva contraseña"
                  />
                </label>

                <button
                  type="submit"
                  className="access-btn access-btn--primary"
                  disabled={loading || !pass1 || !pass2}
                >
                  {loading ? "Guardando…" : "Guardar contraseña"}
                </button>

                <p className="access-muted">
                  <Link to={loginHref} className="access-link">
                    Volver al login
                  </Link>
                </p>
              </form>
            </div>
          </section>

          <aside className="access-card access-card--info">
            <h2 className="access-card__title">Si no funciona</h2>
            <p className="access-card__subtitle">
              Solicita un nuevo enlace desde la página de recuperación.
            </p>
            <Link to="/forgot-password" className="access-btn access-btn--secondary">
              Solicitar nuevo enlace
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
