// frontend/src/pages/reservas/reservasTrainer.jsx
import { useEffect, useMemo, useState } from 'react';
import { http } from '../../helpers/http';
import { useAuth } from '../../context/auth';

import {
  first,
  normList,
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

function reservaDateTimeMs(r) {
  const fecha = String(r?.fecha || '').slice(0, 10);
  const hora = String(r?.hora || '00:00').slice(0, 5);
  if (!fecha) return null;
  const ms = Date.parse(`${fecha}T${hora}:00`);
  return Number.isNaN(ms) ? null : ms;
}

export default function ReservasTrainer() {
  const { user, role } = useAuth();
  const [list, setList] = useState([]);

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

  /* ===== Listado adiestrador ===== */
  const loadTrainerList = async () => {
    try {
      clearNotice();
      const data = await http('/api/reservas/trainer?limit=300', {
        auth: true,
      });
      const listNorm = normList(data?.items || data?.reservas || data || []);
      setList(listNorm);
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo obtener reservas'));
      setTraceErr({
        action: 'GET trainer list',
        url: '/api/reservas/trainer',
        error: serializeErr(e),
      });
    }
  };

  /* ===== Acciones trainer sobre reservas ===== */
  const confirmar = async (id) => {
    try {
      await http(`/api/reservas/${id}/confirm`, {
        method: 'PATCH',
        auth: true,
      });
      showSuccess('Reserva confirmada');
      await loadTrainerList();
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
      await loadTrainerList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo rechazar'));
      setTraceErr({ action: 'PATCH reject', id, error: serializeErr(e) });
    }
  };

  /* ===== Buckets UI ===== */
  const trainerBuckets = useMemo(() => {
    const pending = [];
    const confirmed = [];
    const past = [];
    const cancelled = [];

    const now = Date.now();

    for (const r of list) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'pending' || s === 'pendiente') {
        pending.push(r);
      } else if (s === 'confirmed' || s === 'confirmada') {
        const t = reservaDateTimeMs(r);
        if (t != null && t < now) past.push(r);
        else confirmed.push(r);
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

    const sortByDTDesc = (arr) =>
      [...arr].sort((a, b) => {
        const ta = reservaDateTimeMs(a) ?? 0;
        const tb = reservaDateTimeMs(b) ?? 0;
        return tb - ta;
      });

    return {
      pending: sortByDT(pending),
      confirmed: sortByDT(confirmed),
      past: sortByDTDesc(past),
      cancelled: sortByDT(cancelled),
    };
  }, [list]);

  useEffect(() => {
    loadTrainerList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== Render ===== */
  return (
    <div className="reservas-trainer">
      <h2>Reservas (Adiestrador)</h2>
      <p style={{ marginBottom: 12, opacity: 0.8 }}>
        {user?.email} · rol: {role}
      </p>

      {notice.text && (
        <div className={`notice ${notice.type}`}>{notice.text}</div>
      )}

      {trace && (
        <details open className="trace" style={{ marginTop: 10 }}>
          <summary>🪵 Diagnóstico</summary>
          <pre>{JSON.stringify(trace, null, 2)}</pre>
        </details>
      )}

      <section style={{ marginTop: 24 }}>
        <button className="btn-ghost" onClick={loadTrainerList}>
          Actualizar listado
        </button>

        <div
          style={{
            display: 'grid',
            gap: 16,
            marginTop: 16,
            gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
          }}
        >
          {[
            {
              title: 'Pendientes de gestionar',
              items: trainerBuckets.pending,
              actions: true,
            },
            {
              title: 'Confirmadas',
              items: trainerBuckets.confirmed,
              actions: true,
            },
            {
              title: 'Reservas pasadas',
              items: trainerBuckets.past,
              actions: false,
              noButtons: true,
            },
            {
              title: 'Canceladas / Rechazadas',
              items: trainerBuckets.cancelled,
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

                    const rawStatus = String(r.status || '').toLowerCase();
                    const canConfirm =
                      (rawStatus === 'pending' || rawStatus === 'pendiente') &&
                      !['cancelled', 'cancelada', 'rejected', 'rechazada'].includes(
                        rawStatus
                      );
                    const canReject =
                      rawStatus === 'pending' ||
                      rawStatus === 'pendiente' ||
                      rawStatus === 'confirmed' ||
                      rawStatus === 'confirmada';

                    return (
                      <li key={r.id} className="reserva-item">
                        <div className="reserva-main">
                          <div className="title">
                            {r.servicioTitulo || 'Servicio'}
                          </div>
                          <div className="meta">
                            <b>Cliente:</b> {r.email} · {r.fecha} · {r.hora} ·{' '}
                            <i>{r.modalidad}</i>
                          </div>
                        </div>

                        <div className={`badge ${r.status}`}>
                          {r.status}
                        </div>

                        {!group.noButtons && (
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
                        )}

                        {!group.noButtons && isOpen && (
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
                                notes.map((n) => {
                                  const label =
                                    n.author === 'admin'
                                      ? 'Admin'
                                      : n.author === 'trainer'
                                      ? 'Adiestrador'
                                      : 'Usuario';

                                  return (
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
                                        <b>{label}</b> ·{' '}
                                        {relativeTime(n.createdAt)}
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
                                        {/* Trainer puede borrar sus notas */}
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
                                  );
                                })
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

                        {!group.noButtons && (
                          <div
                            className="trainer-actions"
                            style={{
                              gridColumn: '1 / -1',
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 8,
                              alignItems: 'center',
                              marginTop: 8,
                            }}
                          >
                            {group.actions && canConfirm && (
                              <button
                                className="btn-primary"
                                onClick={() => confirmar(r.id)}
                              >
                                Confirmar
                              </button>
                            )}

                            {group.actions && canReject && (
                              <button
                                className="btn-danger"
                                onClick={() => rechazar(r.id)}
                              >
                                Rechazar
                              </button>
                            )}
                          </div>
                        )}
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
