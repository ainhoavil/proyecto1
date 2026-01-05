// frontend/src/pages/reservas/reservasAdmin.jsx
import { useEffect, useMemo, useState } from 'react';
import { http } from '../../helpers/http';

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

function perrosTexto(perroField) {
  if (!perroField) return '';
  try {
    const j = typeof perroField === 'string' ? JSON.parse(perroField) : perroField;
    const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : [];
    const names = arr
      .map((p) => p?.nombre || p?.name || p?.titulo || p)
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean);
    return Array.from(new Set(names)).join(', ');
  } catch {
    const s = String(perroField || '')
      .split(',')
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return Array.from(new Set(s)).join(', ');
  }
}

/* ===================== Componente ===================== */

export default function ReservasAdmin() {
  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState('');

  const [adminList, setAdminList] = useState([]);
  const [adminFilterEmail, setAdminFilterEmail] = useState('');
  const [adminLimit, setAdminLimit] = useState(300);

  // Adiestradores (para asignación manual)
  const [trainers, setTrainers] = useState([]);
  const [loadingTrainers, setLoadingTrainers] = useState(false);
  const [trainerPickByRes, setTrainerPickByRes] = useState({});
  const [availableTrainersByRes, setAvailableTrainersByRes] = useState({});
  const [loadingAvailByRes, setLoadingAvailByRes] = useState({});

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

  /* ===== Adiestradores (asignación manual) ===== */
  const loadTrainers = async () => {
    setLoadingTrainers(true);
    try {
      const data = await http('/api/trainers/eligible', { auth: true });
      const arr = normList(data?.items || data?.trainers || data || []);
      setTrainers(arr);
    } catch (e) {
      setTrainers([]);
      setTraceErr({ action: 'GET /api/trainers/eligible', error: serializeErr(e) });
    } finally {
      setLoadingTrainers(false);
    }
  };

  const trainerNameById = useMemo(() => {
    const m = new Map();
    for (const t of Array.isArray(trainers) ? trainers : []) {
      const id = first(t?.uid, t?.id, t?._id);
      if (!id) continue;
      const name = t?.displayName || t?.nombre || t?.email || String(id);
      m.set(String(id), String(name));
    }
    return m;
  }, [trainers]);

  const ensureAvailableTrainers = async (r) => {
    const rid = first(r?.id, r?._id, r?.uuid, null);
    if (!rid) return;
    if (availableTrainersByRes[rid] || loadingAvailByRes[rid]) return;

    setLoadingAvailByRes((p) => ({ ...p, [rid]: true }));
    try {
      const qs = new URLSearchParams({
        fecha: String(r?.fecha || ''),
        hora: String(r?.hora || ''),
        durationMin: String(r?.durationMin || 60),
        ...(r?.servicioId ? { servicioId: String(r.servicioId) } : {}),
        ...(r?.modalidad ? { modalidad: String(r.modalidad) } : {}),
        reservaId: String(rid),
      });
      const data = await http(`/api/trainers/available?${qs.toString()}`, { auth: true });
      const arr = normList(data?.items || data?.trainers || data || []);
      setAvailableTrainersByRes((p) => ({ ...p, [rid]: arr }));
    } catch (e) {
      setAvailableTrainersByRes((p) => ({ ...p, [rid]: [] }));
      setTraceErr({ action: 'GET /api/trainers/available', reservaId: rid, error: serializeErr(e) });
    } finally {
      setLoadingAvailByRes((p) => ({ ...p, [rid]: false }));
    }
  };

  const asignarTrainer = async (reservaId, trainerId) => {
    const rid = first(reservaId, null);
    if (!rid) return;
    try {
      await http(`/api/reservas/${rid}/trainer`, {
        method: 'PATCH',
        auth: true,
        data: { trainerId: trainerId ? String(trainerId) : '' },
      });
      showSuccess('Adiestrador actualizado');
      await cargarAdminList();
    } catch (e) {
      showError(serverErrMsg(e, 'No se pudo asignar el adiestrador'));
      setTraceErr({ action: 'PATCH /api/reservas/:id/trainer', reservaId: rid, trainerId, error: serializeErr(e) });
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
  const [quickDogs, setQuickDogs] = useState([]);
  const [quickDogIds, setQuickDogIds] = useState([]);
  const [quickDogsWarn, setQuickDogsWarn] = useState('');
  const [quickMod, setQuickMod] = useState('presencial');
  const [quickTrainerId, setQuickTrainerId] = useState('');

  useEffect(() => {
  let alive = true;
  const email = String(quickEmail || "").trim();
  const isValid = /\S+@\S+\.\S+/.test(email);

  (async () => {
    if (!isValid) {
      if (!alive) return;
      setQuickDogs([]);
      setQuickDogIds([]);
      setQuickDogsWarn("");
      return;
    }
    try {
      const r = await http(`/api/perros/by-email?email=${encodeURIComponent(email)}`, { auth: true });
      const arr = Array.isArray(r?.items) ? r.items : [];
      if (!alive) return;

      setQuickDogs(arr);
      setQuickDogIds([]);

      if (!arr.length) {
        setQuickDogsWarn("No puede crear reservas para este usuario porque no tiene ningún perro registrado.");
      } else {
        setQuickDogsWarn("");
      }
    } catch (e) {
      if (!alive) return;
      console.error("Error cargando perros por email", e);
      setQuickDogs([]);
      setQuickDogIds([]);
      setQuickDogsWarn("No se pudieron cargar los perros de este usuario.");
    }
  })();

  return () => {
    alive = false;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [quickEmail]);


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

    if (!quickDogs.length) {
      showError('No puede crear reservas para este usuario porque no tiene ningún perro registrado.');
      return;
    }
    if (!quickDogIds.length) {
      showError('Selecciona al menos un perro para la reserva.');
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
          trainerId: quickTrainerId ? String(quickTrainerId) : '',
          status: 'pending',
          perro: (() => {
            const sel = quickDogs.filter((p) => quickDogIds.includes(p.id));
            return JSON.stringify(sel.map((p) => ({ id: p.id, nombre: p.nombre, raza: p.raza, nacimiento: p.nacimiento })));
          })(),
        },
        auth: true,
      });
      showSuccess(`Reserva creada para ${quickEmail.trim()}`);
      setQuickEmail('');
      setQuickTrainerId('');
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
      const origin = String(r.origin || '').toLowerCase();

      if (s === 'pending_user' || s === 'pendiente_usuario') {
        pendingUserAccept.push(r);
      } else if (s === 'pending' || s === 'pendiente') {
        if (origin === 'admin') pendingUserAccept.push(r);
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
    loadTrainers();
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
          <label>
            Adiestrador (opcional)
            <select
              value={quickTrainerId}
              onChange={(e) => setQuickTrainerId(e.target.value)}
              disabled={loadingTrainers}
            >
              <option value="">Sin adiestrador seleccionado</option>
              {trainers.map((t) => {
                const tid = first(t?.uid, t?.id, t?._id);
                const name = t?.displayName || t?.nombre || t?.email || String(tid);
                return (
                  <option key={tid} value={tid}>
                    {name}
                  </option>
                );
              })}
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
<div style={{ marginTop: 8 }}>
  <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.85 }}>Perros del usuario</div>

  {quickDogsWarn ? (
    <div style={{ color: "#b83232", fontSize: 13 }}>{quickDogsWarn}</div>
  ) : quickDogs.length ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {quickDogs.map((p) => {
        const checked = quickDogIds.includes(p.id);
        return (
          <label
            key={p.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid #e6e6e6",
              borderRadius: 12,
              padding: "6px 10px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                const on = e.target.checked;
                setQuickDogIds((prev) =>
                  on ? Array.from(new Set([...prev, p.id])) : prev.filter((x) => x !== p.id)
                );
              }}
            />
            <span>{p.nombre}</span>
            {p.raza ? <span style={{ opacity: 0.7 }}>({p.raza})</span> : null}
          </label>
        );
      })}
    </div>
  ) : (
    <div style={{ opacity: 0.7, fontSize: 13 }}>Introduce un email para ver sus perros.</div>
  )}
</div>

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
              actions: true, // aquí el admin puede rechazar
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
                    const perros = perrosTexto(r.perro);

                    const rawStatus = String(r.status || '').toLowerCase();
                    const canConfirm =
                      rawStatus === 'pending' || rawStatus === 'pendiente';
                    const canReject =
                      rawStatus === 'pending' ||
                      rawStatus === 'pendiente' ||
                      rawStatus === 'pending_user' ||
                      rawStatus === 'pendiente_usuario' ||
                      rawStatus === 'confirmed' ||
                      rawStatus === 'confirmada';
                    const canDelete = [
                      'cancelled',
                      'cancelada',
                      'rejected',
                      'rechazada',
                      'deleted',
                      'eliminada',
                    ].includes(rawStatus);

                    return (
                      <li key={r.id} className="reserva-item">
                        <div className="reserva-main">
                          <div className="title">
                            {r.servicioTitulo || 'Servicio'}
                          </div>
                          <div className="meta">
                            <b>De:</b> {r.email}
                            {perros ? ` · Perros: ${perros}` : ''} · {r.fecha} · {r.hora} ·{' '}
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

                        {/* Asignación manual de adiestrador */}
                        <div
                          style={{
                            gridColumn: '1 / -1',
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            marginTop: 6,
                          }}
                        >
                          <span style={{ fontSize: 12, opacity: 0.85 }}>
                            Adiestrador:
                          </span>
                          {(() => {
                            const rid = String(first(r?.id, r?._id, r?.uuid) || '').trim();
                            const currentTid = String(r.trainerId || r.trainer_id || '').trim();
                            const picked = trainerPickByRes[rid] != null ? String(trainerPickByRes[rid]) : currentTid;
                            const selectedTid = String(picked || '').trim();
                            const selectedName = selectedTid
                              ? (trainerNameById.get(selectedTid) || selectedTid)
                              : '';

                            const avail = availableTrainersByRes[rid] || [];
                            const loadingAvail = !!loadingAvailByRes[rid];

                            return (
                              <select
                                value={selectedTid}
                                disabled={loadingTrainers}
                                onFocus={() => ensureAvailableTrainers(r)}
                                onMouseDown={() => ensureAvailableTrainers(r)}
                                onChange={(e) => {
                                  const tid = e.target.value;
                                  setTrainerPickByRes((p) => ({ ...p, [rid]: tid }));
                                  asignarTrainer(rid, tid);
                                }}
                                style={{ minWidth: 260 }}
                                title="Asignar/cambiar adiestrador. En el desplegable se muestran solo los disponibles para esa franja."
                              >
                                {/* Opción seleccionada (siempre visible) */}
                                {selectedTid ? (
                                  <option value={selectedTid}>Adiestrador: {selectedName}</option>
                                ) : (
                                  <option value="">Sin adiestrador seleccionado</option>
                                )}

                                {/* Permitir desasignar */}
                                {selectedTid && (
                                  <option value="">Sin adiestrador seleccionado</option>
                                )}

                                {loadingAvail && (
                                  <option value="__loading" disabled>
                                    Cargando adiestradores disponibles…
                                  </option>
                                )}

                                {(Array.isArray(avail) ? avail : []).map((t) => {
                                  const tid = String(first(t?.uid, t?.id, t?._id) || '').trim();
                                  if (!tid) return null;
                                  if (tid === selectedTid) return null;
                                  const label = t?.displayName || t?.nombre || t?.email || tid;
                                  return (
                                    <option key={tid} value={tid}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                            );
                          })()}

                          <span style={{ fontSize: 12, opacity: 0.8 }}>
                            Actual: {(() => {
                              const tid = String(r.trainerId || r.trainer_id || '').trim();
                              if (!tid) return 'Sin adiestrador seleccionado';
                              return `Adiestrador: ${trainerNameById.get(tid) || tid}`;
                            })()}
                          </span>
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
                          {/* Confirmar / Rechazar solo en grupos con actions=true */}
                          {group.actions && canConfirm && !canDelete && (
                            <button
                              className="btn-primary"
                              onClick={() => confirmar(r.id)}
                            >
                              Confirmar
                            </button>
                          )}

                          {group.actions && canReject && !canDelete && (
                            <button
                              className="btn-danger"
                              onClick={() => rechazar(r.id)}
                            >
                              Rechazar
                            </button>
                          )}

                          {/* Eliminar solo para canceladas / rechazadas / eliminadas */}
                          {canDelete && (
                            <button
                              className="btn-ghost"
                              onClick={() => eliminar(r.id)}
                            >
                              Eliminar
                            </button>
                          )}
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
