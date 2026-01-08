// frontend/src/pages/reservas/reservasUser.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../../helpers/http";
import { useUi } from "../../context/ui";
import { useAuth } from "../../context/auth";

/* =========================
   Helpers de reservas
   ========================= */

function reservaIdOf(r) {
  const id = r?.id || r?._id || r?.uid || r?.pk || r?.reservaId || r?.reserva_id;
  return id ? String(id) : "";
}

function reservaDateTimeMs(r) {
  const f = String(r?.fecha || "").slice(0, 10);
  const h = String(r?.hora || "00:00").slice(0, 5) || "00:00";
  // Date('YYYY-MM-DDTHH:mm:ss') se interpreta en local time del navegador
  const iso = `${f}T${h}:00`;
  const d = new Date(iso);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/* =========================
   Helpers de notas
   ========================= */

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function noteIdOf(n) {
  const id = n?.id || n?._id || n?.noteId || n?.note_id || n?.uid || n?.pk;
  return id ? String(id) : "";
}

function noteCreatedAt(n) {
  return n?.created_at || n?.createdAt || n?.created || n?.timestamp || "";
}

function noteText(n) {
  return String(
    n?.text ??
      n?.nota ??
      n?.note ??
      n?.admin_note ??
      n?.user_note ??
      n?.userNote ??
      n?.adminNote ??
      ""
  ).trim();
}

function noteAuthorLabel(n) {
  const rawRole = String(n?.author_role ?? n?.authorRole ?? n?.author ?? n?.role ?? "")
    .toLowerCase()
    .trim();

  const role =
    rawRole === "trainer"
      ? "adiestrador"
      : rawRole === "user" || rawRole === "cliente" || rawRole === "client"
      ? "client"
      : rawRole;

  const roleLabel =
    role === "admin"
      ? "Centro"
      : role === "adiestrador"
      ? "Adiestrador"
      : role === "client"
      ? "Cliente"
      : rawRole || "Autor";

  const email = String(n?.author_email ?? n?.authorEmail ?? n?.email ?? "").trim();
  const uid = String(
    n?.author_uid ?? n?.authorUid ?? n?.author_id ?? n?.authorId ?? ""
  ).trim();

  const who =
    email || uid || String(n?.authorName ?? n?.author_name ?? n?.name ?? "").trim();

  return who ? `${roleLabel} (${who})` : roleLabel;
}

/* =========================
   Utilidades UI
   ========================= */

function formatEUR(value, currency = "EUR") {
  if (value == null) return "A consultar";
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function todayYMD() {
  return ymd(new Date());
}

function renderFecha(fecha) {
  if (!fecha) return "";
  try {
    const d = new Date(fecha);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("es-ES", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  } catch {
    // ignore
  }
  return fecha;
}

function renderPerro(perro) {
  if (!perro) return "(sin datos)";
  if (typeof perro === "string") {
    try {
      const obj = JSON.parse(perro);
      return renderPerro(obj);
    } catch {
      return perro;
    }
  }
  if (Array.isArray(perro)) {
    return perro.map((p) => renderPerro(p)).filter(Boolean).join(", ");
  }
  if (typeof perro === "object") {
    const nombre = perro.nombre || perro.name;
    const raza = perro.razaTamaño || perro.raza || "";
    const edad = perro.edad ? `${perro.edad} años` : "";
    const castrado = perro.castrado ? "castrado" : "";
    const parts = [nombre, raza, edad, castrado].filter(Boolean);
    return parts.length ? parts.join(" · ") : "(sin datos)";
  }
  return String(perro);
}

function statusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pending" || s === "pendiente") return "Pendiente centro";
  if (s === "confirmed" || s === "confirmada") return "Confirmada";
  if (s === "cancelled" || s === "cancelada") return "Cancelada";
  if (s === "rejected" || s === "rechazada") return "Rechazada";
  if (s === "pending_user") return "Pendiente centro";
  return s || "Estado";
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pending" || s === "pendiente") return "badge badge-pending";
  if (s === "confirmed" || s === "confirmada") return "badge badge-confirmed";
  if (s === "cancelled" || s === "cancelada") return "badge badge-cancelled";
  if (s === "rejected" || s === "rechazada") return "badge badge-rejected";
  if (s === "pending_user") return "badge badge-pending";
  return "badge";
}

/* =========================
   Card Reserva
   ========================= */

function ReservaCard({
  r,
  onCancel,
  onToggleNotes,
  onUserDecision,

  readOnly = false,

  // chat
  onOpenChat,
  openingChatId,

  // notas
  isNotesOpen,
  notes,
  loadingNotes,
  newNote,
  onChangeNote,
  onAddNote,
  onDeleteNote,
}) {
  const rid = reservaIdOf(r);
  const normalizedStatus = String(r?.status || "").toLowerCase();

  const puedeCancelar =
    normalizedStatus === "pending" ||
    normalizedStatus === "pendiente" ||
    normalizedStatus === "confirmada" ||
    normalizedStatus === "confirmed" ||
    normalizedStatus === "pending_user";

  const puedeAceptarRechazar =
    normalizedStatus === "pending_user" &&
    (r?.canUserConfirm === true || r?.userConfirmRequired === true);

  const puedeChat =
    normalizedStatus === "confirmed" ||
    normalizedStatus === "confirmada" ||
    normalizedStatus === "pending" ||
    normalizedStatus === "pendiente" ||
    normalizedStatus === "pending_user";

  const countNotas =
    typeof r?.notesCount === "number"
      ? r.notesCount
      : isNotesOpen && Array.isArray(notes)
      ? notes.length
      : null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontWeight: "bold", textTransform: "capitalize" }}>
            {r?.servicioTitulo || r?.servicioId || "Reserva"}
          </div>

          <div style={{ fontSize: 14, marginTop: 4 }}>
            <b>Fecha:</b> {r?.fecha} · <b>Hora:</b> {r?.hora}{" "}
            {r?.modalidad && (
              <>
                · <i>{r.modalidad}</i>
              </>
            )}
          </div>

          {(r?.trainerName || r?.trainerNombre || r?.trainer) && (
            <div style={{ fontSize: 14, marginTop: 2 }}>
              <b>Adiestrador:</b> {r?.trainerName || r?.trainerNombre || r?.trainer}
            </div>
          )}

          {r?.perro && (
            <div style={{ fontSize: 14, marginTop: 2 }}>
              <b>Perro:</b> {renderPerro(r.perro)}
            </div>
          )}

          {r?.price != null && (
            <div style={{ fontSize: 14, marginTop: 2 }}>
              <b>Precio:</b> {formatEUR(r.price, r.currency || "EUR")}
            </div>
          )}

          {r?.adminNote && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <b>Nota centro:</b> {r.adminNote}
            </div>
          )}

          {r?.cancelReason && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <b>Motivo cancelación:</b> {r.cancelReason}
            </div>
          )}
        </div>

        <div style={{ textAlign: "right" }}>
          <span className={statusClass(r?.status)}>{statusLabel(r?.status)}</span>
        </div>
      </div>

      {!readOnly && (
        <div
          style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}
          className="reservas-actions-row"
        >
          <button className="btn-secondary" onClick={() => onToggleNotes?.(r)}>
            📝 Notas{countNotas != null ? ` (${countNotas})` : ""}
          </button>

          {puedeChat && (
            <button
              className="btn-primary"
              onClick={() => onOpenChat?.(r)}
              disabled={openingChatId === rid}
              title="Abrir chat relacionado con esta reserva"
            >
              {openingChatId === rid ? "Abriendo chat…" : "💬 Abrir chat"}
            </button>
          )}

          {puedeAceptarRechazar && (
            <>
              <button className="btn-primary" onClick={() => onUserDecision?.(r, "confirm")}>
                Aceptar
              </button>
              <button className="btn-outline" onClick={() => onUserDecision?.(r, "reject")}>
                Rechazar
              </button>
            </>
          )}

          {puedeCancelar && (
            <button className="btn-outline" onClick={() => onCancel?.(r)}>
              Cancelar reserva
            </button>
          )}
        </div>
      )}

      {/* Panel desplegable de notas */}
      {!readOnly && isNotesOpen && (
        <div className="reservas-notes">
          {loadingNotes ? (
            <p className="reservas-notes__loading">Cargando notas…</p>
          ) : !notes || notes.length === 0 ? (
            <p className="reservas-notes__empty">No hay notas todavía.</p>
          ) : (
            <div className="reservas-notes__list">
              {notes.map((n, idx) => (
                <div
                  key={noteIdOf(n) || `${rid}-note-${idx}`}
                  className="reservas-notes__item"
                >
                  <div>
                    {/* ✅ AQUÍ estaba el error: spans mal cerrados. Ya está limpio */}
                    <div className="reservas-notes__meta">
                      <b>{noteAuthorLabel(n) || "Centro"}</b>
                      {noteCreatedAt(n) ? (
                        <span> · {formatDateTime(noteCreatedAt(n))}</span>
                      ) : null}
                    </div>

                    <div className="reservas-notes__text">{noteText(n)}</div>
                  </div>

                  {onDeleteNote && n?.canDelete === true && (
                    <button
                      className="btn-ghost"
                      onClick={() => onDeleteNote(noteIdOf(n))}
                      title="Eliminar nota"
                    >
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Añadir nueva nota */}
          <div className="reservas-notes__new">
            <textarea
              rows={2}
              placeholder="Escribe una nota…"
              value={newNote}
              onChange={(e) => onChangeNote?.(e.target.value)}
            />
            <button
              className="btn-primary"
              onClick={onAddNote}
              disabled={!newNote.trim()}
            >
              Agregar nota
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Página principal
   ========================= */

export default function ReservasUser() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const ui = useUi();

  const [reservas, setReservas] = useState([]);
  const [trainersById, setTrainersById] = useState({});
  const [loading, setLoading] = useState(true);

  // chat
  const [openingChatId, setOpeningChatId] = useState(null);

  // buscador
  const [search, setSearch] = useState("");

  // calendario
  const [mesBase, setMesBase] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(todayYMD());

  // notas
  const [openNotesId, setOpenNotesId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState("");

  const cargarReservas = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const data = await http("/api/reservas/mias", { auth: true });
      const arr = Array.isArray(data) ? data : data?.items || [];
      setReservas(arr);
    } catch (e) {
      console.error("Error cargando reservas", e);
      setReservas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarReservas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await http("/api/trainers/public");
        const items = Array.isArray(t) ? t : t?.items || [];
        const map = {};
        for (const it of items) {
          const id = String(it?.id || it?.uid || "").trim();
          if (!id) continue;
          const nombre = String(it?.nombre || it?.name || it?.fullName || "").trim();
          map[id] = nombre || map[id] || "";
        }
        if (alive) setTrainersById(map);
      } catch {
        // silencioso
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reservasEnriched = useMemo(() => {
    if (!Array.isArray(reservas) || !reservas.length) return [];
    return reservas.map((r) => {
      const tidRaw = r?.trainerId ?? r?.trainer_id ?? r?.trainer_uid ?? r?.trainerUid;
      const tid = String(tidRaw || "").trim();
      const tName = tid ? String(trainersById?.[tid] || "").trim() : "";
      return tName ? { ...r, trainerName: tName } : r;
    });
  }, [reservas, trainersById]);

  const filtro = search.trim().toLowerCase();

  const reservasFiltradas = useMemo(() => {
    if (!filtro) return reservasEnriched;

    return reservasEnriched.filter((r) => {
      const perroStr = typeof r?.perro === "string" ? r.perro : renderPerro(r?.perro);
      const campos = [
        r?.servicioTitulo,
        r?.servicioId,
        perroStr,
        r?.trainerName,
        r?.fecha,
        r?.hora,
        statusLabel(r?.status),
      ];
      return campos.some((v) => String(v || "").toLowerCase().includes(filtro));
    });
  }, [reservasEnriched, filtro]);

  const fechasConReservas = useMemo(() => {
    const map = new Map();
    for (const r of reservasFiltradas) {
      if (!r?.fecha) continue;
      const f = String(r.fecha).slice(0, 10);
      const list = map.get(f) || [];
      list.push(r);
      map.set(f, list);
    }
    return map;
  }, [reservasFiltradas]);

  const reservasDelDiaSeleccionado = useMemo(() => {
    if (!selectedDate) return [];
    return fechasConReservas.get(selectedDate) || [];
  }, [fechasConReservas, selectedDate]);

  const pendientesCentro = useMemo(
    () =>
      reservasFiltradas.filter((r) => {
        const s = String(r?.status || "").toLowerCase();
        return s === "pending" || s === "pendiente";
      }),
    [reservasFiltradas]
  );

  const pendientesUsuario = useMemo(
    () =>
      reservasFiltradas.filter((r) => {
        const s = String(r?.status || "").toLowerCase();
        return s === "pending_user";
      }),
    [reservasFiltradas]
  );

  const { confirmadasFuturas, pasadasConfirmadas } = useMemo(() => {
    const now = Date.now();
    const future = [];
    const past = [];

    for (const r of reservasFiltradas) {
      const s = String(r?.status || "").toLowerCase();
      const isConfirmed = s === "confirmed" || s === "confirmada";
      if (!isConfirmed) continue;

      const ms = reservaDateTimeMs(r);
      if (Number.isFinite(ms) && ms < now) past.push(r);
      else future.push(r);
    }

    future.sort((a, b) => reservaDateTimeMs(a) - reservaDateTimeMs(b));
    past.sort((a, b) => reservaDateTimeMs(b) - reservaDateTimeMs(a));

    return { confirmadasFuturas: future, pasadasConfirmadas: past };
  }, [reservasFiltradas]);

  const canceladasRechazadas = useMemo(
    () =>
      reservasFiltradas.filter((r) => {
        const s = String(r?.status || "").toLowerCase();
        return (
          s === "cancelled" ||
          s === "cancelada" ||
          s === "rejected" ||
          s === "rechazada"
        );
      }),
    [reservasFiltradas]
  );

  const handleCancel = async (r) => {
    const ok = await ui.confirm({
      title: "Cancelar reserva",
      message: `¿Cancelar la reserva del ${r?.fecha} a las ${r?.hora}?`,
      confirmText: "Cancelar",
      cancelText: "Volver",
      danger: true,
    });
    if (!ok) return;

    const rid = reservaIdOf(r);
    if (!rid) return;

    try {
      await http(`/api/reservas/${rid}/cancel`, {
        method: "PATCH",
        data: { reason: "Cancelada por el cliente" },
        auth: true,
      });
      await cargarReservas();
    } catch (e) {
      console.error("Error cancelando reserva", e);
      const msg = e?.data?.error || e?.message || "No se pudo cancelar la reserva.";
      ui.notify({ type: "error", message: msg });
    }
  };

  const handleUserDecision = async (r, action) => {
    const verb = action === "confirm" ? "aceptar" : "rechazar";
    const ok = await ui.confirm({
      title: "Confirmar acción",
      message: `¿Seguro que quieres ${verb} la reserva del ${r?.fecha} a las ${r?.hora}?`,
      confirmText: "Sí",
      cancelText: "No",
      danger: false,
    });
    if (!ok) return;

    const rid = reservaIdOf(r);
    if (!rid) return;

    try {
      await http(`/api/reservas/${rid}/user-confirm`, {
        method: "PATCH",
        data: { action },
        auth: true,
      });
      await cargarReservas();
    } catch (e) {
      console.error("Error actualizando reserva (user-confirm)", e);
      ui.notify({ type: "error", message: "No se pudo actualizar la reserva." });
    }
  };

  // Chat
  const handleOpenChat = async (r) => {
    const rid = reservaIdOf(r);
    if (!rid) return;
    if (openingChatId === rid) return;

    try {
      setOpeningChatId(rid);

      const resp = await http(`/api/chats/by-reserva/${rid}`, {
        method: "POST",
        auth: true,
      });

      const conversationId = resp?.conversationId || resp?.id;
      if (!conversationId) {
        ui.notify({
          type: "error",
          message: "No se pudo abrir el chat (no se recibió conversationId).",
        });
        return;
      }

      navigate(`/chat/${conversationId}`, { state: { from: "/reservas" } });
    } catch (e) {
      console.error("Error abriendo chat:", e);
      const msg =
        e?.data?.error ||
        e?.responseData?.error ||
        e?.message ||
        "No se pudo abrir el chat para esta reserva.";
      ui.notify({ type: "error", message: msg });
    } finally {
      setOpeningChatId(null);
    }
  };

  // Notas
  const loadNotes = async (reservaId) => {
    if (!reservaId) return;
    setLoadingNotes(true);
    try {
      const data = await http(`/api/reservas/${reservaId}/notes`, { auth: true });
      setNotes(Array.isArray(data) ? data : data?.items || []);
    } catch (e) {
      console.error("Error cargando notas", e);
      setNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleToggleNotes = (r) => {
    const rid = reservaIdOf(r);
    if (!rid) return;

    if (openNotesId === rid) {
      setOpenNotesId(null);
      setNotes([]);
      setNewNote("");
      return;
    }

    setOpenNotesId(rid);
    setNewNote("");
    loadNotes(rid);
  };

  const handleAddNote = async () => {
    if (!openNotesId || !newNote.trim()) return;
    try {
      await http(`/api/reservas/${openNotesId}/notes`, {
        method: "POST",
        data: {
          text: newNote.trim(),
          nota: newNote.trim(),
          userNote: newNote.trim(),
        },
        auth: true,
      });
      setNewNote("");
      await loadNotes(openNotesId);
    } catch (e) {
      console.error("Error guardando nota", e);
      ui.notify({
        type: "error",
        message: "No se pudo guardar la nota (revisa qué campo espera el backend).",
      });
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!openNotesId || !noteId) return;

    const ok = await ui.confirm({
      title: "Eliminar nota",
      message: "¿Eliminar esta nota?",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    try {
      await http(`/api/reservas/${openNotesId}/notes/${noteId}`, {
        method: "DELETE",
        auth: true,
      });
      await loadNotes(openNotesId);
    } catch (e) {
      console.error("Error eliminando nota", e);
      ui.notify({
        type: "error",
        message:
          "No se pudo eliminar la nota (si el backend no tiene DELETE, se puede quitar este botón).",
      });
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="card contratar-page">
        <h1>Reservas</h1>
        <p>Necesitas iniciar sesión para ver tus reservas.</p>
      </div>
    );
  }

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
      <p className="reservas-subtitle">
        Consulta tu calendario de reservas, gestiona su estado y abre el chat asociado desde
        cada reserva.
      </p>

      <div
        style={{
          marginTop: 10,
          marginBottom: 14,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(0,0,0,0.08)",
          background: "rgba(255, 165, 0, 0.10)",
          fontSize: 14,
        }}
      >
        ⚠️ <b>Cancelaciones:</b> solo es posible cancelar una reserva con más de <b>24 horas</b>{" "}
        de antelación.
      </div>

      {/* Buscador */}
      <div className="reservas-search">
        <input
          type="search"
          placeholder="Buscar por servicio, perro, fecha o estado…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Calendario */}
      <section className="month-scheduler" style={{ marginBottom: 32 }}>
        <div className="month-header">
          <button
            className="btn-ghost"
            type="button"
            onClick={() =>
              setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() - 1, 1))
            }
          >
            ‹
          </button>

          <div className="month-label">
            Calendario de reservas ·{" "}
            {mesBase.toLocaleString("es-ES", { month: "long", year: "numeric" })}
          </div>

          <button
            className="btn-ghost"
            type="button"
            onClick={() =>
              setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() + 1, 1))
            }
          >
            ›
          </button>
        </div>

        <div className="weekdays">
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        <div className="month-grid">
          {(() => {
            const first = new Date(mesBase.getFullYear(), mesBase.getMonth(), 1);
            const startOffset = (first.getDay() + 6) % 7; // lunes=0
            const lastDay = new Date(mesBase.getFullYear(), mesBase.getMonth() + 1, 0).getDate();
            const cells = [];

            for (let i = 0; i < 42; i++) {
              const dayNum = i - startOffset + 1;
              const inMonth = dayNum >= 1 && dayNum <= lastDay;

              let f = "";
              let isSelected = false;
              let hasReserva = false;

              if (inMonth) {
                const d = new Date(mesBase.getFullYear(), mesBase.getMonth(), dayNum);
                f = ymd(d);
                isSelected = f === selectedDate;
                hasReserva = fechasConReservas.has(f);
              }

              cells.push(
                <button
                  key={i}
                  type="button"
                  className={`daycell ${inMonth ? "" : "out"} ${isSelected ? "selected" : ""} ${
                    hasReserva ? "has-reserva" : ""
                  }`}
                  onClick={() => {
                    if (!inMonth) return;
                    setSelectedDate(f === selectedDate ? "" : f);
                  }}
                  disabled={!inMonth}
                >
                  {inMonth ? dayNum : ""}
                </button>
              );
            }
            return cells;
          })()}
        </div>

        <div className="month-legend">
          <span>
            <span className="legend-dot legend-dot--pending" /> Pendiente
          </span>
          <span>
            <span className="legend-dot legend-dot--confirmed" /> Confirmada
          </span>
          <span>
            <span className="legend-dot legend-dot--cancelled" /> Cancelada / rechazada
          </span>
        </div>

        {selectedDate && (
          <div className="month-selected">
            <strong>Reservas del día: {renderFecha(selectedDate)}</strong>

            {reservasDelDiaSeleccionado.length === 0 ? (
              <p className="reservas-empty">No tienes reservas ese día.</p>
            ) : (
              <div className="reservas-list reservas-list--day">
                {reservasDelDiaSeleccionado.map((r) => {
                  const rid = reservaIdOf(r);
                  return (
                    <ReservaCard
                      key={rid}
                      r={r}
                      onCancel={handleCancel}
                      onToggleNotes={handleToggleNotes}
                      onUserDecision={handleUserDecision}
                      onOpenChat={handleOpenChat}
                      openingChatId={openingChatId}
                      isNotesOpen={openNotesId === rid}
                      notes={notes}
                      loadingNotes={loadingNotes}
                      newNote={newNote}
                      onChangeNote={setNewNote}
                      onAddNote={handleAddNote}
                      onDeleteNote={handleDeleteNote}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Listas por estado */}
      <section className="reservas-section">
        <h2>Pendientes por confirmar por el centro</h2>
        {pendientesCentro.length === 0 ? (
          <p className="reservas-empty">No tienes reservas pendientes de centro.</p>
        ) : (
          <div className="reservas-list">
            {pendientesCentro.map((r) => {
              const rid = reservaIdOf(r);
              return (
                <ReservaCard
                  key={rid}
                  r={r}
                  onCancel={handleCancel}
                  onToggleNotes={handleToggleNotes}
                  onUserDecision={handleUserDecision}
                  onOpenChat={handleOpenChat}
                  openingChatId={openingChatId}
                  isNotesOpen={openNotesId === rid}
                  notes={notes}
                  loadingNotes={loadingNotes}
                  newNote={newNote}
                  onChangeNote={setNewNote}
                  onAddNote={handleAddNote}
                  onDeleteNote={handleDeleteNote}
                />
              );
            })}
          </div>
        )}
      </section>

      {pendientesUsuario.length > 0 && (
        <section className="reservas-section">
          <h2>Pendientes (histórico)</h2>
          <div className="reservas-list">
            {pendientesUsuario.map((r) => {
              const rid = reservaIdOf(r);
              return (
                <ReservaCard
                  key={rid}
                  r={r}
                  onCancel={handleCancel}
                  onToggleNotes={handleToggleNotes}
                  onUserDecision={handleUserDecision}
                  onOpenChat={handleOpenChat}
                  openingChatId={openingChatId}
                  isNotesOpen={openNotesId === rid}
                  notes={notes}
                  loadingNotes={loadingNotes}
                  newNote={newNote}
                  onChangeNote={setNewNote}
                  onAddNote={handleAddNote}
                  onDeleteNote={handleDeleteNote}
                />
              );
            })}
          </div>
        </section>
      )}

      <section className="reservas-section">
        <h2>Confirmadas</h2>
        {confirmadasFuturas.length === 0 ? (
          <p className="reservas-empty">No tienes reservas confirmadas próximas.</p>
        ) : (
          <div className="reservas-list">
            {confirmadasFuturas.map((r) => {
              const rid = reservaIdOf(r);
              return (
                <ReservaCard
                  key={rid}
                  r={r}
                  onCancel={handleCancel}
                  onToggleNotes={handleToggleNotes}
                  onUserDecision={handleUserDecision}
                  onOpenChat={handleOpenChat}
                  openingChatId={openingChatId}
                  isNotesOpen={openNotesId === rid}
                  notes={notes}
                  loadingNotes={loadingNotes}
                  newNote={newNote}
                  onChangeNote={setNewNote}
                  onAddNote={handleAddNote}
                  onDeleteNote={handleDeleteNote}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="reservas-section">
        <h2>Reservas pasadas</h2>
        {pasadasConfirmadas.length === 0 ? (
          <p className="reservas-empty">No tienes reservas pasadas.</p>
        ) : (
          <div className="reservas-list">
            {pasadasConfirmadas.map((r) => {
              const rid = reservaIdOf(r);
              return <ReservaCard key={rid} r={r} readOnly />;
            })}
          </div>
        )}
      </section>

      <section className="reservas-section">
        <h2>Canceladas / Rechazadas</h2>
        {canceladasRechazadas.length === 0 ? (
          <p className="reservas-empty">No tienes reservas canceladas ni rechazadas.</p>
        ) : (
          <div className="reservas-list">
            {canceladasRechazadas.map((r) => {
              const rid = reservaIdOf(r);
              return (
                <ReservaCard
                  key={rid}
                  r={r}
                  onCancel={handleCancel}
                  onToggleNotes={handleToggleNotes}
                  onUserDecision={handleUserDecision}
                  onOpenChat={handleOpenChat}
                  openingChatId={openingChatId}
                  isNotesOpen={openNotesId === rid}
                  notes={notes}
                  loadingNotes={loadingNotes}
                  newNote={newNote}
                  onChangeNote={setNewNote}
                  onAddNote={handleAddNote}
                  onDeleteNote={handleDeleteNote}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
