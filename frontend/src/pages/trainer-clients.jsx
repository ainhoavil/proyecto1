import { useEffect, useState } from "react";
import { http } from "../helpers/http";
import { useAuth } from "../context/auth";
import "../styles/contratar.scss";

export default function TrainerClients() {

  const { user } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [notice, setNotice] = useState({ type: "", text: "" });

  const showError = (t) => setNotice({ type: "error", text: t });
  const showSuccess = (t) => setNotice({ type: "success", text: t });

  /* ============================== LOAD CLIENTES ============================= */
  const loadClientes = async () => {
    try {
      const data = await http("/api/trainers/me/clients", { auth: true });
      const arr = data?.items || data || [];
      setClientes(arr);
    } catch (e) {
      showError("No se pudieron cargar los clientes.");
    }
  };

  useEffect(() => {
    loadClientes();
  }, []);

  /* ============================== UI ============================= */

  return (
    <div className="reservas-page">
      <h2>Mis clientes</h2>
      <p style={{ opacity: 0.7 }}>Adiestrador: {user?.email}</p>

      {notice.text && (
        <div className={`notice ${notice.type}`}>{notice.text}</div>
      )}

      {/* Lista */}
      <div
        style={{
          display: "grid",
          gap: 20,
          marginTop: 20,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        {clientes.length === 0 && (
          <p className="empty">Todavía no tienes clientes asignados.</p>
        )}

        {clientes.map((c) => (
          <div
            key={c.id}
            className="card-client"
            style={{
              padding: 16,
              border: "1px solid #d8dbe0",
              borderRadius: 10,
              background: "#fff",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <h3 style={{ margin: 0 }}>{c.nombre}</h3>
              <p style={{ margin: 0, opacity: 0.7 }}>{c.email}</p>
            </div>

            {/* Perros */}
            {Array.isArray(c.perros) && c.perros.length > 0 && (
              <div>
                <b>Perros:</b>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {c.perros.map((p, i) => (
                    <li key={i}>
                      {p.nombre} {p.raza ? `(${p.raza})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Última y próxima reserva */}
            <div style={{ opacity: 0.8 }}>
              <p style={{ margin: "4px 0" }}>
                <b>Última sesión:</b>{" "}
                {c.ultimaReserva ? new Date(c.ultimaReserva).toLocaleString("es-ES") : "—"}
              </p>
              <p style={{ margin: "4px 0" }}>
                <b>Próxima sesión:</b>{" "}
                {c.proximaReserva ? new Date(c.proximaReserva).toLocaleString("es-ES") : "—"}
              </p>
            </div>

            {/* BOTONES */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                className="btn-primary"
                onClick={() => (window.location.href = `/trainer/clientes/${c.id}`)}
              >
                Ver perfil
              </button>

              <button
                className="btn-ghost"
                onClick={() => (window.location.href = `/trainer/chat/${c.id}`)}
              >
                Chat
              </button>

              <button
                className="btn-ghost"
                onClick={() =>
                  (window.location.href = `/trainer-agenda?cliente=${c.id}`)
                }
              >
                Crear reserva
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
