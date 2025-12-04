// frontend/src/pages/Register.jsx
import { useState } from "react";
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

  /* ---------------- REGISTER LOGIC ---------------- */
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

    const emailNorm = email.trim().toLowerCase();

    setLoading(true);
    try {
      const res = await http("/auth/register", {
        method: "POST",
        data: {
          name: `${nombre} ${apellidos}`.trim(),
          email: emailNorm,
          password: pass,
        },
      });

      const token = res?.token || null;
      const role = res?.rol || res?.user?.role || "user";

      const user = res?.user || {
        uid: res?.uid,
        email: emailNorm,
        nombre,
        apellidos,
        role,
      };

      if (token) {
        loginSuccess({ token, role, user });

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
      const backendMsg =
        err?.data?.error || err?.response?.data?.error || "";

      if (status === 409) {
        setError(backendMsg || "Ese email ya está registrado.");
      } else if (status === 400) {
        setError(backendMsg || "Datos inválidos. Revisa el formulario.");
      } else {
        setError(
          backendMsg || "No se pudo crear la cuenta. Inténtalo de nuevo."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = email && pass && pass2 && aceptaTerminos && !loading;

  /* -------------------- UI --------------------- */

  return (
    <div className="register-page">
      <div className="register-container">
        {/* Cabecera */}
        <header className="register-header">
          <span className="register-eyebrow">NUEVO USUARIO</span>
          <h1 className="register-title">Crea tu cuenta en DogForm</h1>
          <p className="register-lead">
            Configura tu perfil y el de tu perro para reservar adiestramiento,
            paseos y educación en Madrid con un solo inicio de sesión.
          </p>
        </header>

        <div className="register-grid">
          {/* -----------------------------------
                CARD IZQUIERDA (FORMULARIO)
          ----------------------------------- */}
          <section className="register-card register-card--form">
            {/* Tabs */}
            <div className="register-tabs">
              <Link to="/login" className="register-tab">
                Acceder
              </Link>
              <button className="register-tab register-tab--active">
                Crear cuenta
              </button>
            </div>

            <div className="register-card__body">
              <h2 className="register-section-title">
                Información básica para empezar
              </h2>
              <p className="register-section-sub">
                Solo te llevará un minuto. Podrás completar más detalles de tu perro más adelante.
              </p>

              {error && (
                <div className="register-alert" role="alert">
                  {error}
                </div>
              )}

              <form className="register-form" onSubmit={handleRegister}>
                {/* Grid 2 columnas */}
                <div className="form-grid">
                  <label>
                    Nombre
                    <input
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder="Tu nombre"
                      required
                    />
                  </label>

                  <label>
                    Apellidos
                    <input
                      type="text"
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
                    Teléfono de contacto
                    <input
                      type="tel"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      placeholder="+34 600 000 000"
                    />
                  </label>

                  <label>
                    Barrio / zona en Madrid
                    <input
                      type="text"
                      value={zona}
                      onChange={(e) => setZona(e.target.value)}
                      placeholder="Ej. Chamberí, Retiro…"
                    />
                  </label>

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
                        onClick={() => setShowPass1(!showPass1)}
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
                        placeholder="Repite la contraseña"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass2(!showPass2)}
                      >
                        {showPass2 ? "Ocultar" : "Ver"}
                      </button>
                    </div>
                  </label>

                  <label>
                    Nombre de tu perro
                    <input
                      type="text"
                      value={perroNombre}
                      onChange={(e) => setPerroNombre(e.target.value)}
                      placeholder="Nombre del perro"
                    />
                  </label>

                  <label>
                    Tamaño del perro
                    <input
                      type="text"
                      value={perroTamano}
                      onChange={(e) => setPerroTamano(e.target.value)}
                      placeholder="Pequeño · Mediano · Grande"
                    />
                  </label>
                </div>

                {/* Intereses */}
                <div className="intereses">
                  <span>Servicios que te interesan</span>
                  <div className="chips">
                    <button
                      type="button"
                      className={intereses.adiestramiento ? "chip chip--active" : "chip"}
                      onClick={() =>
                        setIntereses((p) => ({
                          ...p,
                          adiestramiento: !p.adiestramiento,
                        }))
                      }
                    >
                      Adiestramiento básico
                    </button>
                    <button
                      type="button"
                      className={intereses.paseos ? "chip chip--active" : "chip"}
                      onClick={() =>
                        setIntereses((p) => ({
                          ...p,
                          paseos: !p.paseos,
                        }))
                      }
                    >
                      Paseos diarios
                    </button>
                    <button
                      type="button"
                      className={intereses.educacion ? "chip chip--active" : "chip"}
                      onClick={() =>
                        setIntereses((p) => ({
                          ...p,
                          educacion: !p.educacion,
                        }))
                      }
                    >
                      Educación cachorros
                    </button>
                    <button
                      type="button"
                      className={intereses.conducta ? "chip chip--active" : "chip"}
                      onClick={() =>
                        setIntereses((p) => ({
                          ...p,
                          conducta: !p.conducta,
                        }))
                      }
                    >
                      Modificación de conducta
                    </button>
                  </div>
                </div>

                {/* Checkboxes */}
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

                {/* Submit */}
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
                    Iniciar sesión
                  </Link>
                </p>
              </form>
            </div>
          </section>

          {/* -----------------------------------
                CARD DERECHA (INFORMACIÓN)
          ----------------------------------- */}
          <aside className="register-card register-card--info">
            <h2 className="register-info-title">
              ¿Qué ocurre después de crear tu cuenta?
            </h2>

            <ul className="register-info-list">
              <li>
                Te acompañamos paso a paso para que organizar el cuidado de tu perro sea sencillo.
              </li>
              <li>
                Completa el perfil de tu perro con su edad, rutina y necesidades especiales para personalizar los servicios.
              </li>
              <li>
                Explora el calendario y reserva sesiones de adiestramiento, paseos o educación en los horarios que mejor encajen.
              </li>
              <li>
                Haz seguimiento de cada servicio, recibe notas de nuestro equipo y ajusta el plan de tu perro cuando lo necesites.
              </li>
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
