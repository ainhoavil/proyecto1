import '../styles/home.scss';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { http } from '../helpers/http';

function Home() {
  const [servicios, setServicios] = useState([]);

  // Cargar servicios reales de la BBDD
  useEffect(() => {
    const cargar = async () => {
      try {
        const data = await http('/api/servicios');
        // ordenar por "order"
        const sorted = [...(data || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setServicios(sorted);
      } catch {
        setServicios([]);
      }
    };
    cargar();
  }, []);

  // Tomamos solo los 3 primeros o destacados
  const serviciosHome = servicios.slice(0, 3);

  return (
    <div className="home">

      {/* HERO */}
      <section className="hero">
        <div
          className="hero__bg"
          style={{ backgroundImage: "url('/img/hero.jpg')" }}
        ></div>

        <div className="hero__content container">
          <h1>Todo para tu perro</h1>
          <p>Servicios amigables, profesionales y adaptados a tu mejor amigo.</p>
          <Link to="/servicios" className="btn hero-btn">Ver servicios</Link>
        </div>
      </section>

      {/* ABOUT */}
      <section className="about container">
        <div className="about__text">
          <span className="tag">PASIÓN POR LOS PERROS</span>
          <h2>Tu aliado en el bienestar de tu perro</h2>

          <p>
            En DogForm creemos que cada perro es único: tiene su propia personalidad,
            su ritmo y su manera de aprender. Por eso trabajamos con un enfoque amable,
            respetuoso y basado en refuerzo positivo.
          </p>

          <p>
            Nuestro objetivo es ayudarte a disfrutar de una convivencia más equilibrada,
            tranquila y feliz. Te acompañamos paso a paso con sesiones adaptadas,
            seguimiento personalizado y herramientas prácticas que encajan en tu día a día.
          </p>

          <p>
            Nos enfocamos en el bienestar emocional del perro, en sus necesidades reales
            y en fortalecer el vínculo con su familia para lograr mejoras duraderas.
          </p>

          <ul className="about__list">
            <li>Enfoque 100% amable y respetuoso</li>
            <li>Refuerzo positivo como base del aprendizaje</li>
            <li>Sesiones personalizadas según necesidades</li>
            <li>Atención al bienestar físico y emocional</li>
            <li>Guía, acompañamiento y seguimiento real</li>
          </ul>

          <p>
            Tanto si buscas adiestramiento, modificación de conducta, paseos de calidad
            o simplemente mejorar la comunicación con tu mejor amigo, estamos aquí para
            ayudarte a vivir una relación más auténtica, sana y feliz.
          </p>

          <Link to="/contacto" className="link">Contactar</Link>
        </div>

        <div
          className="about__img"
          style={{ backgroundImage: "url('/img/about.jpg')" }}
        ></div>
      </section>

      {/* ======================
          SERVICIOS DINÁMICOS
      ====================== */}
      <section className="services">
        <div className="container">
          <span className="tag">TODO PARA TU PERRO</span>
          <h2>Nuestros servicios destacados</h2>

          <div className="services__grid">

            {serviciosHome.length > 0 ? (
              serviciosHome.map((item) => (
                <div className="card service-card" key={item.id}>
                  <div
                    className="card-img"
                    style={{
                      backgroundImage: item.imageUrl
                        ? `url('${item.imageUrl}')`
                        : "url('/img/placeholder.jpg')"
                    }}
                  ></div>

                  <div className="card-content">
                    <h3>{item.title}</h3>
                    <p>{item.short}</p>
                    <Link to="/servicios" className="arrow">Ver más →</Link>
                  </div>
                </div>
              ))
            ) : (
              <p>No hay servicios disponibles aún.</p>
            )}

          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="cta">
        <div className="container">
          <h2>¿Listo para comenzar?</h2>
          <p>Consulta nuestros servicios o reserva tu primera cita en DogForm.</p>

          <div className="cta__buttons">
            <Link to="/servicios" className="btn">Ver servicios</Link>
            <Link to="/reservas" className="btn btn-outline">Reservar cita</Link>
          </div>
        </div>
      </section>

    </div>
  );
}

export default Home;
