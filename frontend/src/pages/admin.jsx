// frontend/src/pages/admin.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { http } from '../helpers/http';
import { useAuth } from '../context/auth'; // Importamos useAuth

/* ==================== UTILS ==================== */
function formatEUR(value, currency = 'EUR') {
  if (value == null) return 'A consultar';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
const HOURS = Array.from({ length: 12 }, (_, i) => i + 9).filter(h => h !== 14 && h !== 15);
const todayYMD = () => {
  const d = new Date(); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

// helper para evitar keys null/undefined
const getServicioKey = (s) => String(s.id ?? s.uuid ?? s._id ?? s.title ?? `srv-${Math.random()}`);

/* ==================== COMPONENTE PRINCIPAL ==================== */
export default function Admin() {
  const navigate = useNavigate();
  const { user, role, loading } = useAuth(); // Usamos el contexto
  const [tab, setTab] = useState('usuarios');

  // Gatekeeping: Redundante si usas RoleRoute, pero seguro por si se accede directo
  useEffect(() => {
    if (!loading) {
      const esAdmin = role === 'admin' || user?.isAdmin;
      if (!esAdmin) {
        navigate('/');
      }
    }
  }, [loading, role, user, navigate]);

  if (loading) return <div className="admin page-wrapper">Cargando...</div>;
  if (!(role === 'admin' || user?.isAdmin)) return null;

  return (
    <div className="admin page-wrapper" style={{ padding: '2rem 0', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1.5rem', color: '#2f6f62' }}>Panel de Administración</h1>

      {/* Navegación por pestañas */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '2px solid #eee', paddingBottom: 10, overflowX: 'auto' }}>
        <button className={tab === 'usuarios' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('usuarios')}>👥 Usuarios</button>
        <button className={tab === 'reservas' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('reservas')}>📅 Reservas</button>
        <button className={tab === 'servicios' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('servicios')}>🛠 Servicios</button>
        <button className={tab === 'videos' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('videos')}>📹 Vídeos</button>
      </div>

      <div className="tab-content">
        {tab === 'usuarios' && <UsersTab />}
        {tab === 'reservas' && <ReservasTab />}
        {tab === 'servicios' && <ServiciosTab />}
        {tab === 'videos' && <VideosTab />}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA USUARIOS ==================== */
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', rol: 'user' });
  const [msg, setMsg] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await http('/api/auth/users', { auth: true });
      setUsers(data || []);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadUsers(); }, []);

  const changeRole = async (uid, newRole) => {
    if (!window.confirm(`¿Cambiar rol a ${newRole}?`)) return;
    try {
      await http('/api/auth/role', { method: 'POST', data: { uid, rol: newRole }, auth: true });
      loadUsers();
    } catch (e) { alert('Error cambiando rol'); }
  };

  const createUser = async (e) => {
    e.preventDefault();
    if (!newUser.email || !newUser.password) return;
    try {
      await http('/api/auth/users', { method: 'POST', data: newUser, auth: true });
      setMsg('✅ Usuario creado');
      setNewUser({ name: '', email: '', password: '', rol: 'user' });
      loadUsers();
    } catch (e) { setMsg('❌ Error creando usuario. Email duplicado?'); }
  };

  const deleteUser = async (uid) => {
    if (!window.confirm('⚠️ ¿ELIMINAR usuario y todos sus datos?')) return;
    try {
      await http(`/api/auth/users/${uid}`, { method: 'DELETE', auth: true });
      loadUsers();
    } catch (e) { alert('Error eliminando usuario'); }
  };

  return (
    <div>
      {/* Formulario de Creación */}
      <div className="card" style={{ marginBottom: 20, padding: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Crear nuevo usuario (Empleado/Cliente)</h3>
        <form onSubmit={createUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label>Nombre <input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} style={{ width: '100%' }} /></label>
          <label>Email <input type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} required style={{ width: '100%' }} /></label>
          <label>Contraseña <input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} required style={{ width: '100%' }} /></label>
          <label>Rol
            <select value={newUser.rol} onChange={e => setNewUser({ ...newUser, rol: e.target.value })} style={{ width: '100%' }}>
              <option value="user">Usuario</option>
              <option value="adiestrador">Adiestrador</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="btn-primary">Crear Usuario</button>
        </form>
        {msg && <p style={{ marginTop: 10, fontWeight: 'bold' }}>{msg}</p>}
      </div>

      {/* Tabla de Usuarios */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Lista de Usuarios ({users.length})</h3>
        {loading ? <p>Cargando...</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, minWidth: '600px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee', background: '#f9f9f9' }}>
                  <th style={{ padding: 10 }}>Nombre</th>
                  <th style={{ padding: 10 }}>Email</th>
                  <th style={{ padding: 10 }}>Rol Actual</th>
                  <th style={{ padding: 10 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.uid} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 10 }}>{u.nombre || '-'}</td>
                    <td style={{ padding: 10 }}>{u.email}</td>
                    <td style={{ padding: 10 }}>
                      <span style={{
                        padding: '4px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold',
                        background: u.rol === 'admin' ? '#333' : u.rol === 'adiestrador' ? '#e68a4e' : '#eee',
                        color: u.rol === 'user' ? '#333' : '#fff'
                      }}>
                        {u.rol}
                      </span>
                    </td>
                    <td style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        value={u.rol}
                        onChange={(e) => changeRole(u.uid, e.target.value)}
                        style={{ padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
                      >
                        <option value="user">Usuario</option>
                        <option value="adiestrador">Adiestrador</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button className="btn-ghost" onClick={() => deleteUser(u.uid)} title="Eliminar" style={{ color: 'crimson' }}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA RESERVAS ==================== */
function ReservasTab() {
  const [reservas, setReservas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [adminNotes, setAdminNotes] = useState({});

  const [quickFecha, setQuickFecha] = useState(todayYMD());
  const [quickHora, setQuickHora] = useState('09:00');
  const [quickEmail, setQuickEmail] = useState('');
  
  const [servicios, setServicios] = useState([]);
  const [servicioId, setServicioId] = useState('');

  useEffect(() => {
    http('/api/servicios').then(data => {
      const arr = Array.isArray(data) ? data : [];
      setServicios(arr);
      if (arr.length) setServicioId(arr[0].id);
    }).catch(() => {});
    cargarReservas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarReservas = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status: filterStatus, limit: '300' });
      const data = await http(`/api/reservas?${qs}`, { auth: true });
      setReservas(Array.isArray(data) ? data : []);
    } catch { } finally { setLoading(false); }
  };

  const confirmar = async (id) => {
    try {
      await http(`/api/reservas/${id}/confirm`, { method:'PATCH', auth:true, data: { note: adminNotes[id] || '' }});
      cargarReservas();
    } catch { alert('Error'); }
  };

  const rechazar = async (id) => {
    try {
      await http(`/api/reservas/${id}/reject`, { method:'PATCH', auth:true, data: { note: adminNotes[id] || '' }});
      cargarReservas();
    } catch { alert('Error'); }
  };

  const bloquear = async () => {
    try {
      await http('/api/reservas/bloqueos', { method:'POST', auth:true, data: { fecha: quickFecha, hora: quickHora, motivo: 'Manual' } });
      alert('Hora bloqueada');
    } catch { alert('Error'); }
  };

  const reservarManual = async () => {
    if(!quickEmail) return alert('Pon un email');
    try {
      const s = servicios.find(x => x.id === servicioId);
      await http('/api/reservas/admin', { 
        method:'POST', auth:true, 
        data: { 
          email: quickEmail, fecha: quickFecha, hora: quickHora, 
          servicioId: s?.id, servicioTitulo: s?.title, status: 'pending' 
        } 
      });
      alert('Reserva creada'); cargarReservas();
    } catch { alert('Error'); }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, padding: '1.5rem', background: '#e7f3ef' }}>
        <h3 style={{marginTop:0}}>Acciones Rápidas</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>Fecha <input type="date" value={quickFecha} onChange={e => setQuickFecha(e.target.value)} /></label>
          <label>Hora 
            <select value={quickHora} onChange={e => setQuickHora(e.target.value)}>
              {HOURS.map(h => <option key={h} value={`${String(h).padStart(2,'0')}:00`}>{h}:00</option>)}
            </select>
          </label>
          <label>Servicio
            <select value={servicioId} onChange={e => setServicioId(e.target.value)}>
              {servicios.map(s => {
                const key = getServicioKey(s);
                return (
                  <option key={key} value={s.id}>
                    {s.title}
                  </option>
                );
              })}
            </select>
          </label>
          <button className="btn-danger" onClick={bloquear}>Bloquear Hora</button>
          
          <div style={{flex:1}}></div>
          
          <label>Email Cliente <input type="email" value={quickEmail} onChange={e => setQuickEmail(e.target.value)} placeholder="cliente@mail.com" /></label>
          <button className="btn-primary" onClick={reservarManual}>Crear Reserva</button>
        </div>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
          <h3 style={{margin:0}}>Listado de Reservas</h3>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setTimeout(cargarReservas, 100); }}>
            <option value="all">Todas</option>
            <option value="pending">Pendientes</option>
            <option value="confirmed">Confirmadas</option>
          </select>
          <button className="btn-ghost" onClick={cargarReservas}>🔄 Actualizar</button>
        </div>

        {loading ? <p>Cargando...</p> : (
          <ul className="reservas-list">
            {reservas.map(r => (
              <li key={r.id} className="reserva-item">
                <div className="reserva-main">
                  <div className="title">{r.servicioTitulo}</div>
                  <div className="meta">
                    <b>{r.email}</b> · {r.fecha} {r.hora} · <span className={`badge ${r.status}`}>{r.status}</span>
                  </div>
                </div>
                <div className="admin-actions">
                  <input placeholder="Nota..." value={adminNotes[r.id] || ''} onChange={e => setAdminNotes({...adminNotes, [r.id]: e.target.value})} />
                  {r.status === 'pending' && (
                    <>
                      <button className="btn-primary" onClick={() => confirmar(r.id)}>✓</button>
                      <button className="btn-danger" onClick={() => rechazar(r.id)}>✗</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA SERVICIOS ==================== */
function ServiciosTab() {
  const [servicios, setServicios] = useState([]);
  const [nuevo, setNuevo] = useState({ title: '', short: '', price: '', duration: '', mode: '' });

  const refresh = async () => {
    try {
      const data = await http('/api/servicios');
      setServicios(Array.isArray(data) ? data : []);
    } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const crear = async (e) => {
    e.preventDefault();
    try {
      await http('/api/servicios', { method: 'POST', data: { ...nuevo, price: Number(nuevo.price) }, auth: true });
      refresh();
      setNuevo({ title: '', short: '', price: '', duration: '', mode: '' });
    } catch { alert('Error creando servicio'); }
  };

  const borrar = async (id) => {
    if(window.confirm('¿Borrar?')) {
      await http(`/api/servicios/${id}`, { method: 'DELETE', auth: true });
      refresh();
    }
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h3>Gestión de Servicios</h3>
      <form onSubmit={crear} style={{ marginBottom: 20, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems:'end' }}>
        <label>Título <input value={nuevo.title} onChange={e => setNuevo({...nuevo, title: e.target.value})} required /></label>
        <label>Resumen <input value={nuevo.short} onChange={e => setNuevo({...nuevo, short: e.target.value})} required /></label>
        <label>Precio <input type="number" value={nuevo.price} onChange={e => setNuevo({...nuevo, price: e.target.value})} /></label>
        <label>Duración <input value={nuevo.duration} onChange={e => setNuevo({...nuevo, duration: e.target.value})} placeholder="60 min" /></label>
        <label>Modalidad <input value={nuevo.mode} onChange={e => setNuevo({...nuevo, mode: e.target.value})} placeholder="presencial" /></label>
        <button type="submit" className="btn-primary">Añadir</button>
      </form>
      <div style={{ display: 'grid', gap: 10 }}>
        {servicios.map(s => {
          const key = getServicioKey(s);
          return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', border: '1px solid #eee', borderRadius: 8 }}>
              <div>
                <strong>{s.title}</strong> <small>({formatEUR(s.price)})</small><br/>
                <span style={{fontSize:12, color:'#666'}}>{s.short}</span>
              </div>
              <button onClick={() => borrar(s.id)} className="btn-ghost" style={{color:'crimson'}}>🗑️</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA VÍDEOS ==================== */
function VideosTab() {
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
    } catch (err) { setMensajeVid('❌ Error creando vídeo'); }
  };

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: 500 }}>
      <h3>Publicar Nuevo Vídeo</h3>
      <form onSubmit={crearVideo} style={{ display: 'grid', gap: 12 }}>
        <label>Título
          <input value={title} onChange={e => setTitle(e.target.value)} required />
        </label>
        <label>URL (YouTube/Vimeo)
          <input value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://..." />
        </label>
        <label>Visibilidad
          <select value={tier} onChange={e => setTier(e.target.value)}>
            <option value="public">Público (Todos)</option>
            <option value="private">Privado (Solo registrados)</option>
          </select>
        </label>
        <button type="submit" className="btn-primary">Guardar vídeo</button>
      </form>
      {mensajeVid && <p style={{ marginTop: 12, fontWeight: 'bold' }}>{mensajeVid}</p>}
    </div>
  );
}
