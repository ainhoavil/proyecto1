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

// fecha+hora exactas (no relative time)
function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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

function dayOfWeekFromYMD(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getDay(); // 0=domingo, 6=sábado
}

function getDisplayedHourSlots(ymd) {
  const dow = dayOfWeekFromYMD(ymd);
  if (dow === 0) return [];
  if (dow === 6) return HOURS.filter((h) => Number(h) <= 13);
  return HOURS;
}

function isPastFechaHora(fecha, hora) {
  const [y, m, d] = String(fecha || '').split('-').map(Number);
  const [hh, mm = 0] = String(hora || '00:00').split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return false;
  const dt = new Date(y, m - 1, d, hh, mm);
  return dt.getTime() < Date.now();
}


function parseMin(hhmm) {
  const s = String(hhmm || '').trim();
  const [hh, mm = '0'] = s.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function noteIdOf(n) {
  const id = first(n?.id, n?._id, n?.noteId, n?.note_id, n?.uid, n?.pk);
  return id ? String(id) : '';
}

function noteCreatedAt(n) {
  return first(n?.created_at, n?.createdAt, n?.created, n?.timestamp);
}

function noteText(n) {
  return String(
    first(n?.text, n?.nota, n?.note, n?.admin_note, n?.user_note, n?.message, '')
  ).trim();
}

function labelAutorNota(n) {
  const rawRole = String(
    first(n?.author_role, n?.authorRole, n?.author, n?.role, '')
  )
    .toLowerCase()
    .trim();

  const role =
    rawRole === 'trainer'
      ? 'adiestrador'
      : rawRole === 'user' || rawRole === 'cliente' || rawRole === 'client'
      ? 'client'
      : rawRole;

  const roleLabel =
    role === 'admin'
      ? 'Centro'
      : role === 'adiestrador'
      ? 'Adiestrador'
      : role === 'client'
      ? 'Cliente'
      : rawRole || 'Autor';

  const email = String(first(n?.author_email, n?.authorEmail, n?.email, '')).trim();
  const uid = String(
    first(n?.author_uid, n?.authorUid, n?.author_id, n?.authorId, '')
  ).trim();
  const who = email || uid || String(first(n?.authorName, n?.author_name, n?.name, '')).trim();

  return who ? `${roleLabel} (${who})` : roleLabel;
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
      const data = await http(`/api/reservas/${id}/notes`, { auth: true });
      const arr = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];
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
      const data = await http(`/api/reservas/${id}/notes`, {
        method: 'POST',
        data: { text: txt, nota: txt, note: txt, admin_note: txt, user_note: txt },
        auth: true,
      });
      setNoteDraftByRes((p) => ({ ...p, [id]: '' }));
      const arr = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];
      setNotesByRes((p) => ({ ...p, [id]: [...arr].reverse() }));
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
        [id]: (p[id] || []).filter((n) => noteIdOf(n) !== String(noteId)),
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

  const trainerEmailSet = useMemo(() => {
    const s = new Set();
    for (const t of Array.isArray(trainers) ? trainers : []) {
      const em = String(t?.email || '').trim().toLowerCase();
      if (em) s.add(em);
    }
    return s;
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
        // Reservas pasadas: queremos traer TODAS (no solo confirmadas)
        status: 'all',
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

  const quickDisplayedHours = useMemo(() => getDisplayedHourSlots(quickFecha), [quickFecha]);

  useEffect(() => {
    // Si cambia la fecha a un día cerrado o cambia el filtro de horas, ajusta la hora seleccionada
    if (!quickDisplayedHours.length) {
      if (quickHora) setQuickHora('');
      return;
    }

    const hh = Number(String(quickHora || '').split(':')[0]);
    if (!Number.isFinite(hh) || !quickDisplayedHours.includes(hh)) {
      setQuickHora(`${String(quickDisplayedHours[0]).padStart(2, '0')}:00`);
    }
  }, [quickFecha, quickDisplayedHours, quickHora]);

  const [quickEmail, setQuickEmail] = useState('');
  const [quickDogs, setQuickDogs] = useState([]);
  const [quickDogIds, setQuickDogIds] = useState([]);
  const [quickDogsWarn, setQuickDogsWarn] = useState('');
  const [quickMod, setQuickMod] = useState('presencial');
  const [quickTrainerId, setQuickTrainerId] = useState('');

  // Bloqueos avanzados (admin)
  const [blockScope, setBlockScope] = useState('global'); // 'global' | 'trainer'
  const [blockType, setBlockType] = useState('hour'); // 'hour' | 'allDay'
  const [blockTrainerId, setBlockTrainerId] = useState('');
  const [blocksDayLoaded, setBlocksDayLoaded] = useState(false);
  const [showBlocksList, setShowBlocksList] = useState(false);
  const [blocksDay, setBlocksDay] = useState([]);
  const [loadingBlocksDay, setLoadingBlocksDay] = useState(false);
  const [blocksList, setBlocksList] = useState([]); // lista global (futuros)
  const [loadingBlocksList, setLoadingBlocksList] = useState(false);

  // Si cambia el día seleccionado, reseteamos la vista de bloqueos del día
  // (se vuelve a cargar al pulsar el botón "Ver bloqueos del día").
  useEffect(() => {
    setBlocksDay([]);
    setBlocksDayLoaded(false);
  }, [quickFecha]);

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

      // Si el email corresponde a un adiestrador, no permitimos reservas por este flujo.
      const isTrainerEmail =
        (r && String(r.reason || '').toLowerCase() === 'trainer') ||
        trainerEmailSet.has(String(email).toLowerCase());

      if (!arr.length) {
        setQuickDogsWarn(
          isTrainerEmail
            ? "Este email pertenece a un adiestrador. Para crear una reserva, introduce el email de un cliente con perros registrados."
            : "No puede crear reservas para este usuario porque no tiene ningún perro registrado."
        );
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
}, [quickEmail, trainerEmailSet]);


// ---------- Helpers API (fallback de endpoints) ----------
const tryHttpCandidates = async (candidates) => {
  let lastErr = null;
  for (const c of candidates) {
    try {
      return await http(c.path, { auth: true, ...(c.opts || {}) });
    } catch (e) {
      lastErr = e;
      const st = Number(e?.status || e?.httpStatus || 0);
      if (st === 404 || st === 405) continue;
      throw e;
    }
  }
  throw lastErr || new Error('No se pudo completar la operación.');
};

const normalizeBlock = (b) => {
  const id = first(b?.id, b?._id, b?.uuid, '');
  const fecha = first(b?.fecha, b?.date, b?.dia, b?.day, '');
  const horaRaw = first(b?.hora, b?.time, b?.hour, null);
  const hora = horaRaw == null ? '' : String(horaRaw).trim().slice(0, 5);
  const trainerId = first(
    b?.trainer_id,
    b?.trainerId,
    b?.trainer,
    b?.trainer_uid,
    b?.trainerUid,
    ''
  );

  const allDay =
    Boolean(
      b?.allDay ??
        b?.isAllDay ??
        b?.diaCompleto ??
        b?.fullDay ??
        b?.full_day ??
        b?.is_all_day
    ) || !hora;

  const tid = String(trainerId || '').trim();
  const isGlobal =
    !tid || String(b?.scope || '').toLowerCase() === 'global' || b?.isGlobal === true;

  return {
    id: id ? String(id) : '',
    fecha: String(fecha || '').slice(0, 10),
    hora,
    trainerId: tid,
    allDay,
    isGlobal,
    raw: b,
  };
};

const loadBloqueosDiaAdmin = async (fecha) => {
  const f = String(fecha || quickFecha || '').trim();
  if (!f) return;

  setLoadingBlocksDay(true);
  try {
    const qs = new URLSearchParams({ fecha: f });
    const data = await tryHttpCandidates([
      { path: `/api/bloqueos/admin/day?${qs.toString()}`, opts: { method: 'GET' } },
      { path: `/api/reservas/bloqueos/day?${qs.toString()}`, opts: { method: 'GET' } },
      { path: `/api/bloqueos/day?${qs.toString()}`, opts: { method: 'GET' } },
      { path: `/api/reservas/bloqueos?${qs.toString()}`, opts: { method: 'GET' } },
    ]);

    const arr = normList(data?.items || data?.bloqueos || data?.blocks || data || []);
    setBlocksDay(arr.map(normalizeBlock).filter((x) => x.fecha && x.fecha === f));
  } catch (e) {
    setBlocksDay([]);
    showError(serverErrMsg(e, 'No se pudieron cargar los bloqueos del día'));
    setTraceErr({ action: 'GET bloqueos admin day', fecha: f, error: serializeErr(e) });
  } finally {
    setLoadingBlocksDay(false);
  }
};

// Lista de bloqueos futuros (admin) para vista global.
const loadBloqueosListAdmin = async () => {
  setLoadingBlocksList(true);
  try {
    const data = await tryHttpCandidates([
      { path: '/api/bloqueos/admin/list', opts: { method: 'GET' } },
      { path: '/api/reservas/bloqueos', opts: { method: 'GET' } },
    ]);

    const arr = normList(data?.items || data?.bloqueos || data?.blocks || data || []);
    const normalized = arr.map(normalizeBlock).filter((x) => x.fecha);

    // Orden: fecha asc (cercano -> lejano), día completo primero, hora asc.
    const sorted = [...normalized].sort((a, b) => {
      if (a.fecha !== b.fecha) return String(a.fecha).localeCompare(String(b.fecha));
      const aAll = a?.allDay ? 0 : 1;
      const bAll = b?.allDay ? 0 : 1;
      if (aAll !== bAll) return aAll - bAll;
      const ta = a?.allDay ? -1 : parseMin(a?.hora) ?? 1e9;
      const tb = b?.allDay ? -1 : parseMin(b?.hora) ?? 1e9;
      if (ta !== tb) return ta - tb;
      const aScope = a?.isGlobal ? 0 : 1;
      const bScope = b?.isGlobal ? 0 : 1;
      if (aScope !== bScope) return aScope - bScope;
      return String(a?.trainerId || '').localeCompare(String(b?.trainerId || ''));
    });

    setBlocksList(sorted);
  } catch (e) {
    setBlocksList([]);
    showError(serverErrMsg(e, 'No se pudieron cargar los bloqueos (lista)'));
    setTraceErr({ action: 'GET bloqueos admin list', error: serializeErr(e) });
  } finally {
    setLoadingBlocksList(false);
  }
};

const crearBloqueoAvanzado = async () => {
  const fecha = String(quickFecha || '').trim();
  if (!fecha) {
    showError('Falta fecha (YYYY-MM-DD)');
    return;
  }

  const scope = String(blockScope || 'global');
  const type = String(blockType || 'hour');

  const trainerId = scope === 'trainer' ? String(blockTrainerId || '').trim() : '';
  if (scope === 'trainer' && !trainerId) {
    showError('Selecciona un adiestrador para el bloqueo.');
    return;
  }

  const hora = type === 'hour' ? String(quickHora || '').trim() : '';
  if (type === 'hour' && !hora) {
    showError('Falta hora (HH:MM)');
    return;
  }

  const payload = {
    fecha,
    ...(type === 'hour' ? { hora } : { allDay: true, all_day: true, hora: null }),
    ...(scope === 'trainer'
      ? { trainerId, trainer_id: trainerId, scope: 'trainer' }
      : { trainerId: null, trainer_id: null, scope: 'global' }),
    motivo: 'Bloqueo admin',
  };

  try {
    // Preferimos endpoints "nuevos" (A2) y hacemos fallback.
    await tryHttpCandidates([
      { path: '/api/bloqueos/admin', opts: { method: 'POST', data: payload } },
      { path: '/api/bloqueos', opts: { method: 'POST', data: payload } },
      ...(type === 'hour' && scope === 'global'
        ? [{ path: '/api/reservas/bloqueos', opts: { method: 'POST', data: { fecha, hora } } }]
        : []),
    ]);

    showSuccess(type === 'allDay' ? 'Día bloqueado' : 'Hora bloqueada');
    setBlocksDayLoaded(true);
    await loadBloqueosDiaAdmin(fecha);
    if (showBlocksList) await loadBloqueosListAdmin();
    await cargarAdminList();
  } catch (e) {
    showError(serverErrMsg(e, 'No se pudo crear el bloqueo'));
    setTraceErr({ action: 'POST bloqueo admin', payload, error: serializeErr(e) });
  }
};

const eliminarBloqueoAdmin = async (b) => {
  const blk = normalizeBlock(b || {});
  const fecha = blk.fecha || String(quickFecha || '').trim();
  const hora = blk.allDay ? '' : blk.hora;
  const trainerId = blk.isGlobal ? '' : blk.trainerId;

  try {
    if (blk.id) {
      await tryHttpCandidates([
        { path: `/api/bloqueos/admin/${encodeURIComponent(blk.id)}`, opts: { method: 'DELETE' } },
        { path: `/api/bloqueos/${encodeURIComponent(blk.id)}`, opts: { method: 'DELETE' } },
      ]);
    } else {
      const payload = {
        fecha,
        ...(blk.allDay ? { allDay: true, all_day: true, hora: null } : { hora }),
        ...(trainerId
          ? { trainerId, trainer_id: trainerId, scope: 'trainer' }
          : { trainerId: null, trainer_id: null, scope: 'global' }),
      };

      await tryHttpCandidates([
        { path: '/api/bloqueos/admin', opts: { method: 'DELETE', data: payload } },
        { path: '/api/bloqueos', opts: { method: 'DELETE', data: payload } },
        ...(hora && !trainerId
          ? [
              {
                path: `/api/reservas/bloqueos?${new URLSearchParams({ fecha, hora }).toString()}`,
                opts: { method: 'DELETE' },
              },
            ]
          : []),
      ]);
    }

    showSuccess('Bloqueo eliminado');
    setBlocksDayLoaded(true);
    await loadBloqueosDiaAdmin(fecha);
    if (showBlocksList) await loadBloqueosListAdmin();
    await cargarAdminList();
  } catch (e) {
    showError(serverErrMsg(e, 'No se pudo eliminar el bloqueo'));
    setTraceErr({ action: 'DELETE bloqueo admin', bloque: blk, error: serializeErr(e) });
  }
};

// Bloqueo rápido (compat): bloquea una hora global usando los datos actuales
const bloquear = async () => {
  try {
    await tryHttpCandidates([
      { path: '/api/reservas/bloqueos', opts: { method: 'POST', data: { fecha: quickFecha, hora: quickHora } } },
      {
        path: '/api/bloqueos/admin',
        opts: { method: 'POST', data: { fecha: quickFecha, hora: quickHora, trainerId: null, trainer_id: null, scope: 'global' } },
      },
      {
        path: '/api/bloqueos',
        opts: { method: 'POST', data: { fecha: quickFecha, hora: quickHora, trainerId: null, trainer_id: null, scope: 'global' } },
      },
    ]);
    showSuccess('Hora bloqueada');
    setBlocksDayLoaded(true);
    await loadBloqueosDiaAdmin(quickFecha);
    if (showBlocksList) await loadBloqueosListAdmin();
    await cargarAdminList();
  } catch (e) {
    showError(serverErrMsg(e, 'No se pudo bloquear la hora'));
    setTraceErr({ action: 'POST bloquear (rápido)', error: serializeErr(e) });
  }
};

  const reservarParaEmail = async () => {
    if (!/\S+@\S+\.\S+/.test(quickEmail)) {
      showError('Email inválido');
      return;
    }

    if (!quickDogs.length) {
      // Si el email es de un adiestrador, el endpoint /perros/by-email devuelve vacío a propósito.
      const isTrainerEmail = trainerEmailSet.has(String(quickEmail || '').trim().toLowerCase());
      showError(
        isTrainerEmail
          ? 'Ese email pertenece a un adiestrador. Introduce el email de un cliente con perros registrados.'
          : 'No puede crear reservas para este usuario porque no tiene ningún perro registrado.'
      );
      return;
    }
    if (!quickDogIds.length) {
      showError('Selecciona al menos un perro para la reserva.');
      return;
    }
    if (!quickTrainerId) {
      showError('Selecciona un adiestrador para la reserva.');
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
          status: 'pending_user',
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
    const pastAll = [];
    const cancelled = [];

    for (const r of adminList) {
      const s = String(r.status || '').toLowerCase();
      const origin = String(r.origin || '').toLowerCase();

      // Todo lo pasado va a "Reservas pasadas" (independiente del status)
      if (isPastFechaHora(r?.fecha, r?.hora)) {
        pastAll.push(r);
        continue;
      }

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
      past: sortByDT(pastAll),
      cancelled: sortByDT(cancelled),
    };
  }, [adminList]);


const blocksDayView = useMemo(() => {
  const arr = Array.isArray(blocksDay) ? blocksDay : [];
  const today = new Date().toISOString().slice(0, 10);

  // La fuente de verdad está en backend, pero en UI asumimos:
  // - solo bloqueos futuros
  // - hoy: solo horas que no han pasado
  if (quickFecha && String(quickFecha) < today) return [];

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const parseMin = (hhmm) => {
    const s = String(hhmm || '').trim();
    const [hh, mm = '0'] = s.split(':');
    const h = Number(hh);
    const m = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };

  const filtered = arr.filter((b) => {
    if (!b) return false;

    // Si vemos "hoy", ocultamos horas pasadas (defensa extra por si backend no filtra aún)
    if (quickFecha && String(quickFecha) === today && !b.allDay) {
      const t = parseMin(b.hora);
      if (t != null && t < nowMin) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    // Día completo primero
    const aAll = a?.allDay ? 0 : 1;
    const bAll = b?.allDay ? 0 : 1;
    if (aAll !== bAll) return aAll - bAll;

    // Hora ascendente
    const ta = a?.allDay ? -1 : parseMin(a?.hora) ?? 1e9;
    const tb = b?.allDay ? -1 : parseMin(b?.hora) ?? 1e9;
    if (ta !== tb) return ta - tb;

    // Global antes que adiestrador
    const aScope = a?.isGlobal ? 0 : 1;
    const bScope = b?.isGlobal ? 0 : 1;
    if (aScope !== bScope) return aScope - bScope;

    return String(a?.trainerId || '').localeCompare(String(b?.trainerId || ''));
  });
}, [blocksDay, quickFecha]);

const blocksListView = useMemo(() => {
  const arr = Array.isArray(blocksList) ? blocksList : [];
  return arr;
}, [blocksList]);

  const verBloqueosDia = async () => {
    setBlocksDayLoaded(true);
    await loadBloqueosDiaAdmin(quickFecha);
  };

  const toggleBlocksList = async () => {
    const next = !showBlocksList;
    setShowBlocksList(next);
    if (next) {
      await loadBloqueosListAdmin();
    }
  };



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
              {!quickDisplayedHours.length && (
                <option value="">Cerrado (no reservas)</option>
              )}
              {quickDisplayedHours.map((h) => {
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
            <button
              className="btn-primary"
              onClick={reservarParaEmail}
              disabled={!quickEmail || !servicioId || !quickFecha || !quickHora || !!quickDogsWarn || (quickDogs.length > 0 && quickDogIds.length === 0)}
            >
              Crear reserva
            </button>
          </div>
        </div>
      </section>


{/* Bloqueos avanzados (admin) */}
<section className="admin-blocks" style={{ marginTop: 16 }}>
  <h2>Bloqueos avanzados (admin)</h2>

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
      Aplica a
      <select
        value={blockScope}
        onChange={(e) => {
          const v = e.target.value;
          setBlockScope(v);
          if (v !== 'trainer') setBlockTrainerId('');
        }}
      >
        <option value="global">Global (todos)</option>
        <option value="trainer">Adiestrador concreto</option>
      </select>
    </label>

    <label>
      Tipo
      <select
        value={blockType}
        onChange={(e) => setBlockType(e.target.value)}
      >
        <option value="hour">Hora</option>
        <option value="allDay">Día completo</option>
      </select>
    </label>

    {blockType === 'hour' && (
      <label>
        Hora
        <select
          value={quickHora}
          onChange={(e) => setQuickHora(e.target.value)}
        >
          {!quickDisplayedHours.length && (
            <option value="">Cerrado (no reservas)</option>
          )}
          {quickDisplayedHours.map((h) => {
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
    )}

    {blockScope === 'trainer' && (
      <label>
        Adiestrador
        <select
          value={blockTrainerId}
          onChange={(e) => setBlockTrainerId(e.target.value)}
          disabled={loadingTrainers}
        >
          <option value="">Selecciona…</option>
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
    )}

    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <button
        className="btn-danger"
        onClick={crearBloqueoAvanzado}
        disabled={!quickFecha || (blockType === "hour" && !quickHora)}
      >
        Crear bloqueo
      </button>
      <button className="btn-ghost" onClick={verBloqueosDia}>
        Ver bloqueos del día
      </button>
    </div>
  </div>

  <div style={{ marginTop: 10 }}>
    <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
      Bloqueos del día{' '}
      <span style={{ opacity: 0.75 }}>(solo futuros; hoy solo horas no pasadas)</span>
    </div>

    {loadingBlocksDay ? (
      <div className="empty">Cargando…</div>
    ) : !blocksDayLoaded ? (
      <div className="empty">Selecciona un día y pulsa “Ver bloqueos del día”.</div>
    ) : !blocksDayView.length ? (
      <div className="empty">No hay bloqueos para esta fecha.</div>
    ) : (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {blocksDayView.map((b, idx) => {
          const labelHora = b.allDay ? 'Día completo' : b.hora || '—';
          const scopeLabel = b.isGlobal
            ? 'Global'
            : trainerNameById.get(b.trainerId) || b.trainerId || 'Adiestrador';
          const key = b.id || `${b.fecha}-${b.hora}-${b.trainerId}-${idx}`;
          return (
            <span
              key={key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid #e6e6e6',
                borderRadius: 16,
                padding: '6px 10px',
                background: '#fff',
              }}
              title={b.id ? `id: ${b.id}` : ''}
            >
              <b>{labelHora}</b>
              <span style={{ opacity: 0.8 }}>{scopeLabel}</span>
              <button
                className="btn-ghost"
                onClick={() => eliminarBloqueoAdmin(b)}
                title="Eliminar bloqueo"
                style={{ padding: '2px 8px' }}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
    )}
  </div>

  <div style={{ marginTop: 14 }}>
    <button
      className="btn-ghost"
      onClick={toggleBlocksList}
      style={{ marginBottom: 6 }}
    >
      {showBlocksList ? 'Ocultar lista de bloqueos' : 'Ver lista de bloqueos'}
    </button>

    {showBlocksList && (
      <>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
          Lista de bloqueos futuros (ordenados por fecha/hora)
        </div>

    {loadingBlocksList ? (
      <div className="empty">Cargando…</div>
    ) : !blocksListView.length ? (
      <div className="empty">No hay bloqueos futuros.</div>
    ) : (
      <div style={{ display: 'grid', gap: 8 }}>
        {blocksListView.map((b, idx) => {
          const labelHora = b.allDay ? 'Día completo' : b.hora || '—';
          const scopeLabel = b.isGlobal
            ? 'Global'
            : trainerNameById.get(b.trainerId) || b.trainerId || 'Adiestrador';
          const key = b.id || `${b.fecha}-${b.hora}-${b.trainerId}-${idx}`;
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                border: '1px solid #e6e6e6',
                borderRadius: 14,
                padding: '8px 10px',
                background: '#fff',
              }}
              title={b.id ? `id: ${b.id}` : ''}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <b>{b.fecha}</b>
                <span>{labelHora}</span>
                <span style={{ opacity: 0.8 }}>· {scopeLabel}</span>
              </div>
              <button
                className="btn-ghost"
                onClick={() => eliminarBloqueoAdmin(b)}
                title="Eliminar bloqueo"
                style={{ padding: '2px 10px' }}
              >
                Eliminar
              </button>
            </div>
          );
        })}
      </div>
    )}
      </>
    )}
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
              hideIfEmpty: true,
            },
            {
              title: 'Confirmadas (próximas)',
              items: adminBuckets.confirmed,
              actions: true, // aquí el admin puede rechazar
            },
            {
              title: 'Reservas pasadas (todas)',
              items: adminBuckets.past,
              actions: false,
              readOnly: true,
              allowDelete: true,
            },
            {
              title: 'Canceladas / Rechazadas',
              items: adminBuckets.cancelled,
              actions: false,
            },
          ].filter((g) => !(g.hideIfEmpty && !g.items.length)).map((group) => (
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
                    const canDelete =
                      !!group.allowDelete ||
                      ['cancelled', 'cancelada', 'rejected', 'rechazada', 'deleted', 'eliminada'].includes(rawStatus);

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

                        {!group.readOnly && (
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

                        {!group.readOnly && (
                          <>
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
                          </>
                        )}

                        {!group.readOnly && isOpen && (
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
                                notes.map((n, idx) => (
                                  <div
                                    key={noteIdOf(n) || `${r.id}-note-${idx}`}
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
                                      <b>{labelAutorNota(n)}</b>{' '}
                                      · {relativeTime(noteCreatedAt(n))}
                                    </div>
                                    <div
                                      className="note-text"
                                      style={{ whiteSpace: 'pre-wrap' }}
                                    >
                                      {noteText(n)}
                                    </div>
                                    <div
                                      className="note-actions"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 6,
                                      }}
                                    >
                                      {n?.canDelete === true && (
                                        <button
                                          className="btn-ghost"
                                          onClick={() =>
                                            deleteNote(r.id, noteIdOf(n))
                                          }
                                          title="Borrar nota"
                                        >
                                          🗑️
                                        </button>
                                      )}
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
