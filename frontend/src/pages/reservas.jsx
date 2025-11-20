// frontend/src/pages/reservas.jsx
import { useAuth } from '../context/auth';
import ReservasAdmin from './reservas/reservasAdmin';
import ReservasUser from './reservas/reservasUser';
import ReservasTrainer from './reservas/reservasTrainer'; // 👈 nuevo import

export default function Reservas() {
  const { loading, role, user } = useAuth();

  // Normalizamos rol
  const rolBase =
    role ||
    user?.rol ||
    user?.role ||
    (user?.isAdmin ? 'admin' : 'user');

  const esAdmin = rolBase === 'admin';
  const esTrainer = rolBase === 'trainer';

  if (loading) {
    return (
      <div className="card contratar-page">
        <h1>Reservas</h1>
        <p>Cargando…</p>
      </div>
    );
  }

  // Admin → panel admin
  if (esAdmin) {
    return <ReservasAdmin />;
  }

  // Adiestrador → panel trainer
  if (esTrainer) {
    return <ReservasTrainer />;
  }

  // Resto → panel usuario
  return <ReservasUser />;
}
