import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { http } from "../helpers/http";
import { HOURS, humanDate } from "../helpers/reservas";
import { useAuth } from "../context/auth";
import "../styles/contratar.scss";

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pending" || s === "pendiente") return "Pendiente (centro)";
  if (s === "pending_user") return "Pendiente (cliente)";
  if (s === "confirmed" || s === "confirmada") return "Confirmada";
  if (s === "cancelled" || s === "cancelada") return "Cancelada";
  if (s === "rejected" || s === "rechazada") return "Rechazada";
  return s || "Estado";
}

export default function TrainerAgenda() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /* ======================== Estados ============================ */
  const [fecha, setFecha] = useState(() => todayYMD());

  const [reservasDia, setReservasDia] = useState([]);
  const [bloqueosDia, setBloqueosDia] = useState([]); // array de "HH:MM"

  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState("");

  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState("");

  const [modalidad, setModalidad] = useState("presencial");

  // Modo de click en slots
  const [mode, setMode] = useState("create"); // "create" | "block"

  // ✅ Inbox / list de reservas del adiestrador
  const [misReservas, setMisReservas] = useState([]);
  const [loadingMisReservas, setLoadingMisReservas] = useState(false);

  // ✅ Chat
  const [openingChatId, setOpeningChatId] = useState(null);

  const [notice, setNotice] = useState({ type: "", text: "" });
  const showError = (t) => setNotice({ type: "error", text: t });
  const showSuccess = (t) => setNotice({ type: "success", text: t });
  const clearNotice = () => setNotice({ type: "", text: "" });

  /* ======================== Cargar base ============================ */
  useEffect(() => {
    let alive = true;

    const loadClientes = async () => {
      try {
        const r = await http("/api/trainers/me/clients", { auth: true });
        const arr = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
        if (!alive) return;
        setClientes(arr);

        const qsCliente = searchParams.get("cliente");
        if (qsCliente && arr.some((c) => String(c.id) === String(qsCliente))) {
          setClienteId(String(qsCliente));
          return;
        }

        if (!clienteId && arr.length) setClienteId(String(arr[0].id));
      } catch (e) {
        if (!alive) return;
        setClientes([]);
      }
    };

    const loadServicios = async () => {
      try {
        const r = await http("/api/servicios", { auth: true });
        const arr = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
        if (!alive) return;
        setServicios(arr);
        if (!servicioId && arr.length) setServicioId(String(arr[0].id));
      } catch (e) {
        if (!alive) return;
        setServicios([]);
      }
    };

    loadClientes();
    loadServicios();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ======================== Agenda diaria ============================ */
  const loadAgendaDia = async (f) => {
    if (!f) return;
    try {
      const r = await http(`/api/reservas/trainer/day?fecha=${f}`, { auth: true });
      setReservasDia(Array.isArray(r) ? r : []);
    } catch {
      setReservasDia([]);
      showError("No se pudo cargar la agenda del día.");
    }
  };

  const loadBloqueosDia = async (f) => {
    if (!f) return;
    try {
      const r = await http(`/api/bloqueos/day?fecha=${f}`, { auth: true });
      const arr = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
      setBloqueosDia(arr.map((b) => String(b?.hora || "")).filter(Boolean));
    } catch (e) {
      // si el backend no tiene el endpoint, lo veremos aquí
      setBloqueosDia([]);
      showError("No se pudieron cargar los bloqueos del día.");
    }
  };

  const refreshDia = async (f = fecha) => {
    clearNotice();
    await Promise.all([loadAgendaDia(f), loadBloqueosDia(f)]);
  };

  useEffect(() => {
    if (fecha) refreshDia(fecha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  /* ======================== Mis reservas (inbox) ============================ */
  const loadMisReservas = async () => {
    setLoadingMisReservas(true);
    try {
      const r = await http("/api/reservas/mias-trainer", { auth: true });
      setMisReservas(Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
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
      showError("Selecciona cliente y servicio antes de crear la reserva.");
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
      await refreshDia(fecha);
      await loadMisReservas();
    } catch (e) {
      console.error("Error creando reserva:", e);
      showError("No se pudo crear la reserva.");
    }
  };

  const bloquearHora = async (hora) => {
    try {
      await http("/api/bloqueos", {
        method: "POST",
        auth: true,
        data: { fecha, hora },
      });
      await loadBloqueosDia(fecha);
    } catch (e) {
      console.error("Error bloqueando:", e);
      showError("No se pudo bloquear la hora.");
    }
  };

  const desbloquearHora = async (hora) => {
    try {
      await http("/api/bloqueos", {
        method: "DELETE",
        auth: true,
        data: { fecha, hora },
      });
      await loadBloqueosDia(fecha);
    } catch (e) {
      console.error("Error desbloqueando:", e);
      showError("No se pudo desbloquear la hora.");
    }
  };

  const reservaPorHora = (hora) => reservasDia.find((r) => String(r.hora) === String(hora));

  const puedeChat = (status) => {
    const s = String(status || "").toLowerCase();
    return s === "confirmed" || s === "confirmada" || s === "pending_user" || s === "pending";
  };

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

  const onSlotClick = async (hora, { bloqueada }) => {
    clearNotice();
    if (!fecha) {
      showError("Selecciona una fecha.");
      return;
    }

    if (mode === "create") {
      if (bloqueada) {
        showError("Esa hora está bloqueada. Desbloquéala para poder reservar.");
        return;
      }
      await crearReserva(hora);
      return;
    }

    // mode === "block"
    if (bloqueada) await desbloquearHora(hora);
    else await bloquearHora(hora);
  };

  const misReservasOrdenadas = useMemo(() => {
    const arr = Array.isArray(misReservas) ? [...misReservas] : [];
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Mis reservas (adiestrador)</h3>
            <p style={{ margin: "6px 0 0", opacity: 0.7 }}>{user?.email}</p>
          </div>
          <button
            className="btn-ghost"
            type="button"
            onClick={loadMisReservas}
            disabled={loadingMisReservas}
          >
            {loadingMisReservas ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {loadingMisReservas ? (
          <div className="card" style={{ marginTop: 10 }}>
            Cargando tus reservas…
          </div>
        ) : misReservasOrdenadas.length === 0 ? (
          <div className="card" style={{ marginTop: 10 }}>
            No tienes reservas asignadas todavía.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 10,
            }}
          >
            {misReservasOrdenadas.map((r) => (
              <div key={r.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>
                      {r.servicioTitulo || r.servicioId || "Reserva"}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 14 }}>
                      <b>Fecha:</b> {r.fecha} · <b>Hora:</b> {r.hora}{" "}
                      {r.modalidad ? (
                        <>
                          · <i>{r.modalidad}</i>
                        </>
                      ) : null}
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
                    title={!puedeChat(r.status) ? "Chat no disponible para este estado" : "Abrir chat"}
                  >
                    {openingChatId === r.id ? "Abriendo chat…" : "💬 Abrir chat"}
                  </button>

                  {r.fecha && (
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => setFecha(String(r.fecha).slice(0, 10))}
                    >
                      Ver en agenda
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ================= AGENDA DIARIA (CREAR / BLOQUEAR) ================= */}
      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Agenda diaria</h3>
            <p style={{ margin: "6px 0 0", opacity: 0.8 }}>{humanDate(fecha)}</p>
          </div>

          <div style={{ display: "grid", gap: 10, minWidth: 280 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Fecha</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn-ghost" type="button" onClick={() => setFecha(todayYMD())}>
                  Hoy
                </button>
                <button className="btn-ghost" type="button" onClick={() => refreshDia(fecha)}>
                  Actualizar
                </button>
              </div>
            </label>
          </div>
        </div>

        {/* selector modo */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 14,
          }}
        >
          <div style={{ opacity: 0.85 }}>
            <b>Click en hora:</b>{" "}
            {mode === "create" ? "crear reserva (hora libre)" : "bloquear / desbloquear"}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={mode === "create" ? "btn-primary" : "btn-ghost"}
              onClick={() => setMode("create")}
            >
              Crear reserva
            </button>
            <button
              type="button"
              className={mode === "block" ? "btn-primary" : "btn-ghost"}
              onClick={() => setMode("block")}
            >
              Bloquear
            </button>
          </div>
        </div>

        {/* formulario (solo para crear) */}
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Cliente</span>
              <select
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                disabled={mode !== "create"}
              >
                <option value="">— Selecciona cliente —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || c.nombre || c.email || c.id}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Servicio</span>
              <select
                value={servicioId}
                onChange={(e) => setServicioId(e.target.value)}
                disabled={mode !== "create"}
              >
                <option value="">— Selecciona servicio —</option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.titulo || s.nombre || s.name || s.id}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Modalidad</span>
              <select
                value={modalidad}
                onChange={(e) => setModalidad(e.target.value)}
                disabled={mode !== "create"}
              >
                <option value="presencial">Presencial</option>
                <option value="online">Online</option>
                <option value="a domicilio">A domicilio</option>
              </select>
            </label>
          </div>

          <p style={{ marginTop: 10, opacity: 0.8, fontSize: 13 }}>
            {mode === "create"
              ? "Modo Crear reserva: haz click en una hora libre para crear la reserva con el cliente/servicio seleccionados."
              : "Modo Bloquear: haz click en una hora libre para bloquearla o en una bloqueada para desbloquearla."}
          </p>
        </div>

        {/* grid horas */}
        <div
          style={{
            display: "grid",
            gap: 12,
            marginTop: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {HOURS.map((h) => {
            const hora = typeof h === "number" ? `${String(h).padStart(2, "0")}:00` : String(h);
            const reserva = reservaPorHora(hora);
            const bloqueada = bloqueosDia.includes(hora);

            if (reserva) {
              return (
                <div
                  key={hora}
                  className="card"
                  style={{
                    padding: 12,
                    border: "1px solid #f0c5a9",
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 900 }}>{reserva.servicioTitulo || "Servicio"}</div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Estado</div>
                      <div style={{ fontWeight: 800 }}>{statusLabel(reserva.status)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                    <b>Fecha:</b> {reserva.fecha} · <b>Hora:</b> {reserva.hora}
                    {reserva.modalidad ? (
                      <>
                        {" "}· <i>{reserva.modalidad}</i>
                      </>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, opacity: 0.9 }}>
                    <b>Cliente:</b>{" "}
                    {reserva.clienteNombre || reserva.clienteEmail || reserva.email || "—"}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => handleOpenChat(reserva)}
                      disabled={!puedeChat(reserva.status) || openingChatId === reserva.id}
                      style={{ width: "100%" }}
                    >
                      {openingChatId === reserva.id ? "Abriendo…" : "💬 Abrir chat"}
                    </button>
                  </div>
                </div>
              );
            }

            // slot libre o bloqueado
            const label = bloqueada
              ? mode === "block"
                ? "Bloqueada · click para desbloquear"
                : "Bloqueada"
              : mode === "create"
              ? "Libre · crear reserva"
              : "Libre · bloquear";

            return (
              <button
                key={hora}
                type="button"
                className="card"
                onClick={() => onSlotClick(hora, { bloqueada })}
                style={{
                  textAlign: "left",
                  padding: 12,
                  cursor: "pointer",
                  border: `1px solid ${bloqueada ? "#f5b4b4" : "#f0c5a9"}`,
                  background: bloqueada ? "#fff5f5" : "#fff",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 18 }}>{hora.slice(0, 2)}</div>
                <div style={{ marginTop: 4, opacity: 0.85 }}>{label}</div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
