// frontend/src/pages/reservas.jsx
import { useAuth } from '../context/auth';
import ReservasAdmin from './reservas/reservasAdmin';
import ReservasUser from './reservas/reservasUser';
import TrainerAgenda from './trainerAgenda'; // Importamos la agenda del adiestrador

export default function Reservas() {
  const { loading, role, user } = useAuth();

  // Normalizamos rol asegurando compatibilidad
  // En tu auth.js, getRole() ya debería devolver 'admin', 'adiestrador' o 'user'
  const rolBase = role || user?.rol || user?.role || (user?.isAdmin ? 'admin' : 'user');

  const esAdmin = rolBase === 'admin';
  // IMPORTANTE: Usamos 'adiestrador' que es el valor real en tu BBDD
  const esAdiestrador = rolBase === 'adiestrador'; 

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
      <h1>
        {esAdmin 
          ? 'Panel de Reservas (Admin)' 
          : esAdiestrador 
            ? 'Agenda del Adiestrador' 
            : 'Mis Reservas'}
      </h1>

      {/* Renderizado condicional según el rol */}
      {esAdmin ? (
        <ReservasAdmin />
      ) : esAdiestrador ? (
        <TrainerAgenda />
      ) : (
        <ReservasUser />
      )}
    </div>
  );
}