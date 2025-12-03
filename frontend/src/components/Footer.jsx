import { Link } from "react-router-dom";
import "../styles/footer.scss";

export default function Footer() {
  return (
    <footer className="df-footer">
      <div className="df-footer__inner">
        {/* BRAND + TEXTO */}
        <div className="df-footer__brand-row">
          <div className="df-footer__logo">
            <span>DF</span>
          </div>
          <div className="df-footer__brand-text">
            <h2 className="df-footer__title">DogForm</h2>
            <p className="df-footer__subtitle">
              La forma más sencilla y profesional de gestionar el bienestar diario
              de tu perro desde un único lugar.
            </p>
          </div>
        </div>

        {/* DIRECCIÓN */}
        <p className="df-footer__address">
          DogForm · C/ Gran Vía 25, 4ºB · 28013 Madrid
        </p>

        {/* COPYRIGHT */}
        <p className="df-footer__copy">
          © DogForm, todos los derechos reservados.
        </p>

        {/* NAVEGACIÓN INFERIOR */}
        <nav className="df-footer__nav">
          <Link to="/" className="df-footer__link">
            Inicio
          </Link>
          <Link to="/servicios" className="df-footer__link">
            Servicios
          </Link>
          <Link to="/reservas" className="df-footer__link">
            Reservas
          </Link>
          <Link to="/contacto" className="df-footer__link">
            Contacto
          </Link>
          <Link to="/aviso-legal" className="df-footer__link">
            Aviso Legal
          </Link>
          <Link to="/privacidad" className="df-footer__link">
            Política de Privacidad
          </Link>
          <Link to="/cookies" className="df-footer__link">
            Cookies
          </Link>
        </nav>

        {/* REDES SOCIALES */}
        <div className="df-footer__social">
          <a href="#" className="df-footer__social-pill" aria-label="LinkedIn">
            in
          </a>
          <a href="#" className="df-footer__social-pill" aria-label="Instagram">
            ig
          </a>
          <a href="#" className="df-footer__social-pill" aria-label="Facebook">
            fb
          </a>
        </div>
      </div>
    </footer>
  );
}
