// frontend/src/helpers/reservas.js

/* ========= utilidades base ========= */
export const toStr = (v) => (v === undefined || v === null) ? '' : String(v);
export const norm  = (s) => toStr(s).toLowerCase();
export const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '';

export const padHHMM = (x) => {
  if (!x) return x;
  const [h, m = '00'] = String(x).split(':');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayYMD = () => ymd(new Date());

export const addMinutes = (hhmm, mins) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const total = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m) + Number(mins || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export const humanDate = (iso) => {
  try {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' });
  } catch { return iso; }
};

/* ========= errores / mensajes ========= */
export const serializeErr = (e) => ({
  message: e?.message || String(e),
  status:   e?.status,
  url:      e?.url || e?.config?.url,
  method:   e?.config?.method,
  httpStatus: e?.response?.status || e?.status,
  responseData: e?.responseData || e?.response?.data || e?.data
});

export const serverErrMsg = (e, fb = 'Ocurrió un error') => {
  const data = e?.responseData || e?.data || e?.response?.data;
  return data?.error || data?.message || e?.message || fb;
};

/* ========= estados ========= */
export function canonStatus(s) {
  const x = norm(s);
  if (['pending','pendiente'].includes(x)) return 'pending';
  if (['confirmed','confirmada','confirmado'].includes(x)) return 'confirmed';
  if (['cancelled','cancelada','cancelado'].includes(x)) return 'cancelled';
  if (['rejected','rechazada','rechazado'].includes(x)) return 'rejected';
  if (['deleted','eliminada','eliminado'].includes(x)) return 'deleted';
  return x || '';
}

export function isEditableStatus(status) {
  const s = canonStatus(status);
  return !['cancelled', 'rejected', 'deleted'].includes(s);
}

/* ========= normalizadores ========= */
export function normalizeReserva(r) {
  if (!r || typeof r !== 'object') return null;

  const id             = first(r.id, r._id, r.uuid, r.pk);
  const fecha          = first(r.fecha, r.date, r.dia, r.day);
  const hora           = padHHMM(first(r.hora, r.time, r.slot));
  const modalidad      = first(r.modalidad, r.mode, r.modality, 'presencial');

  const statusRaw      = first(r.status, r.state, r.estatus, r.estado);
  const status         = canonStatus(statusRaw);

  const servicioTitulo = first(
    r.servicioTitulo, r.serviceTitle, r.tituloServicio,
    r.servicio?.title, r.servicio?.titulo, r.servicio?.name,
    r.servicio, r.titulo, r.title, 'Servicio'
  );

  const email          = first(r.email, r.userEmail, r.user_email, r.uid, r.usuario?.email, r.user?.email);

  const adminNote = first(
    r.adminNote, r.admin_note, r.notaAdmin, r.nota_admin, r.note_admin, r.note
  );
  const userNote  = first(
    r.userNote, r.user_note, r.notaUsuario, r.nota_usuario, r.noteUser, r.comentario, r.comment
  );

  const cancelReason = first(
    r.cancelReason, r.motivo_cancelacion, r.motivoCancelacion, r.motivo, r.reason
  );

  const origin = first(r.origin, r.origen, 'directo');

  return {
    ...r,
    id,
    fecha,
    hora,
    modalidad,
    status,
    statusRaw,
    servicioTitulo,
    email,
    adminNote: toStr(adminNote),
    userNote:  toStr(userNote),
    cancelReason: toStr(cancelReason),
    origin
  };
}

export const normList = (arr) => Array.isArray(arr) ? arr.map(normalizeReserva).filter(Boolean) : [];

/* ========= calendario / horas ========= */
export const HOURS = Array.from({ length: 12 }, (_, i) => i + 9).filter(h => h !== 14 && h !== 15);

/* ========= disponibilidad ========= */
export function parseDisponibilidad(data) {
  let libres = data?.slots ?? data?.libres ?? data?.available ?? [];
  if (Array.isArray(libres) && libres.length && typeof libres[0] === 'object') {
    libres = libres.map(x => x.hora || x.time || x.slot || x.start || x.start_local).filter(Boolean);
  }
  libres = libres.map(padHHMM);

  let ocup = data?.unavailable ?? data?.ocupadas ?? data?.busy ?? [];
  if (ocup.length && typeof ocup[0] === 'object') {
    ocup = ocup.map(x => x.hora || x.time || x.slot || x.start || x.start_local).filter(Boolean);
  }
  if (!ocup.length && Array.isArray(data?.reservas)) {
    ocup = normList(data.reservas)
      .filter(r => !['cancelled', 'rejected', 'deleted'].includes(canonStatus(r.status || r.statusRaw)))
      .map(r => padHHMM(r.hora))
      .filter(Boolean);
  }

  return { ocup: ocup.map(padHHMM), libres };
}

/* ========= ayudas varias ========= */
export const DEFAULT_MODALITIES = ['presencial', 'online', 'a domicilio'];

export function makeNotePayload(val) {
  const v = toStr(val).trim();
  return { note: v, admin_note: v, nota_admin: v, adminNote: v };
}

export function makeNotePayloadWithStatus(val, statusValue) {
  const v = toStr(val).trim();
  const s = canonStatus(statusValue) || 'pending';
  return { status: s, ...makeNotePayload(v) };
}
