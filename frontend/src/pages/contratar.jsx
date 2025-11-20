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
/* ====================================================== */

export default function Contratar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const { isAuthenticated, user, role, loading } = useAuth();
  const esAdmin = role === 'admin' || !!user?.isAdmin;
  const authReady = !loading && isAuthenticated;
  const userEmail = (user?.email || '').trim();

  /* =====================================================
      LOGIN FORZADO SI NO HAY SESIÓN
  ====================================================== */
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      const servicio = params.get('servicio') || '';
      const next = servicio
        ? `/contratar?servicio=${encodeURIComponent(servicio)}`
        : '/contratar';
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [loading, isAuthenticated, params, navigate]);

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
  const [servicioId, setServicioId] = useState(servicioParam);

  const servicioSel = useMemo(() => {
    if (!servicioId) return null;
    return (
      servicios.find(
        (s) =>
          String(s.id) === String(servicioId) ||
          String(s._id) === String(servicioId) ||
          String(s.uuid) === String(servicioId) ||
          s.title === servicioId
      ) || null
    );
  }, [servicios, servicioId]);

  const durationMin = useMemo(() => {
    if (servicioSel?.durationMin) return Number(servicioSel.durationMin);
    const txt = servicioSel?.duration || '';
    const m = txt.match(/(\d+)\s*min/i);
    return m ? Number(m[1]) : 60;
  }, [servicioSel]);

  /* ===== modalidades ===== */
  const allowedModalities = useMemo(() => {
    if (!servicioSel) return ['presencial'];

    const title = String(servicioSel.title || '').toLowerCase();

    if (title.includes('obediencia'))
      return ['presencial', 'online', 'a domicilio'];

    if (title.includes('básico') || title.includes('basico'))
      return ['presencial', 'online', 'a domicilio'];

    if (title.includes('paseo'))
      return ['presencial', 'a domicilio'];

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
  }, [allowedModalities, modalidadParam]);

  /* ===== wizard ===== */
  const [step, setStep] = useState(servicioParam ? 1 : 0);
  const atras = () => setStep((s) => Math.max(s - 1, 0));

  /* ===== calendario mensual ===== */
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
        durationMin
      });
      const data = await http(`/api/reservas/disponibilidad?${qs.toString()}`);

      const libres = data.libres || data.slots || data.available || [];
      const ocupadas = data.unavailable || data.ocupadas || data.busy || [];

      setHorasLibres(Array.isArray(libres) ? libres : []);
      setUnavailable(Array.isArray(ocupadas) ? ocupadas : []);

      if (hora && !libres.includes(hora)) setHora('');
    } catch (e) {
      console.error('Error disponibilidad', e);
      setHorasLibres([]);
      setUnavailable([]);
    }
  };

  useEffect(() => {
    if (fecha) cargarDisponibilidad(fecha);
  }, [fecha, durationMin]);

  const isSlotBusy = (t) => {
    if (horasLibres.length) return !horasLibres.includes(t);
    return new Set(unavailable).has(t);
  };

  /* =====================================================
         PERROS — GET /perros
  ====================================================== */
  const [perros, setPerros] = useState([]);
  const [perroId, setPerroId] = useState('');

  const [nuevoPerro, setNuevoPerro] = useState({
    nombre: '',
    edad: '',
    razaTamaño: '',
    castrado: false,
    observaciones: ''
  });

  const [perro, setPerro] = useState({
    nombre: '',
    edad: '',
    razaTamaño: '',
    castrado: false,
    observaciones: ''
  });

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

        if (activos.length === 1) {
          const p = activos[0];
          setPerroId(p.id);
          setPerro({
            nombre: p.nombre,
            edad: '',
            razaTamaño: p.raza,
            castrado: !!p.castrado,
            observaciones: p.notas || ''
          });
        }
      } catch (e) {
        console.error('Error cargando perros', e);
        setPerros([]);
      }
    })();
  }, [authReady]);

  useEffect(() => {
    if (!perroId) return;
    const p = perros.find((x) => x.id === perroId);
    if (!p) return;

    setPerro({
      nombre: p.nombre,
      edad: '',
      razaTamaño: p.raza,
      castrado: !!p.castrado,
      observaciones: p.notas || ''
    });
  }, [perroId, perros]);

  /* =====================================================
         CREAR PERRO — POST /perros
  ====================================================== */
  const crearPerro = async () => {
    if (!nuevoPerro.nombre.trim()) {
      alert('El nombre del perro es obligatorio.');
      return;
    }

    try {
      const body = {
        nombre: nuevoPerro.nombre.trim(),
        raza: nuevoPerro.razaTamaño.trim() || '',
        nacimiento: new Date().toISOString().slice(0, 10), // <--- obligatorio en backend
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
      setPerroId(createdItem.id);

      setPerro({
        nombre: createdItem.nombre,
        edad: '',
        razaTamaño: createdItem.raza,
        castrado: !!createdItem.castrado,
        observaciones: createdItem.notas || ''
      });

      setNuevoPerro({
        nombre: '',
        edad: '',
        razaTamaño: '',
        castrado: false,
        observaciones: ''
      });
    } catch (e) {
      console.error('Error creando perro', e);
      alert('No se pudo crear el perro');
    }
  };

  /* =====================================================
         CONTACTO
  ====================================================== */
  const [contacto, setContacto] = useState({ telefono: '', direccion: '' });
  const domicilio = modalidad === 'a domicilio';

  const telefonoValido = contacto.telefono.trim().length >= 6;
  const direccionValida =
    !domicilio || contacto.direccion.trim().length > 5;
  const perroValido = perro.nombre.trim().length > 0;

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

    setGuardando(true);

    try {
      const payload = {
        email: userEmail,
        fecha,
        hora,
        servicioId: servicioSel?.id,
        servicioTitulo: servicioSel?.title,
        modalidad,
        duration: servicioSel?.duration,
        durationMin,
        price: servicioSel?.price ?? null,
        currency: servicioSel?.currency || 'EUR',
        perro,
        telefono: contacto.telefono,
        direccion: contacto.direccion,
        pricing: {}
      };

      const res = await http('/api/reservas', {
        method: 'POST',
        data: payload,
        auth: true
      });

      if (res?.status === 409)
        return setMsg('❌ Esa hora ya no está disponible.');

      setMsg('✅ Reserva creada. Redirigiendo…');
      setTimeout(() => navigate('/reservas', { replace: true }), 800);
    } catch (e) {
      console.error('Error creando reserva', e);
      setMsg('❌ No se pudo crear la reserva.');
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
        {['Servicio', 'Fecha y hora', 'Datos del perro', 'Contacto', 'Resumen'].map(
          (t, i) => (
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
          )
        )}
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
              {mesBase.toLocaleString('es-ES', {
                month: 'long',
                year: 'numeric'
              })}
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
              const startOffset =
                (first.getDay() + 6) % 7; // lunes = 0

              const lastDay = new Date(
                mesBase.getFullYear(),
                mesBase.getMonth() + 1,
                0
              ).getDate();

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
                    className={`daycell ${inMonth ? '' : 'out'} ${
                      disabled ? 'disabled' : ''
                    } ${isSelected ? 'selected' : ''}`}
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

                    {inMonth && f === fecha && (
                      <div className="popover" onClick={(e) => e.stopPropagation()}>
                        <div className="pop-title">
                          {new Date(fecha).toLocaleDateString('es-ES', {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'short'
                          })}
                        </div>

                        <div className="pop-hours">
                          {(() => {
                            const rows = [];
                            for (let h = 9; h <= 20; h++) {
                              if (h === 14 || h === 15) continue;

                              const t = `${String(h).padStart(2, '0')}:00`;
                              const busy = isSlotBusy(t);

                              rows.push(
                                <button
                                  key={t}
                                  className={`slot ${busy ? 'busy' : ''} ${
                                    hora === t ? 'active' : ''
                                  }`}
                                  disabled={busy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!busy) setHora(t);
                                  }}
                                  title={busy ? 'Ocupada' : 'Seleccionar'}
                                >
                                  {t}–{addMinutes(t, durationMin)}
                                </button>
                              );
                            }
                            if (!rows.length)
                              return <div className="hint">Sin horas.</div>;

                            return rows;
                          })()}
                        </div>
                      </div>
                    )}
                  </button>
                );
              }

              return cells;
            })()}
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button onClick={atras}>Atrás</button>
            <button
              className="btn-primary"
              disabled={!hora}
              onClick={() => setStep(2)}
            >
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
          <h2>4) Datos del perro</h2>

          {/* SIN PERROS — NUEVO */}
          {perros.length === 0 && (
            <>
              <p>No tienes perros guardados. Crea uno para asociarlo a la reserva.</p>

              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: '1fr 1fr'
                }}
              >
                <label>
                  Nombre (obligatorio)
                  <input
                    value={nuevoPerro.nombre}
                    onChange={(e) =>
                      setNuevoPerro({ ...nuevoPerro, nombre: e.target.value })
                    }
                  />
                </label>

                <label>
                  Raza/Tamaño (opcional)
                  <input
                    value={nuevoPerro.razaTamaño}
                    onChange={(e) =>
                      setNuevoPerro({ ...nuevoPerro, razaTamaño: e.target.value })
                    }
                  />
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Observaciones
                  <input
                    value={nuevoPerro.observaciones}
                    onChange={(e) =>
                      setNuevoPerro({
                        ...nuevoPerro,
                        observaciones: e.target.value
                      })
                    }
                  />
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <input
                    type="checkbox"
                    checked={nuevoPerro.castrado}
                    onChange={(e) =>
                      setNuevoPerro({
                        ...nuevoPerro,
                        castrado: e.target.checked
                      })
                    }
                  />
                  Castrado/esterilizado
                </label>
              </div>

              <div className="actions" style={{ marginTop: 10 }}>
                <button onClick={atras}>Atrás</button>

                <button
                  className="btn-secondary"
                  disabled={!nuevoPerro.nombre.trim()}
                  onClick={crearPerro}
                >
                  Guardar perro
                </button>

                <button
                  className="btn-primary"
                  disabled={!nuevoPerro.nombre.trim()}
                  onClick={() => {
                    setPerro({
                      nombre: nuevoPerro.nombre.trim(),
                      edad: '',
                      razaTamaño: nuevoPerro.razaTamaño,
                      castrado: nuevoPerro.castrado,
                      observaciones: nuevoPerro.observaciones
                    });
                    setStep(3);
                  }}
                >
                  Continuar
                </button>
              </div>
            </>
          )}

          {/* 1 PERRO — AUTORRELLENO */}
          {perros.length === 1 && (
            <>
              <p>
                Perro seleccionado: <b>{perro.nombre}</b>{' '}
                {perro.razaTamaño ? `· ${perro.razaTamaño}` : ''}
              </p>

              <div className="actions">
                <button onClick={atras}>Atrás</button>
                <button className="btn-primary" onClick={() => setStep(3)}>
                  Continuar
                </button>
              </div>
            </>
          )}

          {/* MULTIPLES PERROS */}
          {perros.length > 1 && (
            <>
              <label>
                Selecciona perro:
                <select
                  value={perroId}
                  onChange={(e) => setPerroId(e.target.value)}
                >
                  <option value="">— Selecciona —</option>
                  {perros.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} {p.raza ? `· ${p.raza}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div
                style={{
                  marginTop: 10,
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: '1fr 1fr'
                }}
              >
                <label>
                  Nombre
                  <input
                    value={perro.nombre}
                    onChange={(e) =>
                      setPerro({ ...perro, nombre: e.target.value })
                    }
                  />
                </label>

                <label>
                  Raza/Tamaño
                  <input
                    value={perro.razaTamaño}
                    onChange={(e) =>
                      setPerro({ ...perro, razaTamaño: e.target.value })
                    }
                  />
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Observaciones
                  <input
                    value={perro.observaciones}
                    onChange={(e) =>
                      setPerro({ ...perro, observaciones: e.target.value })
                    }
                  />
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <input
                    type="checkbox"
                    checked={perro.castrado}
                    onChange={(e) =>
                      setPerro({ ...perro, castrado: e.target.checked })
                    }
                  />
                  Castrado/esterilizado
                </label>
              </div>

              <div className="actions">
                <button onClick={atras}>Atrás</button>
                <button
                  className="btn-primary"
                  disabled={!perro.nombre.trim()}
                  onClick={() => setStep(3)}
                >
                  Continuar
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ===============================================
            PASO 3 — CONTACTO
      =============================================== */}
      {step === 3 && (
        <section>
          <h2>5) Datos de contacto</h2>

          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: '1fr 1fr'
            }}
          >
            <label>
              Modalidad
              <select
                value={modalidad}
                onChange={(e) => setModalidad(e.target.value)}
              >
                {allowedModalities.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Teléfono
              <input
                value={contacto.telefono}
                onChange={(e) =>
                  setContacto({ ...contacto, telefono: e.target.value })
                }
              />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              Dirección {modalidad === 'a domicilio' ? '(obligatoria)' : '(opcional)'}
              <input
                value={contacto.direccion}
                required={modalidad === 'a domicilio'}
                onChange={(e) =>
                  setContacto({ ...contacto, direccion: e.target.value })
                }
              />
            </label>
          </div>

          {modalidad === 'a domicilio' && !direccionValida && (
            <p style={{ color: 'crimson' }}>
              ⚠ Debes indicar una dirección para modalidad a domicilio.
            </p>
          )}

          <div className="actions">
            <button onClick={atras}>Atrás</button>
            <button
              className="btn-primary"
              disabled={!telefonoValido || !direccionValida}
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
          <h2>6) Resumen</h2>

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
                guardando
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
