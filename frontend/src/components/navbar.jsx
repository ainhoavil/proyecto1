// src/components/navbar.jsx
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
import '../styles/navbar.scss';

export default function Navbar() {
  const { isAuthenticated, user, role, logout } = useAuth();
  const navigate = useNavigate();

  const esAdmin = role === 'admin';
  const esTrainer = role === 'adiestrador';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar">
      <div className="left">
        <Link to="/" className="logo">Dogform</Link>

        <ul>
          {/* Menú común para todos */}
          <li><Link to="/servicios">Servicios</Link></li>
          <li><Link to="/reservas">Reservas</Link></li>
          <li><Link to="/videos">Vídeos</Link></li>
          <li><Link to="/contacto">Contacto</Link></li>

          {/* Solo adiestrador */}
          {esTrainer && (
            <li><Link to="/trainer-agenda">Agenda</Link></li>
          )}

          {/* Solo admin */}
          {esAdmin && (
            <li><Link to="/admin">Panel admin</Link></li>
          )}
        </ul>
      </div>

      <ul className="right">
        {isAuthenticated ? (
          <>
            <li>
              <Link to="/perfil">
                {user?.email || 'Mi perfil'}
              </Link>
            </li>
            <li>
              <button className="linklike" onClick={handleLogout}>
                Salir
              </button>
            </li>
          </>
        ) : (
          <>
            <li><Link to="/login">Iniciar sesión</Link></li>
            <li><Link to="/register">Regístrate</Link></li>
          </>
        )}
      </ul>
    </nav>
  );
}
