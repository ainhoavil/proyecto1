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

  // Fallback de servicio en reservas (cuando backend no trae título)
  const getServicioTitulo = (sid) => {
    if (!sid) return null;
    const s = servicios.find((x) => [x.id, x._id, x.uuid].includes(sid));
    return s ? first(s.title, s.titulo, s.name, null) : null;
  };

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
  }, []);

  useEffect(() => {
    if (servicioSel?.durationMin) setDurationMin(Number(servicioSel.durationMin) || 60);
    else {
      const txt = first(servicioSel?.duration, servicioSel?.duracion, '');
      const m = String(txt).match(/(\d+)\s*min/i);
      setDurationMin(m ? Number(m[1]) : 60);
    }
  }, [servicioSel]);

  /* ===== Paquetes ===== */
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
  useEffect(() => { if (fecha) cargarDisponibilidad(fecha); }, [fecha, durationMin, servicioId]);

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
    open: false, fecha: '', hora: '',
    servicioTitulo: '', modalidad: '',
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

  /* ===== Crear reserva ===== */
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
      servicioTitulo: servicioTituloSel,
      modalidad,
      status: 'pending',
      paqueteId,
    };

    try {
      await http('/api/reservas', {
        method: 'POST',
        data: minimal,
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
      showError(e?.responseData?.error || e?.data?.error || e?.message || 'No se pudo crear la reserva.');
      setTrace({
        time: new Date().toISOString(),
        action: 'POST /api/reservas (json)',
        payload_preview: minimal,
        error: e?.responseData || e?.data || String(e?.message || e),
      });
    }
  };

  /* ===== MIS RESERVAS ===== */
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

  /* ===== NOTAS TIPO HILO (chat) ===== */
  const [notesByRes, setNotesByRes] = useState({});
  const [noteDraftByRes, setNoteDraftByRes] = useState({});
  const [notesOpen, setNotesOpen] = useState({});

  const loadNotes = async (id) => {
    try {
      const rows = await http(`/api/reservas/${id}/notes`, { auth: true });
      setNotesByRes(p => ({ ...p, [id]: Array.isArray(rows) ? rows : [] }));
    } catch (e) {
      setNotesByRes(p => ({ ...p, [id]: [] }));
    }
  };

  const addNote = async (id) => {
    const txt = (noteDraftByRes[id] || '').trim();
    if (!txt) return;
    try {
      const n = await http(`/api/reservas/${id}/notes`, {
        method: 'POST',
        data: { text: txt },
        auth: true
      });
      setNoteDraftByRes(p => ({ ...p, [id]: '' }));
      setNotesByRes(p => ({ ...p, [id]: [n, ...(p[id] || [])] }));
    } catch (e) {
      showError('No se pudo añadir la nota');
    }
  };

  const deleteNote = async (id, noteId) => {
    try {
      await http(`/api/reservas/${id}/notes/${noteId}`, {
        method: 'DELETE',
        auth: true
      });
      setNotesByRes(p => ({
        ...p,
        [id]: (p[id] || []).filter(n => n.id !== noteId)
      }));
    } catch (e) {
      showError('No se pudo borrar la nota');
    }
  };

  /* ===== CANCELAR (24h) ===== */
  const [cancelModal, setCancelModal] = useState({ open: false, id: '' });
  const abrirCancelModal = (id) => setCancelModal({ open: true, id });
  const cerrarCancelModal = () => setCancelModal({ open: false, id: '' });

  const confirmarCancelModal = async () => {
    const bid = cancelModal.id;
    if (!bid) return;
    try {
      await http(`/api/reservas/${bid}`, {
        method: 'DELETE',
        auth: true
      });
      showSuccess('Reserva cancelada.');
      cerrarCancelModal();
      await Promise.all([
        cargarMias(),
        fecha ? cargarDisponibilidad(fecha) : Promise.resolve()
      ]);
    } catch (e) {
      const errCode = e?.responseData?.error || e?.data?.error;
      if (errCode === 'late-cancel') {
        showError('No puedes cancelar con menos de 24 horas de antelación.');
      } else {
        showError(errCode || 'No se pudo cancelar la reserva.');
      }
    }
  };

  /* ===== DISMISS ===== */
  const [dismissed, setDismissed] = useState(
    () => new Set(JSON.parse(localStorage.getItem('reservas.dismissed') || '[]'))
  );

  const dismiss = (id) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    localStorage.setItem('reservas.dismissed', JSON.stringify(Array.from(next)));
  };

  useEffect(() => { cargarMias(); cargarMisPaquetes(); }, [isAuthenticated]);

  /* ===== RENDER ===== */
  return (
    <div className="reservas-page">

      {/* Avisos */}
      {notice.text && (
        <div className={`notice ${notice.type}`}>
          {notice.text}
          <button onClick={() => setNotice({ type: '', text: '' })}>×</button>
        </div>
      )}

      {/* Traza debug */}
      {trace && (
        <pre className="debug-trace">
          {JSON.stringify(trace, null, 2)}
        </pre>
      )}

      {/* Selección de servicio */}
      <div className="servicios-box">
        <label>Servicio:</label>
        <select
          value={servicioId}
          onChange={(e) => setServicioId(e.target.value)}
        >
          {servicios.map((s) => {
            const id = first(s.id, s._id, s.uuid);
            const t = first(s.title, s.titulo, s.name, 'Servicio');
            return <option key={id} value={id}>{t}</option>;
          })}
        </select>
      </div>

      {/* Calendario */}
      <div className="calendar-box">
        <h2>{mesBase.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}</h2>

        <div className="calendar-grid">
          {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d) => (
            <div key={d} className="cal-header">{d}</div>
          ))}

          {Array.from({ length: 42 }).map((_, i) => {
            const d = new Date(mesBase);
            const startDay = (mesBase.getDay() + 6) % 7;
            d.setDate(1 + (i - startDay));
            const isCurrentMonth = d.getMonth() === mesBase.getMonth();
            const yyyyMMdd = d.toISOString().slice(0, 10);

            return (
              <button
                key={i}
                className={`cal-cell ${isCurrentMonth ? '' : 'other-month'}`}
                onClick={() => {
                  setFecha(yyyyMMdd);
                  setHora('');
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Horas disponibles */}
      {fecha && (
        <div className="horas-box">
          <h3>Horas disponibles – {humanDate(fecha)}</h3>

          {loadingHoras ? (
            <p>Cargando…</p>
          ) : (
            <div className="horas-grid">
              {HOURS.map((h) => {
                const disabled = unavailable.includes(h);
                return (
                  <button
                    key={h}
                    disabled={disabled}
                    className={disabled ? 'hora-disabled' : 'hora'}
                    onClick={() => abrirConfirmacion(fecha, h)}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Confirmación */}
      {confirmBox.open && (
        <div className="modal">
          <div className="modal-content">
            <h3>Confirmar reserva</h3>
            <p><b>Servicio:</b> {servicioTituloSel}</p>
            <p><b>Fecha:</b> {humanDate(confirmBox.fecha)}</p>
            <p><b>Hora:</b> {confirmBox.hora}</p>

            <label>Modalidad:</label>
            <select
              value={confirmBox.modalidad}
              onChange={(e) =>
                setConfirmBox((p) => ({ ...p, modalidad: e.target.value }))
              }
            >
              {allowedModalities.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <div className="modal-actions">
              <button onClick={reservarConfirmado} className="btn-primary">Reservar</button>
              <button onClick={cerrarConfirmacion} className="btn-ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de reservas */}
      <h2 className="mis-reservas-title">Mis reservas</h2>

      <div className="mis-reservas-list">
        {mias.length === 0 && (
          <p className="empty">No tienes reservas todavía.</p>
        )}

        {mias.map((r) => {
          const clave = r.id;
          const tituloSrv = first(
            r.servicioTitulo,
            getServicioTitulo(r.servicioId),
            'Servicio'
          );

          const statusColor = {
            pending: 'yellow',
            confirmed: 'green',
            rejected: 'red',
            cancelled: 'gray',
            done: 'blue',
          }[r.status] || 'gray';

          const trainerName = r.entrenadorNombre || r.entrenadorEmail || null;

          return (
            <div key={r.id} className="reserva-card">
              <div className="reserva-header">
                <h3>{tituloSrv}</h3>
                <span className={`status ${statusColor}`}>{r.status}</span>
              </div>

              <div className="reserva-body">
                <p><b>Fecha:</b> {humanDate(r.fecha)}</p>
                <p><b>Hora:</b> {r.hora}</p>
                {r.modalidad && <p><b>Modalidad:</b> {r.modalidad}</p>}
                {trainerName && (
                  <p><b>Adiestrador:</b> {trainerName}</p>
                )}
              </div>

              {/* Notas del adiestrador (campo visible al cliente) */}
              {r.notasEntrenador && (
                <div className="trainer-notes">
                  <h4>Notas del adiestrador</h4>
                  <p>{r.notasEntrenador}</p>
                </div>
              )}

              {/* Notas tipo hilo (chat) */}
              <div className="notes-thread">
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    setNotesOpen(o => ({ ...o, [r.id]: !o[r.id] }));
                    if (!notesByRes[r.id]) await loadNotes(r.id);
                  }}
                >
                  📝 Notas
                </button>

                {notesOpen[r.id] && (
                  <div className="notes-box">
                    <div className="notes-list">
                      {(notesByRes[r.id] || []).length === 0 ? (
                        <div className="empty">Sin notas aún.</div>
                      ) : (
                        (notesByRes[r.id] || []).map((n) => (
                          <div key={n.id} className="note-item">
                            <div className="note-meta">
                              <b>{n.author === 'admin' ? 'Adiestrador' : 'Tú'}</b> ·{' '}
                              {new Date(n.createdAt).toLocaleString()}
                            </div>

                            <div className="note-text">{n.text}</div>

                            <div className="note-actions">
                              <button
                                className="btn-ghost"
                                onClick={() => deleteNote(r.id, n.id)}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Escribir nueva nota */}
                    <div className="note-compose">
                      <textarea
                        rows={2}
                        placeholder="Escribe una nota…"
                        value={noteDraftByRes[r.id] || ''}
                        onChange={(e) =>
                          setNoteDraftByRes(p => ({ ...p, [r.id]: e.target.value }))
                        }
                      />
                      <button className="btn-primary" onClick={() => addNote(r.id)}>
                        Agregar nota
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Cancelar (con política 24h) */}
              {['pending', 'confirmed'].includes(r.status) && (
                <div className="cancel-section">
                  <p className="policy">Puedes cancelar sin coste hasta 24 horas antes de la cita.</p>
                  <button
                    className="btn-ghost cancel-btn"
                    onClick={() => abrirCancelModal(r.id)}
                  >
                    Cancelar reserva
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal cancelar */}
      {cancelModal.open && (
        <div className="modal">
          <div className="modal-content">
            <h3>Cancelar reserva</h3>
            <p>
              ¿Seguro que quieres cancelar esta reserva?
              <br />
              Recuerda: solo se puede cancelar sin coste con al menos 24 horas de antelación.
            </p>

            <div className="modal-actions">
              <button className="btn-primary" onClick={confirmarCancelModal}>
                Confirmar
              </button>
              <button className="btn-ghost" onClick={cerrarCancelModal}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
