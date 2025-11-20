// frontend/src/pages/reservas/reservasUser.jsx
import { useEffect, useMemo, useState } from 'react';
import { http } from '../../helpers/http';
import { useAuth } from '../../context/auth';
import '../../styles/contratar.scss'; // reutilizamos estilos de botones / card

// ==== utilidades básicas ====
function formatEUR(value, currency = 'EUR') {
  if (value == null) return 'A consultar';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayYMD() {
  return ymd(new Date());
}

function renderFecha(fecha) {
  if (!fecha) return '';
  try {
    const d = new Date(fecha);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('es-ES', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
  } catch {
    // ignore
  }
  return fecha;
}

function renderPerro(perro) {
  if (!perro) return '(sin datos)';
  if (typeof perro === 'string') {
    // Intentamos parsear JSON, si falla mostramos el string
    try {
      const obj = JSON.parse(perro);
      return renderPerro(obj);
    } catch {
      return perro;
    }
  }
  if (typeof perro === 'object') {
    const nombre = perro.nombre || perro.name;
    const raza = perro.razaTamaño || perro.raza || '';
    const edad = perro.edad ? `${perro.edad} años` : '';
    const castrado = perro.castrado ? 'castrado' : '';
    const parts = [nombre, raza, edad, castrado].filter(Boolean);
    return parts.length ? parts.join(' · ') : '(sin datos)';
  }
  return String(perro);
}

function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending' || s === 'pendiente') return 'Pending';
  if (s === 'confirmed' || s === 'confirmada') return 'Confirmed';
  if (s === 'cancelled' || s === 'cancelada') return 'Cancelled';
  if (s === 'rejected' || s === 'rechazada') return 'Rejected';
  if (s === 'pending_user') return 'Pendiente (tu aceptación)';
  return s || 'Estado';
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending' || s === 'pendiente') return 'badge badge-pending';
  if (s === 'confirmed' || s === 'confirmada') return 'badge badge-confirmed';
  if (s === 'cancelled' || s === 'cancelada') return 'badge badge-cancelled';
  if (s === 'rejected' || s === 'rechazada') return 'badge badge-rejected';
  if (s === 'pending_user') return 'badge badge-pending';
  return 'badge';
}

// ==== card de reserva ====
function ReservaCard({ r, onCancel, onToggleNotes, onUserDecision }) {
  const normalizedStatus = String(r.status || '').toLowerCase();

  const puedeCancelar =
    normalizedStatus === 'pending' ||
    normalizedStatus === 'confirmada' ||
    normalizedStatus === 'confirmed' ||
    normalizedStatus === 'pending_user';

  const puedeAceptarRechazar = normalizedStatus === 'pending_user';

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
            {r.servicioTitulo || r.servicioId || 'Reserva'}
          </div>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            <b>Fecha:</b> {r.fecha} · <b>Hora:</b> {r.hora}{' '}
            {r.modalidad && (
              <>
                · <i>{r.modalidad}</i>
              </>
            )}
          </div>
          {r.perro && (
            <div style={{ fontSize: 14, marginTop: 2 }}>
              <b>Perro:</b> {renderPerro(r.perro)}
            </div>
          )}
          {r.price != null && (
            <div style={{ fontSize: 14, marginTop: 2 }}>
              <b>Precio:</b> {formatEUR(r.price, r.currency || 'EUR')}
            </div>
          )}
          {r.adminNote && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <b>Nota centro:</b> {r.adminNote}
            </div>
          )}
          {r.cancelReason && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <b>Motivo cancelación:</b> {r.cancelReason}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={statusClass(r.status)}>{statusLabel(r.status)}</span>
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={() => onToggleNotes(r)}>
          📝 Notas
        </button>

        {puedeAceptarRechazar && (
          <>
            <button
              className="btn-primary"
              onClick={() => onUserDecision?.(r, 'confirm')}
            >
              Aceptar
            </button>
            <button
              className="btn-outline"
              onClick={() => onUserDecision?.(r, 'reject')}
            >
              Rechazar
            </button>
          </>
        )}

        {puedeCancelar && (
          <button className="btn-outline" onClick={() => onCancel(r)}>
            Cancelar reserva
          </button>
        )}
      </div>
    </div>
  );
}

// ==== componente principal ====
export default function ReservasUser() {
  const { isAuthenticated } = useAuth();
  const [reservas, setReservas] = useState([]);
  const [loading, setLoading] = useState(true);

  // calendario
  const [mesBase, setMesBase] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(todayYMD());

  // notas
  const [openNotesId, setOpenNotesId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');

  const cargarReservas = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const data = await http('/api/reservas/mias', { auth: true });
      const arr = Array.isArray(data) ? data : data?.items || [];
      setReservas(arr);
    } catch (e) {
      console.error('Error cargando reservas', e);
      setReservas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarReservas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // mapa de días con reservas (YYYY-MM-DD)
  const fechasConReservas = useMemo(() => {
    const map = new Map();
    for (const r of reservas) {
      if (!r.fecha) continue;
      const f = String(r.fecha).slice(0, 10);
      const list = map.get(f) || [];
      list.push(r);
      map.set(f, list);
    }
    return map;
  }, [reservas]);

  const reservasDelDiaSeleccionado = useMemo(() => {
    if (!selectedDate) return [];
    return fechasConReservas.get(selectedDate) || [];
  }, [fechasConReservas, selectedDate]);

  // agrupación básica por estado
  const pendientesCentro = useMemo(
    () =>
      reservas.filter((r) => {
        const s = String(r.status || '').toLowerCase();
        return s === 'pending' || s === 'pendiente';
      }),
    [reservas]
  );

  // nuevas pendientes para el usuario (pending_user)
  const pendientesUsuario = useMemo(
    () =>
      reservas.filter((r) => {
        const s = String(r.status || '').toLowerCase();
        return s === 'pending_user';
      }),
    [reservas]
  );

  const confirmadas = useMemo(
    () =>
      reservas.filter((r) => {
        const s = String(r.status || '').toLowerCase();
        return s === 'confirmed' || s === 'confirmada';
      }),
    [reservas]
  );

  const canceladasRechazadas = useMemo(
    () =>
      reservas.filter((r) => {
        const s = String(r.status || '').toLowerCase();
        return (
          s === 'cancelled' ||
          s === 'cancelada' ||
          s === 'rejected' ||
          s === 'rechazada'
        );
      }),
    [reservas]
  );

  // cancelar reserva
  const handleCancel = async (r) => {
    if (!window.confirm(`¿Cancelar la reserva del ${r.fecha} a las ${r.hora}?`)) return;
    try {
      await http(`/api/reservas/${r.id}/cancel`, {
        method: 'PATCH',
        data: { reason: 'Cancelada por el cliente' },
        auth: true,
      });
      await cargarReservas();
    } catch (e) {
      console.error('Error cancelando reserva', e);
      alert('No se pudo cancelar la reserva.');
    }
  };

  // aceptar / rechazar cuando está en pending_user
  const handleUserDecision = async (r, action) => {
    const verb = action === 'confirm' ? 'aceptar' : 'rechazar';
    if (!window.confirm(`¿Seguro que quieres ${verb} la reserva del ${r.fecha} a las ${r.hora}?`)) {
      return;
    }
    try {
      await http(`/api/reservas/${r.id}/user-confirm`, {
        method: 'PATCH',
        data: { action },
        auth: true,
      });
      await cargarReservas();
    } catch (e) {
      console.error('Error actualizando reserva (user-confirm)', e);
      alert('No se pudo actualizar la reserva.');
    }
  };

  // notas
  const loadNotes = async (reserva) => {
    setLoadingNotes(true);
    try {
      const data = await http(`/api/reservas/${reserva.id}/notes`, { auth: true });
      setNotes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Error cargando notas', e);
      setNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleToggleNotes = (r) => {
    if (openNotesId === r.id) {
      setOpenNotesId(null);
      setNotes([]);
      setNewNote('');
      return;
    }
    setOpenNotesId(r.id);
    setNewNote('');
    loadNotes(r);
  };

  const handleAddNote = async () => {
    if (!openNotesId || !newNote.trim()) return;
    try {
      await http(`/api/reservas/${openNotesId}/notes`, {
        method: 'POST',
        data: { text: newNote.trim() },
        auth: true,
      });
      setNewNote('');
      await loadNotes({ id: openNotesId });
    } catch (e) {
      console.error('Error creando nota', e);
      alert('No se pudo guardar la nota.');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="card contratar-page">
        <h1>Mis reservas</h1>
        <p>Necesitas iniciar sesión para ver tus reservas.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card contratar-page">
        <h1>Mis reservas</h1>
        <p>Cargando…</p>
      </div>
    );
  }

  // ==== render ====
  return (
    <div className="card contratar-page">
      <h1>Mis reservas</h1>
      <p style={{ marginBottom: 24 }}>
        Recuerda: puedes cancelar sin coste hasta 24 horas antes de la cita.
      </p>

      {/* ==== Calendario resumen ==== */}
      <section className="month-scheduler" style={{ marginBottom: 32 }}>
        <div className="month-header">
          <button
            className="btn-ghost"
            onClick={() =>
              setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() - 1, 1))
            }
          >
            ‹
          </button>
          <div className="month-label">
            {mesBase.toLocaleString('es-ES', {
              month: 'long',
              year: 'numeric',
            })}
          </div>
          <button
            className="btn-ghost"
            onClick={() =>
              setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() + 1, 1))
            }
          >
            ›
          </button>
        </div>

        <div className="weekdays">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        <div className="month-grid">
          {(() => {
            const first = new Date(mesBase.getFullYear(), mesBase.getMonth(), 1);
            const startOffset = (first.getDay() + 6) % 7; // lunes = 0
            const lastDay = new Date(
              mesBase.getFullYear(),
              mesBase.getMonth() + 1,
              0
            ).getDate();
            const cells = [];
            for (let i = 0; i < 42; i++) {
              const dayNum = i - startOffset + 1;
              const inMonth = dayNum >= 1 && dayNum <= lastDay;
              let f = '';
              let disabled = true;
              let isSelected = false;
              let hasReserva = false;

              if (inMonth) {
                const d = new Date(mesBase.getFullYear(), mesBase.getMonth(), dayNum);
                f = ymd(d);
                // en la vista de usuario no bloqueamos finde, solo mostramos
                disabled = false;
                isSelected = f === selectedDate;
                hasReserva = fechasConReservas.has(f); // 👈 marcar si hay reservas ese día
              }

              cells.push(
                <button
                  key={i}
                  type="button"
                  className={`daycell ${inMonth ? '' : 'out'} ${
                    disabled ? 'disabled' : ''
                  } ${isSelected ? 'selected' : ''} ${
                    hasReserva ? 'has-reserva' : ''
                  }`}
                  onClick={() => {
                    if (!inMonth || disabled) return;
                    setSelectedDate(f === selectedDate ? '' : f);
                  }}
                  disabled={!inMonth || disabled}
                >
                  {inMonth ? dayNum : ''}
                </button>
              );
            }
            return cells;
          })()}
        </div>

        {selectedDate && (
          <div style={{ marginTop: 12 }}>
            <strong>
              Reservas del día: {renderFecha(selectedDate)}
            </strong>
            {reservasDelDiaSeleccionado.length === 0 ? (
              <p style={{ fontSize: 14, marginTop: 4 }}>No tienes reservas ese día.</p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {reservasDelDiaSeleccionado.map((r) => (
                  <ReservaCard
                    key={r.id}
                    r={r}
                    onCancel={handleCancel}
                    onToggleNotes={handleToggleNotes}
                    onUserDecision={handleUserDecision}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ==== Listas por estado ==== */}
      <section style={{ marginBottom: 32 }}>
        <h2>Pendientes (confirmación del centro)</h2>
        {pendientesCentro.length === 0 ? (
          <div className="card" style={{ background: '#f7f7f7', marginTop: 8 }}>
            Sin registros.
          </div>
        ) : (
          pendientesCentro.map((r) => (
            <ReservaCard
              key={r.id}
              r={r}
              onCancel={handleCancel}
              onToggleNotes={handleToggleNotes}
              onUserDecision={handleUserDecision}
            />
          ))
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Pendientes (tu aceptación)</h2>
        {pendientesUsuario.length === 0 ? (
          <div className="card" style={{ background: '#f7f7f7', marginTop: 8 }}>
            Sin registros.
          </div>
        ) : (
          pendientesUsuario.map((r) => (
            <ReservaCard
              key={r.id}
              r={r}
              onCancel={handleCancel}
              onToggleNotes={handleToggleNotes}
              onUserDecision={handleUserDecision}
            />
          ))
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Confirmadas</h2>
        {confirmadas.length === 0 ? (
          <div className="card" style={{ background: '#f7f7f7', marginTop: 8 }}>
            Sin registros.
          </div>
        ) : (
          confirmadas.map((r) => (
            <ReservaCard
              key={r.id}
              r={r}
              onCancel={handleCancel}
              onToggleNotes={handleToggleNotes}
              onUserDecision={handleUserDecision}
            />
          ))
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Canceladas / Rechazadas</h2>
        {canceladasRechazadas.length === 0 ? (
          <div className="card" style={{ background: '#f7f7f7', marginTop: 8 }}>
            Sin registros.
          </div>
        ) : (
          canceladasRechazadas.map((r) => (
            <ReservaCard
              key={r.id}
              r={r}
              onCancel={handleCancel}
              onToggleNotes={handleToggleNotes}
              onUserDecision={handleUserDecision}
            />
          ))
        )}
      </section>

      {/* ==== Panel de notas (simple) ==== */}
      {openNotesId && (
        <section style={{ marginTop: 16 }}>
          <h3>Notas de la reserva seleccionada</h3>
          {loadingNotes ? (
            <p>Cargando notas…</p>
          ) : notes.length === 0 ? (
            <p style={{ fontSize: 14 }}>No hay notas todavía.</p>
          ) : (
            <ul style={{ fontSize: 14, paddingLeft: 16 }}>
              {notes.map((n) => (
                <li key={n.id}>
                  <b>{n.author}:</b> {n.text}{' '}
                  <span style={{ opacity: 0.7 }}>
                    ({new Date(n.createdAt).toLocaleString('es-ES')})
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1 }}
              placeholder="Escribe una nota…"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
            />
            <button className="btn-primary" onClick={handleAddNote} disabled={!newNote.trim()}>
              Añadir
            </button>
            <button
              className="btn-outline"
              onClick={() => {
                setOpenNotesId(null);
                setNotes([]);
                setNewNote('');
              }}
            >
              Cerrar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
