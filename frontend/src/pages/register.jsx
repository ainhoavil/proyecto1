// frontend/src/pages/Register.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { useAuth } from "../context/auth";
import "../styles/register.scss";

export default function Register() {
  const [nombre, setNombre] = useState("");
  const [apellidos, setApellidos] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [zona, setZona] = useState("");
  const [perroNombre, setPerroNombre] = useState("");
  const [perroTamano, setPerroTamano] = useState("");

  const [intereses, setIntereses] = useState({
    adiestramiento: false,
    paseos: false,
    educacion: false,
    conducta: false,
  });

  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [aceptaTips, setAceptaTips] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess } = useAuth();

  const params = new URLSearchParams(location.search);
  const nextParam = params.get("next") || "";

  // Google Identity Services (Registrarse con Google)
  const googleBtnRef = useRef(null);
  const gisInitRef = useRef(false);
  const loadingRef = useRef(false);
  const termsRef = useRef(false);
  const nextRef = useRef({ nextParam: "", stateNext: null });

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    termsRef.current = aceptaTerminos;
  }, [aceptaTerminos]);

  useEffect(() => {
    nextRef.current = { nextParam, stateNext: location.state?.next || null };
  }, [nextParam, location.state]);

  useEffect(() => {
    const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
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

          // Para registrar con Google también exigimos aceptación de términos
          if (!termsRef.current) {
            setError("Debes aceptar los términos y condiciones para continuar.");
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
              loginSuccess(res);
            }

            const next =
              nextRef.current?.nextParam || nextRef.current?.stateNext || "/";
            navigate(next, { replace: true });
          } catch (err) {
            const status =
              err?.status || err?.httpStatus || err?.response?.status;
            if (status === 401)
              setError("No se pudo validar tu cuenta de Google.");
            else
              setError("No se pudo registrarte con Google. Inténtalo de nuevo.");
          } finally {
            loadingRef.current = false;
            setLoading(false);
          }
        },
      });

      google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signup_with",
        shape: "pill",
        width: 420,
      });
    };

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

  const canSubmit =
    !loading &&
    nombre.trim().length > 1 &&
    email.trim().length > 5 &&
    pass.length >= 6 &&
    pass2.length >= 6 &&
    aceptaTerminos;

  const handleRegister = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError("");

    if (pass !== pass2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (pass.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (!aceptaTerminos) {
      setError("Debes aceptar los términos y condiciones.");
      return;
    }

    setLoading(true);
    try {
      const res = await http("/auth/register", {
        method: "POST",
        data: {
          name: `${nombre} ${apellidos}`.trim(),
          email: email.trim().toLowerCase(),
          password: pass,
          telefono: telefono.trim(),
          zona: zona.trim(),
          perroNombre: perroNombre.trim(),
          perroTamano: perroTamano.trim(),
          intereses,
          aceptaTips,
        },
      });

      if (res?.token) {
        if (typeof loginSuccess === "function") {
          loginSuccess(res);
        }
        const next = nextParam || location.state?.next || "/";
        navigate(next, { replace: true });
      } else {
        const nextLogin = nextParam
          ? `/login?next=${encodeURIComponent(nextParam)}`
          : "/login";
        navigate(nextLogin, { replace: true });
      }
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const backendMsg = err?.data?.error || err?.response?.data?.error || "";

      if (status === 409) setError("Este email ya está registrado.");
      else if (status === 400)
        setError(backendMsg || "Revisa los campos del formulario.");
      else setError("No se pudo crear la cuenta. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="register-container">
        <header className="register-header">
          <span className="register-eyebrow">CREAR CUENTA</span>
          <h1 className="register-title">Crea tu cuenta en DogForm</h1>
          <p className="register-lead">
            Empieza a gestionar reservas, seguimiento y comunicación con el
            equipo. Puedes completar más detalles después.
          </p>
        </header>

        <div className="register-grid">
          <section className="register-card register-card--form">
            <div className="register-tabs">
              <Link
                to={
                  nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : "/login"
                }
                className="register-tab"
              >
                Acceder
              </Link>
              <button className="register-tab register-tab--active" type="button">
                Crear cuenta
              </button>
            </div>

            <div className="register-card__body">
              <h2 className="register-section-title">
                Información básica para empezar
              </h2>
              <p className="register-section-sub">
                Solo te llevará un minuto. Podrás completar más detalles de tu
                perro más adelante.
              </p>

              {error && (
                <div className="register-alert" role="alert">
                  {error}
                </div>
              )}

              <form className="register-form" onSubmit={handleRegister}>
                <div className="form-grid">
                  <label>
                    Nombre
                    <input
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder="Tu nombre"
                      required
                    />
                  </label>

                  <label>
                    Apellidos
                    <input
                      value={apellidos}
                      onChange={(e) => setApellidos(e.target.value)}
                      placeholder="Tus apellidos"
                    />
                  </label>

                  <label>
                    Correo electrónico
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu-email@ejemplo.com"
                      required
                    />
                  </label>

                  <label>
                    Teléfono (opcional)
                    <input
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      placeholder="+34 600 123 456"
                    />
                  </label>

                  <label>
                    Zona (opcional)
                    <input
                      value={zona}
                      onChange={(e) => setZona(e.target.value)}
                      placeholder="Madrid / Centro / etc."
                    />
                  </label>

                  <label>
                    Nombre del perro (opcional)
                    <input
                      value={perroNombre}
                      onChange={(e) => setPerroNombre(e.target.value)}
                      placeholder="Kira"
                    />
                  </label>

                  <label>
                    Tamaño del perro (opcional)
                    <select
                      value={perroTamano}
                      onChange={(e) => setPerroTamano(e.target.value)}
                    >
                      <option value="">Selecciona</option>
                      <option value="pequeño">Pequeño</option>
                      <option value="mediano">Mediano</option>
                      <option value="grande">Grande</option>
                    </select>
                  </label>

                  <div className="full">
                    <p className="subhead">¿Qué te interesa?</p>
                    <div className="checks">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={intereses.adiestramiento}
                          onChange={() =>
                            setIntereses((p) => ({
                              ...p,
                              adiestramiento: !p.adiestramiento,
                            }))
                          }
                        />
                        Adiestramiento
                      </label>

                      <label className="check">
                        <input
                          type="checkbox"
                          checked={intereses.paseos}
                          onChange={() =>
                            setIntereses((p) => ({ ...p, paseos: !p.paseos }))
                          }
                        />
                        Paseos
                      </label>

                      <label className="check">
                        <input
                          type="checkbox"
                          checked={intereses.educacion}
                          onChange={() =>
                            setIntereses((p) => ({ ...p, educacion: !p.educacion }))
                          }
                        />
                        Educación
                      </label>

                      <label className="check">
                        <input
                          type="checkbox"
                          checked={intereses.conducta}
                          onChange={() =>
                            setIntereses((p) => ({ ...p, conducta: !p.conducta }))
                          }
                        />
                        Conducta
                      </label>
                    </div>
                  </div>

                  <label>
                    Contraseña
                    <div className="password-row">
                      <input
                        type={showPass1 ? "text" : "password"}
                        value={pass}
                        onChange={(e) => setPass(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        required
                      />
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setShowPass1((v) => !v)}
                      >
                        {showPass1 ? "Ocultar" : "Ver"}
                      </button>
                    </div>
                  </label>

                  <label>
                    Repetir contraseña
                    <div className="password-row">
                      <input
                        type={showPass2 ? "text" : "password"}
                        value={pass2}
                        onChange={(e) => setPass2(e.target.value)}
                        placeholder="Repite tu contraseña"
                        required
                      />
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setShowPass2((v) => !v)}
                      >
                        {showPass2 ? "Ocultar" : "Ver"}
                      </button>
                    </div>
                  </label>

                  <div className="full">
                    <p className="subhead">Condiciones</p>

                    <label className="check">
                      <input
                        type="checkbox"
                        checked={aceptaTerminos}
                        onChange={(e) => setAceptaTerminos(e.target.checked)}
                        required
                      />
                      Acepto los términos y condiciones y la política de privacidad.
                    </label>

                    <label className="check">
                      <input
                        type="checkbox"
                        checked={aceptaTips}
                        onChange={(e) => setAceptaTips(e.target.checked)}
                      />
                      Quiero recibir recomendaciones y consejos para el cuidado de mi perro.
                    </label>
                  </div>
                </div>

                <div className="register-divider">
                  <span>O continúa con</span>
                </div>

                <div className="register-google">
                  <div
                    ref={googleBtnRef}
                    className="register-google__button"
                    aria-label="Registrarse con Google"
                  />
                </div>

                <button type="submit" className="btn-primary" disabled={!canSubmit}>
                  {loading ? "Creando…" : "Crear cuenta y continuar"}
                </button>

                <p className="muted">
                  ¿Ya tienes cuenta?{" "}
                  <Link
                    to={
                      nextParam
                        ? `/login?next=${encodeURIComponent(nextParam)}`
                        : "/login"
                    }
                  >
                    Acceder
                  </Link>
                </p>
              </form>
            </div>
          </section>

          <aside className="register-card register-card--info">
            <h3 className="register-info-title">Lo que obtienes con tu cuenta</h3>
            <ul className="register-info-list">
              <li>Reserva y gestiona servicios fácilmente.</li>
              <li>Consulta historial y seguimiento del adiestramiento.</li>
              <li>Comunicación directa con el equipo.</li>
              <li>Acceso rápido a materiales y recomendaciones.</li>
            </ul>

            <p className="register-help">
              Si tienes cualquier duda durante el registro, escríbenos a{" "}
              <a href="mailto:hola@dogform.es">hola@dogform.es</a> o por WhatsApp al{" "}
              <a href="tel:+34600123456">+34 600 123 456</a>.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
