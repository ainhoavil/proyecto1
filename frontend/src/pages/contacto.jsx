import { useState } from "react";
import "../styles/contacto.scss";

function Contacto() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [tipoServicio, setTipoServicio] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [aceptaPrivacidad, setAceptaPrivacidad] = useState(false);

  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  // Anti-bots
  const [honeypot, setHoneypot] = useState("");
  const [loadedAt] = useState(() => Date.now());

  const manejarEnvio = async (e) => {
    e.preventDefault();
    setError("");
    setEnviado(false);

    // honeypot: si se rellena, tratamos como bot
    if (honeypot.trim() !== "") {
      setEnviado(true);
      setNombre("");
      setEmail("");
      setTelefono("");
      setTipoServicio("");
      setMensaje("");
      setAceptaPrivacidad(false);
      return;
    }

    // tiempo mínimo (3s) para evitar bots instantáneos
    const elapsed = Date.now() - loadedAt;
    if (elapsed < 3000) {
      setError(
        "Has enviado el formulario demasiado rápido, inténtalo de nuevo."
      );
      return;
    }

    if (!aceptaPrivacidad) {
      setError(
        "Debes aceptar la política de privacidad para enviar el mensaje."
      );
      return;
    }

    try {
      const mensajeFinal = [
        telefono && `Teléfono: ${telefono}`,
        tipoServicio && `Tipo de servicio: ${tipoServicio}`,
        "",
        mensaje,
      ]
        .filter(Boolean)
        .join("\n");

      const res = await fetch("/api/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          email,
          mensaje: mensajeFinal,
          honeypot,
        }),
      });

      if (res.ok) {
        setEnviado(true);
        setNombre("");
        setEmail("");
        setTelefono("");
        setTipoServicio("");
        setMensaje("");
        setAceptaPrivacidad(false);
      } else {
        setError("Error al enviar el mensaje. Inténtalo de nuevo más tarde.");
      }
    } catch (err) {
      console.error("Error de red:", err);
      setError("Error de red. Inténtalo de nuevo en unos minutos.");
    }
  };

  return (
    <div className="contact-page">
      <div className="contact-page__container">
        {/* ENCABEZADO */}
        <header className="contact-header">
          <h1 className="contact-header__title">
            Hablemos sobre el bienestar de tu perro
          </h1>
          <p className="contact-header__lead">
            Cuéntanos qué necesitas: adiestramiento, paseos o educación en
            Madrid. Rellena el formulario o utiliza los datos de contacto para
            hablar directamente con nuestro equipo.
          </p>
          <div className="contact-header__divider" />
        </header>

        {/* DOS COLUMNAS */}
        <div className="contact-layout">
          {/* IZQUIERDA: FORMULARIO */}
          <section className="contact-card contact-card--form">
            <h2 className="contact-card__title">Envíanos un mensaje</h2>
            <p className="contact-card__subtitle">
              Respondemos habitualmente en menos de 24 horas laborables.
            </p>

            {error && (
              <div className="contact-alert contact-alert--error">{error}</div>
            )}
            {enviado && (
              <div className="contact-alert contact-alert--success">
                Gracias por tu mensaje. Te responderemos lo antes posible.
              </div>
            )}

            <form className="contact-form" onSubmit={manejarEnvio} noValidate>
              {/* Honeypot oculto */}
              <div className="contact-form__honeypot">
                <label>
                  Empresa
                  <input
                    type="text"
                    name="empresa"
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>
              </div>

              <div className="contact-form__grid contact-form__grid--two">
                <label className="contact-field">
                  <span>Nombre y apellidos</span>
                  <input
                    type="text"
                    placeholder="Tu nombre completo"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                  />
                </label>

                <label className="contact-field">
                  <span>Correo electrónico</span>
                  <input
                    type="email"
                    placeholder="tu-email@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="contact-form__grid contact-form__grid--two">
                <label className="contact-field">
                  <span>Teléfono (opcional)</span>
                  <input
                    type="tel"
                    placeholder="+34 600 000 000"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                  />
                </label>

                <label className="contact-field">
                  <span>Tipo de servicio</span>
                  <input
                    type="text"
                    placeholder="Adiestramiento, paseos, educación..."
                    value={tipoServicio}
                    onChange={(e) => setTipoServicio(e.target.value)}
                  />
                </label>
              </div>

              <label className="contact-field">
                <span>Mensaje</span>
                <textarea
                  rows={5}
                  placeholder="Cuéntanos un poco sobre tu perro, su edad, zona de Madrid y qué necesitas..."
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  required
                />
              </label>

              <label className="contact-check">
                <input
                  type="checkbox"
                  checked={aceptaPrivacidad}
                  onChange={(e) => setAceptaPrivacidad(e.target.checked)}
                />
                <span>
                  He leído y acepto la política de privacidad para el tratamiento
                  de mis datos con el fin de recibir respuesta a mi consulta.
                </span>
              </label>

              <div className="contact-form__actions">
                <button
                  type="submit"
                  className="contact-btn contact-btn--primary"
                >
                  Enviar mensaje
                </button>
                <span className="contact-form__helper">
                  O si lo prefieres, llámanos o escríbenos por WhatsApp.
                </span>
              </div>
            </form>
          </section>

          {/* DERECHA: INFO CONTACTO */}
          <aside className="contact-card contact-card--info">
            <h2 className="contact-card__title">Datos de contacto DogForm</h2>
            <p className="contact-card__subtitle">
              Estamos en Madrid y trabajamos en los principales barrios de la
              ciudad y alrededores.
            </p>

            <div className="contact-info-block">
              <h3>TELÉFONO / WHATSAPP</h3>
              <p>+34 600 123 456</p>
            </div>

            <div className="contact-info-block">
              <h3>EMAIL</h3>
              <p>hola@dogform.es</p>
            </div>

            <div className="contact-info-block">
              <h3>DIRECCIÓN</h3>
              <p>C/ Gran Vía 25, 4ºB · 28013 Madrid</p>
              <p>
                Horario de atención: Lunes a viernes de 9:00 a 19:00. Para
                urgencias puedes escribirnos por WhatsApp fuera de este horario.
              </p>
            </div>

            <div className="contact-map">
              {/* Pon aquí tu imagen real de mapa si la tienes */}
              <div className="contact-map__img" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default Contacto;
