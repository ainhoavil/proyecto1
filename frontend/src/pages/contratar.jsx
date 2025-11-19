// frontend/src/pages/contratar.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { isLogged, getRole } from '../helpers/auth';
import { useEditMode } from '../context/editmode';
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
function todayYMD() { return ymd(new Date()); }
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

  // redirección a login si no hay sesión
  useEffect(() => {
    if (!isLogged()) {
      const servicio = params.get('servicio') || '';
      const next = servicio ? `/contratar?servicio=${encodeURIComponent(servicio)}` : '/contratar';
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const role = getRole();
  const esAdmin = role === 'admin';
  const { editMode } = useEditMode();

  /* ===== auth listo + email (desde backend) ===== */
  const [authReady, setAuthReady] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  useEffect(() => {
    (async () => {
      if (!isLogged()) return;
      try {
        // Esperado: GET /api/me -> { email, profile:{...} }
        const me = await http('/api/me', { auth: true });
        setUserEmail((me?.email || me?.profile?.email || '').trim());
      } catch {
        // Si el backend ya infiere el email del token, podemos seguir sin mostrarlo
        setUserEmail('');
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  /* ===== servicios (desde backend) ===== */
  const [servicios, setServicios] = useState([]);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const list = await http('/api/servicios'); // GET
        const arr = Array.isArray(list) ? list : (list?.items || []);
        arr.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
        setServicios(arr);
      } catch {
        setServicios([]);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  // servicio preseleccionado (?servicio= o state)
  const servicioParam = params.get('servicio') || location.state?.servicio || '';
  const [servicioId, setServicioId] = useState(servicioParam);

  const servicioSel = useMemo(() => {
    if (!servicioId) return null;
    return servicios.find(s => (s.id === servicioId || s.title === servicioId)) || null;
  }, [servicios, servicioId]);

  // duración (min)
  const durationMin = useMemo(() => {
    if (servicioSel?.durationMin) return Number(servicioSel.durationMin);
    const txt = servicioSel?.duration || '';
    const m = txt.match(/(\d+)\s*min/i);
    return m ? Number(m[1]) : 60;
  }, [servicioSel]);

  /* ===== modalidades disponibles ===== */
  const allowedModalities = useMemo(() => {
    if (!servicioSel) return ['presencial'];
    if (Array.isArray(servicioSel.modalities) && servicioSel.modalities.length) {
      return servicioSel.modalities;
    }
    const fromMode = String(servicioSel.mode || '').toLowerCase();
    const set = new Set();
    if (fromMode.includes('presencial')) set.add('presencial');
    if (fromMode.includes('online')) set.add('online');
    if (fromMode.includes('domicilio')) set.add('a domicilio');
    if (set.size === 0) set.add('presencial');
    return Array.from(set);
  }, [servicioSel]);

  const [modalidad, setModalidad] = useState('presencial');
  useEffect(() => { if (allowedModalities.length) setModalidad(allowedModalities[0]); }, [allowedModalities]);

  /* ===== wizard ===== */
  const [step, setStep] = useState(servicioParam ? 1 : 0);
  const siguiente = () => setStep(s => Math.min(s + 1, 4));
  const atras = () => setStep(s => Math.max(s - 1, 0));

  /* ===== calendario mensual + disponibilidad ===== */
  const [mesBase, setMesBase] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [fecha, setFecha] = useState(todayYMD());
  const [hora, setHora] = useState('');

  const [horasLibres, setHorasLibres] = useState([]);
  const [unavailable, setUnavailable] = useState([]);

  const cargarDisponibilidad = async (f) => {
    if (!f) return;
    try {
      const qs = new URLSearchParams({ fecha: f, durationMin: String(durationMin) });
      const data = await http(`/api/reservas/disponibilidad?${qs.toString()}`); // GET pública
      const libres = data.libres || data.slots || data.available || [];
      const ocupadas = data.unavailable || data.ocupadas || data.busy || data.taken || [];
      setHorasLibres(Array.isArray(libres) ? libres : []);
      setUnavailable(Array.isArray(ocupadas) ? ocupadas : []);
    } catch {
      setHorasLibres([]);
      setUnavailable([]);
    }
  };
  useEffect(() => { if (fecha) cargarDisponibilidad(fecha); }, [fecha, durationMin]); // eslint-disable-line

  // util para pintar gris/ocupado de forma robusta
  const isSlotBusy = (t) => {
    if (horasLibres.length) return !horasLibres.includes(t);
    const busy = new Set(unavailable || []);
    return busy.has(t);
  };

  /* ===== perros del usuario (multi-perro) ===== */
  const [perros, setPerros] = useState([]);
  const [perroId, setPerroId] = useState(''); // selección cuando >1
  const [nuevoPerro, setNuevoPerro] = useState({ nombre: '', edad: '', razaTamaño: '', castrado: false, observaciones: '' });

  const [perro, setPerro] = useState({
    nombre: '',
    edad: '',
    razaTamaño: '',
    castrado: false,
    observaciones: ''
  });

  useEffect(() => {
    (async () => {
      try {
        // GET /api/dogs -> [{ id, nombre, raza, nacimiento, notas, castrado }]
        const list = await http('/api/dogs', { auth: true });
        const arr = Array.isArray(list?.items) ? list.items : (Array.isArray(list) ? list : []);
        const activos = arr.filter(p => !p.archived);
        setPerros(activos);
        if (activos.length === 1) {
          const p = activos[0];
          setPerroId(p.id);
          setPerro({
            nombre: p.nombre || '',
            edad: '',
            razaTamaño: p.raza || '',
            castrado: !!p.castrado,
            observaciones: p.notas || ''
          });
        }
      } catch {
        setPerros([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!perroId) return;
    const p = perros.find(x => x.id === perroId);
    if (!p) return;
    setPerro({
      nombre: p.nombre || '',
      edad: '',
      razaTamaño: p.raza || '',
      castrado: !!p.castrado,
      observaciones: p.notas || ''
    });
  }, [perroId, perros]);

  const crearPerro = async () => {
    if (!nuevoPerro.nombre?.trim()) {
      alert('El nombre del perro es obligatorio.');
      return;
    }
    try {
      const body = {
        nombre: nuevoPerro.nombre.trim(),
        raza: nuevoPerro.razaTamaño?.trim() || '',
        nacimiento: '',
        notas: nuevoPerro.observaciones?.trim() || '',
        castrado: !!nuevoPerro.castrado,
        avatarURL: '',
        archived: false,
      };
      // POST /api/dogs
      const created = await http('/api/dogs', { method: 'POST', data: body, auth: true });
      const createdItem = created?.item || { id: created?.id, ...body };
      setPerros(prev => [...prev, createdItem]);
      setPerroId(createdItem.id);
      setPerro({
        nombre: createdItem.nombre,
        edad: '',
        razaTamaño: createdItem.raza,
        castrado: !!createdItem.castrado,
        observaciones: createdItem.notas || ''
      });
      setNuevoPerro({ nombre: '', edad: '', razaTamaño: '', castrado: false, observaciones: '' });
    } catch {
      alert('No se pudo crear el perro');
    }
  };

  /* ===== contacto ===== */
  const [contacto, setContacto] = useState({ telefono: '', direccion: '' });

  /* ===== admin: bloquear manualmente un slot ===== */
  const canBlock = esAdmin && editMode;
  const bloquear = async (h) => {
    if (!canBlock || !fecha) return;
    if (!window.confirm(`Bloquear ${fecha} ${h}?`)) return;
    try {
      await http('/api/reservas/bloqueos', {
        method: 'POST',
        data: { fecha, hora: h, durationMin, motivo: 'Bloqueo manual' },
        auth: true
      });
      await cargarDisponibilidad(fecha);
    } catch {
      alert('No se pudo crear el bloqueo');
    }
  };

  /* ===== confirmar reserva ===== */
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const domicilio = modalidad === 'a domicilio';
  const direccionValida = !domicilio || (contacto.direccion && contacto.direccion.trim().length > 5);
  const telefonoValido = contacto.telefono && contacto.telefono.trim().length >= 6;
  const perroValido = perro.nombre && perro.nombre.trim().length > 0;

  const confirmar = async () => {
    setMsg('');
    if (!authReady) { setMsg('Cargando sesión…'); return; }
    if (!telefonoValido) { setMsg('Indica un teléfono de contacto.'); return; }
    if (!perroValido) { setMsg('El nombre del perro es obligatorio.'); return; }
    if (domicilio && !direccionValida) { setMsg('Para modalidad a domicilio, indica una dirección.'); return; }

    setGuardando(true);
    try {
      const payload = {
        email: userEmail || '', // el backend puede inferirlo del token
        fecha, hora,
        servicioId: servicioSel?.id || servicioSel?.title || '',
        servicioTitulo: servicioSel?.title || '',
        modalidad,
        duration: servicioSel?.duration || '',
        durationMin,
        price: servicioSel?.price ?? null,
        currency: servicioSel?.currency || 'EUR',
        perro,
        telefono: contacto.telefono || '',
        direccion: contacto.direccion || '',
        pricing: {},
      };

      // POST /api/reservas (usuario)
      const res = await http('/api/reservas', { method: 'POST', data: payload, auth: true });
      if (res?.status === 409) { setMsg('❌ Esa hora ya no está disponible.'); return; }

      setMsg('✅ Reserva creada. Redirigiendo…');
      setTimeout(() => navigate('/reservas', { replace: true }), 900);
    } catch {
      setMsg('❌ No se pudo crear la reserva.');
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <div className="card">Cargando…</div>;

  /* ======================= render ======================= */
  return (
    <div className="card contratar-page">
      <h1>Contratar servicio</h1>

      <ol style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, marginBottom: 16 }}>
        {['Servicio', 'Fecha y hora', 'Datos del perro', 'Contacto', 'Resumen'].map((t, i) => (
          <li key={t} style={{ padding: '4px 8px', borderRadius: 8, background: i === step ? '#e5f2ea' : '#eee' }}>{i + 1}. {t}</li>
        ))}
      </ol>

      {/* Paso 0: elegir servicio */}
      {step === 0 && (
        <section>
          <h2>1) Elige servicio</h2>

          <label>
            Servicio:
            <select value={servicioId} onChange={e => setServicioId(e.target.value)} style={{ marginLeft: 8 }}>
              <option value="">— Selecciona —</option>
              {servicios.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>

          {servicioSel && (
            <div style={{ marginTop: 12, fontSize: 14, opacity: .9 }}>
              <div><b>{servicioSel.title}</b></div>
              <div>{servicioSel.short}</div>
              <div>{servicioSel.duration && <>⏱ {servicioSel.duration} · </>}{servicioSel.mode && <>📍 {servicioSel.mode}</>}</div>
              <div><b>Precio:</b> {formatEUR(servicioSel.price, servicioSel.currency)}</div>
            </div>
          )}

          <div className="actions">
            <button disabled={!servicioSel} className="btn-primary" onClick={() => setStep(1)}>Continuar</button>
          </div>
        </section>
      )}

      {/* Paso 1: calendario mensual + horas */}
      {step === 1 && (
        <section className="month-scheduler">
          <div className="month-header">
            <button
              className="btn-ghost"
              onClick={() => setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() - 1, 1))}
            >‹</button>
            <div className="month-label">
              {mesBase.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}
            </div>
            <button
              className="btn-ghost"
              onClick={() => setMesBase(new Date(mesBase.getFullYear(), mesBase.getMonth() + 1, 1))}
            >›</button>
          </div>

          <div className="weekdays">
            {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => <div key={d}>{d}</div>)}
          </div>

          <div className="month-grid">
            {(() => {
              const first = new Date(mesBase.getFullYear(), mesBase.getMonth(), 1);
              const startOffset = (first.getDay() + 6) % 7; // lunes = 0
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
                  const dow = d.getDay();         // 0..6 (Dom..Sáb)
                  const isWeekend = dow === 0 || dow === 6;
                  const isPastDay = f < todayYMD();
                  disabled = isWeekend || isPastDay; // fines de semana y pasado NO seleccionables
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
                      const same = (f === fecha);
                      if (same) { setFecha(''); setHora(''); }
                      else {
                        setFecha(f);
                        setHora('');
                        await cargarDisponibilidad(f);
                      }
                    }}
                    disabled={!inMonth || disabled}
                  >
                    {inMonth ? dayNum : ''}

                    {/* POPUP DE HORAS DENTRO DEL DÍA */}
                    {inMonth && f === fecha && (
                      <div className="popover" onClick={(e) => e.stopPropagation()}>
                        <div className="pop-title">
                          {new Date(fecha).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })}
                        </div>
                        <div className="pop-hours">
                          {(() => {
                            const rows = [];
                            for (let h = 9; h <= 20; h++) {
                              if (h === 14 || h === 15) continue; // 14-16 fuera
                              const t = `${String(h).padStart(2, '0')}:00`;
                              const busy = isSlotBusy(t);
                              rows.push(
                                <button
                                  key={t}
                                  className={`slot ${busy ? 'busy' : ''} ${hora === t ? 'active' : ''}`}
                                  disabled={busy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!busy) setHora(t);
                                  }}
                                  onDoubleClick={() => { if (canBlock && busy === false) bloquear(t); }}
                                  title={busy ? 'Ocupada' : (canBlock ? 'Seleccionar / Doble click: bloquear' : 'Seleccionar')}
                                >
                                  {t}–{addMinutes(t, durationMin)}
                                </button>
                              );
                            }
                            if (!rows.length) return <div className="hint">Sin horas.</div>;
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
            <button disabled={!hora} className="btn-primary" onClick={() => setStep(2)}>Continuar</button>
          </div>
        </section>
      )}

      {/* Paso 2: datos del perro */}
      {step === 2 && (
        <section>
          <h2>4) Datos del perro</h2>

          {perros.length === 0 ? (
            <>
              <p>No tienes perros guardados. Crea uno para asociarlo a la reserva.</p>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
                <label>Nombre (obligatorio)
                  <input required value={nuevoPerro.nombre} onChange={e => setNuevoPerro({ ...nuevoPerro, nombre: e.target.value })} />
                </label>
                <label>Raza/Tamaño (opcional)
                  <input value={nuevoPerro.razaTamaño} onChange={e => setNuevoPerro({ ...nuevoPerro, razaTamaño: e.target.value })} />
                </label>
                <label style={{ gridColumn: '1 / -1' }}>Observaciones (opcional)
                  <input value={nuevoPerro.observaciones} onChange={e => setNuevoPerro({ ...nuevoPerro, observaciones: e.target.value })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={nuevoPerro.castrado} onChange={e => setNuevoPerro({ ...nuevoPerro, castrado: e.target.checked })} />
                  Castrado/esterilizado (opcional)
                </label>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={atras}>Atrás</button>
                <button className="btn-secondary" onClick={crearPerro} disabled={!nuevoPerro.nombre?.trim()}>Guardar perro</button>
                <button
                  className="btn-primary"
                  disabled={!nuevoPerro.nombre?.trim()}
                  onClick={() => {
                    setPerro({
                      nombre: nuevoPerro.nombre.trim(),
                      edad: nuevoPerro.edad || '',
                      razaTamaño: nuevoPerro.razaTamaño || '',
                      castrado: !!nuevoPerro.castrado,
                      observaciones: nuevoPerro.observaciones || ''
                    });
                    setStep(3);
                  }}
                >
                  Continuar
                </button>
              </div>
            </>
          ) : perros.length === 1 ? (
            <>
              <p>Perro seleccionado: <b>{perro.nombre}</b>{perro.razaTamaño ? ` · ${perro.razaTamaño}` : ''}</p>
              <div className="actions">
                <button onClick={atras}>Atrás</button>
                <button className="btn-primary" onClick={() => setStep(3)}>Continuar</button>
              </div>
            </>
          ) : (
            <>
              <label>
                Selecciona perro (obligatorio):{' '}
                <select required value={perroId} onChange={e => setPerroId(e.target.value)}>
                  <option value="">— Selecciona —</option>
                  {perros.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}{p.raza ? ` · ${p.raza}` : ''}</option>
                  ))}
                </select>
              </label>

              <div style={{ marginTop: 10, display:'grid', gap:8, gridTemplateColumns:'1fr 1fr' }}>
                <label>Nombre (obligatorio)
                  <input required value={perro.nombre} onChange={e => setPerro({ ...perro, nombre: e.target.value })} />
                </label>
                <label>Raza/Tamaño (opcional)
                  <input value={perro.razaTamaño} onChange={e => setPerro({ ...perro, razaTamaño: e.target.value })} />
                </label>
                <label style={{ gridColumn:'1 / -1' }}>Observaciones (opcional)
                  <input value={perro.observaciones} onChange={e => setPerro({ ...perro, observaciones: e.target.value })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={perro.castrado} onChange={e => setPerro({ ...perro, castrado: e.target.checked })} />
                  Castrado/esterilizado (opcional)
                </label>
              </div>

              <div className="actions">
                <button onClick={atras}>Atrás</button>
                <button className="btn-primary" disabled={!perro.nombre?.trim()} onClick={() => setStep(3)}>Continuar</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Paso 3: contacto + modalidad */}
      {step === 3 && (
        <section>
          <h2>5) Datos de contacto</h2>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <label>Modalidad (obligatoria)
              <select required value={modalidad} onChange={e => setModalidad(e.target.value)}>
                {allowedModalities.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label>Teléfono (obligatorio)
              <input required value={contacto.telefono} onChange={e => setContacto({ ...contacto, telefono: e.target.value })} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Dirección {modalidad === 'a domicilio' ? '(obligatoria)' : '(opcional)'}
              <input
                required={modalidad === 'a domicilio'}
                value={contacto.direccion}
                onChange={e => setContacto({ ...contacto, direccion: e.target.value })}
              />
            </label>
          </div>

          {modalidad === 'a domicilio' && !(contacto.direccion && contacto.direccion.trim().length > 5) && (
            <p style={{ color: 'crimson', marginTop: 8 }}>⚠ Necesitas indicar una dirección para modalidad a domicilio.</p>
          )}

          <div className="actions">
            <button onClick={atras}>Atrás</button>
            <button
              className="btn-primary"
              onClick={() => setStep(4)}
              disabled={
                !(contacto.telefono && contacto.telefono.trim().length >= 6) ||
                (modalidad === 'a domicilio' && !(contacto.direccion && contacto.direccion.trim().length > 5))
              }
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {/* Paso 4: resumen + confirmar */}
      {step === 4 && (
        <section>
          <h2>6) Resumen</h2>
          {!servicioSel ? (
            <p>No hay servicio seleccionado. <Link to="/servicios">Volver a servicios</Link></p>
          ) : (
            <div className="summary">
              <div><b>Servicio:</b> {servicioSel.title}</div>
              <div><b>Fecha:</b> {fecha} — <b>Hora:</b> {hora}</div>
              <div><b>Duración:</b> {servicioSel.duration || `${durationMin} min`}</div>
              <div><b>Modalidad:</b> {modalidad}</div>
              <div><b>Precio:</b> {formatEUR(servicioSel.price, servicioSel.currency)}</div>
              <div>
                <b>Perro:</b> {perro.nombre || '(sin nombre)'}
                {perro.razaTamaño ? ` · ${perro.razaTamaño}` : ''}
                {perro.edad ? ` · ${perro.edad} años` : ''}
                {perro.castrado ? ' · castrado' : ''}
              </div>
              {contacto.telefono && <div><b>Teléfono:</b> {contacto.telefono}</div>}
              {contacto.direccion && <div><b>Dirección:</b> {contacto.direccion}</div>}
            </div>
          )}

          <div className="actions">
            <button onClick={atras}>Atrás</button>
            <button
              onClick={confirmar}
              className="btn-primary"
              disabled={
                !authReady || !servicioSel || !fecha || !hora ||
                !(contacto.telefono && contacto.telefono.trim().length >= 6) ||
                (modalidad === 'a domicilio' && !(contacto.direccion && contacto.direccion.trim().length > 5)) ||
                !(perro.nombre && perro.nombre.trim().length > 0) ||
                guardando
              }
            >
              {guardando ? 'Creando…' : 'Confirmar reserva'}
            </button>
            {msg && <span style={{ marginLeft: 8 }}>{msg}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
