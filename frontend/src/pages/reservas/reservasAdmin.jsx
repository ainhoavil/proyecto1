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

/* ===================== Utils: notas "vistas" ===================== */
const LS_KEY = 'reservas_admin_seen_notes_v1';

function loadSeenMap() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveSeenMap(map) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {}
}
function noteSignature(r) {
  const u = (r?.userNote ?? '').trim();
  const a = (r?.adminNote ?? '').trim();
  return JSON.stringify({ u, a });
}
function isEditableStatus(status) {
  const s = String(status || '').toLowerCase();
  return !['cancelled', 'rejected', 'deleted', 'cancelada', 'rechazada', 'eliminada'].includes(s);
}

/* ===================== Componente ===================== */

export default function ReservasAdmin() {
  const { user } = useAuth();

  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState('');

  const [adminList, setAdminList] = useState([]);
  const [adminFilterEmail, setAdminFilterEmail] = useState('');
  const [adminLimit, setAdminLimit] = useState(300);

  const [adminNotes, setAdminNotes] = useState({});
  const [openNotes, setOpenNotes] = useState({});

  const [seenNotes, setSeenNotes] = useState(() => loadSeenMap());

  const [quickFecha, setQuickFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [quickHora, setQuickHora] = useState('09:00');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickMod, setQuickMod] = useState('presencial');

  const [notice, setNotice] = useState({ type: '', text: '' });
  const [trace, setTrace] = useState(null);

  const showSuccess = (t) => setNotice({ type: 'success', text: t });
  const showError = (t) => setNotice({ type: 'error', text: t });
  const clearNotice = () => setNotice({ type: '', text: '' });
  const setTraceErr = (obj) => setTrace({ time: new Date().toISOString(), ...obj });

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

  const cargarAdminList = async () => {
    try {
      clearNotice();
      const qs = new URLSearchParams({
        limit: String(adminLimit || 300),
        ...(adminFilterEmail ? { email: adminFilterEmail.trim() } : {}),
      });
      const data = await http(`/api/reservas?${qs.toString()}`, { auth: true });
      const list = normList(data?.items || data?.reservas || data || []);

      const nextNotes = { ...adminNotes };
      for (const r of list) {
        if (nextNotes[r.id] === undefined) nextNotes[r.id] = r.adminNote ?? '';
      }
      setAdminNotes(nextNotes);

      setAdminList(list);
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo obtener reservas'));
      setTraceErr({ action: 'GET admin list', url: '/api/reservas', error: serializeErr(e) });
    }
  };

  const payloadNote = (id) => {
    const v = (adminNotes[id] ?? '').trim();
    return { note: v, admin_note: v, nota_admin: v, adminNote: v };
  };

  const confirmar = async (id) => {
    try {
      await http(`/api/reservas/${id}/confirm`, {
        method: 'PATCH',
        data: payloadNote(id),
        auth: true,
      });
      showSuccess('Reserva confirmada');
      await cargarAdminList();
      markNotesSeen(id);
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo confirmar'));
      setTraceErr({ action: 'PATCH confirm', id, error: serializeErr(e) });
    }
  };

  const rechazar = async (id) => {
    try {
      await http(`/api/reservas/${id}/reject`, {
        method: 'PATCH',
        data: payloadNote(id),
        auth: true,
      });
      showSuccess('Reserva rechazada');
      await cargarAdminList();
      markNotesSeen(id);
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

  // ---- Guardar nota admin (enviando status requerido por el backend) ----
  const guardarNota = async (id) => {
    try {
      const current = adminList.find(r => r.id === id);
      if (!current) return;

      if (!isEditableStatus(current.status)) {
        showError('No se puede modificar la nota en este estado.');
        return;
      }

      const payload = {
        status: current.status || current.estado || current.state || 'pending',
        ...payloadNote(id),
      };

      await http(`/api/reservas/${id}`, {
        method: 'PATCH',
        data: payload,
        auth: true,
      });

      showSuccess('Nota guardada');
      await cargarAdminList();
      markNotesSeen(id);
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo guardar la nota'));
      setTraceErr({ action: 'PATCH note', id, error: serializeErr(e) });
    }
  };

  const bloquear = async () => {
    try {
      await http('/api/reservas/bloqueos', {
        method: 'POST',
        data: { fecha: quickFecha, hora: quickHora, motivo: 'Bloqueo manual', servicioId },
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
      } else if (['cancelled','rejected','deleted','cancelada','rechazada','eliminada'].includes(s)) {
        cancelled.push(r);
      }
    }
    const sortByDT = (arr) =>
      [...arr].sort((a, b) =>
        (`${a.fecha || ''} ${a.hora || ''}`).localeCompare(`${b.fecha || ''} ${b.hora || ''}`)
      );
    return {
      pendingAdminConfirm: sortByDT(pendingAdminConfirm),
      pendingUserAccept: sortByDT(pendingUserAccept),
      confirmed: sortByDT(confirmed),
      cancelled: sortByDT(cancelled),
    };
  }, [adminList]);

  const getIsNewNotes = (r) => {
    const sig = noteSignature(r);
    return seenNotes[r.id] !== sig && (r.userNote?.trim() || r.adminNote?.trim());
  };
  const markNotesSeen = (id) => {
    const r = adminList.find(x => x.id === id);
    if (!r) return;
    const sig = noteSignature(r);
    const next = { ...seenNotes, [id]: sig };
    setSeenNotes(next);
    saveSeenMap(next);
  };

  const toggleNotes = (r) => {
    const isOpen = !!openNotes[r.id];
    const next = { ...openNotes, [r.id]: !isOpen };
    setOpenNotes(next);
    if (!isOpen) markNotesSeen(r.id);
  };

  useEffect(() => {
    loadServicios();
    cargarAdminList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="reservas-admin">
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      {trace && (
        <details open className="trace" style={{ marginTop: 10 }}>
          <summary>🪵 Diagnóstico</summary>
          <pre>{JSON.stringify(trace, null, 2)}</pre>
        </details>
      )}

      <section className="admin-tools" style={{ marginTop: 16 }}>
        <h2>Acciones rápidas (admin)</h2>
        <div
          className="admin-grid"
          style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}
        >
          <label>Fecha
            <input type="date" value={quickFecha} onChange={(e) => setQuickFecha(e.target.value)} />
          </label>
          <label>Hora
            <select value={quickHora} onChange={(e) => setQuickHora(e.target.value)}>
              {HOURS.map(h => {
                const t = `${String(h).padStart(2, '0')}:00`;
                return <option key={t} value={t}>{t}</option>;
              })}
            </select>
          </label>
          <label>Servicio
            <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
              {servicios.map(s => {
                const sid = first(s.id, s._id, s.uuid);
                const title = first(s.title, s.titulo, s.name, 'Servicio');
                return <option key={sid} value={sid}>{title}</option>;
              })}
            </select>
          </label>
          <label>Modalidad
            <select value={quickMod} onChange={(e) => setQuickMod(e.target.value)}>
              <option value="presencial">Presencial</option>
              <option value="online">Online</option>
              <option value="a domicilio">A domicilio</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button className="btn-danger" onClick={bloquear}>Bloquear hora</button>
          </div>
          <label>Email (reservar para…)
            <input
              type="email"
              placeholder="cliente@ejemplo.com"
              value={quickEmail}
              onChange={(e) => setQuickEmail(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button className="btn-primary" onClick={reservarParaEmail}>Crear reserva</button>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <label>Email
            <input
              type="email"
              value={adminFilterEmail}
              onChange={(e) => setAdminFilterEmail(e.target.value)}
              placeholder="(opcional)"
            />
          </label>
          <label>Límite
            <input
              type="number"
              min={50}
              max={1000}
              value={adminLimit}
              onChange={(e) => setAdminLimit(Number(e.target.value || 300))}
              style={{ width: 100 }}
            />
          </label>
          <button className="btn-ghost" onClick={cargarAdminList}>Actualizar</button>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
          {[
            { title: 'Pendientes (confirmación del admin)', items: adminBuckets.pendingAdminConfirm, actions: true },
            { title: 'Pendientes (aceptación del usuario)', items: adminBuckets.pendingUserAccept, actions: false },
            { title: 'Confirmadas', items: adminBuckets.confirmed, actions: false },
            { title: 'Canceladas / Rechazadas', items: adminBuckets.cancelled, actions: false },
          ].map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              {!group.items.length ? (
                <div className="empty">Sin registros.</div>
              ) : (
                <ul className="reservas-list">
                  {group.items.map((r) => {
                    const hasUser = !!(r.userNote && String(r.userNote).trim());
                    const hasAdmin = !!(r.adminNote && String(r.adminNote).trim());
                    const isOpen = !!openNotes[r.id];
                    const newNotes = getIsNewNotes(r);

                    return (
                      <li key={r.id} className="reserva-item">
                        <div className="reserva-main">
                          <div className="title">{r.servicioTitulo}</div>
                          <div className="meta">
                            <b>De:</b> {r.email} · {r.fecha} · {r.hora} · <i>{r.modalidad}</i>
                          </div>
                        </div>

                        <div className={`badge ${r.status}`}>{r.status}</div>

                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
                          {(hasUser || hasAdmin) ? (
                            <span style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6 }}>
                              {newNotes && <span title="Nuevas notas sin leer">🟣</span>}
                              {hasUser && '✉️ Nota de usuario'}{hasUser && hasAdmin ? ' · ' : ''}
                              {hasAdmin && '🗒️ Nota admin'}
                            </span>
                          ) : (
                            <span style={{ fontSize: 13, color: '#999' }}>Sin notas</span>
                          )}
                          <button
                            className="btn-ghost"
                            onClick={() => toggleNotes(r)}
                            style={{ marginLeft: 'auto' }}
                          >
                            {isOpen ? 'Ocultar notas' : 'Ver notas'}
                          </button>
                        </div>

                        {isOpen && (
                          <div className="note-box" style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                            {hasUser && (
                              <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
                                <b>✉️ Nota de usuario</b>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{r.userNote}</div>
                              </div>
                            )}
                            {hasAdmin && (
                              <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
                                <b>🗒️ Nota admin (guardada)</b>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{r.adminNote}</div>
                              </div>
                            )}
                            {r.cancelReason && (
                              <div style={{ background: '#fff4f4', border: '1px solid #f2caca', borderRadius: 8, padding: 8 }}>
                                <b>❌ Motivo cancelación</b>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{r.cancelReason}</div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="admin-actions" style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
                          {isEditableStatus(r.status) ? (
                            <>
                              <input
                                type="text"
                                placeholder="Escribe o actualiza tu nota (se guarda sin cambiar el estado)…"
                                value={adminNotes[r.id] ?? ''}
                                onChange={(e) => setAdminNotes({ ...adminNotes, [r.id]: e.target.value })}
                                style={{ minWidth: 240, flex: 1 }}
                              />
                              <button className="btn-secondary" onClick={() => guardarNota(r.id)}>
                                Guardar nota
                              </button>
                            </>
                          ) : (
                            <em style={{ color: '#777' }}>Notas bloqueadas por estado</em>
                          )}

                          {group.actions && (
                            <>
                              <button className="btn-primary" onClick={() => confirmar(r.id)}>Confirmar</button>
                              <button className="btn-danger" onClick={() => rechazar(r.id)}>Rechazar</button>
                            </>
                          )}
                          <button className="btn-ghost" onClick={() => eliminar(r.id)}>Eliminar</button>
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
