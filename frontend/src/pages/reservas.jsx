import { useAuth } from "../context/auth";
import ReservasAdmin from "./reservas/reservasAdmin";
import ReservasUser from "./reservas/reservasUser";
import TrainerAgenda from "./trainer-Agenda.jsx";

export default function Reservas() {
  const { loading, role, user } = useAuth();

  const rolBase =
    role || user?.rol || user?.role || (user?.isAdmin ? "admin" : "user");

  const esAdmin = rolBase === "admin";
  const esAdiestrador = rolBase === "adiestrador";

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
          ? "Panel de Reservas (Admin)"
          : esAdiestrador
          ? "Agenda del Adiestrador"
          : "Mis Reservas"}
      </h1>

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
