// frontend/src/pages/Login.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { useAuth } from "../context/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [recordar, setRecordar] = useState(false); // si no marcas, la sesión se guarda solo en esta pestaña/sesión
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Google Identity Services
  const googleBtnRef = useRef(null);
  const gisInitRef = useRef(false);
  const loadingRef = useRef(false);
  const rememberRef = useRef(false);
  const nextRef = useRef({ nextParam: "", stateNext: null });

  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess } = useAuth();

  // Propaga ?next= tanto al enlace de registro como a la redirección post-login
  const params = new URLSearchParams(location.search);
  const nextParam = params.get("next") || "";

  // Mantener valores actuales accesibles desde el callback de Google (sin re-inicializar GIS)
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    rememberRef.current = recordar;
  }, [recordar]);

  useEffect(() => {
    nextRef.current = {
      nextParam,
      stateNext: location.state?.next || null,
    };
  }, [nextParam, location.state]);
  // GOOGLE SIGN-IN (GIS)
  useEffect(() => {
    const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

    // Si no hay client id, no inicializamos.
    if (!clientId) return;

    let cancelled = false;

    const init = () => {
      if (cancelled) return;
      if (gisInitRef.current) return;

      const google = window.google;
      if (!google?.accounts?.id) return;
      if (!googleBtnRef.current) return;

      gisInitRef.current = true;

      google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          const credential = response?.credential;
          if (!credential) {
            setError("No se pudo obtener credenciales de Google.");
            return;
          }

          if (loadingRef.current) return;
          setError("");
          loadingRef.current = true;
          setLoading(true);

          try {
            const res = await http("/api/auth/google", {
              method: "POST",
              data: { credential },
            });

            if (typeof loginSuccess === "function") {
              loginSuccess(res, { remember: rememberRef.current });
            }

            const next =
              nextRef.current?.nextParam ||
              nextRef.current?.stateNext ||
              "/";
            navigate(next, { replace: true });
          } catch (err) {
            const status = err?.status || err?.httpStatus || err?.response?.status;
            if (status === 401)
              setError("No se pudo validar tu cuenta de Google.");
            else
              setError("No se pudo iniciar sesión con Google. Inténtalo de nuevo.");
          } finally {
            loadingRef.current = false;
            setLoading(false);
          }
        },
      });

      // Renderiza el botón oficial de Google dentro del div
      google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 420,
      });
    };

    // Puede que el script aún no haya cargado; reintenta un poco.
    const t = setInterval(() => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        clearInterval(t);
        init();
      }
    }, 100);

    init();

    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError("");
    setLoading(true);

    try {
      // POST /api/auth/login { email, password }
      // Backend responde: { token, email, rol }
      const res = await http("/api/auth/login", {
        method: "POST",
        data: { email, password: pass },
      });

      if (typeof loginSuccess === "function") {
        loginSuccess(res, { remember: recordar });
      }

      const next = nextParam || location.state?.next || "/";
      navigate(next, { replace: true });
    } catch (err) {
      const status = err?.status || err?.httpStatus || err?.response?.status;

      if (status === 401) setError("Email o contraseña incorrectos.");
      else if (status === 400)
        setError("Solicitud inválida. Revisa los campos.");
      else if (status === 429)
        setError("Demasiados intentos. Prueba de nuevo en unos minutos.");
      else setError("No se pudo iniciar sesión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const registerHref = nextParam
    ? `/register?next=${encodeURIComponent(nextParam)}`
    : "/register";

  // ✅ Forgot password: conserva ?next= por si luego quieres redirigir tras reset
  const forgotHref = nextParam
    ? `/forgot-password?next=${encodeURIComponent(nextParam)}`
    : "/forgot-password";

  return (
    <div className="access-page">
      <div className="access-page__container">
        {/* Cabecera de la página */}
        <header className="access-header">
          <h1 className="access-header__title">
            Accede o crea tu cuenta en DogForm
          </h1>
          <p className="access-header__lead">
            Gestiona reservas, seguimiento de adiestramiento y comunicación con
            nuestro equipo desde tu espacio privado.
          </p>
        </header>

        {/* Layout dos columnas */}
        <div className="access-layout">
          {/* Izquierda: tarjeta de login */}
          <section className="access-card access-card--form">
            {/* Tabs superiores */}
            <div className="access-tabs">
              <button className="access-tab access-tab--active" type="button">
                Acceder
              </button>
              <Link to={registerHref} className="access-tab">
                Crear cuenta
              </Link>
            </div>

            <div className="access-card__body">
              <h2 className="access-card__title">Inicia sesión en tu cuenta</h2>
              <p className="access-card__subtitle">
                Introduce tu correo y contraseña para continuar con tus reservas
                y servicios.
              </p>

              {error && (
                <div className="access-alert access-alert--error" role="alert">
                  {error}
                </div>
              )}

              <form className="access-form" onSubmit={handleLogin} noValidate>
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

                <label className="access-field">
                  <span>Contraseña</span>
                  <div className="access-password-row">
                    <input
                      type={showPass ? "text" : "password"}
                      value={pass}
                      onChange={(e) => setPass(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="Tu contraseña"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={
                        showPass ? "Ocultar contraseña" : "Mostrar contraseña"
                      }
                      className="access-link-btn"
                    >
                      {showPass ? "Ocultar" : "Ver"}
                    </button>
                  </div>
                </label>

                <div className="access-form__row access-form__row--small">
                  <label className="access-check">
                    <input
                      type="checkbox"
                      checked={recordar}
                      onChange={(e) => setRecordar(e.target.checked)}
                    />
                    <span>Recordar en este dispositivo</span>
                  </label>

                  {/* ✅ ahora es Link y funciona */}
                  <Link
                    to={forgotHref}
                    className="access-link-btn access-link-btn--right"
                  >
                    He olvidado mi contraseña
                  </Link>
                </div>

                <button
                  type="submit"
                  className="access-btn access-btn--primary"
                  disabled={loading || !email || !pass}
                >
                  {loading ? "Entrando…" : "Acceder"}
                </button>

                <p className="access-muted">
                  ¿Aún no tienes cuenta?{" "}
                  <Link to={registerHref} className="access-link">
                    Crear una cuenta nueva
                  </Link>
                </p>

                <div className="access-divider">
                  <span>O continúa con</span>
                </div>

                {/* Botón oficial de Google (renderizado por GIS) */}
                <div
                  ref={googleBtnRef}
                  style={{ width: "100%", display: "flex", justifyContent: "center" }}
                />

                <p className="access-muted access-muted--small">
                  Al continuar aceptas nuestras políticas de privacidad y
                  términos de servicio.
                </p>
              </form>
            </div>
          </section>

          {/* Derecha: beneficios */}
          <aside className="access-card access-card--info">
            <h2 className="access-card__title">
              Ventajas de crear tu cuenta DogForm
            </h2>
            <p className="access-card__subtitle">
              Centraliza todo lo relacionado con el bienestar de tu perro desde
              un solo lugar.
            </p>

            <ul className="access-benefits">
              <li>
                <span className="access-benefits__icon">①</span>
                <div>
                  <p>
                    Reserva y gestiona sesiones de adiestramiento, educación y
                    paseos en Madrid en pocos clics.
                  </p>
                </div>
              </li>
              <li>
                <span className="access-benefits__icon">②</span>
                <div>
                  <p>
                    Consulta el historial de servicios,.
                  </p>
                </div>
              </li>
              <li>
                <span className="access-benefits__icon">③</span>
                <div>
                  <p>
                    Mantente en contacto directo con nuestro equipo para
                    resolver dudas rápidas sobre rutinas, ejercicios y
                    bienestar.
                  </p>
                </div>
              </li>
            </ul>

            <p className="access-help">
              Si tienes cualquier problema para acceder, también puedes
              escribirnos a{" "}
              <a href="mailto:hola@dogform.es">dogformtraining@gmail.com</a> o por WhatsApp
              al <a href="tel:+34600123456">+34 600 123 456</a>.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
