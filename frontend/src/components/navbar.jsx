import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth";
import "../styles/navbar.scss";

export default function Navbar() {
  const { isAuthenticated, user, role, logout } = useAuth();
  const navigate = useNavigate();

  const esAdmin = role === "admin" || user?.isAdmin;
  const esTrainer = role === "adiestrador";

  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
    setMenuOpen(false);
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className={`navbar ${menuOpen ? "open" : ""}`}>
      <div className="navbar__inner container">
        {/* IZQUIERDA */}
        <div className="navbar__left">
          <Link to="/" className="navbar__logo" onClick={closeMenu}>
            <span className="navbar__logo-circle">
              <span className="paw">🐾</span>
            </span>
            <span className="navbar__logo-text">Dogform</span>
          </Link>

          <ul className="navbar__links">
            <li>
              <Link to="/servicios">Servicios</Link>
            </li>

            <li>
              <Link to="/adiestradores">Adiestradores</Link>
            </li>

            {isAuthenticated && !esTrainer && (
              <li>
                <Link to="/reservas">Reservas</Link>
              </li>
            )}

            <li>
              <Link to="/contacto">Contacto</Link>
            </li>

            {esTrainer && (
              <li>
                <Link to="/reservas">Agenda</Link>
              </li>
            )}

            {esTrainer && (
              <li>
                <Link to="/trainer/clientes">Clientes</Link>
              </li>
            )}

            {esAdmin && (
              <li>
                <Link to="/admin">Panel admin</Link>
              </li>
            )}
          </ul>
        </div>

        {/* DERECHA */}
        <ul className="navbar__right">
          {isAuthenticated ? (
            <>
              <li>
                <Link to="/perfil">{user?.email || "Mi perfil"}</Link>
              </li>
              <li>
                <button className="logout-btn" onClick={handleLogout}>
                  Salir
                </button>
              </li>
            </>
          ) : (
            <>
              <li>
                <Link to="/login">Iniciar sesión</Link>
              </li>
              <li>
                <Link to="/register" className="btn-small">
                  Regístrate
                </Link>
              </li>
            </>
          )}
        </ul>

        {/* TOGGLE */}
        <button
          className="navbar__toggle"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Abrir menú"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {/* MOBILE */}
      <div className="navbar__mobile">
        <button
          className="close-mobile"
          onClick={closeMenu}
          aria-label="Cerrar menú"
        >
          ✕
        </button>

        <ul>
          <li>
            <Link to="/servicios" onClick={closeMenu}>
              Servicios
            </Link>
          </li>

          <li>
            <Link to="/adiestradores" onClick={closeMenu}>
              Adiestradores
            </Link>
          </li>

          {isAuthenticated && !esTrainer && (
            <li>
              <Link to="/reservas" onClick={closeMenu}>
                Reservas
              </Link>
            </li>
          )}

          <li>
            <Link to="/contacto" onClick={closeMenu}>
              Contacto
            </Link>
          </li>

          {esTrainer && (
            <li>
              <Link to="/reservas" onClick={closeMenu}>
                Agenda
              </Link>
            </li>
          )}

          {esTrainer && (
            <li>
              <Link to="/trainer/clientes" onClick={closeMenu}>
                Clientes
              </Link>
            </li>
          )}

          {esAdmin && (
            <li>
              <Link to="/admin" onClick={closeMenu}>
                Panel admin
              </Link>
            </li>
          )}

          <hr />

          {isAuthenticated ? (
            <>
              <li>
                <Link to="/perfil" onClick={closeMenu}>
                  {user?.email || "Mi perfil"}
                </Link>
              </li>
              <li>
                <button className="logout-btn" onClick={handleLogout}>
                  Salir
                </button>
              </li>
            </>
          ) : (
            <>
              <li>
                <Link to="/login" onClick={closeMenu}>
                  Iniciar sesión
                </Link>
              </li>
              <li>
                <Link to="/register" onClick={closeMenu}>
                  Regístrate
                </Link>
              </li>
            </>
          )}
        </ul>
      </div>
    </nav>
  );
}
