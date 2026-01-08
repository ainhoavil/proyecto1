// frontend/src/pages/contratar.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { http } from '../helpers/http';

/* ===================== utilidades ===================== */
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
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
const getTrainerId = (t) => String(t?.uid ?? t?.id ?? '').trim();

const getDogId = (p) => String(p?.id ?? p?.uid ?? p?._id ?? '').trim();
const DISPLAY_HOURS = { start: 9, end: 20, skip: new Set([14, 15]) };

function dayOfWeekFromYMD(ymdStr) {
  const s = String(ymdStr || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d).getDay(); // local time
}

function getDisplayedHourSlots(fechaYmd) {
  const dow = dayOfWeekFromYMD(fechaYmd);
  // Domingos: cerrado
  if (dow === 0) return [];

  const out = [];
  for (let h = DISPLAY_HOURS.start; h <= DISPLAY_HOURS.end; h++) {
    if (DISPLAY_HOURS.skip.has(h)) continue;
    out.push(`${String(h).padStart(2, '0')}:00`);
  }

  // Sábados: a partir de las 14:00 no disponible (13:00 es la última hora)
  if (dow === 6) return out.filter((t) => Number(String(t).slice(0, 2)) < 14);

  return out;
}

function padHHMM(x) {
  if (!x) return '';
  const [h, m = '00'] = String(x).trim().split(':');
  if (!h) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeTimeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => padHHMM(x)).filter(Boolean);
  if (typeof v === 'object') {
    // soporta formatos tipo { "09:00": true, "10:00": false }
    return Object.entries(v)
      .filter(([, val]) => !!val)
      .map(([k]) => padHHMM(k))
      .filter(Boolean);
  }
  return [];
}

/* ====================================================== */

// Nota: en esta pantalla permitimos reservar para 1 o varios perros.
// El campo "perro" que enviamos al backend se mantiene como JSON string por compatibilidad.

export default function Contratar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const { isAuthenticated, user, loading } = useAuth();
  const authReady = !loading && isAuthenticated;
  const userEmail = (user?.email || '').trim();

  /* =====================================================
      LOGIN FORZADO SI NO HAY SESIÓN
  ====================================================== */
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      const next = `${location.pathname}${location.search || ''}` || '/contratar';
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [loading, isAuthenticated, navigate, location.pathname, location.search]);

  /* ===================== cargar servicios ===================== */
  const [servicios, setServicios] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const list = await http('/api/servicios');
        const arr = Array.isArray(list) ? list : list?.items || list?.servicios || [];
        arr.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
        setServicios(arr);
      } catch (e) {
        console.error('Error cargando servicios', e);
        setServicios([]);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  /* ===== servicio / modalidad inicial ===== */
  const servicioParam = params.get('servicio') || location.state?.servicio || '';
  const modalidadParam = params.get('modalidad') || location.state?.modalidad || '';
  const trainerParam = params.get('trainerId') || location.state?.trainerId || '';

  const [servicioId, setServicioId] = useState(servicioParam);

  const servicioSel = useMemo(() => {
    if (!servicioId) return null;
    return (
      servicios.find((s) => {
        const sid = String(s?.id ?? '');
        const s_id = String(s?._id ?? '');
        const suuid = String(s?.uuid ?? '');
        const stitle = String(s?.title ?? '');
        const reminder = String(servicioId ?? '');
        return sid === reminder || s_id === reminder || suuid === reminder || stitle === reminder;
      }) || null
    );
  }, [servicios, servicioId]);

  // ✅ ID real del servicio (evita undefined)
  const servicioIdResolved = useMemo(() => {
    if (!servicioSel) return String(servicioId || '').trim();
    return String(servicioSel.id || servicioSel._id || servicioSel.uuid || servicioId || '').trim();
  }, [servicioSel, servicioId]);

  const durationMin = useMemo(() => {
    if (servicioSel?.durationMin) return Number(servicioSel.durationMin);
    const txt = servicioSel?.duration || '';
    const m = String(txt).match(/(\d+)\s*min/i);
    return m ? Number(m[1]) : 60;
  }, [servicioSel]);

  /* ===== modalidades ===== */
  const allowedModalities = useMemo(() => {
    if (!servicioSel) return ['presencial'];

    const title = String(servicioSel.title || '').toLowerCase();

    if (title.includes('obediencia')) return ['presencial', 'online', 'a domicilio'];
    if (title.includes('básico') || title.includes('basico')) return ['presencial', 'online', 'a domicilio'];
    if (title.includes('paseo')) return ['presencial', 'a domicilio'];

    if (Array.isArray(servicioSel.modalities) && servicioSel.modalities.length) return servicioSel.modalities;

    const fromMode = String(servicioSel.mode || '').toLowerCase();
    const set = new Set();
    if (fromMode.includes('presencial')) set.add('presencial');
    if (fromMode.includes('online')) set.add('online');
    if (fromMode.includes('domicilio')) set.add('a domicilio');

    if (set.size === 0) set.add('presencial');
    return Array.from(set);
  }, [servicioSel]);

  const [modalidad, setModalidad] = useState(modalidadParam || 'presencial');

  useEffect(() => {
    if (!allowedModalities.length) return;

    if (modalidadParam && allowedModalities.includes(modalidadParam)) {
      setModalidad(modalidadParam);
      return;
    }
    if (!allowedModalities.includes(modalidad)) {
      setModalidad(allowedModalities[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedModalities, modalidadParam]);

  /* ===== wizard ===== */
  const [step, setStep] = useState(servicioParam ? 1 : 0);
  const atras = () => setStep((s) => Math.max(s - 1, 0));

  /* =====================================================
         ADIESTRADORES COMPATIBLES
  ====================================================== */
  const [trainers, setTrainers] = useState([]);
  const [loadingTrainers, setLoadingTrainers] = useState(false);

  const [trainerChoice, setTrainerChoice] = useState(() => {
    const tid = String(trainerParam || '').trim();
    return tid ? tid : 'any';
  }); // 'any' | '<id>'

  const [trainersErr, setTrainersErr] = useState('');
  const [trainerHint, setTrainerHint] = useState('');

  const canLoadTrainers = !!servicioIdResolved && !!modalidad && authReady;

  const loadEligibleTrainers = async () => {
    if (!canLoadTrainers) return;

    setLoadingTrainers(true);
    setTrainersErr('');
    setTrainerHint('');

    try {
      const qs = new URLSearchParams({
        servicioId: String(servicioIdResolved),
        modalidad: String(modalidad || '')
      });

      const data = await http(`/api/trainers/eligible?${qs.toString()}`, { auth: true });
      const arr = Array.isArray(data) ? data : data?.items || [];
      setTrainers(arr);

      if (trainerChoice !== 'any') {
        const ok = arr.some((t) => getTrainerId(t) === String(trainerChoice));
        if (!ok) {
          setTrainerChoice('any');
          setTrainerHint(
            'El adiestrador seleccionado no está disponible para este servicio/modalidad. Se ha cambiado a “Cualquiera disponible”.'
          );
        }
      }
    } catch (e) {
      console.error('Error cargando trainers elegibles', e);
      setTrainers([]);
      setTrainersErr('No se pudo cargar la lista de adiestradores disponibles.');
      setTrainerChoice('any');
      setTrainerHint('');
    } finally {
      setLoadingTrainers(false);
    }
  };

  useEffect(() => {
    if (!canLoadTrainers) return;
    loadEligibleTrainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadTrainers, servicioIdResolved, modalidad]);

  const hasAnyEligibleTrainer = useMemo(() => trainers.length > 0, [trainers]);

  const selectedTrainerInList = useMemo(() => {
    if (trainerChoice === 'any') return true;
    return trainers.some((t) => getTrainerId(t) === String(trainerChoice));
  }, [trainers, trainerChoice]);

  const selectedTrainer = useMemo(() => {
    if (trainerChoice === 'any') return null;
    return trainers.find((t) => getTrainerId(t) === String(trainerChoice)) || null;
  }, [trainers, trainerChoice]);

  /* =====================================================
        CALENDARIO + DISPONIBILIDAD
  ====================================================== */
  const [mesBase, setMesBase] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [fecha, setFecha] = useState(todayYMD());
  const [hora, setHora] = useState('');
  const [horasLibres, setHorasLibres] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityHint, setAvailabilityHint] = useState('');

  const cargarDisponibilidad = async (f) => {
    const day = String(f || '').trim();
    if (!day) return;

    const displayedSlots = getDisplayedHourSlots(day);

    if (!displayedSlots.length) {
      setHorasLibres([]);
      setUnavailable([]);
      setAvailabilityHint('No hay disponibilidad para esta fecha (centro cerrado).');
      setLoadingAvailability(false);
      return;
    }

    setLoadingAvailability(true);
    setAvailabilityHint('');

    try {
      const fetchDisponibilidad = async (trainerIdOrNull) => {
        const qs = new URLSearchParams({
          fecha: day,
          durationMin: String(durationMin)
        });

        if (trainerIdOrNull) qs.set('trainerId', String(trainerIdOrNull));

        return await http(`/api/reservas/disponibilidad?${qs.toString()}`);
      };

      // === ADIESTRADOR CONCRETO ===
      if (trainerChoice && trainerChoice !== 'any') {
        const data = await fetchDisponibilidad(trainerChoice);

        const libresRaw = data?.libres ?? data?.slots ?? data?.available ?? [];
        const ocupadasRaw = data?.unavailable ?? data?.ocupadas ?? data?.busy ?? [];

        const libres = normalizeTimeArray(libresRaw);
        const ocupadas = normalizeTimeArray(ocupadasRaw);

        const libresOrdered = displayedSlots.filter((t) => libres.includes(t));

        setHorasLibres(libresOrdered);
        setUnavailable(Array.isArray(ocupadas) ? ocupadas : []);

        if (hora && !libresOrdered.includes(hora)) {
          setHora('');
          setAvailabilityHint(
            '⚠️ El adiestrador seleccionado no está disponible en la hora elegida. Elige otra hora u otro adiestrador.'
          );
        } else if (day && libresOrdered.length === 0) {
          setAvailabilityHint('⚠️ No hay horas disponibles para este adiestrador en la fecha seleccionada.');
        }

        return;
      }

      // === CUALQUIERA (ANY) ===
      // Regla: un slot es "libre" si al menos 1 adiestrador lo tiene libre.
      const eligible = Array.isArray(trainers) ? trainers : [];
      const ids = eligible.map(getTrainerId).filter(Boolean);

      if (!ids.length) {
        setHorasLibres([]);
        setUnavailable(displayedSlots);
        setAvailabilityHint('⚠️ No hay adiestradores disponibles para este servicio y modalidad.');
        if (hora) setHora('');
        return;
      }

      const settled = await Promise.allSettled(ids.map((id) => fetchDisponibilidad(id)));

      const union = new Set();
      let okCount = 0;

      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        okCount += 1;

        const data = r.value;
        const libresRaw = data?.libres ?? data?.slots ?? data?.available ?? [];
        const libres = normalizeTimeArray(libresRaw);

        for (const t of libres) union.add(t);
      }

      const libresUnion = displayedSlots.filter((t) => union.has(t));

      setHorasLibres(libresUnion);
      setUnavailable(libresUnion.length ? [] : displayedSlots);

      if (hora && !union.has(hora)) {
        setHora('');
        setAvailabilityHint(
          '⚠️ La hora seleccionada ya no está disponible para ningún adiestrador. Elige otra hora u otro adiestrador.'
        );
      } else if (libresUnion.length === 0) {
        setAvailabilityHint('⚠️ No hay horas disponibles en esa fecha para ningún adiestrador.');
      } else if (okCount < ids.length) {
        setAvailabilityHint('ℹ️ Se han calculado las horas con la disponibilidad disponible en este momento.');
      }
    } catch (e) {
      console.error('Error disponibilidad', e);
      setHorasLibres([]);
      setUnavailable(getDisplayedHourSlots(fecha));
      setAvailabilityHint('❌ No se pudo cargar la disponibilidad. Inténtalo de nuevo.');
      if (hora) setHora('');
    } finally {
      setLoadingAvailability(false);
    }
  };

  useEffect(() => {
    if (fecha) cargarDisponibilidad(fecha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, durationMin, trainerChoice, trainers]);

  const isSlotBusy = (t) => {
    if (loadingAvailability) return true;
    if (horasLibres.length) return !horasLibres.includes(t);
    return new Set(unavailable).has(t);
  };

  /* =====================================================
         PERROS
  ====================================================== */
  const [perros, setPerros] = useState([]);
  const [perroIds, setPerroIds] = useState([]); // selección múltiple
  const [showNewDogForm, setShowNewDogForm] = useState(false);
  const [perroNoGuardado, setPerroNoGuardado] = useState(null); // perro añadido solo para esta reserva

  const [nuevoPerro, setNuevoPerro] = useState({
    nombre: '',
    nacimiento: '',
    razaTamaño: '',
    castrado: false,
    observaciones: ''
  });

  const [savingDog, setSavingDog] = useState(false);
  const [dogMsg, setDogMsg] = useState('');

  const togglePerroId = (id) => {
    const pid = String(id || '').trim();
    if (!pid) return;
    setPerroIds((prev) => {
      const arr = Array.isArray(prev) ? prev.map((x) => String(x || '').trim()).filter(Boolean) : [];
      const has = arr.includes(pid);
      return has ? arr.filter((x) => x !== pid) : Array.from(new Set([...arr, pid]));
    });
  };

  const perrosSeleccionados = useMemo(() => {
    const ids = new Set((Array.isArray(perroIds) ? perroIds : []).map((x) => String(x || '').trim()).filter(Boolean));
    if (!ids.size) return [];
    return (Array.isArray(perros) ? perros : []).filter((p) => ids.has(getDogId(p)));
  }, [perroIds, perros]);

  useEffect(() => {
    (async () => {
      if (!authReady) return;
      try {
        const list = await http('/perros', { auth: true });
        const arr = Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : [];

        const activos = arr.filter((p) => !p.archived);
        setPerros(activos);

        // mantener selección si sigue existiendo
        const aliveIds = new Set(activos.map(getDogId).filter(Boolean));
        setPerroIds((prev) => {
          const base = Array.isArray(prev) ? prev.map((x) => String(x || '').trim()).filter(Boolean) : [];
          const kept = base.filter((x) => aliveIds.has(x));
          if (kept.length) return kept;
          // si solo hay 1 perro guardado, lo auto-seleccionamos
          if (activos.length === 1) {
            const onlyId = getDogId(activos[0]);
            return onlyId ? [onlyId] : [];
          }
          return [];
        });

        setShowNewDogForm(activos.length === 0);
      } catch (e) {
        console.error('Error cargando perros', e);
        setPerros([]);
        setPerroIds([]);
        setShowNewDogForm(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  const canSaveNewDog = useMemo(() => {
    const nombreOk = !!nuevoPerro.nombre.trim();
    const razaOk = !!nuevoPerro.razaTamaño.trim();
    const nacOk = !!String(nuevoPerro.nacimiento || '').trim();
    return nombreOk && razaOk && nacOk;
  }, [nuevoPerro.nombre, nuevoPerro.razaTamaño, nuevoPerro.nacimiento]);

  const canContinueNewDogWithoutSaving = useMemo(() => {
    return !!nuevoPerro.nombre.trim();
  }, [nuevoPerro.nombre]);

  const crearPerro = async () => {
    setDogMsg('');

    if (!canSaveNewDog) {
      setDogMsg('⚠️ Para guardar el perro necesitas nombre, raza/tamaño y fecha de nacimiento.');
      return null;
    }

    setSavingDog(true);

    try {
      const body = {
        nombre: nuevoPerro.nombre.trim(),
        raza: nuevoPerro.razaTamaño.trim(),
        nacimiento: String(nuevoPerro.nacimiento || '').trim(),
        notas: nuevoPerro.observaciones.trim() || '',
        castrado: !!nuevoPerro.castrado,
        avatarURL: '',
        archived: false
      };

      const created = await http('/perros', {
        method: 'POST',
        data: body,
        auth: true
      });

      const createdItem = created?.item || created || { id: created?.id, ...body };
      const createdId = getDogId(createdItem) || String(created?.id || '').trim();

      setPerros((prev) => [...prev, createdItem]);

      // ✅ seleccionar el creado sin perder selección previa
      if (createdId) {
        setPerroIds((prev) => Array.from(new Set([...(Array.isArray(prev) ? prev : []), createdId])));
      }
      setShowNewDogForm(false);

      // limpiar formulario
      setNuevoPerro({
        nombre: '',
        nacimiento: '',
        razaTamaño: '',
        castrado: false,
        observaciones: ''
      });

      // si había un perro "no guardado" de esta reserva, lo mantenemos (no lo tocamos)

      const name = String(createdItem?.nombre || '').trim();
      setDogMsg(name ? `✅ ${name} añadido a tu perfil.` : '✅ Perro añadido a tu perfil.');
      return createdItem;
    } catch (e) {
      console.error('Error creando perro', e);
      setDogMsg('❌ No se pudo guardar el perro.');
      return null;
    } finally {
      setSavingDog(false);
    }
  };

  const continuarSinGuardarPerro = () => {
    setDogMsg('');

    if (!canContinueNewDogWithoutSaving) {
      setDogMsg('⚠️ Indica al menos el nombre del perro para continuar.');
      return;
    }

    setPerroNoGuardado({
      id: '',
      nombre: nuevoPerro.nombre.trim(),
      razaTamaño: String(nuevoPerro.razaTamaño || '').trim(),
      nacimiento: String(nuevoPerro.nacimiento || '').trim(),
      castrado: !!nuevoPerro.castrado,
      observaciones: String(nuevoPerro.observaciones || '').trim()
    });

    setStep(3);
  };

  const perrosParaReserva = useMemo(() => {
    const base = (Array.isArray(perrosSeleccionados) ? perrosSeleccionados : []).map((p) => ({
      id: getDogId(p) || '',
      nombre: String(p?.nombre || '').trim(),
      razaTamaño: String(p?.raza || p?.razaTamaño || '').trim(),
      nacimiento: String(p?.nacimiento || '').trim(),
      castrado: !!p?.castrado,
      observaciones: String(p?.notas || p?.observaciones || '').trim()
    }));

    const extra = perroNoGuardado && String(perroNoGuardado?.nombre || '').trim()
      ? [{
          id: '',
          nombre: String(perroNoGuardado.nombre || '').trim(),
          razaTamaño: String(perroNoGuardado.razaTamaño || '').trim(),
          nacimiento: String(perroNoGuardado.nacimiento || '').trim(),
          castrado: !!perroNoGuardado.castrado,
          observaciones: String(perroNoGuardado.observaciones || '').trim()
        }]
      : [];

    // dedupe por (id) cuando exista
    const seen = new Set();
    const out = [];
    for (const d of [...base, ...extra]) {
      const key = d.id ? `id:${d.id}` : `name:${d.nombre.toLowerCase()}|${d.razaTamaño.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (d.nombre) out.push(d);
    }
    return out;
  }, [perrosSeleccionados, perroNoGuardado]);

  /* =====================================================
         CONTACTO
  ====================================================== */
  const [contacto, setContacto] = useState({ telefono: '', direccion: '' });
  const domicilio = modalidad === 'a domicilio';

  useEffect(() => {
    if (!authReady) return;

    let cancel = false;

    (async () => {
      try {
        const data = await http('/perfil', { auth: true });
        if (cancel) return;

        const prof = data?.profile || data || {};
        const prefix = String(prof.prefix || '').trim();
        const phone = String(prof.phone || prof.telefono || '').trim();
        const address = String(prof.address || prof.direccion || '').trim();

        const tel = phone ? [prefix, phone].filter(Boolean).join(' ').trim() : '';

        if (!tel && !address) return;

        setContacto((prev) => ({
          telefono: String(prev?.telefono || '').trim() ? prev.telefono : tel,
          direccion: String(prev?.direccion || '').trim() ? prev.direccion : address
        }));
      } catch {
        // optional
      }
    })();

    return () => {
      cancel = true;
    };
  }, [authReady]);

  const telefonoValido = contacto.telefono.trim().length >= 6;
  const direccionValida = !domicilio || contacto.direccion.trim().length > 5;
  const perroValido = Array.isArray(perrosParaReserva) && perrosParaReserva.length > 0;

  /* =====================================================
         CONFIRMAR RESERVA
  ====================================================== */
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const confirmar = async () => {
    setMsg('');

    if (!authReady) return setMsg('Cargando sesión…');
    if (!telefonoValido) return setMsg('Indica un teléfono válido.');
    if (!perroValido) return setMsg('Selecciona al menos un perro.');
    if (domicilio && !direccionValida) return setMsg('Indica dirección para modalidad a domicilio.');

    if (!hasAnyEligibleTrainer) {
      return setMsg('❌ No hay adiestradores disponibles para este servicio y modalidad.');
    }

    setGuardando(true);

    try {
      let perroToSend = null;
      try {
        const arr = Array.isArray(perrosParaReserva) ? perrosParaReserva : [];
        perroToSend = arr.length
          ? JSON.stringify(
              arr.map((p) => ({
                id: String(p.id || '').trim(),
                nombre: String(p.nombre || '').trim(),
                raza: String(p.razaTamaño || '').trim(),
                nacimiento: p.nacimiento ? String(p.nacimiento) : null
              }))
            )
          : null;
      } catch {
        perroToSend = null;
      }

      const payload = {
        email: userEmail,
        fecha,
        hora,

        servicioId: servicioIdResolved,
        servicioTitulo: servicioSel?.title,

        modalidad,
        duration: servicioSel?.duration,
        durationMin,
        price: servicioSel?.price ?? null,
        currency: servicioSel?.currency || 'EUR',

        perro: perroToSend,
        telefono: contacto.telefono,
        direccion: contacto.direccion,
        pricing: {},

        trainerId: trainerChoice
      };

      await http('/api/reservas', {
        method: 'POST',
        data: payload,
        auth: true
      });

      setMsg('✅ Reserva creada. Redirigiendo…');
      setTimeout(() => navigate('/reservas', { replace: true }), 800);
    } catch (e) {
      console.error('Error creando reserva', e);

      const status = e?.status || e?.httpStatus || 0;
      const serverMsg = e?.data?.error || e?.data?.message || e?.message || '';

      if (status === 409) {
        setMsg('❌ Ese adiestrador ya no está disponible en esa hora. Elige otra hora u otro adiestrador.');
        setStep(1);
      } else {
        setMsg(serverMsg ? `❌ ${serverMsg}` : '❌ No se pudo crear la reserva.');
      }
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <div className="card">Cargando…</div>;

  /* ======================= RENDER ======================= */
  return (
    <div className="card contratar-page">
      <h1>Contratar servicio</h1>

      {/* STEPPER */}
      <ol
        style={{
          display: 'flex',
          gap: 8,
          listStyle: 'none',
          padding: 0,
          marginBottom: 16
        }}
      >
        {['Servicio', 'Fecha y hora', 'Datos del perro', 'Contacto', 'Resumen'].map((t, i) => (
          <li
            key={t}
            style={{
              padding: '4px 8px',
              borderRadius: 8,
              /* Color activo alineado con la paleta de la app (naranja suave) */
              background: i === step ? '#FBEDE3' : '#f3f3f3',
              border: i === step ? '1px solid #E68A4E' : '1px solid #e3e3e3',
              color: i === step ? '#7A3F1D' : 'inherit'
            }}
          >
            {i + 1}. {t}
          </li>
        ))}
      </ol>

      {/* ===============================================
            PASO 0 — ELEGIR SERVICIO
      =============================================== */}
      {step === 0 && (
        <section>
          <h2>1) Elige servicio</h2>

          <label>
            Servicio:
            <select value={servicioId} onChange={(e) => setServicioId(e.target.value)} style={{ marginLeft: 8 }}>
              <option value="">— Selecciona —</option>
              {servicios.map((s) => {
                const id = s.id || s._id || s.uuid || s.title;
                return (
                  <option key={id} value={id}>
                    {s.title}
                  </option>
                );
              })}
            </select>
          </label>

          {servicioSel && (
            <div style={{ marginTop: 12, fontSize: 14, opacity: 0.9 }}>
              <div>
                <b>{servicioSel.title}</b>
              </div>
              <div>{servicioSel.short}</div>
              <div>
                {servicioSel.duration && <>⏱ {servicioSel.duration} · </>}
                {servicioSel.mode && <>📍 {servicioSel.mode}</>}
              </div>
              <div>
                <b>Precio:</b> {formatEUR(servicioSel.price, servicioSel.currency)}
              </div>
            </div>
          )}

          <div className="actions">
            <button disabled={!servicioSel} className="btn-primary" onClick={() => setStep(1)}>
              Continuar
            </button>
          </div>
        </section>
      )}

      {/* ===============================================
            PASO 1 — CALENDARIO
      =============================================== */}
      {step === 1 && (
        <section className="month-scheduler">
          <div className="month-header">
            <button className="btn-ghost" onClick={() => setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() - 1, 1))}>
              ‹
            </button>
            <div className="month-label">{mesBase.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}</div>
            <button className="btn-ghost" onClick={() => setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() + 1, 1))}>
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
              const startOffset = (first.getDay() + 6) % 7;
              const lastDay = new Date(mesBase.getFullYear(), mesBase.getMonth() + 1, 0).getDate();

              const cells = [];
              for (let i = 0; i < 42; i++) {
                const dayNum = i - startOffset + 1;
                const inMonth = dayNum >= 1 && dayNum <= lastDay;

                let f = '';
                let disabled = true;
                let isSelected = false;

                if (inMonth) {
                  const d = new Date(mesBase.getFullYear(), mesBase.getMonth(), dayNum);
                  f = ymd(d);

                  const dow = d.getDay();
                  // Domingo: cerrado. Sábado: permitido (pero con horas limitadas en el selector).
                  const isClosedDay = dow === 0;
                  const isPast = f < todayYMD();

                  disabled = isClosedDay || isPast;
                  isSelected = f === fecha;
                }

                cells.push(
                  <button
                    key={i}
                    type="button"
                    className={`daycell ${inMonth ? '' : 'out'} ${disabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={async (ev) => {
                      ev.stopPropagation();
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
                    disabled={!inMonth || disabled}
                  >
                    {inMonth ? dayNum : ''}
                  </button>
                );
              }

              return cells;
            })()}
          </div>

          <div className="slots-panel">
            <div className="slots-title">
              {fecha
                ? `Selecciona una hora para ${new Date(`${fecha}T00:00:00`).toLocaleDateString('es-ES', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long'
                  })}`
                : 'Selecciona un día para ver las horas disponibles'}
            </div>

            {trainerChoice === 'any' && (
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                “Cualquiera disponible”: se muestran las horas en las que <b>al menos un adiestrador</b> está libre.
              </div>
            )}

            {loadingAvailability && <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>Calculando disponibilidad…</div>}
            {!loadingAvailability && availabilityHint && (
              <div
                style={{
                  fontSize: 12,
                  marginTop: 6,
                  color: availabilityHint.startsWith('❌') || availabilityHint.startsWith('⚠️') ? 'crimson' : 'inherit'
                }}
              >
                {availabilityHint}
              </div>
            )}

            {fecha ? (
              <div className="slots-grid">
                {(() => {
                  const rows = [];
                  for (let h = 9; h <= 20; h++) {
                    if (h === 14 || h === 15) continue;

                    const t = `${String(h).padStart(2, '0')}:00`;
                    const busy = isSlotBusy(t);

                    rows.push(
                      <button
                        key={t}
                        type="button"
                        className={`slot ${busy ? 'busy' : ''} ${hora === t ? 'active' : ''}`}
                        disabled={busy}
                        onClick={() => {
                          if (!busy) setHora(t);
                        }}
                        title={busy ? 'Ocupada' : 'Seleccionar'}
                      >
                        {t}–{addMinutes(t, durationMin)}
                      </button>
                    );
                  }

                  if (!rows.length) return <div className="hint">Sin horas disponibles.</div>;
                  return rows;
                })()}
              </div>
            ) : (
              <div className="hint">Selecciona un día para continuar.</div>
            )}
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button onClick={atras}>Atrás</button>
            <button className="btn-primary" disabled={!hora || loadingAvailability} onClick={() => setStep(2)}>
              Continuar
            </button>
          </div>
        </section>
      )}

      {/* ===============================================
            PASO 2 — DATOS DEL PERRO
      =============================================== */}
      {step === 2 && (
        <section>
          <h2>3) Datos del perro</h2>

          {perros.length > 0 ? (
            <>
              <p style={{ margin: '8px 0' }}>Elige uno o varios perros para esta reserva:</p>

              <div className="dog-choice-list">
                {perros.map((p) => {
                  const pid = getDogId(p);
                  const name = String(p?.nombre || '').trim() || 'Perro';
                  const raza = String(p?.raza || p?.razaTamaño || '').trim();
                  const checked = (Array.isArray(perroIds) ? perroIds : []).includes(pid);

                  return (
                    <label key={pid || name} className="dog-choice">
                      <input
                        type="checkbox"
                        value={pid}
                        checked={!!pid && checked}
                        onChange={() => {
                          setDogMsg('');
                          togglePerroId(pid);
                        }}
                      />
                      <span>
                        <b>{name}</b>
                        {raza ? ` · ${raza}` : ''}
                      </span>
                    </label>
                  );
                })}
              </div>

              {perrosSeleccionados.length === 0 && (
                <p style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>Selecciona al menos un perro o añade uno nuevo.</p>
              )}
            </>
          ) : (
            <p>No tienes perros guardados. Puedes añadir uno nuevo o continuar sin guardarlo.</p>
          )}

          {/* Resumen de selección */}
          {perrosParaReserva.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.95 }}>
              <b>En esta reserva:</b>{' '}
              {perrosParaReserva
                .map((d) => {
                  const name = String(d?.nombre || '').trim();
                  const raza = String(d?.razaTamaño || '').trim();
                  return raza ? `${name} (${raza})` : name;
                })
                .filter(Boolean)
                .join(', ')}
            </div>
          )}

          {/* Añadir perro nuevo */}
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDogMsg('');
                setShowNewDogForm((v) => !v);
              }}
            >
              {showNewDogForm ? 'Ocultar formulario de perro nuevo' : 'Añadir perro nuevo'}
            </button>

            {perroNoGuardado && (
              <button
                type="button"
                className="btn-ghost"
                style={{ marginLeft: 8 }}
                onClick={() => setPerroNoGuardado(null)}
                title="Quitar el perro no guardado de esta reserva"
              >
                Quitar perro no guardado
              </button>
            )}
          </div>

          {showNewDogForm && (
            <>
              <p style={{ marginTop: 10 }}>
                Puedes guardar el perro en tu perfil y seleccionarlo junto con otros, o continuar sin guardarlo.
              </p>

              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
                <label>
                  Nombre (obligatorio)
                  <input value={nuevoPerro.nombre} onChange={(e) => setNuevoPerro({ ...nuevoPerro, nombre: e.target.value })} />
                </label>

                <label>
                  Raza/Tamaño
                  <input
                    value={nuevoPerro.razaTamaño}
                    onChange={(e) => setNuevoPerro({ ...nuevoPerro, razaTamaño: e.target.value })}
                    placeholder="Ej.: mestizo mediano, pastor alemán…"
                  />
                </label>

                <label>
                  Fecha de nacimiento (aprox.)
                  <input type="date" value={nuevoPerro.nacimiento} onChange={(e) => setNuevoPerro({ ...nuevoPerro, nacimiento: e.target.value })} />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                  <input type="checkbox" checked={nuevoPerro.castrado} onChange={(e) => setNuevoPerro({ ...nuevoPerro, castrado: e.target.checked })} />
                  Castrado/esterilizado
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Observaciones
                  <input value={nuevoPerro.observaciones} onChange={(e) => setNuevoPerro({ ...nuevoPerro, observaciones: e.target.value })} />
                </label>
              </div>

              {dogMsg && <div style={{ marginTop: 10, fontSize: 12, opacity: 0.95 }}>{dogMsg}</div>}

              <div className="actions" style={{ marginTop: 10 }}>
                <button onClick={atras}>Atrás</button>

                <button
                  className="btn-primary"
                  disabled={!canSaveNewDog || savingDog}
                  onClick={async () => {
                    const created = await crearPerro();
                    if (created) setStep(3);
                  }}
                  title="Guarda el perro en tu perfil, lo añade a la selección y continúa"
                >
                  {savingDog ? 'Guardando…' : 'Guardar en perfil y continuar'}
                </button>

                <button
                  className="btn-secondary"
                  disabled={!canContinueNewDogWithoutSaving}
                  onClick={continuarSinGuardarPerro}
                  title="Continuar sin guardar el perro en tu perfil (se incluirá en esta reserva)"
                >
                  Continuar sin guardar
                </button>

                <button
                  className="btn-ghost"
                  disabled={perrosSeleccionados.length === 0 && !perroNoGuardado}
                  onClick={() => setStep(3)}
                  title="Continuar usando la selección actual"
                >
                  Continuar con selección
                </button>
              </div>
            </>
          )}

          {!showNewDogForm && (
            <div className="actions" style={{ marginTop: 12 }}>
              <button onClick={atras}>Atrás</button>
              <button className="btn-primary" disabled={perrosSeleccionados.length === 0 && !perroNoGuardado} onClick={() => setStep(3)}>
                Continuar
              </button>
            </div>
          )}
        </section>
      )}

      {/* ===============================================
            PASO 3 — CONTACTO (incluye adiestrador)
      =============================================== */}
      {step === 3 && (
        <section>
          <h2>4) Datos de contacto</h2>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <label>
              Modalidad
              <select value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
                {allowedModalities.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Adiestrador
              <select
                value={trainerChoice}
                onChange={(e) => {
                  setTrainerChoice(e.target.value);
                  setTrainerHint('');
                }}
                disabled={!canLoadTrainers || loadingTrainers}
              >
                <option value="any">Cualquiera disponible</option>
                {trainerChoice !== 'any' && !selectedTrainerInList && <option value={trainerChoice}>Adiestrador seleccionado</option>}
                {trainers.map((t) => {
                  const tid = getTrainerId(t);
                  const label = t.displayName || t.nombre || t.email || tid;
                  return (
                    <option key={tid} value={tid}>
                      {label}
                    </option>
                  );
                })}
              </select>

              {loadingTrainers && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Cargando adiestradores…</div>}
              {trainersErr && <div style={{ fontSize: 12, color: 'crimson', marginTop: 4 }}>{trainersErr}</div>}
              {!trainersErr && trainerHint && <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{trainerHint}</div>}
              {canLoadTrainers && !loadingTrainers && !trainersErr && trainers.length === 0 && (
                <div style={{ fontSize: 12, color: 'crimson', marginTop: 4 }}>No hay adiestradores disponibles para este servicio/modalidad.</div>
              )}
            </label>

            <label>
              Teléfono
              <input value={contacto.telefono} onChange={(e) => setContacto({ ...contacto, telefono: e.target.value })} />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              Dirección {domicilio ? '(obligatoria)' : '(opcional)'}
              <input value={contacto.direccion} required={domicilio} onChange={(e) => setContacto({ ...contacto, direccion: e.target.value })} />
            </label>
          </div>

          {domicilio && !direccionValida && <p style={{ color: 'crimson' }}>⚠ Debes indicar una dirección para modalidad a domicilio.</p>}

          {!hora && fecha && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'crimson' }}>
              ⚠ No hay una hora válida seleccionada para la fecha elegida. Si has cambiado de adiestrador, es posible que esa hora ya no esté disponible.
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                  Cambiar hora
                </button>
              </div>
            </div>
          )}

          <div className="actions">
            <button onClick={atras}>Atrás</button>
            <button className="btn-primary" disabled={!fecha || !hora || !telefonoValido || !direccionValida || !hasAnyEligibleTrainer || loadingAvailability} onClick={() => setStep(4)}>
              Continuar
            </button>
          </div>
        </section>
      )}

      {/* ===============================================
            PASO 4 — RESUMEN
      =============================================== */}
      {step === 4 && (
        <section>
          <h2>5) Resumen</h2>

          {!servicioSel ? (
            <p>
              No hay servicio seleccionado. <Link to="/servicios">Volver a servicios</Link>
            </p>
          ) : (
            <div className="summary">
              <div>
                <b>Servicio:</b> {servicioSel.title}
              </div>
              <div>
                <b>Fecha:</b> {fecha} · <b>Hora:</b> {hora}
              </div>
              <div>
                <b>Duración:</b> {servicioSel.duration || `${durationMin} min`}
              </div>
              <div>
                <b>Modalidad:</b> {modalidad}
              </div>

              <div>
                <b>Adiestrador:</b>{' '}
                {trainerChoice === 'any'
                  ? 'Cualquiera disponible'
                  : selectedTrainer?.displayName || selectedTrainer?.nombre || selectedTrainer?.email || trainerChoice}
              </div>

              <div>
                <b>Precio:</b> {formatEUR(servicioSel.price, servicioSel.currency)}
              </div>
              <div>
                <b>Perro(s):</b>{' '}
                {perrosParaReserva.length
                  ? perrosParaReserva
                      .map((d) => {
                        const name = String(d?.nombre || '').trim();
                        const raza = String(d?.razaTamaño || '').trim();
                        return raza ? `${name} (${raza})` : name;
                      })
                      .filter(Boolean)
                      .join(', ')
                  : '—'}
              </div>
              {contacto.telefono && (
                <div>
                  <b>Teléfono:</b> {contacto.telefono}
                </div>
              )}
              {contacto.direccion && (
                <div>
                  <b>Dirección:</b> {contacto.direccion}
                </div>
              )}
            </div>
          )}

          <div className="actions">
            <button onClick={atras}>Atrás</button>
            <button
              className="btn-primary"
              disabled={
                !authReady ||
                !servicioSel ||
                !fecha ||
                !hora ||
                !telefonoValido ||
                !direccionValida ||
                !perroValido ||
                guardando ||
                loadingAvailability ||
                !hasAnyEligibleTrainer
              }
              onClick={confirmar}
            >
              {guardando ? 'Creando…' : 'Confirmar reserva'}
            </button>
            {msg && <span style={{ marginLeft: 10 }}>{msg}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
