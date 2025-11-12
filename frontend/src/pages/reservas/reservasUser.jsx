// frontend/src/pages/reservas/reservasUser.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { http } from '../../helpers/http';
import { useAuth } from '../../context/auth';
import '../../styles/contratar.scss';

import {
  first,
  normList,
  HOURS,
  parseDisponibilidad,
  humanDate,
  todayYMD,
  addMinutes,
} from '../../helpers/reservas';

export default function ReservasUser() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();

  const [notice, setNotice] = useState({ type: '', text: '' });
  const [trace, setTrace] = useState(null);
  const showSuccess = (t) => setNotice({ type: 'success', text: t });
  const showError = (t) => setNotice({ type: 'error', text: t });
  const setTraceErr = (obj) => setTrace({ time: new Date().toISOString(), ...obj });

  /* ===== Servicios ===== */
  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState('');
  const [durationMin, setDurationMin] = useState(60);

  const servicioSel = useMemo(
    () => servicios.find((s) => [s.id, s._id, s.uuid].includes(servicioId)) || null,
    [servicios, servicioId]
  );
  const servicioTituloSel = useMemo(
    () => first(servicioSel?.title, servicioSel?.titulo, servicioSel?.name, 'Servicio'),
    [servicioSel]
  );

  useEffect(() => {
    (async () => {
      try {
        const list = await http('/api/servicios');
        const arr = Array.isArray(list) ? list : list?.items || list?.data || [];
        setServicios(arr || []);
        if ((arr || []).length && !servicioId) {
          const fid = first(arr[0]?.id, arr[0]?._id, arr[0]?.uuid);
          if (fid) setServicioId(fid);
        }
      } catch (e) {
        setServicios([]);
        setTraceErr({ action: 'GET /api/servicios', error: String(e?.message || e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (servicioSel?.durationMin) setDurationMin(Number(servicioSel.durationMin) || 60);
    else {
      const txt = first(servicioSel?.duration, servicioSel?.duracion, '');
      const m = String(txt).match(/(\d+)\s*min/i);
      setDurationMin(m ? Number(m[1]) : 60);
    }
  }, [servicioSel]);

  /* ===== Paquetes del usuario ===== */
  const [paquetes, setPaquetes] = useState([]);
  const [paqueteId, setPaqueteId] = useState('');
  async function cargarMisPaquetes() {
    if (!isAuthenticated) { setPaquetes([]); setPaqueteId(''); return; }
    try {
      const list = await http('/api/paquetes/mios', { auth: true });
      const arr = Array.isArray(list) ? list : list?.items || list?.data || [];
      const activos = arr.filter((p) => String(p.status).toLowerCase() === 'active');
      setPaquetes(activos);
      if (activos.length === 1) setPaqueteId(first(activos[0].id, activos[0]._id, activos[0].uuid));
    } catch (e) {
      setPaquetes([]); setPaqueteId('');
      setTraceErr({ action: 'GET /api/paquetes/mios', error: String(e?.message || e) });
    }
  }

  /* ===== Disponibilidad ===== */
  const [mesBase, setMesBase] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [loadingHoras, setLoadingHoras] = useState(false);
  const [unavailable, setUnavailable] = useState([]);

  const cargarDisponibilidad = async (f) => {
    if (!f || !servicioId) return;
    setLoadingHoras(true);
    try {
      const qs = new URLSearchParams({
        fecha: f,
        durationMin: String(durationMin),
        servicioId: String(servicioId || ''),
      });
      const data = await http(`/api/reservas/disponibilidad?${qs.toString()}`);
      const { ocup } = parseDisponibilidad(data || {});
      setUnavailable(ocup);
    } catch (e) {
      setUnavailable([]);
      setTraceErr({ action: 'GET /api/reservas/disponibilidad', error: String(e?.message || e) });
    } finally {
      setLoadingHoras(false);
    }
  };
  useEffect(() => { if (fecha) cargarDisponibilidad(fecha); }, [fecha, durationMin, servicioId]); // eslint-disable-line

  /* ===== Confirmación ===== */
  const allowedModalities = useMemo(() => {
    if (!servicioSel) return ['presencial', 'online', 'a domicilio'];
    if (Array.isArray(servicioSel.modalities) && servicioSel.modalities.length) return servicioSel.modalities;
    const fromMode = String(first(servicioSel.mode, servicioSel.modo, '')).toLowerCase();
    const set = new Set(['presencial']);
    if (fromMode.includes('online')) set.add('online');
    if (fromMode.includes('domicilio')) set.add('a domicilio');
    return Array.from(set);
  }, [servicioSel]);

  const [confirmBox, setConfirmBox] = useState({
    open: false,
    fecha: '',
    hora: '',
    servicioTitulo: '',
    modalidad: '',
  });

  const abrirConfirmacion = (f, h) => {
    if (!isAuthenticated) {
      navigate(`/login?next=${encodeURIComponent('/reservas')}`, { replace: true });
      return;
    }
    setConfirmBox({
      open: true,
      fecha: f,
      hora: h,
      servicioTitulo: servicioTituloSel,
      modalidad: allowedModalities[0] || 'presencial',
    });
    setFecha(''); setHora('');
  };
  const cerrarConfirmacion = () => setConfirmBox((p) => ({ ...p, open: false }));

  /* ===== Crear reserva (JSON) ===== */
  const reservarConfirmado = async () => {
    const { fecha: f, hora: h, modalidad } = confirmBox;
    if (!servicioSel || !f || !h) {
      showError('Falta servicio, fecha u hora.');
      return;
    }

    const userEmail = user?.email || '';
    const servicio = first(servicioSel?.id, servicioSel?._id, servicioSel?.uuid, servicioId) || '';

    const minimal = {
      login: userEmail,
      email: userEmail,
      fecha: f,
      hora: h,
      servicioId: servicio,
      modalidad,
      status: 'pending',
      paqueteId, // si está vacío, el backend lo ignorará
    };

    try {
      await http('/api/reservas', {
        method: 'POST',
        data: minimal, // JSON
        auth: true
      });

      showSuccess('Reserva creada.');
      cerrarConfirmacion();
      await Promise.all([
        cargarMias(),
        cargarMisPaquetes(),
        f ? cargarDisponibilidad(f) : Promise.resolve(),
      ]);
    } catch (e) {
      showError(
        e?.responseData?.error ||
        e?.data?.error ||
        e?.message ||
        'No se pudo crear la reserva.'
      );
      setTrace({
        time: new Date().toISOString(),
        action: 'POST /api/reservas (json)',
        payload_preview: minimal,
        error: e?.responseData || e?.data || String(e?.message || e),
      });
    }
  };

  /* ===== Mis reservas ===== */
  const [mias, setMias] = useState([]);
  async function cargarMias() {
    if (!isAuthenticated) { setMias([]); return; }
    try {
      const j = await http('/api/reservas/mias', { auth: true });
      const arr = j?.items || j?.reservas || j || [];
      setMias(normList(arr));
    } catch (e) {
      setMias([]);
      setTraceErr({ action: 'GET /api/reservas/mias', error: String(e?.message || e) });
    }
  }

  /* ===== Aceptar (origin=admin) ===== */
  const aceptarReserva = async (id) => {
    try {
      // Primero, endpoint correcto del backend
      await http(`/api/reservas/${id}/confirm`, { method: 'PATCH', auth: true });
    } catch (e1) {
      try {
        // Fallback: puente genérico
        await http(`/api/reservas/${id}`, { method: 'PATCH', data: { status: 'confirmed' }, auth: true });
      } catch (e2) {
        showError(e2?.responseData?.error || e1?.responseData?.error || 'No se pudo aceptar.');
        setTraceErr({ action: 'PATCH confirm fallback', id, error: e2?.responseData || e1?.responseData || String(e2?.message || e1?.message) });
        return;
      }
    }
    showSuccess('Reserva aceptada.');
    await Promise.all([cargarMias(), fecha ? cargarDisponibilidad(fecha) : Promise.resolve()]);
  };

  /* ===== Cancelar ===== */
  const [cancelModal, setCancelModal] = useState({ open: false, id: '', reason: '' });
  const abrirCancelModal = (id) => setCancelModal({ open: true, id, reason: '' });
  const cerrarCancelModal = () => setCancelModal({ open: false, id: '', reason: '' });
  const confirmarCancelModal = async () => {
    const bid = cancelModal.id; const reason = (cancelModal.reason || '').trim();
    try {
      await http(`/api/reservas/${bid}/cancel`, { method: 'PATCH', data: { reason }, auth: true });
    } catch (e1) {
      try {
        await http(`/api/reservas/${bid}`, { method: 'PATCH', data: { status: 'cancelled', cancelReason: reason }, auth: true });
      } catch (e2) {
        showError(e2?.responseData?.error || e1?.responseData?.error || 'No se pudo cancelar.');
        setTraceErr({ action: 'PATCH cancel fallback', id: bid, error: e2?.responseData || e1?.responseData || String(e2?.message || e1?.message) });
        return;
      }
    }
    showSuccess('Reserva cancelada.');
    cerrarCancelModal();
    await Promise.all([cargarMias(), fecha ? cargarDisponibilidad(fecha) : Promise.resolve()]);
  };

  /* ===== Notas usuario ===== */
  const [noteOpen, setNoteOpen] = useState({});
  const [noteDraft, setNoteDraft] = useState({});
  const toggleNote = (id, open) => setNoteOpen((p) => ({ ...p, [id]: open ?? !p[id] }));
  const setDraft = (id, txt) => setNoteDraft((p) => ({ ...p, [id]: txt }));
  const enviarNota = async (id) => {
    const note = (noteDraft[id] || '').trim();
    if (!note) { toggleNote(id, false); return; }
    try {
      await http(`/api/reservas/${id}/note-user`, { method: 'PATCH', data: { note }, auth: true });
      showSuccess('Nota enviada.');
      toggleNote(id, false); setDraft(id, '');
      await cargarMias();
    } catch (e1) {
      showError(e1?.responseData?.error || 'No se pudo guardar la nota.');
      setTraceErr({ action: 'PATCH /api/reservas/:id/note-user', id, error: e1?.responseData || String(e1?.message || e1) });
    }
  };

  /* ===== Ocultar rechazadas/eliminadas ===== */
  const [dismissed, setDismissed] = useState(
    () => new Set(JSON.parse(localStorage.getItem('reservas.dismissed') || '[]'))
  );
  const dismiss = (id) => {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    localStorage.setItem('reservas.dismissed', JSON.stringify(Array.from(next)));
  };

  useEffect(() => { cargarMias(); cargarMisPaquetes(); }, [isAuthenticated]); // eslint-disable-line

  /* ===== Buckets UI ===== */
  const groupUserReservations = useMemo(() => {
    const pending = [], approved = [], rejected = [];
    for (const r of mias) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'pending' || s === '') pending.push(r);
      else if (s === 'confirmed' || s === 'approved' || s === 'confirmada') approved.push(r);
      else if (['rejected', 'cancelled', 'deleted', 'rechazada', 'cancelada', 'eliminada'].includes(s)) rejected.push(r);
      else pending.push(r);
    }
    return { pending, approved, rejected };
  }, [mias]);

  /* ===== UI ===== */
  return (
    <div className="reservas-user">
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      {trace && (
        <details open className="trace" style={{ marginTop: 10 }}>
          <summary>Diagnóstico</summary>
          <pre>{JSON.stringify(trace, null, 2)}</pre>
        </details>
      )}

      {/* Modal cancelar */}
      {cancelModal.open && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Cancelar reserva</h3>
            <label>
              Motivo (opcional)
              <input
                value={cancelModal.reason}
                onChange={(e) => setCancelModal((p) => ({ ...p, reason: e.target.value }))}
                placeholder="Ej. no puedo asistir"
              />
            </label>
            <div className="modal-actions">
              <button onClick={cerrarCancelModal}>Cerrar</button>
              <button className="btn-danger" onClick={confirmarCancelModal}>
                Cancelar reserva
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selector servicio / paquete */}
      <section style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Servicio:</span>
            <select
              value={servicioId}
              onChange={(e) => setServicioId(e.target.value)}
              disabled={!servicios.length}
            >
              {servicios.map((s) => {
                const sid = first(s.id, s._id, s.uuid);
                const title = first(s.title, s.titulo, s.name, `Servicio ${sid?.slice?.(0, 6) || ''}`);
                return (
                  <option key={sid} value={sid}>
                    {title}
                  </option>
                );
              })}
            </select>
          </label>

          {paquetes.length > 1 && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>Paquete:</span>
              <select value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
                <option value="">— Sin paquete —</option>
                {paquetes.map((p) => {
                  const s = p.saldo || {};
                  const restantes = (s.total || 0) - (s.usadas || 0) - (s.pendientes || 0);
                  const pid = first(p.id, p._id, p.uuid);
                  return (
                    <option key={pid} value={pid}>
                      {first(p.servicioId, p.serviceId, 'pack')} · {Math.max(0, restantes)}/{s.total || 0}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
        </div>
        {servicioSel && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
            <span>⏱ {first(servicioSel?.duration, servicioSel?.duracion, `${durationMin} min`)}</span>
            {first(servicioSel?.mode, servicioSel?.modo, '') && (
              <span> · 📍 {first(servicioSel?.mode, servicioSel?.modo, '')}</span>
            )}
          </div>
        )}
      </section>

      {/* Confirmar creación */}
      {confirmBox.open && (
        <div className="confirm-box">
          <div className="title">Confirmar reserva</div>
          <div className="msg">
            ¿Reservar <b>{confirmBox.servicioTitulo}</b> el <b>{humanDate(confirmBox.fecha)}</b> a las{' '}
            <b>{confirmBox.hora}</b>?
          </div>
          <div className="row">
            <label>Modalidad</label>
            <select
              value={confirmBox.modalidad}
              onChange={(e) => setConfirmBox((p) => ({ ...p, modalidad: e.target.value }))}
            >
              {allowedModalities.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button onClick={() => setConfirmBox((p) => ({ ...p, open: false }))}>Cerrar</button>
            <button className="btn-primary" onClick={reservarConfirmado}>
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* Calendario + horas */}
      <section className="month-scheduler">
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
            {mesBase.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}
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
            const firstDay = new Date(mesBase.getFullYear(), mesBase.getMonth(), 1);
            const startOffset = (firstDay.getDay() + 6) % 7; // lunes=0
            const lastDay = new Date(
              mesBase.getFullYear(),
              mesBase.getMonth() + 1,
              0
            ).getDate();

            const cells = [];
            const busySet = new Set(unavailable);

            for (let i = 0; i < 42; i++) {
              const dayNum = i - startOffset + 1;
              const inMonth = dayNum >= 1 && dayNum <= lastDay;

              let f = '',
                disabled = true,
                isSelected = false;

              if (inMonth) {
                const d = new Date(mesBase.getFullYear(), mesBase.getMonth(), dayNum);
                f = d.toISOString().slice(0, 10);
                const dow = d.getDay();
                disabled = dow === 0 || dow === 6 || f < todayYMD();
                isSelected = f === fecha;
              }

              cells.push(
                <div
                  key={i}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  className={`daycell ${inMonth ? '' : 'out'} ${disabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={async () => {
                    if (!inMonth || disabled) return;
                    if (f === fecha) {
                      setFecha('');
                      setHora('');
                    } else {
                      setFecha(f);
                      setHora('');
                      await cargarDisponibilidad(f);
                    }
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!inMonth || disabled) return;
                      if (f === fecha) {
                        setFecha('');
                        setHora('');
                      } else {
                        setFecha(f);
                        setHora('');
                        await cargarDisponibilidad(f);
                      }
                    }
                  }}
                >
                  {inMonth ? dayNum : ''}

                  {inMonth && f === fecha && (
                    <div className="popover">
                      <div className="pop-title">{humanDate(fecha)}</div>
                      {loadingHoras ? (
                        <div className="hint">Cargando…</div>
                      ) : (
                        <div className="pop-hours">
                          {HOURS.map((hh) => {
                            const t = `${String(hh).padStart(2, '0')}:00`;
                            const isBusy = busySet.has(t);
                            return (
                              <button
                                key={t}
                                type="button"
                                className={`slot ${isBusy ? 'busy' : ''} ${hora === t ? 'active' : ''}`}
                                disabled={isBusy}
                                onClick={() => {
                                  if (!isBusy) abrirConfirmacion(f, t);
                                }}
                                title={isBusy ? 'Ocupada' : 'Reservar'}
                              >
                                {t}–{addMinutes(t, durationMin)}
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
            return cells;
          })()}
        </div>
      </section>

      {/* Mis reservas */}
      <section style={{ marginTop: 20 }}>
        <h2>Mis reservas</h2>

        {!isAuthenticated && <p>Inicia sesión para ver y gestionar tus reservas.</p>}
        {isAuthenticated && !mias.length && (
          <div className="empty">No tienes reservas aún.</div>
        )}

        {isAuthenticated && !!mias.length && (
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
            }}
          >
            {/* Pendientes */}
            <div>
              <h3>Pendientes</h3>
              {!groupUserReservations.pending.length ? (
                <div className="empty">Sin pendientes.</div>
              ) : (
                <ul className="reservas-list">
                  {groupUserReservations.pending.map((r) => (
                    <li key={r.id} className="reserva-item">
                      <div className="reserva-main">
                        <div className="title">{r.servicioTitulo}</div>
                        <div className="meta">
                          {r.fecha} · {r.hora} · <i>{r.modalidad}</i>
                        </div>
                      </div>
                      <div className={`badge ${r.status}`}>{r.status}</div>

                      {(r.adminNote || r.userNote) && (
                        <div className="note-box">
                          {r.adminNote && (
                            <div>
                              <b>Nota del adiestrador:</b> {r.adminNote}
                            </div>
                          )}
                          {r.userNote && (
                            <div>
                              <b>Tu nota:</b> {r.userNote}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="admin-actions">
                        {r.origin === 'admin' && (
                          <button className="btn-primary" onClick={() => aceptarReserva(r.id)}>
                            Aceptar
                          </button>
                        )}
                        <button className="btn-danger" onClick={() => abrirCancelModal(r.id)}>
                          Cancelar
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => toggleNote(r.id)}
                          title="Enviar nota"
                        >
                          ✉️ Nota
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Aprobadas */}
            <div>
              <h3>Aprobadas</h3>
              {!groupUserReservations.approved.length ? (
                <div className="empty">Sin aprobadas.</div>
              ) : (
                <ul className="reservas-list">
                  {groupUserReservations.approved.map((r) => (
                    <li key={r.id} className="reserva-item">
                      <div className="reserva-main">
                        <div className="title">{r.servicioTitulo}</div>
                        <div className="meta">
                          {r.fecha} · {r.hora} · <i>{r.modalidad}</i>
                        </div>
                      </div>
                      <div className={`badge ${r.status}`}>{r.status}</div>

                      {(r.adminNote || r.userNote) && (
                        <div className="note-box">
                          {r.adminNote && (
                            <div>
                              <b>Nota del adiestrador:</b> {r.adminNote}
                            </div>
                          )}
                          {r.userNote && (
                            <div>
                              <b>Tu nota:</b> {r.userNote}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="admin-actions">
                        <button className="btn-danger" onClick={() => abrirCancelModal(r.id)}>
                          Cancelar
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => toggleNote(r.id)}
                          title="Enviar nota"
                        >
                          ✉️ Nota
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Rechazadas / Eliminadas */}
            <div>
              <h3>Rechazadas / Eliminadas</h3>
              {!groupUserReservations.rejected.filter((x) => !dismissed.has(x.id)).length ? (
                <div className="empty">Sin rechazadas/eliminadas.</div>
              ) : (
                <ul className="reservas-list">
                  {groupUserReservations.rejected
                    .filter((x) => !dismissed.has(x.id))
                    .map((r) => (
                      <li key={r.id} className="reserva-item">
                        <div className="reserva-main">
                          <div className="title">{r.servicioTitulo}</div>
                          <div className="meta">
                            {r.fecha} · {r.hora} · <i>{r.modalidad}</i>
                          </div>
                        </div>
                        <div className={`badge ${r.status}`}>{r.status}</div>

                        {(r.adminNote || r.cancelReason || r.userNote) && (
                          <div className="note-box">
                            {r.adminNote && (
                              <div>
                                <b>Nota del adiestrador:</b> {r.adminNote}
                              </div>
                            )}
                            {r.cancelReason && (
                              <div>
                                <b>Motivo:</b> {r.cancelReason}
                              </div>
                            )}
                            {r.userNote && (
                              <div>
                                <b>Tu nota:</b> {r.userNote}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="admin-actions">
                          <button className="btn-ghost" onClick={() => dismiss(r.id)}>
                            Quitar de la lista
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* estilos mínimos locales */}
      <style>{`
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999}
        .modal{background:#fff;border-radius:10px;max-width:420px;width:92%;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.2)}
        .modal h3{margin:0 0 12px}
        .modal label{display:block;margin:8px 0}
        .modal input{width:100%;padding:8px}
        .modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
        .note-box{grid-column:1 / -1; background:#f7fafc; border:1px solid #e4e8ee; padding:8px 10px; border-radius:8px; color:#333; font-size:13px; margin:6px 0}
        .note-box textarea{width:100%;padding:8px;border-radius:6px;border:1px solid #d9dfe7;resize:vertical}
      `}</style>
    </div>
  );
}
