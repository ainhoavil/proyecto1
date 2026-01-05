import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { http } from "../helpers/http";

// Base del backend para construir URLs absolutas (imágenes / archivos)
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const absUrl = (u = '') =>
  !u ? '' : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith('/') ? '' : '/'}${u}`;

const getServiceImg = (imageUrl) => {
  if (!imageUrl) return "/img/placeholder.jpg";
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  if (imageUrl.startsWith('/api/files/') || imageUrl.startsWith('/files/')) return absUrl(imageUrl);
  if (imageUrl.startsWith('/img/')) return imageUrl;
  return `/img/servicios/${imageUrl}`;
};


function Home() {
  const [servicios, setServicios] = useState([]);

  // Cargar servicios reales de la BBDD
  useEffect(() => {
    const cargar = async () => {
      try {
        const data = await http("/api/servicios");
        const sorted = [...(data || [])].sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0)
        );
        setServicios(sorted);
      } catch {
        setServicios([]);
      }
    };
    cargar();
  }, []);

  // Tomamos 4 primeros para el grid de la home
  const serviciosHome = servicios.slice(0, 4);

  return (
    <div className="home">
      {/* ========= HERO ========= */}
      <section className="hero">
        <div className="hero__inner container">
          <div className="hero__banner">
            <div
              className="hero__bg"
              style={{ backgroundImage: "url('/img/hero.jpg')" }} // cambia la ruta si hace falta
            />

            <div className="hero__content">
              <p className="hero__eyebrow">
                SERVICIOS CANINOS PROFESIONALES EN MADRID
              </p>

              <h1 className="hero__title">
                Cuidamos de tu perro con servicios profesionales y cercanos
              </h1>

              <p className="hero__subtitle">
                Adiestramiento, paseos y educación canina en Madrid para que tu
                perro esté acompañado, estimulado y tranquilo todos los días.
              </p>

              <p className="hero__badge">
                Actualmente disponible en Madrid ciudad y alrededores.
              </p>

              <div className="hero__actions">
                <Link to="/reservas" className="btn btn--primary">
                  Reservar ahora
                </Link>
                <Link to="/servicios" className="btn btn--ghost">
                  Ver servicios
                </Link>
              </div>

              <p className="hero__note">
                Puedes reservar una primera consulta gratuita e informativa con
                un profesional de DogForm.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========= BENEFICIOS ========= */}
      <section className="section section--benefits">
        <div className="container">
          <span className="section__eyebrow">BENEFICIOS</span>
          <h2 className="section__title">Por qué elegir DogForm</h2>

          <p className="section__lead">
            Una plataforma pensada para que el cuidado de tu perro sea tan
            fácil, seguro y profesional como se merece.
          </p>

          <div className="benefits__grid">
            <article className="benefit-card">
              <div className="benefit-card__icon">🎓</div>
              <h3>Profesionales certificados</h3>
              <p>
                Trabajamos solo con adiestradores y cuidadores formados y
                verificados para tu tranquilidad.
              </p>
            </article>

            <article className="benefit-card">
              <div className="benefit-card__icon">📅</div>
              <h3>Reservas inteligentes y fáciles</h3>
              <p>
                Elige el servicio, día y hora en segundos, sin llamadas ni
                intercambios interminables de mensajes.
              </p>
            </article>

            <article className="benefit-card">
              <div className="benefit-card__icon">📈</div>
              <h3>Seguimiento del progreso</h3>
              <p>
                Visualiza la evolución de tu perro sesión a sesión y comparte
                notas con el profesional.
              </p>
            </article>

            <article className="benefit-card">
              <div className="benefit-card__icon">❤️</div>
              <h3>Atención personalizada</h3>
              <p>
                Adaptamos cada servicio a la personalidad, edad y necesidades
                concretas de tu compañero peludo.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ========= SERVICIOS DESTACADOS ========= */}
      <section className="section section--services">
        <div className="container">
          <span className="section__eyebrow">SERVICIOS</span>
          <h2 className="section__title">Servicios destacados para tu perro</h2>

          <p className="section__lead">
            Selecciona el servicio que mejor se adapte a vuestro momento: desde
            primeros paseos hasta planes avanzados de educación canina.
          </p>

          <div className="services__grid">
            {serviciosHome.length > 0 ? (
              serviciosHome.map((item) => (
                <article className="service-card" key={item.id}>
                  <div
                    className="service-card__image"
                    style={{
                      backgroundImage: `url('${getServiceImg(item.imageUrl)}')`,
                    }}
                  />

                  <div className="service-card__body">
                    <div className="service-card__text">
                      <h3>{item.title}</h3>
                      <p>{item.short}</p>
                    </div>

                    <div className="service-card__footer">
                      {item.priceFrom && (
                        <p className="service-card__price">
                          Desde {item.priceFrom}
                        </p>
                      )}
                      <Link
                        to="/servicios"
                        className="btn btn--small btn--light"
                      >
                        Ver más
                      </Link>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className="services__empty">
                Aún no hay servicios configurados. Pronto podrás ver aquí los
                principales servicios de DogForm.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ========= CÓMO FUNCIONA (3 PASOS) ========= */}
      <section className="section section--steps">
        <div className="container steps__layout">
          <div className="steps__intro">
            <span className="steps__eyebrow">CÓMO FUNCIONA</span>
            <h2>Reserva en 3 pasos sencillos</h2>
            <p>
              Primero crea tu cuenta gratuita y desde ahí, gestiona en minutos
              todas las reservas de tu perro en DogForm.
            </p>
          </div>

          <div className="steps__grid">
            <div className="step-card">
              <span className="step-card__number">1</span>
              <h3>Crea tu cuenta gratuita</h3>
              <p>
                Regístrate en DogForm con tu email en menos de un minuto para
                guardar tus datos y los de tu perro de forma segura.
              </p>
            </div>

            <div className="step-card">
              <span className="step-card__number">2</span>
              <h3>Elige servicio, día y hora</h3>
              <p>
                Desde tu cuenta selecciona el tipo de servicio y el horario que
                mejor os encaje.
              </p>
            </div>

            <div className="step-card">
              <span className="step-card__number">3</span>
              <h3>Confirma y sigue tu reserva</h3>
              <p>
                Confirma la reserva y consulta en todo momento detalles, cambios
                y próximos servicios de tu perro.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========= TESTIMONIOS ========= */}
      <section className="section section--testimonials">
        <div className="container">
          <span className="section__eyebrow">TESTIMONIOS</span>
          <h2 className="section__title">
            Familias perrunas que ya confían en DogForm
          </h2>

          <p className="section__lead">
            DogForm es un aliado para el bienestar diario de sus perros.
          </p>

          <div className="testimonials__grid">
            <article className="testimonial-card">
              <h3>Laura &amp; Kira</h3>
              <p className="testimonial-card__tag">
                Adiestramiento y paseos
              </p>
              <p>
                En pocas semanas vimos un cambio enorme en Kira. Las reservas
                son muy fáciles y siempre sabemos con quién está.
              </p>
              <div className="testimonial-card__rating">★★★★★</div>
            </article>

            <article className="testimonial-card">
              <h3>Miguel &amp; Loki</h3>
              <p className="testimonial-card__tag">Educación canina</p>
              <p>
                Nos ayudaron a entender mejor a Loki y a crear rutinas claras en
                casa. Se nota la profesionalidad en cada sesión.
              </p>
              <div className="testimonial-card__rating">★★★★★</div>
            </article>

            <article className="testimonial-card">
              <h3>Miguel &amp; Loki</h3>
              <p className="testimonial-card__tag">Paseos</p>
              <p>
                Loki vuelve más tranquilo y relajado de cada paseo. El reporte
                después de cada salida nos da mucha tranquilidad.
              </p>
              <div className="testimonial-card__rating">★★★★★</div>
            </article>

            <article className="testimonial-card">
              <h3>Ana &amp; Bruno</h3>
              <p className="testimonial-card__tag">Consultas personalizadas</p>
              <p>
                Poder hablar con un especialista cuando hemos tenido dudas nos
                ha dado mucha calma como familia perruna.
              </p>
              <div className="testimonial-card__rating">★★★★★</div>
            </article>
          </div>
        </div>
      </section>

      {/* ========= CTA FINAL NARANJA ========= */}
      <section className="section section--cta">
        <div className="container">
          <div className="cta-box">
            <div className="cta-box__text">
              <h2>¿Listo para reservar el próximo servicio de tu perro?</h2>
              <p>
                Configura tu primera reserva en menos de dos minutos creando tu
                cuenta DogForm y descubre cómo podemos ayudarte en el día a día.
              </p>
            </div>

            <div className="cta-box__actions">
              <Link to="/login" className="btn btn--primary btn--light-on">
                Acceder / Registro
              </Link>
              <Link to="/servicios" className="btn btn--ghost btn--light-on">
                Ver todos los servicios
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;