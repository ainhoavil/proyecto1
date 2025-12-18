import { useEffect, useState } from "react";
import { http } from "../helpers/http";
import { HOURS, humanDate } from "../helpers/reservas";
import { useAuth } from "../context/auth";
import "../styles/contratar.scss";

export default function TrainerAgenda() {
  const { user } = useAuth();

  /* ======================== Estados ============================ */
  const [fecha, setFecha] = useState("");

  const [reservasDia, setReservasDia] = useState([]);
  const [bloqueosDia, setBloqueosDia] = useState([]);

  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState("");
  const [modalidad, setModalidad] = useState("presencial");

  const [notice, setNotice] = useState({ type: "", text: "" });

  const showError = (t) => setNotice({ type: "error", text: t });
  const showSuccess = (t) => setNotice({ type: "success", text: t });

  /* ======================== Cargar base ============================ */
  useEffect(() => {
    http("/api/trainers/me/clients", { auth: true }).then((r) => {
      const arr = Array.isArray(r) ? r : [];
      setClientes(arr);
      if (arr.length) setClienteId(arr[0].id);
    });

    http("/api/servicios").then((r) => {
      const arr = Array.isArray(r) ? r : [];
      setServicios(arr);
      if (arr.length) setServicioId(arr[0].id);
    });
  }, []);

  /* ======================== Agenda diaria ============================ */
  const loadAgendaDia = async (f) => {
    if (!f) return;
    try {
      const r = await http(
        `/api/reservas/trainer/day?fecha=${f}`,
        { auth: true }
      );
      setReservasDia(Array.isArray(r) ? r : []);
    } catch {
      showError("No se pudo cargar la agenda del día.");
    }
  };

  const loadBloqueosDia = async (f) => {
    if (!f) return;
    try {
      const r = await http(`/api/bloqueos/day?fecha=${f}`, { auth: true });
      setBloqueosDia(Array.isArray(r) ? r.map((b) => b.hora) : []);
    } catch {}
  };

  useEffect(() => {
    if (fecha) {
      loadAgendaDia(fecha);
      loadBloqueosDia(fecha);
    }
  }, [fecha]);

  /* ======================== Acciones ============================ */
  const crearReserva = async (hora) => {
    if (!clienteId || !servicioId || !fecha) {
      showError("Faltan datos para crear la reserva.");
      return;
    }

    try {
      await http("/api/reservas/trainer-create", {
        method: "POST",
        auth: true,
        data: {
          clienteId,
          servicioId,
          fecha,
          hora,
          modalidad,
          status: "confirmed"
        }
      });
      showSuccess("Reserva creada.");
      loadAgendaDia(fecha);
    } catch {
      showError("No se pudo crear la reserva.");
    }
  };

  const bloquearHora = async (hora) => {
    await http("/api/bloqueos", {
      method: "POST",
      auth: true,
      data: { fecha, hora }
    });
    loadBloqueosDia(fecha);
  };

  const desbloquearHora = async (hora) => {
    await http("/api/bloqueos", {
      method: "DELETE",
      auth: true,
      data: { fecha, hora }
    });
    loadBloqueosDia(fecha);
  };

  const reservaPorHora = (hora) =>
    reservasDia.find((r) => r.hora === hora);

  /* ======================== Render ============================ */
  return (
    <div className="reservas-page">

      {notice.text && (
        <div className={`notice ${notice.type}`}>{notice.text}</div>
      )}

      {/* ================= CREAR RESERVA ================= */}
      <section>
        <h3>Crear reserva</h3>

        <div className="servicios-box">
          <label>Cliente</label>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre || c.email}
              </option>
            ))}
          </select>
        </div>

        <div className="servicios-box">
          <label>Servicio</label>
          <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.titulo || "Servicio"}
              </option>
            ))}
          </select>
        </div>

        <div className="servicios-box">
          <label>Modalidad</label>
          <select value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
            <option value="presencial">Presencial</option>
            <option value="online">Online</option>
            <option value="a domicilio">A domicilio</option>
          </select>
        </div>
      </section>

      {/* ================= AGENDA DIARIA ================= */}
      <section>
        <h3>Agenda diaria</h3>

        <div className="servicios-box">
          <label>Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        {fecha && (
          <>
            <p>{humanDate(fecha)}</p>

            <div className="horas-grid">
              {HOURS.map((h) => {
                const hora =
                  typeof h === "number"
                    ? `${String(h).padStart(2, "0")}:00`
                    : h;

                const reserva = reservaPorHora(hora);
                const bloqueada = bloqueosDia.includes(hora);

                if (reserva) {
                  return (
                    <div key={hora} className="hora-ocupada">
                      <strong>{hora}</strong>
                      <div>
                        {reserva.clienteNombre || "Cliente"} ·{" "}
                        {reserva.servicioTitulo || "Servicio"}
                      </div>
                    </div>
                  );
                }

                if (bloqueada) {
                  return (
                    <button
                      key={hora}
                      className="hora-bloqueada"
                      onClick={() => desbloquearHora(hora)}
                    >
                      {hora} · Desbloquear
                    </button>
                  );
                }

                return (
                  <button
                    key={hora}
                    className="hora"
                    onClick={() => bloquearHora(hora)}
                  >
                    {hora} · Bloquear
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
