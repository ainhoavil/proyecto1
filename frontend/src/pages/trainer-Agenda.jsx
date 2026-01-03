import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { http } from "../helpers/http";
import { HOURS, humanDate, canonStatus, serverErrMsg } from "../helpers/reservas";
import "../styles/contratar.scss";

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(status) {
  const s = canonStatus(status);
  if (s === "pending") return "Pendiente (centro)";
  if (s === "pending_user") return "Pendiente (cliente)";
  if (s === "confirmed") return "Confirmada";
  if (s === "cancelled") return "Cancelada";
  if (s === "rejected") return "Rechazada";
  if (s === "deleted") return "Eliminada";
  return s || "Estado";
}

export default function TrainerAgenda() {
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
  const [selectedHora, setSelectedHora] = useState(""); // "HH:MM" seleccionado en el panel de horas

  // ✅ Inbox / list de reservas del adiestrador
  const [misReservas, setMisReservas] = useState([]);
  const [loadingMisReservas, setLoadingMisReservas] = useState(false);

  // ✅ Chat
  const [openingChatId, setOpeningChatId] = useState(null);
// Notas de reserva (adiestrador)
const [notesOpen, setNotesOpen] = useState(false);
const [notesReserva, setNotesReserva] = useState(null);
const [notesItems, setNotesItems] = useState([]);
const [notesText, setNotesText] = useState("");
const [notesLoading, setNotesLoading] = useState(false);
const [notesError, setNotesError] = useState("");

  // Avisos
  const [notice, setNotice] = useState({ type: "", text: "" });

  const showError = (text) => setNotice({ type: "error", text });
  const showSuccess = (text) => setNotice({ type: "success", text });
  const clearNotice = () => setNotice({ type: "", text: "" });

  /* ======================== Cargar selects ============================ */
  useEffect(() => {
    let alive = true;

    const loadServicios = async () => {
      try {
        const s = await http("/api/servicios", { auth: true });
        const arr = Array.isArray(s) ? s : Array.isArray(s?.items) ? s.items : [];
        if (!alive) return;
        setServicios(arr);
        if (!servicioId && arr.length) setServicioId(String(arr[0].id));
      } catch (e) {
        if (!alive) return;
        setServicios([]);
      }
    };

    const loadClientes = async () => {
      try {
        const r = await http("/api/trainers/me/clients", { auth: true });
        const arr = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
        if (!alive) return;
        setClientes(arr);

        const qsCliente = searchParams.get("cliente");
        if (qsCliente) {
          setClienteId(String(qsCliente));
        } else if (!clienteId && arr.length) {
          setClienteId(String(arr[0].id));
        }
      } catch (e) {
        if (!alive) return;
        setClientes([]);
      }
    };

    const bootstrap = async () => {
      await Promise.all([loadServicios(), loadClientes()]);
    };

    bootstrap();

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

  useEffect(() => {
    // Al cambiar fecha o modo, limpiamos selección de hora
    setSelectedHora("");
  }, [fecha, mode]);

  /* ======================== Mis reservas (inbox) ============================ */
  const loadMisReservas = async () => {
    setLoadingMisReservas(true);
    try {
      const r = await http("/api/reservas/mias-trainer", { auth: true });
      setMisReservas(Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      console.error("Error cargando mis reservas (trainer):", e);
      setMisReservas([]);
    } finally {
      setLoadingMisReservas(false);
    }
  };

  useEffect(() => {
    loadMisReservas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ======================== Crear reserva / Bloquear ============================ */
  const crearReserva = async (hora) => {
    const h = String(hora || "").trim();

    if (!fecha) {
      showError("Selecciona una fecha.");
      return;
    }
    if (!h) {
      showError("Selecciona una hora.");
      return;
    }
    if (!clienteId || !servicioId) {
      showError("Selecciona cliente y servicio antes de crear la reserva.");
      return;
    }

    if (bloqueosDia.includes(h)) {
      showError("Esa hora está bloqueada. Desbloquéala para poder reservar.");
      return;
    }
    if (reservaPorHora(h)) {
      showError("Esa hora ya tiene una reserva.");
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
          hora: h,
          modalidad,
          status: "confirmed",
        },
      });
      showSuccess("Reserva creada.");
      setSelectedHora("");
      await refreshDia(fecha);
      await loadMisReservas();
    } catch (e) {
      console.error("Error creando reserva:", e);
      showError(serverErrMsg(e, "No se pudo crear la reserva."));
    }
  };

  const bloquearHora = async (hora) => {
    if (!fecha || !hora) return;
    try {
      await http("/api/bloqueos", {
        method: "POST",
        auth: true,
        data: { fecha, hora },
      });
      await loadBloqueosDia(fecha);
    } catch (e) {
      console.error("Error bloqueando:", e);
      showError(serverErrMsg(e, "No se pudo bloquear la hora."));
    }
  };

  const desbloquearHora = async (hora) => {
    if (!fecha || !hora) return;
    try {
      await http("/api/bloqueos", {
        method: "DELETE",
        auth: true,
        data: { fecha, hora },
      });
      await loadBloqueosDia(fecha);
    } catch (e) {
      console.error("Error desbloqueando:", e);
      showError(serverErrMsg(e, "No se pudo desbloquear la hora."));
    }
  };

  const reservaPorHora = (hora) => reservasDia.find((r) => String(r.hora) === String(hora));

  const puedeChat = (status) => {
    const s = canonStatus(status);
    return s === "confirmed" || s === "pending_user" || s === "pending";
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
      showError(serverErrMsg(e, "No se pudo abrir el chat."));
    } finally {
      setOpeningChatId(null);
    }
  };

  const onSlotClick = async (hora) => {
    clearNotice();
    const h = String(hora || "").trim();
    if (!fecha) {
      showError("Selecciona una fecha.");
      return;
    }

    const bloqueada = bloqueosDia.includes(h);
    const r = reservaPorHora(h);

    if (mode === "block") {
      if (r) {
        showError("No puedes bloquear una hora que ya tiene una reserva.");
        return;
      }
      setSelectedHora(h);
      if (bloqueada) await desbloquearHora(h);
      else await bloquearHora(h);
      return;
    }

    // mode === "create": solo selecciona hora (la creación se hace con el botón).
    if (r) {
      showError("Esa hora ya tiene una reserva.");
      return;
    }
    if (bloqueada) {
      showError("Esa hora está bloqueada. Desbloquéala para poder reservar.");
      return;
    }

    setSelectedHora((prev) => (prev === h ? "" : h));
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

  const noticeStyle = useMemo(() => {
    if (!notice.text) return null;
    const base = {
      marginBottom: 14,
      padding: "10px 14px",
      borderRadius: 10,
      fontSize: 14,
      border: "1px solid transparent",
    };
    if (notice.type === "success") {
      return {
        ...base,
        backgroundColor: "#e6f6eb",
        borderColor: "#7ac69b",
        color: "#22623d",
      };
    }
    return {
      ...base,
      backgroundColor: "#fde8e8",
      borderColor: "#f39b9b",
      color: "#9c1b1b",
    };
  }, [notice.text, notice.type]);

  const servicioTitleById = useMemo(() => {
    const m = new Map();
    const arr = Array.isArray(servicios) ? servicios : [];
    for (const s of arr) {
      const id = s?.id;
      if (id === undefined || id === null) continue;
      const label = s?.title || s?.titulo || s?.nombre || s?.name || String(id);
      m.set(String(id), String(label));
    }
    return m;
  }, [servicios]);

  const getServicioTitulo = (r) => {
    if (!r) return "Servicio";
    const direct = r.servicioTitulo || r.tituloServicio || r.serviceTitle || "";
    if (direct) return String(direct);
    const sid = r.servicioId || r.servicio_id || r.serviceId || "";
    if (sid && servicioTitleById.has(String(sid))) return servicioTitleById.get(String(sid));
    return "Servicio";
  };

  const fechaLabel = fecha ? humanDate(fecha) : "";
  const canCrear = mode === "create" && !!selectedHora && !!clienteId && !!servicioId && !!fecha;
  async function loadReservaNotes(reservaId) {
  try {
    setNotesLoading(true);
    setNotesError("");
    const r = await http(`/api/reservas/${reservaId}/notes`, { auth: true });
    const arr = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
    setNotesItems(arr);
  } catch (e) {
    console.error("No se pudieron cargar las notas", e);
    setNotesItems([]);
    setNotesError(serverErrMsg(e, "No se pudieron cargar las notas"));
  } finally {
    setNotesLoading(false);
  }
}

function openReservaNotes(reserva) {
  setNotesReserva(reserva);
  setNotesOpen(true);
  setNotesText("");
  setNotesItems([]);
  loadReservaNotes(reserva.id);
}

function closeReservaNotes() {
  setNotesOpen(false);
  setNotesReserva(null);
  setNotesItems([]);
  setNotesText("");
  setNotesError("");
}

async function addReservaNote() {
  if (!notesReserva?.id) return;
  const text = String(notesText || "").trim();
  if (!text) return;

  try {
    setNotesLoading(true);
    setNotesError("");
    const r = await http(`/api/reservas/${notesReserva.id}/notes`, {
      method: "POST",
      auth: true,
      body: { text },
    });
    const arr = Array.isArray(r?.items) ? r.items : [];
    setNotesItems(arr);
    setNotesText("");
  } catch (e) {
    console.error("No se pudo guardar la nota", e);
    setNotesError(serverErrMsg(e, "No se pudo guardar la nota"));
  } finally {
    setNotesLoading(false);
  }
}



  return (
    <div>
      {notice.text && <div style={noticeStyle}>{notice.text}</div>}

      {/* ================= CONTROLES PRINCIPALES ================= */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#7b5b45" }}>
          Fecha
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={{
              borderRadius: 10,
              border: "1px solid #e0d4c8",
              padding: "8px 10px",
              fontSize: 13,
              backgroundColor: "#fff7f0",
              outline: "none",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className={mode === "create" ? "btn-primary" : "btn-outline"}
            onClick={() => setMode("create")}
          >
            Reservar
          </button>
          <button
            type="button"
            className={mode === "block" ? "btn-primary" : "btn-outline"}
            onClick={() => setMode("block")}
          >
            Bloquear
          </button>
          <button type="button" className="btn-ghost" onClick={() => refreshDia(fecha)}>
            Actualizar
          </button>
        </div>
      </div>

      {/* ================= FORMULARIO RESERVA MANUAL ================= */}
      {mode === "create" && (
        <div
          style={{
            background: "#fffdfb",
            border: "1px solid #f3d8c6",
            borderRadius: 16,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#3b281c", marginBottom: 10 }}>
            Reserva manual
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#6b5b51" }}>
              Cliente
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">Selecciona cliente</option>
                {clientes.map((c) => (
                  <option key={c.id || c.email} value={String(c.id || "")}>
                    {c.displayName || c.nombre || c.name || c.email || `Cliente ${c.id}`}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#6b5b51" }}>
              Servicio
              <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
                <option value="">Selecciona servicio</option>
                {servicios.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.title || s.titulo || s.nombre || s.name || String(s.id)}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#6b5b51" }}>
              Modalidad
              <select value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
                <option value="presencial">Presencial</option>
                <option value="online">Online</option>
                <option value="a domicilio">A domicilio</option>
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#6b5b51" }}>
              Hora seleccionada
              <div
                style={{
                  borderRadius: 10,
                  border: "1px solid #e0d4c8",
                  padding: "8px 10px",
                  fontSize: 13,
                  backgroundColor: "#fff7f0",
                  color: selectedHora ? "#3a312b" : "#a08168",
                }}
              >
                {selectedHora || "—"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={!canCrear}
              onClick={() => crearReserva(selectedHora)}
            >
              Crear reserva
            </button>
          </div>

          <p className="hint" style={{ marginTop: 8 }}>
            Selecciona una hora libre abajo y después pulsa “Crear reserva”.
          </p>
        </div>
      )}

      {mode === "block" && (
        <p className="hint" style={{ marginBottom: 12 }}>
          Toca una hora para bloquearla o desbloquearla. No se pueden bloquear horas con reserva.
        </p>
      )}

      {/* ================= PANEL DE HORAS ================= */}
      <div className="slots-panel">
        <div className="slots-title">
          {mode === "create" ? `Horas disponibles — ${fechaLabel}` : `Bloqueos — ${fechaLabel}`}
        </div>

        <div className="slots-grid">
          {HOURS.map((h) => {
            const hh = String(h).padStart(2, "0");
            const hora = `${hh}:00`;
            const r = reservaPorHora(hora);
            const bloqueada = bloqueosDia.includes(hora);

            const isDisabled = mode === "create" ? !!r || bloqueada : !!r;
            const cls = `slot ${selectedHora === hora ? "active" : ""} ${
              !!r || (mode === "create" && bloqueada) ? "busy" : ""
            }`;

            const style =
              bloqueada && mode !== "create"
                ? { backgroundColor: "#fff3f3", borderColor: "#f39b9b", color: "#b83232" }
                : undefined;

            const title = !!r
              ? "Ocupada (hay una reserva)"
              : bloqueada
              ? mode === "create"
                ? "Bloqueada"
                : "Bloqueada (click para desbloquear)"
              : mode === "create"
              ? "Libre (click para seleccionar)"
              : "Libre (click para bloquear)";

            return (
              <button
                key={hora}
                type="button"
                className={cls}
                style={style}
                disabled={isDisabled}
                title={title}
                onClick={() => onSlotClick(hora)}
              >
                {hora}
              </button>
            );
          })}
        </div>

        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Horas tachadas: ocupadas o bloqueadas (en modo reservar).
        </p>
      </div>

      {/* ================= RESERVAS DEL DÍA ================= */}
      <section className="reservas-section">
        <h2>Reservas del día</h2>

        {Array.isArray(reservasDia) && reservasDia.length ? (
          <div className="reservas-list reservas-list--day">
            {reservasDia.map((r) => {
              const statusCanon = canonStatus(r.status || "");
              const sKeyRaw = statusCanon || String(r.status || "").toLowerCase();
              const sKey = sKeyRaw.replaceAll("_", "-");
              const badgeCls = `badge badge-${sKey}`;
              const cliente = r.clienteNombre || r.clienteEmail || "Cliente";
              const servicio = getServicioTitulo(r);

              return (
                <div
                  key={r.id}
                  style={{
                    background: "#fff7f0",
                    border: "1px solid #f0d7c7",
                    borderRadius: 16,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#3a312b" }}>
                        {r.hora} · {servicio}
                      </div>
                      <div style={{ fontSize: 12, color: "#8f6b53", marginTop: 2 }}>
                        {cliente} · {r.modalidad || "presencial"}
                      </div>
                    </div>
                    <span className={badgeCls}>{statusLabel(r.status)}</span>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!puedeChat(r.status) || openingChatId === r.id}
                      onClick={() => handleOpenChat(r)}
                    >
                      {openingChatId === r.id ? "Abriendo chat…" : "Abrir chat"}
                    </button>

                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => openReservaNotes(r)}
                    >
                      Notas
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="reservas-empty">No hay reservas para este día.</p>
        )}
      </section>

      {/* ================= BLOQUEOS DEL DÍA ================= */}
      <section className="reservas-section">
        <h2>Bloqueos del día</h2>
        {bloqueosDia.length ? (
<>
  <div className="slots-grid" style={{ marginTop: 8 }}>
    {bloqueosDia.map((h) => (
      <button
        key={h}
        type="button"
        className="slot"
        title="Quitar bloqueo"
        onClick={() => desbloquearHora(h)}
        style={{
          backgroundColor: "#fff3f3",
          borderColor: "#f39b9b",
          color: "#b83232",
          cursor: "pointer",
        }}
      >
        {h} <span style={{ marginLeft: 6, fontWeight: 700 }}>×</span>
      </button>
    ))}
  </div>

  <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
    Haz click en un bloqueo para quitarlo.
  </p>
</>
) : (
          <p className="reservas-empty">No hay bloqueos para este día.</p>
        )}
      </section>

      {/* ===================== MODAL NOTAS ===================== */}
{notesOpen ? (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      zIndex: 9999,
    }}
    onMouseDown={(e) => {
      // cerrar si clic fuera
      if (e.target === e.currentTarget) closeReservaNotes();
    }}
  >
    <div
      style={{
        width: "min(720px, 100%)",
        background: "#fff",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>
          Notas — {notesReserva?.hora} · {notesReserva?.servicioTitulo || "Reserva"} (#{notesReserva?.id})
        </div>
        <button type="button" className="btn-outline" onClick={closeReservaNotes}>
          Cerrar
        </button>
      </div>

      {notesError ? (
        <div style={{ marginTop: 10, color: "#b83232", fontSize: 13 }}>{notesError}</div>
      ) : null}

      <div style={{ marginTop: 12, maxHeight: 320, overflow: "auto", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
        {notesLoading && !notesItems.length ? (
          <div style={{ opacity: 0.75 }}>Cargando…</div>
        ) : notesItems.length ? (
          notesItems.map((n) => (
            <div key={n.id} style={{ padding: "8px 6px", borderBottom: "1px solid #f2f2f2" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.8 }}>
                <span>{n.authorEmail || n.authorUid || "autor"}</span>
                <span>·</span>
                <span>{n.createdAt || ""}</span>
              </div>
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{n.text}</div>
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.75 }}>No hay notas todavía.</div>
        )}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <input
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          placeholder="Escribe una nota…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #ddd",
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addReservaNote();
            }
          }}
        />
        <button type="button" className="btn-primary" disabled={notesLoading || !String(notesText || "").trim()} onClick={addReservaNote}>
          Añadir
        </button>
      </div>
    </div>
  </div>
) : null}


      {/* ================= HISTÓRICO (MIS RESERVAS) ================= */}
      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#7b5b45" }}>
          Mis reservas (histórico)
        </summary>

        <div style={{ marginTop: 10 }}>
          {loadingMisReservas ? (
            <p style={{ fontSize: 13, color: "#8f6b53" }}>Cargando…</p>
          ) : misReservasOrdenadas.length ? (
            <div>
              {misReservasOrdenadas.slice(0, 50).map((r) => {
                const statusCanon = canonStatus(r.status || "");
                const badgeRaw = (statusCanon || String(r.status || "").toLowerCase()).replaceAll("_", "-");
                const badgeCls = `badge badge-${badgeRaw}`;
                return (
                  <div
                    key={r.id}
                    style={{
                      background: "#fff7f0",
                      border: "1px solid #f0d7c7",
                      borderRadius: 16,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: "#3a312b" }}>
                          {r.fecha} · {r.hora} · {getServicioTitulo(r)}
                        </div>
                        <div style={{ fontSize: 12, color: "#8f6b53", marginTop: 2 }}>
                          {r.email || "—"}
                        </div>
                      </div>
                      <span className={badgeCls}>{statusLabel(r.status)}</span>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                      <button
                        className="btn-primary"
                        type="button"
                        disabled={!puedeChat(r.status) || openingChatId === r.id}
                        onClick={() => handleOpenChat(r)}
                      >
                        {openingChatId === r.id ? "Abriendo chat…" : "Abrir chat"}
                      </button>

                      {r.fecha && (
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => setFecha(String(r.fecha).slice(0, 10))}
                        >
                          Ver en agenda
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {misReservasOrdenadas.length > 50 && (
                <p style={{ fontSize: 12, color: "#a08168" }}>
                  Mostrando 50 de {misReservasOrdenadas.length}.
                </p>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#8f6b53" }}>No hay reservas.</p>
          )}
        </div>
      </details>
    </div>
  );
}
