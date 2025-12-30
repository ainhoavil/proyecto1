import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { HOURS, humanDate } from "../helpers/reservas";
import { useAuth } from "../context/auth";
import "../styles/contratar.scss";

function statusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pending" || s === "pendiente") return "Pendiente centro";
  if (s === "confirmed" || s === "confirmada") return "Confirmada";
  if (s === "cancelled" || s === "cancelada") return "Cancelada";
  if (s === "rejected" || s === "rechazada") return "Rechazada";
  if (s === "pending_user") return "Pendiente (cliente)";
  return s || "Estado";
}

export default function TrainerAgenda() {
  const { user } = useAuth();
  const navigate = useNavigate();

  /* ======================== Estados ============================ */
  const [fecha, setFecha] = useState("");

  const [reservasDia, setReservasDia] = useState([]);
  const [bloqueosDia, setBloqueosDia] = useState([]);

  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState("");
  const [modalidad, setModalidad] = useState("presencial");

  // ✅ Inbox / list de reservas del adiestrador
  const [misReservas, setMisReservas] = useState([]);
  const [loadingMisReservas, setLoadingMisReservas] = useState(false);

  // ✅ Chat
  const [openingChatId, setOpeningChatId] = useState(null);

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
      const r = await http(`/api/reservas/trainer/day?fecha=${f}`, { auth: true });
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
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (fecha) {
      loadAgendaDia(fecha);
      loadBloqueosDia(fecha);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  /* ======================== Mis reservas (inbox) ============================ */
  const loadMisReservas = async () => {
    setLoadingMisReservas(true);
    try {
      const r = await http("/api/reservas/mias-trainer", { auth: true });
      setMisReservas(Array.isArray(r) ? r : r?.items || []);
    } catch (e) {
      console.error("Error cargando mis reservas (trainer):", e);
      setMisReservas([]);
      showError("No se pudieron cargar tus reservas como adiestrador.");
    } finally {
      setLoadingMisReservas(false);
    }
  };

  useEffect(() => {
    loadMisReservas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          status: "confirmed",
        },
      });
      showSuccess("Reserva creada.");
      loadAgendaDia(fecha);
      loadMisReservas(); // ✅ refresca inbox
    } catch {
      showError("No se pudo crear la reserva.");
    }
  };

  const bloquearHora = async (hora) => {
    await http("/api/bloqueos", { method: "POST", auth: true, data: { fecha, hora } });
    loadBloqueosDia(fecha);
  };

  const desbloquearHora = async (hora) => {
    await http("/api/bloqueos", { method: "DELETE", auth: true, data: { fecha, hora } });
    loadBloqueosDia(fecha);
  };

  const reservaPorHora = (hora) => reservasDia.find((r) => r.hora === hora);

  // ✅ Abrir chat por reserva (igual que en reservasUser)
  const handleOpenChat = async (reserva) => {
    if (!reserva?.id) return;
    if (openingChatId === reserva.id) return;

    try {
      setOpeningChatId(reserva.id);

      const resp = await http(`/api/chats/by-reserva/${reserva.id}`, {
        method: "POST",
        auth: true,
      });

      const conversationId = resp?.conversationId || resp?.id;
      if (!conversationId) {
        showError("No se pudo abrir el chat (no llegó conversationId).");
        return;
      }

      navigate(`/chat/${conversationId}`);
    } catch (e) {
      console.error("Error abriendo chat:", e);
      showError("No se pudo abrir el chat para esta reserva.");
    } finally {
      setOpeningChatId(null);
    }
  };

  // Si quieres permitir chat solo con confirmed/pending_user, filtra aquí:
  const puedeChat = (status) => {
    const s = String(status || "").toLowerCase();
    return s === "confirmed" || s === "confirmada" || s === "pending_user" || s === "pending";
  };

  const misReservasOrdenadas = useMemo(() => {
    const arr = Array.isArray(misReservas) ? [...misReservas] : [];
    // Orden: más recientes primero (fecha/hora strings)
    arr.sort((a, b) => {
      const fa = `${a.fecha || ""} ${a.hora || ""}`.trim();
      const fb = `${b.fecha || ""} ${b.hora || ""}`.trim();
      return fb.localeCompare(fa);
    });
    return arr;
  }, [misReservas]);

  /* ======================== Render ============================ */
  return (
    <div className="reservas-page">
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      {/* ================= MIS RESERVAS (INBOX) ================= */}
      <section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Mis reservas (adiestrador)</h3>
          <button className="btn-ghost" type="button" onClick={loadMisReservas} disabled={loadingMisReservas}>
            {loadingMisReservas ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {loadingMisReservas ? (
          <div className="card" style={{ marginTop: 10 }}>Cargando tus reservas…</div>
        ) : misReservasOrdenadas.length === 0 ? (
          <div className="card" style={{ marginTop: 10 }}>
            No tienes reservas asignadas todavía.
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              Si esperabas ver reservas aquí, revisa que la reserva tenga <b>trainer_id</b> o <b>entrenador_id</b>
              con tu id de usuario.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {misReservasOrdenadas.map((r) => (
              <div key={r.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>
                      {r.servicioTitulo || r.servicioId || "Reserva"}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 14 }}>
                      <b>Fecha:</b> {r.fecha} · <b>Hora:</b> {r.hora}{" "}
                      {r.modalidad ? <>· <i>{r.modalidad}</i></> : null}
                    </div>
                    {r.email && (
                      <div style={{ marginTop: 2, fontSize: 13, opacity: 0.9 }}>
                        <b>Cliente:</b> {r.email}
                      </div>
                    )}
                    {r.adminNote && (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
                        <b>Nota:</b> {r.adminNote}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Estado</div>
                    <div style={{ fontWeight: 800 }}>{statusLabel(r.status)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => handleOpenChat(r)}
                    disabled={!puedeChat(r.status) || openingChatId === r.id}
                    title={!puedeChat(r.status) ? "Chat no disponible para este estado" : "Abrir chat de la reserva"}
                  >
                    {openingChatId === r.id ? "Abriendo chat…" : "💬 Abrir chat"}
                  </button>

                  {/* opcional: saltar a agenda diaria del día de la reserva */}
                  {r.fecha && (
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => setFecha(String(r.fecha).slice(0, 10))}
                    >
                      Ver en agenda
                    </button>
                  )}

                  {/* opcional: si quieres, aquí podrías añadir “Cancelar/Modificar” según tu lógica */}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>

        {fecha && (
          <>
            <p>{humanDate(fecha)}</p>

            <div className="horas-grid">
              {HOURS.map((h) => {
                const hora = typeof h === "number" ? `${String(h).padStart(2, "0")}:00` : h;

                const reserva = reservaPorHora(hora);
                const bloqueada = bloqueosDia.includes(hora);

                if (reserva) {
                  return (
                    <div key={hora} className="hora-ocupada">
                      <strong>{hora}</strong>
                      <div>
                        {reserva.clienteNombre || reserva.email || "Cliente"} ·{" "}
                        {reserva.servicioTitulo || "Servicio"}
                      </div>

                      {/* ✅ Botón chat también desde el slot del día */}
                      {reserva.id && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            className="btn-primary"
                            type="button"
                            onClick={() => handleOpenChat(reserva)}
                            disabled={!puedeChat(reserva.status) || openingChatId === reserva.id}
                          >
                            {openingChatId === reserva.id ? "Abriendo chat…" : "💬 Abrir chat"}
                          </button>
                        </div>
                      )}
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
