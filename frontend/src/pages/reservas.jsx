// frontend/src/pages/reservas.jsx
import { useAuth } from '../context/auth';
import ReservasAdmin from './reservas/reservasAdmin';
import ReservasUsuario from './reservas/reservasUser';

export default function Reservas() {
  const { loading, role, user } = useAuth();
  const esAdmin = role === 'admin' || !!user?.isAdmin;

  if (loading) {
    return (
      <div className="card contratar-page">
        <h1>Reservas</h1>
        <p>Cargando…</p>
      </div>
    );
  }

  return (
    <div className="card contratar-page">
      <h1>Reservas</h1>
      {esAdmin ? <ReservasAdmin /> : <ReservasUsuario />}
    </div>
  );
}
