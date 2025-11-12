
import '../styles/home.scss';
function Home() {
  return (
    <div className="home">
      <header>
        <h1>Bienvenido a DogForm</h1>
        <p>Tu plataforma de confianza en adiestramiento canino profesional.</p>
      </header>

      <section className="metodologia">
        <h2>Nuestra metodología</h2>
        <p>
          En DogForm creemos en el refuerzo positivo, la comprensión y el vínculo entre
          perro y humano. Cada servicio está adaptado al perfil del perro y sus necesidades.
        </p>
      </section>

      <section className="cta">
        <h2>¿Listo para comenzar?</h2>
        <p>Consulta nuestros servicios o reserva ya tu primera cita con nosotros.</p>
        <a href="/servicios">Ver servicios</a>
        <a href="/reservas">Reservar cita</a>
      </section>
    </div>
  );
}

export default Home;
