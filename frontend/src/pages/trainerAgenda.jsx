import { useEffect, useState } from "react";
import { http } from "../helpers/http";
import { first, HOURS, parseDisponibilidad, humanDate } from "../helpers/reservas";
import { useAuth } from "../context/auth";
import "../styles/contratar.scss";

export default function TrainerAgenda() {

  const { user } = useAuth();

  /* ======================== Estados ============================ */
  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState("");

  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState("");

  const [fecha, setFecha] = useState("");
  const [horasNoDisp, setHorasNoDisp] = useState([]);
  const [loadingHoras, setLoadingHoras] = useState(false);

  const [modalidad, setModalidad] = useState("presencial");

  const [notice, setNotice] = useState({ type: "", text: "" });

  const showSuccess = (t) => setNotice({ type: "success", text: t });
  const showError = (t) => setNotice({ type: "error", text: t });

  /* ======================== Cargar clientes ============================ */
  const loadClientes = async () => {
    try {
      const data = await http("/api/trainers/me/clients", { auth: true });
      const arr = data?.items || data || [];
      setClientes(arr);
      if (arr.length) setClienteId(arr[0].id);
    } catch (e) {
      showError("No se pudieron cargar los clientes.");
    }
  };

  /* ======================== Cargar servicios ============================ */
  const loadServicios = async () => {
    try {
      const data = await http("/api/servicios");
      const arr = Array.isArray(data) ? data : data?.items || [];
      setServicios(arr);
      if (arr.length)
        setServicioId(first(arr[0].id, arr[0]._id, arr[0].uuid));
    } catch (e) {
      showError("No se pudieron cargar los servicios.");
    }
  };

  /* ======================== Disponibilidad ============================ */
  const cargarDisponibilidad = async (fecha) => {
    if (!fecha || !servicioId) return;

    setLoadingHoras(true);
    try {
      const qs = new URLSearchParams({
        fecha,
        servicioId
      });

      const data = await http(`/api/reservas/disponibilidad?${qs}`, { auth: true });
      const { ocup } = parseDisponibilidad(data || {});
      setHorasNoDisp(ocup || []);
    } catch (e) {
      showError("No se pudo cargar la disponibilidad.");
    }
    setLoadingHoras(false);
  };

  /* ======================== Crear reserva ============================ */
  const crearReserva = async (hora) => {
    if (!clienteId || !servicioId || !fecha || !hora) {
      showError("Faltan datos.");
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

      showSuccess("Reserva creada para el cliente.");
      setFecha("");
    } catch (e) {
      showError("No se pudo crear la reserva.");
    }
  };

  /* ======================== Cargar inicial ============================ */
  useEffect(() => {
    loadClientes();
    loadServicios();
  }, []);

  useEffect(() => {
    if (fecha) cargarDisponibilidad(fecha);
  }, [fecha, servicioId]);


  return (
    <div className="reservas-page">
      <h2>Crear reserva para un cliente</h2>

      {notice.text && (
        <div className={`notice ${notice.type}`}>{notice.text}</div>
      )}

      {/* Cliente */}
      <div className="servicios-box">
        <label>Cliente:</label>
        <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          {clientes.map(c => (
            <option key={c.id} value={c.id}>
              {c.nombre} ({c.email})
            </option>
          ))}
        </select>
      </div>

      {/* Servicio */}
      <div className="servicios-box">
        <label>Servicio:</label>
        <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
          {servicios.map(s => {
            const id = first(s.id, s._id, s.uuid);
            const t = first(s.title, s.titulo, s.name, "Servicio");
            return <option key={id} value={id}>{t}</option>;
          })}
        </select>
      </div>

      {/* Fecha */}
      <div className="servicios-box">
        <label>Fecha:</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>

      {/* Modalidad */}
      <div className="servicios-box">
        <label>Modalidad:</label>
        <select value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
          <option value="presencial">Presencial</option>
          <option value="online">Online</option>
          <option value="a domicilio">A domicilio</option>
        </select>
      </div>

      {/* Horas */}
      {fecha && (
        <div className="horas-box">
          <h3>Horas disponibles – {humanDate(fecha)}</h3>

          {loadingHoras ? (
            <p>Cargando disponibilidad…</p>
          ) : (
            <div className="horas-grid">
              {HOURS.map(h => {
                const t = typeof h === "number" ? `${String(h).padStart(2, "0")}:00` : h;
                const disabled = horasNoDisp.includes(t);

                return (
                  <button
                    key={t}
                    className={disabled ? "hora-disabled" : "hora"}
                    disabled={disabled}
                    onClick={() => crearReserva(t)}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
