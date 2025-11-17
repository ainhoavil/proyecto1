// frontend/src/pages/reservas/reservasAdmin.jsx
import { useEffect, useMemo, useState } from 'react';
import { http } from '../../helpers/http';
import { useAuth } from '../../context/auth';
import '../../styles/contratar.scss';

import {
  first,
  normList,
  HOURS,
  serverErrMsg,
  serializeErr,
} from '../../helpers/reservas';

/* ===================== Utils ===================== */

// tiempo relativo tipo "hace 5 min"
function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return 'justo ahora';
  if (sec < 60) return `hace ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dDays = Math.floor(h / 24);
  if (dDays === 1) return 'hace 1 día';
  if (dDays < 7) return `hace ${dDays} días`;
  const w = Math.floor(dDays / 7);
  if (w === 1) return 'hace 1 semana';
  if (w < 5) return `hace ${w} semanas`;
  const m = Math.floor(dDays / 30);
  if (m === 1) return 'hace 1 mes';
  if (m < 12) return `hace ${m} meses`;
  const y = Math.floor(dDays / 365);
  if (y === 1) return 'hace 1 año';
  return `hace ${y} años`;
}

/* ===================== Componente ===================== */

export default function ReservasAdmin() {
  const { user } = useAuth();

  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState('');

  const [adminList, setAdminList] = useState([]);
  const [adminFilterEmail, setAdminFilterEmail] = useState('');
  const [adminLimit, setAdminLimit] = useState(300);

  const [notice, setNotice] = useState({ type: '', text: '' });
  const [trace, setTrace] = useState(null);

  const showSuccess = (t) => setNotice({ type: 'success', text: t });
  const showError = (t) => setNotice({ type: 'error', text: t });
  const clearNotice = () => setNotice({ type: '', text: '' });
  const setTraceErr = (obj) =>
    setTrace({ time: new Date().toISOString(), ...obj });

  /* ===== Notas (hilo) por reserva ===== */
  const [notesByRes, setNotesByRes] = useState({});
  const [noteDraftByRes, setNoteDraftByRes] = useState({});
  const [notesOpen, setNotesOpen] = useState({});

  const loadNotes = async (id) => {
    try {
      const rows = await http(`/api/reservas/${id}/notes`, { auth: true });
      const arr = Array.isArray(rows) ? rows : [];
      setNotesByRes((p) => ({
        ...p,
        [id]: [...arr].reverse(),
      }));
    } catch (e) {
      setNotesByRes((p) => ({ ...p, [id]: [] }));
      setTraceErr({
        action: 'GET /api/reservas/:id/notes',
        id,
        error: serializeErr(e),
      });
    }
  };

  const addNote = async (id) => {
    const txt = (noteDraftByRes[id] || '').trim();
    if (!txt) return;
    try {
      const n = await http(`/api/reservas/${id}/notes`, {
        method: 'POST',
        data: { text: txt },
        auth: true,
      });
      setNoteDraftByRes((p) => ({ ...p, [id]: '' }));
      setNotesByRes((p) => ({
        ...p,
        [id]: [...(p[id] || []), n],
      }));
      showSuccess('Nota añadida');
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo añadir la nota'));
      setTraceErr({
        action: 'POST /api/reservas/:id/notes',
        id,
        error: serializeErr(e),
      });
    }
  };

  const deleteNote = async (id, noteId) => {
    try {
      await http(`/api/reservas/${id}/notes/${noteId}`, {
        method: 'DELETE',
        auth: true,
      });
      setNotesByRes((p) => ({
        ...p,
        [id]: (p[id] || []).filter((n) => n.id !== noteId),
      }));
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo borrar la nota'));
      setTraceErr({
        action: 'DELETE /api/reservas/:id/notes/:noteId',
        id,
        noteId,
        error: serializeErr(e),
      });
    }
  };

  const toggleNotes = async (r) => {
    const isOpen = !!notesOpen[r.id];
    const next = { ...notesOpen, [r.id]: !isOpen };
    setNotesOpen(next);
    if (!isOpen && !notesByRes[r.id]) {
      await loadNotes(r.id);
    }
  };

  /* ===== Servicios ===== */
  const loadServicios = async () => {
    try {
      const list = await http('/api/servicios');
      const arr = Array.isArray(list) ? list : list?.items || list?.data || [];
      setServicios(arr);
      if (arr.length && !servicioId) {
        setServicioId(first(arr[0].id, arr[0]._id, arr[0].uuid));
      }
    } catch (e) {
      setServicios([]);
      setTraceErr({ action: 'GET /api/servicios', error: serializeErr(e) });
    }
  };

  /* ===== Listado admin ===== */
  const cargarAdminList = async () => {
    try {
      clearNotice();
      const qs = new URLSearchParams({
        limit: String(adminLimit || 300),
        ...(adminFilterEmail ? { email: adminFilterEmail.trim() } : {}),
      });
      const data = await http(`/api/reservas?${qs.toString()}`, { auth: true });
      const list = normList(data?.items || data?.reservas || data || []);
      setAdminList(list);
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo obtener reservas'));
      setTraceErr({
        action: 'GET admin list',
        url: '/api/reservas',
        error: serializeErr(e),
      });
    }
  };

  /* ===== Acciones admin sobre reservas ===== */
  const confirmar = async (id) => {
    try {
      await http(`/api/reservas/${id}/confirm`, {
        method: 'PATCH',
        auth: true,
      });
      showSuccess('Reserva confirmada');
      await cargarAdminList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo confirmar'));
      setTraceErr({ action: 'PATCH confirm', id, error: serializeErr(e) });
    }
  };

  const rechazar = async (id) => {
    try {
      await http(`/api/reservas/${id}/reject`, {
        method: 'PATCH',
        auth: true,
      });
      showSuccess('Reserva rechazada');
      await cargarAdminList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo rechazar'));
      setTraceErr({ action: 'PATCH reject', id, error: serializeErr(e) });
    }
  };

  const eliminar = async (id) => {
    try {
      await http(`/api/reservas/${id}`, { method: 'DELETE', auth: true });
      showSuccess('Reserva eliminada');
      await cargarAdminList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo eliminar'));
      setTraceErr({ action: 'DELETE reserva', id, error: serializeErr(e) });
    }
  };

  /* ===== Bloquear hora / crear para email ===== */

  const [quickFecha, setQuickFecha] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  // quickHora robusto: soporta HOURS numérico o string
  const [quickHora, setQuickHora] = useState(() => {
    const firstH = HOURS?.[0];
    if (typeof firstH === 'number') {
      return `${String(firstH).padStart(2, '0')}:00`;
    }
    if (typeof firstH === 'string') {
      return firstH;
    }
    return '09:00';
  });

  const [quickEmail, setQuickEmail] = useState('');
  const [quickMod, setQuickMod] = useState('presencial');

  const bloquear = async () => {
    try {
      await http('/api/reservas/bloqueos', {
        method: 'POST',
        data: {
          fecha: quickFecha,
          hora: quickHora,
          motivo: 'Bloqueo manual',
          servicioId,
        },
        auth: true,
      });
      showSuccess('Hora bloqueada');
      await cargarAdminList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo bloquear la hora'));
      setTraceErr({ action: 'POST bloquear', error: serializeErr(e) });
    }
  };

  const reservarParaEmail = async () => {
    if (!/\S+@\S+\.\S+/.test(quickEmail)) {
      showError('Email inválido');
      return;
    }
    try {
      await http('/api/reservas/admin', {
        method: 'POST',
        data: {
          email: quickEmail.trim(),
          fecha: quickFecha,
          hora: quickHora,
          servicioId,
          modalidad: quickMod,
          status: 'pending',
        },
        auth: true,
      });
      showSuccess(`Reserva creada para ${quickEmail.trim()}`);
      setQuickEmail('');
      await cargarAdminList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo crear la reserva'));
      setTraceErr({ action: 'POST crear para email', error: serializeErr(e) });
    }
  };

  /* ===== Buckets UI ===== */
  const adminBuckets = useMemo(() => {
    const pendingAdminConfirm = [];
    const pendingUserAccept = [];
    const confirmed = [];
    const cancelled = [];

    for (const r of adminList) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'pending' || s === 'pendiente') {
        if (r.origin === 'admin') pendingUserAccept.push(r);
        else pendingAdminConfirm.push(r);
      } else if (s === 'confirmed' || s === 'confirmada') {
        confirmed.push(r);
      } else if (
        ['cancelled', 'rejected', 'deleted', 'cancelada', 'rechazada', 'eliminada'].includes(s)
      ) {
        cancelled.push(r);
      }
    }

    const sortByDT = (arr) =>
      [...arr].sort((a, b) =>
        (`${a.fecha || ''} ${a.hora || ''}`).localeCompare(
          `${b.fecha || ''} ${b.hora || ''}`
        )
      );

    return {
      pendingAdminConfirm: sortByDT(pendingAdminConfirm),
      pendingUserAccept: sortByDT(pendingUserAccept),
      confirmed: sortByDT(confirmed),
      cancelled: sortByDT(cancelled),
    };
  }, [adminList]);

  useEffect(() => {
    loadServicios();
    cargarAdminList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="reservas-admin">
      {notice.text && (
        <div className={`notice ${notice.type}`}>{notice.text}</div>
      )}

      {trace && (
        <details open className="trace" style={{ marginTop: 10 }}>
          <summary>🪵 Diagnóstico</summary>
          <pre>{JSON.stringify(trace, null, 2)}</pre>
        </details>
      )}

      {/* Herramientas rápidas */}
      <section className="admin-tools" style={{ marginTop: 16 }}>
        <h2>Acciones rápidas (admin)</h2>
        <div
          className="admin-grid"
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          }}
        >
          <label>
            Fecha
            <input
              type="date"
              value={quickFecha}
              onChange={(e) => setQuickFecha(e.target.value)}
            />
          </label>
          <label>
            Hora
            <select
              value={quickHora}
              onChange={(e) => setQuickHora(e.target.value)}
            >
              {HOURS.map((h) => {
                const t =
                  typeof h === 'number'
                    ? `${String(h).padStart(2, '0')}:00`
                    : String(h);
                return (
                  <option key={t} value={t}>
                    {t}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Servicio
            <select
              value={servicioId}
              onChange={(e) => setServicioId(e.target.value)}
            >
              {servicios.map((s) => {
                const sid = first(s.id, s._id, s.uuid);
                const title = first(s.title, s.titulo, s.name, 'Servicio');
                return (
                  <option key={sid} value={sid}>
                    {title}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Modalidad
            <select
              value={quickMod}
              onChange={(e) => setQuickMod(e.target.value)}
            >
              <option value="presencial">Presencial</option>
              <option value="online">Online</option>
              <option value="a domicilio">A domicilio</option>
            </select>
          </label>
          <div
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
          >
            <button className="btn-danger" onClick={bloquear}>
              Bloquear hora
            </button>
          </div>
          <label>
            Email (reservar para…)
            <input
              type="email"
              placeholder="cliente@ejemplo.com"
              value={quickEmail}
              onChange={(e) => setQuickEmail(e.target.value)}
            />
          </label>
          <div
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
          >
            <button className="btn-primary" onClick={reservarParaEmail}>
              Crear reserva
            </button>
          </div>
        </div>
      </section>

      {/* Listas por estado */}
      <section style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            marginBottom: 10,
            flexWrap: 'wrap',
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={adminFilterEmail}
              onChange={(e) => setAdminFilterEmail(e.target.value)}
              placeholder="(opcional)"
            />
          </label>
          <label>
            Límite
            <input
              type="number"
              min={50}
              max={1000}
              value={adminLimit}
              onChange={(e) =>
                setAdminLimit(Number(e.target.value || 300))
              }
              style={{ width: 100 }}
            />
          </label>
          <button className="btn-ghost" onClick={cargarAdminList}>
            Actualizar
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
          }}
        >
          {[
            {
              title: 'Pendientes (confirmación del admin)',
              items: adminBuckets.pendingAdminConfirm,
              actions: true,
            },
            {
              title: 'Pendientes (aceptación del usuario)',
              items: adminBuckets.pendingUserAccept,
              actions: false,
            },
            {
              title: 'Confirmadas',
              items: adminBuckets.confirmed,
              actions: false,
            },
            {
              title: 'Canceladas / Rechazadas',
              items: adminBuckets.cancelled,
              actions: false,
            },
          ].map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              {!group.items.length ? (
                <div className="empty">Sin registros.</div>
              ) : (
                <ul className="reservas-list">
                  {group.items.map((r) => {
                    const isOpen = !!notesOpen[r.id];
                    const notes = notesByRes[r.id] || [];

                    return (
                      <li key={r.id} className="reserva-item">
                        <div className="reserva-main">
                          <div className="title">
                            {r.servicioTitulo || 'Servicio'}
                          </div>
                          <div className="meta">
                            <b>De:</b> {r.email} · {r.fecha} · {r.hora} ·{' '}
                            <i>{r.modalidad}</i>
                          </div>
                        </div>

                        <div className={`badge ${r.status}`}>
                          {r.status}
                        </div>

                        <div
                          style={{
                            gridColumn: '1 / -1',
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            marginTop: 6,
                          }}
                        >
                          <button
                            className="btn-ghost"
                            onClick={() => toggleNotes(r)}
                          >
                            📝 Notas{' '}
                            {notes.length ? `(${notes.length})` : ''}
                          </button>
                        </div>

                        {isOpen && (
                          <div
                            className="notes-box"
                            style={{
                              gridColumn: '1 / -1',
                              border: '1px solid #e5e7eb',
                              borderRadius: 10,
                              padding: 10,
                              background: '#fafbfc',
                              marginTop: 6,
                            }}
                          >
                            <div
                              className="notes-list"
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                maxHeight: 220,
                                overflowY: 'auto',
                                paddingRight: 4,
                              }}
                            >
                              {notes.length === 0 ? (
                                <div className="empty">
                                  Sin notas aún.
                                </div>
                              ) : (
                                notes.map((n) => (
                                  <div
                                    key={n.id}
                                    className="note-item"
                                    style={{
                                      background: '#fff',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 8,
                                      padding: 8,
                                      display: 'grid',
                                      gridTemplateColumns: '1fr auto',
                                      gap: 6,
                                    }}
                                  >
                                    <div
                                      className="note-meta"
                                      style={{
                                        fontSize: 12,
                                        color: '#6b7280',
                                        gridColumn: '1 / span 2',
                                      }}
                                    >
                                      <b>
                                        {n.author === 'admin'
                                          ? 'Adiestrador'
                                          : 'Usuario'}
                                      </b>{' '}
                                      · {relativeTime(n.createdAt)}
                                    </div>
                                    <div
                                      className="note-text"
                                      style={{ whiteSpace: 'pre-wrap' }}
                                    >
                                      {n.text}
                                    </div>
                                    <div
                                      className="note-actions"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 6,
                                      }}
                                    >
                                      <button
                                        className="btn-ghost"
                                        onClick={() =>
                                          deleteNote(r.id, n.id)
                                        }
                                        title="Borrar nota"
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>

                            <div
                              className="note-compose"
                              style={{
                                display: 'grid',
                                gap: 8,
                                marginTop: 8,
                              }}
                            >
                              <textarea
                                rows={2}
                                placeholder="Escribe una nota…"
                                value={noteDraftByRes[r.id] || ''}
                                onChange={(e) =>
                                  setNoteDraftByRes((p) => ({
                                    ...p,
                                    [r.id]: e.target.value,
                                  }))
                                }
                                style={{
                                  width: '100%',
                                  border: '1px solid #d9dfe7',
                                  borderRadius: 8,
                                  padding: 8,
                                  resize: 'vertical',
                                }}
                              />
                              <button
                                className="btn-primary"
                                onClick={() => addNote(r.id)}
                              >
                                Agregar nota
                              </button>
                            </div>
                          </div>
                        )}

                        <div
                          className="admin-actions"
                          style={{
                            gridColumn: '1 / -1',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            alignItems: 'center',
                            marginTop: 8,
                          }}
                        >
                          {group.actions && (
                            <>
                              <button
                                className="btn-primary"
                                onClick={() => confirmar(r.id)}
                              >
                                Confirmar
                              </button>
                              <button
                                className="btn-danger"
                                onClick={() => rechazar(r.id)}
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                          <button
                            className="btn-ghost"
                            onClick={() => eliminar(r.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
