// frontend/src/pages/Admin.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { http } from '../helpers/http';

function formatEUR(value, currency = 'EUR') {
  if (value == null) return 'A consultar';
  try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value); }
  catch { return `${value} ${currency}`; }
}
const HOURS = Array.from({ length: 12 }, (_, i) => i + 9).filter(h => h !== 14 && h !== 15); // 9..20 sin 14-15
const todayYMD = () => {
  const d = new Date(); const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
};

function Admin() {
  const navigate = useNavigate();

  // ===== gatekeeping admin =====
  const [autenticado, setAutenticado] = useState(false);
  useEffect(() => {
    const logged = localStorage.getItem('usuarioLogueado');
    const rol = localStorage.getItem('rol'); // 'admin' | 'client'
    if (logged && rol === 'admin') setAutenticado(true);
    else navigate('/login');
  }, [navigate]);
  if (!autenticado) return null;

  /* ========================= NOTICES ========================= */
  const [notice, setNotice] = useState({ type:'', text:'' });
  const showOk  = (t)=>setNotice({type:'success',text:t});
  const showErr = (t)=>setNotice({type:'error',text:t});
  const clear   = ()=>setNotice({type:'',text:''});

  /* ========================= VIDEOS ========================= */
  const [mensajeVid, setMensajeVid] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tier, setTier] = useState('public');

  const crearVideo = async (e) => {
    e.preventDefault();
    setMensajeVid('');
    try {
      await http('/api/videos', { method: 'POST', data: { title, url, tier }, auth: true });
      setMensajeVid('✅ Vídeo creado');
      setTitle(''); setUrl(''); setTier('public');
    } catch (err) {
      console.error(err);
      setMensajeVid('❌ No se pudo crear el vídeo');
    }
  };

  /* ======================= SERVICIOS (CRUD) ======================= */
  const [servicios, setServicios] = useState([]);
  const [loadingServ, setLoadingServ] = useState(true);
  const [servMsg, setServMsg] = useState('');
  const [nuevo, setNuevo] = useState({
    title:'', short:'', long:'', price:'', currency:'EUR',
    duration:'', durationMin:'', mode:'', featured:false, order:''
  });

  const refreshServicios = async () => {
    setLoadingServ(true);
    try {
      const list = await http('/api/servicios');
      const arr = Array.isArray(list) ? list : (list?.items || []);
      arr.sort((a,b)=> (a?.order ?? 0) - (b?.order ?? 0));
      setServicios(arr);
    } catch {
      setServicios([]); showErr('No se pudo cargar el catálogo de servicios.');
    } finally {
      setLoadingServ(false);
    }
  };
  useEffect(()=>{ refreshServicios(); }, []);

  const crearServicio = async (e) => {
    e.preventDefault(); setServMsg('');
    try {
      const body = {
        ...nuevo,
        order: nuevo.order==='' ? undefined : Number(nuevo.order),
        price: nuevo.price==='' ? null : Number(nuevo.price),
        durationMin: nuevo.durationMin==='' ? undefined : Number(nuevo.durationMin),
      };
      await http('/api/servicios', { method:'POST', data: body, auth:true });
      setNuevo({ title:'', short:'', long:'', price:'', currency:'EUR', duration:'', durationMin:'', mode:'', featured:false, order:'' });
      setServMsg('✅ Servicio creado');
      refreshServicios();
    } catch { setServMsg('❌ No se pudo crear'); }
  };

  const guardarServicio = async (id, patch) => {
    try {
      const body = { ...patch };
      if (body.price === '') body.price = null;
      if (body.order !== '' && body.order != null) body.order = Number(body.order);
      if (body.durationMin !== '' && body.durationMin != null) body.durationMin = Number(body.durationMin);
      await http(`/api/servicios/${id}`, { method:'PATCH', data: body, auth:true });
      await refreshServicios(); showOk('Servicio guardado');
    } catch { showErr('No se pudo guardar'); }
  };

  const borrarServicio = async (id) => {
    if (!window.confirm('¿Borrar este servicio?')) return;
    try {
      await http(`/api/servicios/${id}`, { method:'DELETE', auth:true });
      await refreshServicios(); showOk('Servicio borrado');
    } catch { showErr('No se pudo borrar'); }
  };

  /* ======================= RESERVAS (ADMIN) ======================= */
  const [reservas, setReservas] = useState([]);
  const [loadingRes, setLoadingRes] = useState(false);
  const [errorRes, setErrorRes] = useState('');
  const [adminFilterStatus, setAdminFilterStatus] = useState('all'); // all|pending|confirmed|rejected|cancelled
  const [adminFilterEmail, setAdminFilterEmail] = useState('');
  const [adminLimit, setAdminLimit] = useState(300);
  const [adminNotes, setAdminNotes] = useState({});

  const cargarReservas = async () => {
    setLoadingRes(true); setErrorRes('');
    try {
      const qs = new URLSearchParams({
        status: adminFilterStatus,
        ...(adminFilterEmail ? { email: adminFilterEmail.trim() } : {}),
        limit: String(adminLimit)
      }).toString();
      const data = await http(`/api/reservas?${qs}`, { auth: true });
      const items = Array.isArray(data) ? data : (data?.items || []);
      setReservas(items);
    } catch (err) {
      console.error(err); setReservas([]); setErrorRes('No se pudieron cargar las reservas.');
    } finally { setLoadingRes(false); }
  };
  useEffect(()=>{ cargarReservas(); },[]);

  const confirmar = async (id) => {
    try {
      await http(`/api/reservas/${id}/confirm`, { method:'PATCH', auth:true, data: { note: adminNotes[id] || '' }});
      showOk('Reserva confirmada'); cargarReservas();
    } catch { showErr('No se pudo confirmar'); }
  };
  const rechazar = async (id) => {
    try {
      await http(`/api/reservas/${id}/reject`, { method:'PATCH', auth:true, data: { note: adminNotes[id] || '' }});
      showOk('Reserva rechazada'); cargarReservas();
    } catch { showErr('No se pudo rechazar'); }
  };
  const cancelar = async (id) => {
    if (!window.confirm('¿Cancelar esta reserva?')) return;
    const reason = window.prompt('Motivo (opcional):') || '';
    try {
      await http(`/api/reservas/${id}/cancel`, { method:'PATCH', auth:true, data: { reason }});
      showOk('Reserva cancelada'); cargarReservas();
    } catch { showErr('No se pudo cancelar'); }
  };

  // Acciones rápidas
  const [quickFecha, setQuickFecha] = useState(todayYMD());
  const [quickHora, setQuickHora] = useState('09:00');
  const [quickEmail, setQuickEmail] = useState('');
  const [servicioId, setServicioId] = useState('');
  const servicioSel = useMemo(()=> servicios.find(s=>s.id===servicioId) || null, [servicios, servicioId]);
  const durationMin = useMemo(()=>{
    if (servicioSel?.durationMin) return Number(servicioSel.durationMin);
    const txt = servicioSel?.duration || ''; const m = txt.match(/(\d+)\s*min/i);
    return m ? Number(m[1]) : 60;
  }, [servicioSel]);

  const bloquear = async () => {
    try {
      await http('/api/reservas/bloqueos', {
        method:'POST', auth:true,
        data: { fecha: quickFecha, hora: quickHora, durationMin, motivo: 'Bloqueo manual' }
      });
      showOk(`Bloqueada ${quickFecha} ${quickHora}`); cargarReservas();
    } catch { showErr('No se pudo bloquear'); }
  };
  const reservarParaEmail = async () => {
    if (!/\S+@\S+\.\S+/.test(quickEmail)) { showErr('Email inválido'); return; }
    try {
      const payload = {
        email: quickEmail.trim(),
        fecha: quickFecha, hora: quickHora,
        servicioId: servicioSel?.id || '',
        servicioTitulo: servicioSel?.title || '',
        modalidad: 'presencial',
        duration: servicioSel?.duration || '',
        durationMin,
        price: servicioSel?.price ?? null,
        currency: servicioSel?.currency || 'EUR',
        perro: {}, telefono:'', direccion:'', pricing:{}
      };
      await http('/api/reservas/admin', { method:'POST', auth:true, data: payload });
      setQuickEmail(''); showOk('Reserva creada para el email'); cargarReservas();
    } catch { showErr('No se pudo crear la reserva'); }
  };

  /* ============================ RENDER ============================ */
  return (
    <div className="admin">
      <h1>Panel de Administración</h1>
      {notice.text && (
        <div className={`notice ${notice.type}`} style={{ marginBottom: 12 }}>
          {notice.text} <button className="btn-ghost" onClick={clear} style={{ marginLeft: 8 }}>×</button>
        </div>
      )}

      {/* ====== SERVICIOS ====== */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Servicios (CRUD)</h2>

        <form onSubmit={crearServicio} style={{ display: 'grid', gap: 8, gridTemplateColumns:'1fr 1fr', maxWidth: 900 }}>
          <label style={{ gridColumn:'1 / -1' }}>
            Título:
            <input value={nuevo.title} onChange={e => setNuevo({ ...nuevo, title: e.target.value })} required />
          </label>
          <label style={{ gridColumn:'1 / -1' }}>
            Resumen:
            <input value={nuevo.short} onChange={e => setNuevo({ ...nuevo, short: e.target.value })} required />
          </label>
          <label style={{ gridColumn:'1 / -1' }}>
            Descripción:
            <textarea rows={3} value={nuevo.long} onChange={e => setNuevo({ ...nuevo, long: e.target.value })} />
          </label>
          <label>
            Precio (€):
            <input type="number" step="0.01" value={nuevo.price} onChange={e => setNuevo({ ...nuevo, price: e.target.value })} placeholder="Vacío = sin precio" />
          </label>
          <label>
            Moneda:
            <input value={nuevo.currency} onChange={e => setNuevo({ ...nuevo, currency: e.target.value })} />
          </label>
          <label>
            Duración (texto):
            <input value={nuevo.duration} onChange={e => setNuevo({ ...nuevo, duration: e.target.value })} placeholder="6 sesiones · 60 min" />
          </label>
          <label>
            Duración (min):
            <input type="number" value={nuevo.durationMin} onChange={e => setNuevo({ ...nuevo, durationMin: e.target.value })} placeholder="60" />
          </label>
          <label>
            Modalidad:
            <input value={nuevo.mode} onChange={e => setNuevo({ ...nuevo, mode: e.target.value })} placeholder="presencial / domicilio / online" />
          </label>
          <label>
            Orden:
            <input type="number" value={nuevo.order} onChange={e => setNuevo({ ...nuevo, order: e.target.value })} placeholder="10, 20…" />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={nuevo.featured} onChange={e => setNuevo({ ...nuevo, featured: e.target.checked })} />
            Destacado
          </label>
          <div style={{ gridColumn:'1 / -1' }}>
            <button type="submit">Crear servicio</button>
            {servMsg && <span style={{ marginLeft: 8 }}>{servMsg}</span>}
          </div>
        </form>

        <div style={{ marginTop: 16 }}>
          {loadingServ ? <div>Cargando servicios…</div> : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              {servicios.map(s => (
                <article key={s.id} className="service-card" style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
                  <input style={{ fontWeight: 600, fontSize: 16 }}
                    defaultValue={s.title || ''} onChange={e => s._title = e.target.value} placeholder="Título" />
                  <input defaultValue={(s.short ?? '')} onChange={e => s._short = e.target.value} placeholder="Resumen" />
                  <textarea rows={2} defaultValue={(s.long ?? '')} onChange={e => s._long = e.target.value} placeholder="Descripción" />
                  <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' }}>
                    <input type="number" step="0.01" defaultValue={s.price ?? ''} onChange={e => s._price = e.target.value} placeholder="€" />
                    <input defaultValue={s.currency || 'EUR'} onChange={e => s._currency = e.target.value} placeholder="Moneda" />
                    <input defaultValue={s.duration || ''} onChange={e => s._duration = e.target.value} placeholder="Duración texto" />
                    <input type="number" defaultValue={s.durationMin ?? ''} onChange={e => s._durationMin = e.target.value} placeholder="Duración (min)" />
                    <input defaultValue={s.mode || ''} onChange={e => s._mode = e.target.value} placeholder="Modalidad" />
                    <input type="number" defaultValue={s.order ?? ''} onChange={e => s._order = e.target.value} placeholder="Orden" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => {
                      const patch = {
                        title: s._title ?? s.title,
                        short: s._short ?? s.short,
                        long: s._long ?? s.long,
                        price: s._price ?? s.price ?? '',
                        currency: s._currency ?? s.currency,
                        duration: s._duration ?? s.duration,
                        durationMin: s._durationMin ?? s.durationMin ?? '',
                        mode: s._mode ?? s.mode,
                        order: s._order ?? s.order ?? '',
                      };
                      guardarServicio(s.id, patch);
                    }}>Guardar</button>
                    <button className="btn-danger" onClick={() => borrarServicio(s.id)}>Borrar</button>
                  </div>
                  <div style={{ fontSize: 13, opacity: .8, marginTop: 6 }}>
                    {s.duration && <>⏱ {s.duration} · </>}
                    {s.mode && <>📍 {s.mode} · </>}
                    {s.price != null && <b>{formatEUR(s.price, s.currency)}</b>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ====== VIDEOS ====== */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Vídeos</h2>
        <form onSubmit={crearVideo} style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
          <label>
            Título:
            <input value={title} onChange={e => setTitle(e.target.value)} required />
          </label>
          <label>
            URL:
            <input value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://..." />
          </label>
          <label>
            Nivel:
            <select value={tier} onChange={e => setTier(e.target.value)}>
              <option value="public">Público</option>
              <option value="private">Solo usuarios registrados</option>
            </select>
          </label>
          <button type="submit">Guardar vídeo</button>
        </form>
        {mensajeVid && <p style={{ marginTop: 8 }}>{mensajeVid}</p>}
      </div>

      {/* ====== RESERVAS ====== */}
      <div className="card">
        <h2>Reservas</h2>

        {/* Acciones rápidas */}
        <div style={{ display:'grid', gap:10, gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', marginBottom:12 }}>
          <label>Fecha
            <input type="date" value={quickFecha} onChange={(e)=>setQuickFecha(e.target.value)} />
          </label>
          <label>Hora
            <select value={quickHora} onChange={(e)=>setQuickHora(e.target.value)}>
              {HOURS.map(h => {
                const t = `${String(h).padStart(2,'0')}:00`;
                return <option key={t} value={t}>{t}</option>;
              })}
            </select>
          </label>
          <label>Servicio
            <select value={servicioId} onChange={(e)=>setServicioId(e.target.value)}>
              <option value="">— Selecciona —</option>
              {servicios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label>Email (reservar para…)
            <input type="email" value={quickEmail} onChange={(e)=>setQuickEmail(e.target.value)} placeholder="cliente@ejemplo.com" />
          </label>
          <div style={{ display:'flex', gap:8, alignItems:'end' }}>
            <button className="btn-danger" onClick={bloquear} disabled={!servicioId}>Bloquear hora</button>
            <button className="btn-primary" onClick={reservarParaEmail} disabled={!servicioId}>Crear para email</button>
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
          <label>Estado
            <select value={adminFilterStatus} onChange={(e)=>setAdminFilterStatus(e.target.value)} style={{ marginLeft: 6 }}>
              <option value="all">Todos</option>
              <option value="pending">Pendientes</option>
              <option value="confirmed">Confirmadas</option>
              <option value="rejected">Rechazadas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </label>
          <label>Email (igual)
            <input type="email" value={adminFilterEmail} onChange={(e)=>setAdminFilterEmail(e.target.value)} placeholder="(opcional)" style={{ marginLeft: 6 }} />
          </label>
          <label>Límite
            <input type="number" min={50} max={1000} value={adminLimit} onChange={(e)=>setAdminLimit(Number(e.target.value||300))} style={{ width:100, marginLeft: 6 }} />
          </label>
          <button className="btn-ghost" onClick={cargarReservas} disabled={loadingRes}>
            {loadingRes ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>

        {errorRes && <p style={{ color: 'crimson' }}>{errorRes}</p>}

        {!reservas.length && !loadingRes ? (
          <div className="empty">No hay reservas.</div>
        ) : (
          <ul className="reservas-list">
            {reservas.map(r => (
              <li key={r.id} className="reserva-item">
                <div className="reserva-main">
                  <div className="title">{r.servicioTitulo || 'Servicio'}</div>
                  <div className="meta">
                    <b>De:</b> {r.email || r.uid || 'desconocido'} · <b>Fecha:</b> {r.fecha} · <b>Hora:</b> {r.hora} · <i>{r.modalidad || 'presencial'}</i>
                  </div>
                </div>
                <div className={`badge ${r.status}`}>{r.status}</div>
                <div className="admin-actions">
                  <input
                    type="text"
                    placeholder="Nota para el usuario…"
                    value={adminNotes[r.id] ?? r.adminNote ?? ''}
                    onChange={(e) => setAdminNotes({ ...adminNotes, [r.id]: e.target.value })}
                    style={{ minWidth: 220 }}
                  />
                  {r.status === 'pending' && (
                    <>
                      <button className="btn-primary" onClick={() => confirmar(r.id)}>Confirmar</button>
                      <button className="btn-danger" onClick={() => rechazar(r.id)}>Rechazar</button>
                    </>
                  )}
                  {['confirmed','pending'].includes(r.status) && (
                    <button className="btn-ghost" onClick={() => cancelar(r.id)}>Cancelar</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: 12, opacity: .7, marginTop: 8 }}>
          * Esta vista exige token y rol admin en el backend.
        </p>
      </div>
    </div>
  );
}

export default Admin;
