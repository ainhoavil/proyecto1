// frontend/src/pages/Register.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { useAuth } from "../context/auth";

export default function Register() {
  const [nombre, setNombre] = useState("");
  const [apellidos, setApellidos] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [zona, setZona] = useState("");
  const [perroNombre, setPerroNombre] = useState("");
  const [perroTamano, setPerroTamano] = useState("");

  // Interés principal (desplegable)
  const [interes, setInteres] = useState("");

  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const [aceptaTerminos, setAceptaTerminos] = useState(false);

  // Solo para errores del backend / Google (no validaciones de campos)
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Para mostrar errores por campo según se va rellenando
  const [touched, setTouched] = useState({
    nombre: false,
    apellidos: false,
    email: false,
    telefono: false,
    pass: false,
    pass2: false,
    terminos: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const touch = (k) => setTouched((p) => (p[k] ? p : { ...p, [k]: true }));
  const showFieldError = (k) => submitAttempted || touched[k];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const countLetters = (v) => {
    const m = String(v || "").match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g);
    return m ? m.length : 0;
  };

  const normalizeEsPhone = (raw) => {
    let s = String(raw || "").trim();
    if (!s) return "";
    s = s.replace(/[^\d+]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    if (s.startsWith("+34")) s = s.slice(3);
    if (/^34\d{9}$/.test(s)) s = s.slice(2);
    s = s.replace(/\D/g, "");
    return s;
  };

  const isValidEsPhone = (raw) => /^\d{9}$/.test(normalizeEsPhone(raw));

  const isStrongPassword = (pw) => {
    const s = String(pw || "");
    if (s.length < 8) return false;
    const hasLetter = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(s);
    const hasNumber = /\d/.test(s);
    return hasLetter && hasNumber;
  };

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
            touch("terminos");
            setSubmitAttempted(true);
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

  // Validaciones
  const nombreOk = countLetters(nombre) >= 2;
  const apellidosOk = countLetters(apellidos) >= 2;
  const emailOk = EMAIL_RE.test(String(email || "").trim());
  const phoneOk = isValidEsPhone(telefono);
  const passOk = isStrongPassword(pass);
  const passMatch = pass === pass2 && pass2.length > 0;

  const fieldErrors = {
    nombre: nombreOk ? "" : "Nombre: mínimo 2 letras.",
    apellidos: apellidosOk ? "" : "Apellidos: mínimo 2 letras.",
    email: emailOk ? "" : "Email: formato inválido.",
    telefono: phoneOk
      ? ""
      : "Teléfono: obligatorio y debe tener 9 dígitos (puedes incluir +34).",
    pass: passOk
      ? ""
      : "Contraseña: mínimo 8 caracteres e incluir letras y números.",
    pass2: passMatch ? "" : "Las contraseñas deben coincidir.",
    terminos: aceptaTerminos ? "" : "Debes aceptar los términos y condiciones.",
  };

  const missing = Object.values(fieldErrors).filter(Boolean);
  const canSubmit = !loading && missing.length === 0;

  const invalidClass = (k) =>
    showFieldError(k) && fieldErrors[k] ? "is-invalid" : "";
  const InvalidMsg = ({ k }) =>
    showFieldError(k) && fieldErrors[k] ? (
      <div className="field-error" role="alert">
        {fieldErrors[k]}
      </div>
    ) : null;

  const handleRegister = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError("");

    if (missing.length) {
      setSubmitAttempted(true);
      setTouched((p) => ({
        ...p,
        nombre: true,
        apellidos: true,
        email: true,
        telefono: true,
        pass: true,
        pass2: true,
        terminos: true,
      }));
      return;
    }

    // convertimos el desplegable a la estructura que espera el backend
    const intereses = {
      adiestramiento: interes === "adiestramiento",
      paseos: interes === "paseos",
      educacion: interes === "educacion",
      conducta: interes === "conducta",
    };

    setLoading(true);
    try {
      const res = await http("/auth/register", {
        method: "POST",
        data: {
          name: `${nombre} ${apellidos}`.trim(),
          email: email.trim().toLowerCase(),
          password: pass,
          telefono: normalizeEsPhone(telefono),
          zona: zona.trim(),
          perroNombre: perroNombre.trim(),
          perroTamano: perroTamano.trim(),
          intereses,
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
                  nextParam
                    ? `/login?next=${encodeURIComponent(nextParam)}`
                    : "/login"
                }
                className="register-tab"
              >
                Acceder
              </Link>
              <button
                className="register-tab register-tab--active"
                type="button"
              >
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
                      className={invalidClass("nombre")}
                      aria-invalid={invalidClass("nombre") ? "true" : "false"}
                      value={nombre}
                      onChange={(e) => {
                        setNombre(e.target.value);
                        touch("nombre");
                      }}
                      onBlur={() => touch("nombre")}
                      placeholder="Tu nombre"
                      required
                    />
                    <InvalidMsg k="nombre" />
                  </label>

                  <label>
                    Apellidos
                    <input
                      className={invalidClass("apellidos")}
                      aria-invalid={invalidClass("apellidos") ? "true" : "false"}
                      value={apellidos}
                      onChange={(e) => {
                        setApellidos(e.target.value);
                        touch("apellidos");
                      }}
                      onBlur={() => touch("apellidos")}
                      placeholder="Tus apellidos"
                      required
                    />
                    <InvalidMsg k="apellidos" />
                  </label>

                  <label>
                    Correo electrónico
                    <input
                      type="email"
                      className={invalidClass("email")}
                      aria-invalid={invalidClass("email") ? "true" : "false"}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        touch("email");
                      }}
                      onBlur={() => touch("email")}
                      placeholder="tu-email@ejemplo.com"
                      required
                    />
                    <InvalidMsg k="email" />
                  </label>

                  <label>
                    Teléfono (obligatorio)
                    <input
                      type="tel"
                      className={invalidClass("telefono")}
                      aria-invalid={invalidClass("telefono") ? "true" : "false"}
                      value={telefono}
                      onChange={(e) => {
                        setTelefono(e.target.value);
                        touch("telefono");
                      }}
                      onBlur={() => touch("telefono")}
                      placeholder="+34 600 123 456"
                      required
                    />
                    <InvalidMsg k="telefono" />
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

                  <label>
                    ¿Qué te interesa? (opcional)
                    <select
                      value={interes}
                      onChange={(e) => setInteres(e.target.value)}
                    >
                      <option value="">Selecciona</option>
                      <option value="adiestramiento">Adiestramiento</option>
                      <option value="paseos">Paseos</option>
                      <option value="educacion">Educación</option>
                      <option value="conducta">Conducta</option>
                    </select>
                  </label>

                  <label>
                    Contraseña
                    <div className="password-row">
                      <input
                        type={showPass1 ? "text" : "password"}
                        className={invalidClass("pass")}
                        aria-invalid={invalidClass("pass") ? "true" : "false"}
                        value={pass}
                        onChange={(e) => {
                          setPass(e.target.value);
                          touch("pass");
                        }}
                        onBlur={() => touch("pass")}
                        placeholder="Mínimo 8 caracteres (letras y números)"
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

                    <div className="field-hint">
                      Mínimo 8 caracteres e incluir letras y números.
                    </div>

                    <InvalidMsg k="pass" />
                  </label>

                  <label>
                    Repetir contraseña
                    <div className="password-row">
                      <input
                        type={showPass2 ? "text" : "password"}
                        className={invalidClass("pass2")}
                        aria-invalid={invalidClass("pass2") ? "true" : "false"}
                        value={pass2}
                        onChange={(e) => {
                          setPass2(e.target.value);
                          touch("pass2");
                        }}
                        onBlur={() => touch("pass2")}
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
                    <InvalidMsg k="pass2" />
                  </label>

                  <div className="full">
                    <p className="subhead">Condiciones</p>

                    <label className="check">
                      <input
                        type="checkbox"
                        checked={aceptaTerminos}
                        onChange={(e) => {
                          setAceptaTerminos(e.target.checked);
                          touch("terminos");
                        }}
                        required
                      />
                      Acepto los términos y condiciones y la política de
                      privacidad.
                    </label>

                    {showFieldError("terminos") && fieldErrors.terminos && (
                      <div className="field-error" role="alert">
                        {fieldErrors.terminos}
                      </div>
                    )}
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

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!canSubmit}
                >
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
            <h3 className="register-info-title">Lo que puedes hacer con tu cuenta</h3>
            <ul className="register-info-list">
              <li>Reservar servicios (adiestramiento, educación y paseos) en segundos.</li>
              <li>Gestionar tus reservas y consultar tu historial.</li>
              <li>Contactar con el equipo para dudas y coordinación.</li>
            </ul>

            <p className="register-help">
              ¿Necesitas ayuda? Escríbenos a{" "}
              <a href="mailto:hola@dogform.es">dogformtraining@gmail.com</a> o por WhatsApp al{" "}
              <a href="tel:+34600123456">+34 600 123 456</a>.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
