// frontend/src/pages/contratar.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { http } from '../helpers/http';
import '../styles/contratar.scss';

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
/* ====================================================== */

const EMPTY_PERRO = {
  id: '',
  nombre: '',
  edad: '',
  razaTamaño: '',
  nacimiento: '',
  castrado: false,
  observaciones: ''
};

export default function Contratar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const { isAuthenticated, user, role, loading } = useAuth();
  const authReady = !loading && isAuthenticated;
  const userEmail = (user?.email || '').trim();

  /* =====================================================
      LOGIN FORZADO SI NO HAY SESIÓN
  ====================================================== */
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      // Importante: conservar TODOS los query params al forzar login
      // (por ejemplo trainerId preseleccionado).
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
        const arr = Array.isArray(list)
          ? list
          : list?.items || list?.servicios || [];

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

    if (Array.isArray(servicioSel.modalities) && servicioSel.modalities.length)
      return servicioSel.modalities;

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
  }, [allowedModalities, modalidadParam]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ===== wizard ===== */
  const [step, setStep] = useState(servicioParam ? 1 : 0);
  const atras = () => setStep((s) => Math.max(s - 1, 0));

  /* =====================================================
         ADIESTRADORES COMPATIBLES
         (Block A: preselección desde /contratar?trainerId=...)
  ====================================================== */
  const [trainers, setTrainers] = useState([]);
  const [loadingTrainers, setLoadingTrainers] = useState(false);

  // ✅ Si vienes desde un perfil público de adiestrador (/contratar?trainerId=...),
  // dejamos el adiestrador preseleccionado.
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

      // Si tenía elegido uno y ya no está, volver a any
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
  const [mesBase, setMesBase] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [fecha, setFecha] = useState(todayYMD());
  const [hora, setHora] = useState('');
  const [horasLibres, setHorasLibres] = useState([]);
  const [unavailable, setUnavailable] = useState([]);

  const cargarDisponibilidad = async (f) => {
    try {
      const qs = new URLSearchParams({
        fecha: f,
        durationMin: String(durationMin)
      });

      // si el usuario eligió un trainer concreto, filtrar disponibilidad por trainer
      if (trainerChoice && trainerChoice !== 'any') {
        qs.set('trainerId', String(trainerChoice));
      }

      const data = await http(`/api/reservas/disponibilidad?${qs.toString()}`);

      const libres = data?.libres || data?.slots || data?.available || [];
      const ocupadas = data?.unavailable || data?.ocupadas || data?.busy || [];

      setHorasLibres(Array.isArray(libres) ? libres : []);
      setUnavailable(Array.isArray(ocupadas) ? ocupadas : []);

      if (hora && Array.isArray(libres) && !libres.includes(hora)) setHora('');
    } catch (e) {
      console.error('Error disponibilidad', e);
      setHorasLibres([]);
      setUnavailable([]);
    }
  };

  useEffect(() => {
    if (fecha) cargarDisponibilidad(fecha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, durationMin, trainerChoice]);

  const isSlotBusy = (t) => {
    if (horasLibres.length) return !horasLibres.includes(t);
    return new Set(unavailable).has(t);
  };

  /* =====================================================
         PERROS — GET /perros
         Requisito adicional: si ya tiene perros, poder reservar para uno existente
         o añadir uno nuevo desde el flujo.
  ====================================================== */
  const [perros, setPerros] = useState([]);
  const [perroId, setPerroId] = useState('');

  // 'existing' -> reservar para perro registrado
  // 'new'      -> reservar añadiendo perro nuevo (disponible incluso si ya hay perros)
  const [dogMode, setDogMode] = useState('new');

  const [nuevoPerro, setNuevoPerro] = useState({
    nombre: '',
    nacimiento: '',
    razaTamaño: '',
    castrado: false,
    observaciones: ''
  });

  const [perro, setPerro] = useState(EMPTY_PERRO);

  const [savingDog, setSavingDog] = useState(false);
  const [dogMsg, setDogMsg] = useState('');

  useEffect(() => {
    (async () => {
      if (!authReady) return;
      try {
        const list = await http('/perros', { auth: true });
        const arr = Array.isArray(list?.items)
          ? list.items
          : Array.isArray(list)
            ? list
            : [];

        const activos = arr.filter((p) => !p.archived);
        setPerros(activos);

        if (activos.length > 0) {
          // Por defecto: reservar para un perro existente (más rápido)
          setDogMode('existing');

          // Si hay exactamente 1 perro, lo preseleccionamos (evita clicks extra)
          if (activos.length === 1) {
            const p = activos[0];
            setPerroId(p.id);
            setPerro({
              id: p.id,
              nombre: p.nombre,
              edad: '',
              razaTamaño: p.raza,
              nacimiento: p.nacimiento || '',
              castrado: !!p.castrado,
              observaciones: p.notas || ''
            });
          } else {
            // Con varios perros, no preseleccionamos para evitar errores.
            setPerroId('');
            setPerro(EMPTY_PERRO);
          }
        } else {
          setDogMode('new');
          setPerroId('');
          setPerro(EMPTY_PERRO);
        }
      } catch (e) {
        console.error('Error cargando perros', e);
        setPerros([]);
        setDogMode('new');
        setPerroId('');
        setPerro(EMPTY_PERRO);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  useEffect(() => {
    if (dogMode !== 'existing') return;

    if (!perroId) {
      setPerro(EMPTY_PERRO);
      return;
    }

    const p = perros.find((x) => x.id === perroId);
    if (!p) return;

    setPerro({
      id: p.id,
      nombre: p.nombre,
      edad: '',
      razaTamaño: p.raza,
      nacimiento: p.nacimiento || '',
      castrado: !!p.castrado,
      observaciones: p.notas || ''
    });
  }, [perroId, perros, dogMode]);

  const canSaveNewDog = useMemo(() => {
    // Backend exige nombre, raza y nacimiento.
    const nombreOk = !!nuevoPerro.nombre.trim();
    const razaOk = !!nuevoPerro.razaTamaño.trim();
    const nacOk = !!String(nuevoPerro.nacimiento || '').trim();
    return nombreOk && razaOk && nacOk;
  }, [nuevoPerro.nombre, nuevoPerro.razaTamaño, nuevoPerro.nacimiento]);

  const canContinueNewDogWithoutSaving = useMemo(() => {
    // Para continuar sin guardar en perfil, exigimos al menos un nombre.
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

      const createdItem = created?.item || { id: created?.id, ...body };

      setPerros((prev) => [...prev, createdItem]);
      setPerroId(createdItem.id || '');

      // Al crear uno nuevo, lo seleccionamos para la reserva
      setDogMode('existing');
      setPerro({
        id: createdItem.id || '',
        nombre: createdItem.nombre,
        edad: '',
        razaTamaño: createdItem.raza,
        nacimiento: createdItem.nacimiento || body.nacimiento,
        castrado: !!createdItem.castrado,
        observaciones: createdItem.notas || body.notas || ''
      });

      // limpiar formulario
      setNuevoPerro({
        nombre: '',
        nacimiento: '',
        razaTamaño: '',
        castrado: false,
        observaciones: ''
      });

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

    setPerro({
      id: '',
      nombre: nuevoPerro.nombre.trim(),
      edad: '',
      razaTamaño: nuevoPerro.razaTamaño,
      nacimiento: nuevoPerro.nacimiento,
      castrado: !!nuevoPerro.castrado,
      observaciones: nuevoPerro.observaciones
    });

    setStep(3);
  };

  const canContinueExistingDog = useMemo(() => {
    if (perros.length === 0) return false;
    if (perros.length === 1) return !!perro?.nombre?.trim();
    return !!perroId && !!perro?.nombre?.trim();
  }, [perros.length, perroId, perro?.nombre]);

  /* =====================================================
         CONTACTO
  ====================================================== */
  const [contacto, setContacto] = useState({ telefono: '', direccion: '' });
  const domicilio = modalidad === 'a domicilio';

  // =====================================================
  // PREFILL: si el usuario tiene teléfono/dirección en su perfil,
  // rellenamos por defecto estos campos.
  // Importante: NO pisamos lo que el usuario ya haya escrito.
  // =====================================================
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

	        // Solo prefill de teléfono si existe número (evita que se rellene solo el prefijo)
	        const tel = phone ? [prefix, phone].filter(Boolean).join(' ').trim() : '';

        if (!tel && !address) return;

        setContacto((prev) => ({
          telefono: String(prev?.telefono || '').trim() ? prev.telefono : tel,
          direccion: String(prev?.direccion || '').trim() ? prev.direccion : address
        }));
      } catch (e) {
        // Prefill opcional: si falla, no bloquea el flujo
      }
    })();

    return () => {
      cancel = true;
    };
  }, [authReady]);

  const telefonoValido = contacto.telefono.trim().length >= 6;
  const direccionValida = !domicilio || contacto.direccion.trim().length > 5;
  const perroValido = String(perro?.nombre || '').trim().length > 0;

  /* =====================================================
         CONFIRMAR RESERVA
  ====================================================== */
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const confirmar = async () => {
    setMsg('');

    if (!authReady) return setMsg('Cargando sesión…');
    if (!telefonoValido) return setMsg('Indica un teléfono válido.');
    if (!perroValido) return setMsg('El perro necesita nombre.');
    if (domicilio && !direccionValida)
      return setMsg('Indica dirección para modalidad a domicilio.');

    if (!hasAnyEligibleTrainer) {
      return setMsg('❌ No hay adiestradores disponibles para este servicio y modalidad.');
    }

    setGuardando(true);

    try {
      // Guardamos el perro como JSON string (compatible con BD y con reservasUser.jsx que parsea JSON).
      let perroToSend = null;
      try {
        perroToSend = perro ? JSON.stringify(perro) : null;
      } catch {
        perroToSend = perro?.nombre ? String(perro.nombre) : null;
      }

      const payload = {
        email: userEmail,
        fecha,
        hora,

        // ✅ enviar ID real (id/_id/uuid)
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

        // elección de trainer (any o id)
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

      const serverMsg =
        e?.response?.data?.error ||
        e?.error ||
        e?.message ||
        '';

      setMsg(serverMsg ? `❌ ${serverMsg}` : '❌ No se pudo crear la reserva.');
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
              background: i === step ? '#e5f2ea' : '#eee'
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
            <select
              value={servicioId}
              onChange={(e) => setServicioId(e.target.value)}
              style={{ marginLeft: 8 }}
            >
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
            <button
              disabled={!servicioSel}
              className="btn-primary"
              onClick={() => setStep(1)}
            >
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
                  const isWeekend = dow === 0 || dow === 6;
                  const isPast = f < todayYMD();

                  disabled = isWeekend || isPast;
                  isSelected = f === fecha;
                }

                cells.push(
                  <button
                    key={i}
                    type="button"
                    className={`daycell ${inMonth ? '' : 'out'} ${disabled ? 'disabled' : ''} ${
                      isSelected ? 'selected' : ''
                    }`}
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

	          {/*
	            IMPORTANTE (bug fix):
	            Antes se renderizaban botones de horas DENTRO de cada botón del día (button dentro de button).
	            Eso es HTML inválido y provoca comportamientos erráticos (por ejemplo, al seleccionar una hora,
	            se "clicaba" el día que hay debajo).
	
	            Ahora las horas se muestran en un panel separado, fuera del grid.
	          */}
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

	                  if (!rows.length) {
	                    return <div className="hint">Sin horas disponibles.</div>;
	                  }

	                  return rows;
	                })()}
	              </div>
	            ) : (
	              <div className="hint">Selecciona un día para continuar.</div>
	            )}
	          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button onClick={atras}>Atrás</button>
            <button className="btn-primary" disabled={!hora} onClick={() => setStep(2)}>
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

	          {perros.length > 0 && (
	            <div style={{ marginBottom: 12 }}>
	              <p style={{ margin: '8px 0' }}>¿Para qué perro es la reserva?</p>
	
	              <div className="dog-choice-list">
	                {perros.map((p) => {
	                  const pid = String(p.id || '').trim();
	                  const name = String(p.nombre || '').trim() || 'Perro';
	                  const raza = String(p.raza || '').trim();
	
	                  return (
	                    <label key={pid} className="dog-choice">
	                      <input
	                        type="radio"
	                        name="dogPick"
	                        value={pid}
	                        checked={dogMode === 'existing' && perroId === pid}
	                        onChange={() => {
	                          setDogMode('existing');
	                          setDogMsg('');
	                          setPerroId(pid);
	                        }}
	                      />
	                      <span>
	                        <b>{name}</b>
	                        {raza ? ` · ${raza}` : ''}
	                      </span>
	                    </label>
	                  );
	                })}
	
	                <label className="dog-choice">
	                  <input
	                    type="radio"
	                    name="dogPick"
	                    value="__new"
	                    checked={dogMode === 'new'}
	                    onChange={() => {
	                      setDogMode('new');
	                      setDogMsg('');
	                    }}
	                  />
	                  <span>Añadir un perro nuevo</span>
	                </label>
	              </div>
	            </div>
	          )}

	          {/* ====== MODO EXISTING ====== */}
	          {dogMode === 'existing' && perros.length > 0 && (
	            <>
	              {!perroId && perros.length > 1 && (
	                <p style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
	                  Selecciona un perro para continuar.
	                </p>
	              )}

	              {perroId && (
	                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
	                  <div>
	                    <b>Perro:</b> {perro.nombre}
	                    {perro.razaTamaño ? ` · ${perro.razaTamaño}` : ''}
	                    {perro.castrado ? ' · castrado' : ''}
	                  </div>
	                  {perro.observaciones && (
	                    <div style={{ marginTop: 4 }}>
	                      <b>Observaciones:</b> {perro.observaciones}
	                    </div>
	                  )}
	                </div>
	              )}

	              <div className="actions" style={{ marginTop: 10 }}>
	                <button onClick={atras}>Atrás</button>
	                <button
	                  className="btn-primary"
	                  disabled={!canContinueExistingDog}
	                  onClick={() => setStep(3)}
	                >
	                  Continuar
	                </button>
	              </div>
	            </>
	          )}

          {/* ====== MODO NEW ====== */}
          {(dogMode === 'new' || perros.length === 0) && (
            <>
              {perros.length === 0 ? (
                <p>No tienes perros guardados. Puedes añadir uno nuevo o continuar sin guardarlo.</p>
              ) : (
                <p>Añade un perro nuevo para esta reserva (opcionalmente guardándolo en tu perfil).</p>
              )}

              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
                <label>
                  Nombre (obligatorio)
                  <input
                    value={nuevoPerro.nombre}
                    onChange={(e) => setNuevoPerro({ ...nuevoPerro, nombre: e.target.value })}
                  />
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
                  <input
                    type="date"
                    value={nuevoPerro.nacimiento}
                    onChange={(e) => setNuevoPerro({ ...nuevoPerro, nacimiento: e.target.value })}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={nuevoPerro.castrado}
                    onChange={(e) => setNuevoPerro({ ...nuevoPerro, castrado: e.target.checked })}
                  />
                  Castrado/esterilizado
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Observaciones
                  <input
                    value={nuevoPerro.observaciones}
                    onChange={(e) =>
                      setNuevoPerro({ ...nuevoPerro, observaciones: e.target.value })
                    }
                  />
                </label>
              </div>

              {dogMsg && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.95 }}>
                  {dogMsg}
                </div>
              )}

              <div className="actions" style={{ marginTop: 10 }}>
                <button onClick={atras}>Atrás</button>

                <button
                  className="btn-primary"
                  disabled={!canSaveNewDog || savingDog}
                  onClick={async () => {
                    const created = await crearPerro();
                    if (created) setStep(3);
                  }}
                  title="Guarda el perro en tu perfil y continúa"
                >
                  {savingDog ? 'Guardando…' : 'Guardar y continuar'}
                </button>

                <button
                  className="btn-secondary"
                  disabled={!canContinueNewDogWithoutSaving}
                  onClick={continuarSinGuardarPerro}
                  title="Continuar sin guardar el perro en tu perfil"
                >
                  Continuar sin guardar
                </button>
              </div>
            </>
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
                {trainerChoice !== 'any' && !selectedTrainerInList && (
                  <option value={trainerChoice}>Adiestrador seleccionado</option>
                )}
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

              {loadingTrainers && (
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  Cargando adiestradores…
                </div>
              )}
              {trainersErr && (
                <div style={{ fontSize: 12, color: 'crimson', marginTop: 4 }}>
                  {trainersErr}
                </div>
              )}
              {!trainersErr && trainerHint && (
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                  {trainerHint}
                </div>
              )}
              {canLoadTrainers && !loadingTrainers && !trainersErr && trainers.length === 0 && (
                <div style={{ fontSize: 12, color: 'crimson', marginTop: 4 }}>
                  No hay adiestradores disponibles para este servicio/modalidad.
                </div>
              )}
            </label>

            <label>
              Teléfono
              <input
                value={contacto.telefono}
                onChange={(e) => setContacto({ ...contacto, telefono: e.target.value })}
              />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              Dirección {domicilio ? '(obligatoria)' : '(opcional)'}
              <input
                value={contacto.direccion}
                required={domicilio}
                onChange={(e) => setContacto({ ...contacto, direccion: e.target.value })}
              />
            </label>
          </div>

          {domicilio && !direccionValida && (
            <p style={{ color: 'crimson' }}>
              ⚠ Debes indicar una dirección para modalidad a domicilio.
            </p>
          )}

          <div className="actions">
            <button onClick={atras}>Atrás</button>
            <button
              className="btn-primary"
              disabled={!telefonoValido || !direccionValida || !hasAnyEligibleTrainer}
              onClick={() => setStep(4)}
            >
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
                  : (selectedTrainer?.displayName ||
                    selectedTrainer?.nombre ||
                    selectedTrainer?.email ||
                    trainerChoice)}
              </div>

              <div>
                <b>Precio:</b> {formatEUR(servicioSel.price, servicioSel.currency)}
              </div>
              <div>
                <b>Perro:</b> {perro.nombre}
                {perro.razaTamaño ? ` · ${perro.razaTamaño}` : ''}
                {perro.castrado ? ' · castrado' : ''}
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
