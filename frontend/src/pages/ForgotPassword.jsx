// frontend/src/pages/ForgotPassword.jsx
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { http } from "../helpers/http";
import "../styles/login.scss";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const nextParam = params.get("next") || "";

  const loginHref = nextParam
    ? `/login?next=${encodeURIComponent(nextParam)}`
    : "/login";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setStatus({ type: "", message: "" });
    setLoading(true);

    try {
      await http("/api/auth/forgot-password", {
        method: "POST",
        data: { email },
      });

      setStatus({
        type: "ok",
        message:
          "Si el email existe, te enviaremos instrucciones para restablecer la contraseña.",
      });
    } catch (err) {
      // El backend responde genérico igualmente, pero por seguridad mostramos lo mismo
      setStatus({
        type: "ok",
        message:
          "Si el email existe, te enviaremos instrucciones para restablecer la contraseña.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="access-page">
      <div className="access-page__container">
        <header className="access-header">
          <span className="access-header__eyebrow">RECUPERAR ACCESO</span>
          <h1 className="access-header__title">Restablecer contraseña</h1>
          <p className="access-header__lead">
            Introduce tu correo y te enviaremos un enlace para crear una contraseña nueva.
          </p>
        </header>

        <div className="access-layout">
          <section className="access-card access-card--form">
            <div className="access-card__body">
              <h2 className="access-card__title">Recuperación por email</h2>
              <p className="access-card__subtitle">
                Por seguridad, te mostraremos el mismo mensaje aunque el email no exista.
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
                  <span>Correo electrónico</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    inputMode="email"
                    placeholder="tu-email@ejemplo.com"
                    autoFocus
                  />
                </label>

                <button
                  type="submit"
                  className="access-btn access-btn--primary"
                  disabled={loading || !email}
                >
                  {loading ? "Enviando…" : "Enviar enlace"}
                </button>

                <p className="access-muted">
                  ¿Ya lo recuerdas?{" "}
                  <Link to={loginHref} className="access-link">
                    Volver a iniciar sesión
                  </Link>
                </p>
              </form>
            </div>
          </section>

          <aside className="access-card access-card--info">
            <h2 className="access-card__title">Consejo rápido</h2>
            <p className="access-card__subtitle">
              Si estás en local, el enlace de reset aparece en la consola del backend
              (por ahora no enviamos email real).
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
