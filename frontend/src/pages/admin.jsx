// frontend/src/pages/admin.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { http } from '../helpers/http';
import { useAuth } from '../context/auth';
import { useUi } from '../context/ui';

// ✅ Reservas admin unificadas dentro del panel /admin
import ReservasAdmin from './reservas/reservasAdmin.jsx';

// ✅ Servicios web embebidos dentro del panel /admin
import Servicios from './servicios.jsx';

function isValidEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(s);
}

function countLetters(text) {
  const s = String(text || '').trim();
  const m = s.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g);
  return m ? m.length : 0;
}

function isStrongPassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return false;
  return /\d/.test(s) && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(s);
}


/* ==================== UTILS ==================== */
function formatEUR(value, currency = 'EUR') {
  if (value == null) return 'A consultar';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

// Base del backend para construir URLs absolutas (imágenes / archivos)
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const absUrl = (u = '') =>
  !u ? '' : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith('/') ? '' : '/'}${u}`;

const getTrainerPhotoSrc = (u = '') => {
  const s = String(u || '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/api/') || s.startsWith('/files/')) return absUrl(s);
  return s;
};

// helper para evitar keys null/undefined
const getServicioKey = (s) => String(s.id ?? s.uuid ?? s._id ?? s.title ?? `srv-${Math.random()}`);

const ALLOWED_TABS = ['usuarios', 'reservas', 'servicios', 'adiestradores'];
const normalizeTab = (t) => {
  const x = String(t || '').toLowerCase().trim();
  return ALLOWED_TABS.includes(x) ? x : 'usuarios';
};

function roleBadgeStyle(roleRaw) {
  const role = String(roleRaw || '').toLowerCase();
  const isAdmin = role === 'admin';
  const isTrainer = role === 'adiestrador';
  const isClientOrUser = role === 'client' || role === 'user' || role === '';

  return {
    padding: '4px 8px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 'bold',
    background: isAdmin ? '#333' : isTrainer ? '#e68a4e' : '#eee',
    color: isClientOrUser ? '#333' : '#fff',
  };
}

/* ==================== COMPONENTE PRINCIPAL ==================== */
export default function Admin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, role, loading } = useAuth();

  const isAdmin = role === 'admin' || user?.isAdmin;

  // ✅ Lee el tab de la URL: /admin?tab=reservas
  const urlTab = useMemo(() => normalizeTab(searchParams.get('tab')), [searchParams]);
  const [tab, setTab] = useState(urlTab);

  // Sync estado cuando cambia la URL (back/forward)
  useEffect(() => {
    const next = normalizeTab(searchParams.get('tab'));
    if (next !== tab) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Gatekeeping: redundante si ya usas RoleRoute, pero seguro por si se accede directo
  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate('/', { replace: true });
    }
  }, [loading, isAdmin, navigate]);

  const setTabAndUrl = (nextTab) => {
    const t = normalizeTab(nextTab);
    setTab(t);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', t);
    setSearchParams(sp, { replace: true });
  };

  if (loading) return <div className="admin page-wrapper">Cargando...</div>;
  if (!isAdmin) return null;

  return (
    <div className="admin page-wrapper">
      <h1 className="admin__title">Panel de Administración</h1>

      {/* Accesos (navegación unificada del panel admin) */}
      <div className="admin__navCard">
        <div className="admin__nav">
          <button
            className={tab === 'usuarios' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTabAndUrl('usuarios')}
          >
            👥 Usuarios
          </button>
          <button
            className={tab === 'reservas' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTabAndUrl('reservas')}
          >
            📅 Reservas
          </button>

          <button
            className={tab === 'servicios' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTabAndUrl('servicios')}
          >
            🧾 Servicios
          </button>

          <span className="admin__separator" />

          <button
            className={tab === 'adiestradores' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTabAndUrl('adiestradores')}
          >
            🐕 Adiestradores
          </button>
        </div>
      </div>

      <div className="tab-content">
        {tab === 'usuarios' && <UsersTab />}
        {tab === 'reservas' && <ReservasAdmin />}
        {tab === 'servicios' && <Servicios embedded />}
        {tab === 'adiestradores' && <AdiestradoresTab />}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA USUARIOS ==================== */
function UsersTab() {
  const ui = useUi(); 

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    rol: 'client',
  });
  const [msg, setMsg] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await http('/api/auth/users', { auth: true });
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      ui?.notify?.({ type: 'error', message: 'Error cargando usuarios.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const changeRole = async (uid, newRole) => {
    const uidSafe = String(uid || '').trim();
    if (!uidSafe) {
      ui.notify({
        type: 'error',
        message:
          'Este usuario no tiene UID válido (probablemente falta fila en la tabla "usuarios"). Revisa el endpoint /api/auth/users.',
      });
      return;
    }

    const ok = await ui.confirm({
      title: 'Cambiar rol',
      message: `¿Cambiar rol a ${newRole}?`,
      confirmText: 'Cambiar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;

    try {
      await http('/api/auth/role', {
        method: 'POST',
        data: { uid: uidSafe, rol: newRole },
        auth: true,
      });
      ui.notify({ type: 'success', message: 'Rol actualizado.' });
      loadUsers();
    } catch (e) {
      console.error(e);
      ui.notify({ type: 'error', message: 'Error cambiando rol.' });
    }
  };

  const createUser = async (e) => {
    e.preventDefault();

    const email = String(newUser.email || "").trim();
    const name = String(newUser.name || "").trim();
    const password = String(newUser.password || "");

    if (!email || !password || !name) {
      setMsg("❌ Rellena nombre, email y contraseña.");
      return;
    }
    if (!isValidEmail(email)) {
      setMsg("❌ Email inválido.");
      return;
    }
    if (countLetters(name) < 2) {
      setMsg("❌ El nombre debe tener al menos 2 letras.");
      return;
    }
    if (!isStrongPassword(password)) {
      setMsg("❌ Contraseña insegura: mínimo 8 caracteres e incluir letras y números.");
      return;
    }

    try {
      await http('/api/auth/users', { method: 'POST', data: newUser, auth: true });
      setMsg('✅ Usuario creado. Se ha enviado un email con las credenciales (si el correo está configurado).');
      setNewUser({ name: '', email: '', password: '', rol: 'client' });
      loadUsers();
    } catch (e) {
      console.error(e);
      setMsg('❌ Error creando usuario. Email duplicado?');
    }
  };

  const deleteUser = async (uid) => {
    const uidSafe = String(uid || '').trim();
    if (!uidSafe) {
      ui.notify({ type: 'error', message: 'No se puede borrar: UID inválido.' });
      return;
    }

    const ok = await ui.confirm({
      title: 'Eliminar usuario',
      message: '⚠️ ¿ELIMINAR usuario y todos sus datos?',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;

    try {
      await http(`/api/auth/users/${uidSafe}`, { method: 'DELETE', auth: true });
      ui.notify({ type: 'success', message: 'Usuario eliminado.' });
      loadUsers();
    } catch (e) {
      console.error(e);
      ui.notify({ type: 'error', message: 'Error eliminando usuario.' });
    }
  };

  return (
    <div>
      {/* Formulario de Creación */}
      <div className="card" style={{ marginBottom: 20, padding: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Crear nuevo usuario (Empleado/Cliente)</h3>
        <form
          onSubmit={createUser}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <label>
            Nombre
            <input
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              style={{ width: '100%' }}
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              required
              style={{ width: '100%' }}
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              required
              style={{ width: '100%' }}
            />
          </label>

          <label>
            Rol
            <select
              value={newUser.rol}
              onChange={(e) => setNewUser({ ...newUser, rol: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="client">Cliente</option>
              <option value="adiestrador">Adiestrador</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button type="submit" className="btn-primary">
            Crear Usuario
          </button>
        </form>
        {msg && <p style={{ marginTop: 10, fontWeight: 'bold' }}>{msg}</p>}
      </div>

      {/* Tabla de Usuarios */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Lista de Usuarios ({users.length})</h3>

        {loading ? (
          <p>Cargando...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginTop: 10,
                minWidth: '600px',
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '2px solid #eee',
                    background: '#f9f9f9',
                  }}
                >
                  <th style={{ padding: 10 }}>Nombre</th>
                  <th style={{ padding: 10 }}>Email</th>
                  <th style={{ padding: 10 }}>Rol Actual</th>
                  <th style={{ padding: 10 }}>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {users.map((u, idx) => {
                  const key = String(u.uid || u.email || `row-${idx}`);
                  const uidSafe = String(u.uid || '').trim();
                  const rol = String(u.rol || 'client');

                  return (
                    <tr key={key} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 10 }}>{u.nombre || '-'}</td>
                      <td style={{ padding: 10 }}>{u.email}</td>

                      <td style={{ padding: 10 }}>
                        <span style={roleBadgeStyle(rol)}>{rol}</span>
                      </td>

                      <td
                        style={{
                          padding: 10,
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <select
                          value={rol}
                          onChange={(e) => changeRole(u.uid, e.target.value)}
                          disabled={!uidSafe}
                          style={{
                            padding: 4,
                            borderRadius: 4,
                            border: '1px solid #ccc',
                          }}
                          title={!uidSafe ? 'UID inválido (revisar /api/auth/users)' : 'Cambiar rol'}
                        >
                          <option value="client">Cliente</option>
                                      <option value="adiestrador">Adiestrador</option>
                          <option value="admin">Admin</option>
                        </select>

                        <button
                          className="btn-ghost"
                          onClick={() => deleteUser(u.uid)}
                          disabled={!uidSafe}
                          title={!uidSafe ? 'UID inválido (no se puede borrar)' : 'Eliminar'}
                          style={{ color: 'crimson' }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA SERVICIOS ==================== */
function ServiciosTab() {
  const ui = useUi(); 
  const [servicios, setServicios] = useState([]);
  const [nuevo, setNuevo] = useState({
    title: '',
    short: '',
    price: '',
    duration: '',
    mode: '',
  });

  const refresh = async () => {
    try {
      const data = await http('/api/servicios');
      setServicios(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const crear = async (e) => {
    e.preventDefault();
    try {
      await http('/api/servicios', {
        method: 'POST',
        data: { ...nuevo, price: Number(nuevo.price) },
        auth: true,
      });
      refresh();
      setNuevo({ title: '', short: '', price: '', duration: '', mode: '' });
    } catch {
      ui.notify({ type: 'error', message: 'Error creando servicio.' });
    }
  };

  const borrar = async (id) => {
    const ok = await ui.confirm({
      title: 'Borrar',
      message: '¿Borrar?',
      confirmText: 'Borrar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (ok) {
      await http(`/api/servicios/${id}`, { method: 'DELETE', auth: true });
      refresh();
    }
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h3>Gestión de Servicios</h3>

      <form
        onSubmit={crear}
        style={{
          marginBottom: 20,
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          alignItems: 'end',
        }}
      >
        <label>
          Título
          <input value={nuevo.title} onChange={(e) => setNuevo({ ...nuevo, title: e.target.value })} required />
        </label>
        <label>
          Resumen
          <input value={nuevo.short} onChange={(e) => setNuevo({ ...nuevo, short: e.target.value })} required />
        </label>
        <label>
          Precio
          <input type="number" value={nuevo.price} onChange={(e) => setNuevo({ ...nuevo, price: e.target.value })} />
        </label>
        <label>
          Duración
          <input value={nuevo.duration} onChange={(e) => setNuevo({ ...nuevo, duration: e.target.value })} placeholder="60 min" />
        </label>
        <label>
          Modalidad
          <input value={nuevo.mode} onChange={(e) => setNuevo({ ...nuevo, mode: e.target.value })} placeholder="presencial" />
        </label>
        <button type="submit" className="btn-primary">
          Añadir
        </button>
      </form>

      <div style={{ display: 'grid', gap: 10 }}>
        {servicios.map((s) => {
          const key = getServicioKey(s);
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px',
                border: '1px solid #eee',
                borderRadius: 8,
              }}
            >
              <div>
                <strong>{s.title}</strong> <small>({formatEUR(s.price)})</small>
                <br />
                <span style={{ fontSize: 12, color: '#666' }}>{s.short}</span>
              </div>
              <button onClick={() => borrar(s.id)} className="btn-ghost" style={{ color: 'crimson' }}>
                🗑️
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==================== PESTAÑA ADIESTRADORES ==================== */
function AdiestradoresTab() {
  const ui = useUi(); // ✅ FIX: ui existe dentro del tab

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // ===== Perros por adiestrador (CRUD) =====
  const [dogsForTrainerId, setDogsForTrainerId] = useState(null); // trainer seleccionado (string)
  const [dogs, setDogs] = useState([]);
  const [dogsLoading, setDogsLoading] = useState(false);
  const [dogsError, setDogsError] = useState('');

  const [dogActionLoading, setDogActionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDog, setCreateDog] = useState({
    nombre: '',
    raza: '',
    nacimiento: '',
    castrado: false,
    notas: '',
    avatarURL: '',
    avatarFile: null,
    avatarPreview: '',
  });

  const [editingDogId, setEditingDogId] = useState(null);
  const [editDog, setEditDog] = useState({
    nombre: '',
    raza: '',
    nacimiento: '',
    castrado: false,
    notas: '',
    avatarURL: '',
    avatarFile: null,
    avatarPreview: '',
  });

  const refresh = async () => {
    setLoading(true);
    setMsg('');
    try {
      const data = await http('/api/trainers/public');
      const list = Array.isArray(data) ? data : [];
      setItems(
        list.map((t) => ({
          ...t,
          specialtiesInput: Array.isArray(t.specialties) ? t.specialties.join(', ') : '',
        }))
      );
    } catch (e) {
      console.error(e);
      setMsg('❌ No se pudo cargar el listado de adiestradores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (trainerId, patch) => {
    setItems((prev) =>
      prev.map((t) => (String(t.trainerId) === String(trainerId) ? { ...t, ...patch } : t))
    );
  };

  const parseSpecialtiesInput = (raw) => {
    return String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const uploadTrainerPhoto = async (file) => {
    if (!file) throw new Error('No hay archivo');

    const form = new FormData();
    form.append('file', file);

    const res = await http('/upload-db', {
      method: 'POST',
      data: form,
      auth: true,
      timeoutMs: 60000,
    });

    const url = res?.url || res?.path;
    if (!url) throw new Error('No se recibió URL de imagen');

    return absUrl(url);
  };


  const safeRevokeObjectUrl = (maybeUrl) => {
    try {
      if (typeof maybeUrl === 'string' && maybeUrl.startsWith('blob:')) {
        URL.revokeObjectURL(maybeUrl);
      }
    } catch {}
  };

  const uploadDogPhoto = async (file) => {
    if (!file) throw new Error('No hay archivo');

    const form = new FormData();
    form.append('file', file);

    const res = await http('/upload-db', {
      method: 'POST',
      data: form,
      auth: true,
      timeoutMs: 60000,
    });

    const url = res?.url || res?.path;
    if (!url) throw new Error('No se recibió URL de imagen');

    return absUrl(url);
  };

  const pickCreateDogAvatar = (file) => {
    setCreateDog((prev) => {
      safeRevokeObjectUrl(prev.avatarPreview);
      if (!file) return { ...prev, avatarFile: null, avatarPreview: '' };
      return { ...prev, avatarFile: file, avatarPreview: URL.createObjectURL(file) };
    });
  };

  const clearCreateDogAvatar = () => {
    setCreateDog((prev) => {
      safeRevokeObjectUrl(prev.avatarPreview);
      return { ...prev, avatarURL: '', avatarFile: null, avatarPreview: '' };
    });
  };

  const pickEditDogAvatar = (file) => {
    setEditDog((prev) => {
      safeRevokeObjectUrl(prev.avatarPreview);
      if (!file) return { ...prev, avatarFile: null, avatarPreview: '' };
      return { ...prev, avatarFile: file, avatarPreview: URL.createObjectURL(file) };
    });
  };

  const clearEditDogAvatar = () => {
    setEditDog((prev) => {
      safeRevokeObjectUrl(prev.avatarPreview);
      return { ...prev, avatarURL: '', avatarFile: null, avatarPreview: '' };
    });
  };
  const pickPhoto = (trainerId, file) => {
    if (!file) {
      setField(trainerId, { photoFile: null, photoPreview: '' });
      return;
    }

    const preview = URL.createObjectURL(file);
    setField(trainerId, { photoFile: file, photoPreview: preview });
  };

  const clearPhoto = (trainerId) => {
    setField(trainerId, { photoUrl: '', photoFile: null, photoPreview: '' });
  };

  const guardar = async (t) => {
    setMsg('');
    try {
      let photoUrl = t.photoUrl || '';

      if (t.photoFile) {
        setMsg('Subiendo foto…');
        photoUrl = await uploadTrainerPhoto(t.photoFile);
      }

      await http(`/api/trainers/${t.trainerId}/profile`, {
        method: 'POST',
        auth: true,
        data: {
          displayName: t.displayName || '',
          bio: t.bio || '',
          photoUrl,
          experienceYears: t.experienceYears === '' ? null : t.experienceYears,
          specialties: parseSpecialtiesInput(t.specialtiesInput),
        },
      });

      setMsg('✅ Cambios guardados');
      setField(t.trainerId, { photoUrl, photoFile: null, photoPreview: '' });
      refresh();
    } catch (e) {
      console.error(e);
      const msg =
        e?.data?.error ||
        e?.data?.message ||
        e?.message ||
        'Error guardando el perfil del adiestrador';
      ui.notify({ type: 'error', message: msg });
    }
  };

  const pickDogField = (dog, keys, fallback = '') => {
    for (const k of keys) {
      const v = dog?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return fallback;
  };

  const toBool = (v) => {
    if (typeof v === 'boolean') return v;
    const s = String(v ?? '').trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'si' || s === 'sí') return true;
    return false;
  };

  const calcAgeYears = (dateLike) => {
    const s = String(dateLike || '').trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;

    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years -= 1;
    return years < 0 ? null : years;
  };

  const resetDogForms = () => {
    setCreateOpen(false);
    setCreateDog({
      nombre: '',
      raza: '',
      nacimiento: '',
      castrado: false,
      notas: '',
      avatarURL: '',
      avatarFile: null,
      avatarPreview: '',
    });
    setEditingDogId(null);
    setEditDog({
      nombre: '',
      raza: '',
      nacimiento: '',
      castrado: false,
      notas: '',
      avatarURL: '',
      avatarFile: null,
      avatarPreview: '',
    });
    setDogActionLoading(false);
  };

  const loadDogs = async (trainerIdRaw) => {
    const trainerId = String(trainerIdRaw || '').trim();
    if (!trainerId) return;

    setDogsLoading(true);
    setDogsError('');
    try {
      const res = await http(`/api/perros/admin/user/${trainerId}`, { auth: true });
      const items = res?.items ?? res?.data?.items ?? res;
      setDogs(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error(e);
      setDogs([]);
      setDogsError(
        e?.data?.error ||
          e?.data?.message ||
          e?.message ||
          'No se pudo cargar la lista de perros.'
      );
    } finally {
      setDogsLoading(false);
    }
  };

  const toggleDogs = async (trainerIdRaw) => {
    const tid = String(trainerIdRaw || '').trim();
    if (!tid) return;

    // Toggle
    if (String(dogsForTrainerId) === tid) {
      setDogsForTrainerId(null);
      setDogs([]);
      setDogsError('');
      resetDogForms();
      return;
    }

    setDogsForTrainerId(tid);
    setDogs([]);
    setDogsError('');
    resetDogForms();
    await loadDogs(tid);
  };

  const submitCreateDog = async () => {
    const trainerId = String(dogsForTrainerId || '').trim();
    if (!trainerId) return;

    const payload = {
      nombre: String(createDog.nombre || '').trim(),
      raza: String(createDog.raza || '').trim(),
      nacimiento: String(createDog.nacimiento || '').trim() || null,
      castrado: !!createDog.castrado,
      notas: String(createDog.notas || '').trim(),
    };

    if (!payload.nombre) {
      ui.notify({ type: 'error', message: 'El nombre del perro es obligatorio.' });
      return;
    }
    if (!payload.raza) {
      ui.notify({ type: 'error', message: 'La raza/tamaño del perro es obligatoria.' });
      return;
    }

    setDogActionLoading(true);
    try {
      let avatarURL = String(createDog.avatarURL || '').trim();
      if (createDog.avatarFile) {
        avatarURL = await uploadDogPhoto(createDog.avatarFile);
      }

      await http(`/api/perros/admin/user/${trainerId}`, {
        method: 'POST',
        auth: true,
        data: { ...payload, avatarURL },
      });
      ui.notify({ type: 'success', message: 'Perro creado.' });
      setCreateDog({ nombre: '', raza: '', nacimiento: '', castrado: false, notas: '', avatarURL: '', avatarFile: null, avatarPreview: '' });
      setCreateOpen(false);
      await loadDogs(trainerId);
    } catch (e) {
      console.error(e);
      ui.notify({
        type: 'error',
        message: e?.data?.error || e?.data?.message || e?.message || 'No se pudo crear el perro.',
      });
    } finally {
      setDogActionLoading(false);
    }
  };

  const startEditDog = (d) => {
    const dogId = String(pickDogField(d, ['id', 'dogId', 'uuid'], '')).trim();
    if (!dogId) return;

    setCreateOpen(false);
    setEditingDogId(dogId);
    setEditDog({
      nombre: String(pickDogField(d, ['nombre', 'name'], '')).trim(),
      raza: String(pickDogField(d, ['raza', 'breed', 'tipo'], '')).trim(),
      nacimiento: String(pickDogField(d, ['nacimiento', 'birth', 'fechaNacimiento'], '')).trim(),
      castrado: toBool(pickDogField(d, ['castrado', 'neutered'], false)),
      notas: String(pickDogField(d, ['notas', 'notes'], '')).trim(),
      avatarURL: String(pickDogField(d, ['avatarURL', 'avatar_url', 'avatar', 'photoUrl'], '')).trim(),
      avatarFile: null,
      avatarPreview: '',
    });
  };

  const cancelEditDog = () => {
    setEditingDogId(null);
    setEditDog({ nombre: '', raza: '', nacimiento: '', castrado: false, notas: '', avatarURL: '', avatarFile: null, avatarPreview: '' });
  };

  const submitEditDog = async () => {
    const dogId = String(editingDogId || '').trim();
    const trainerId = String(dogsForTrainerId || '').trim();
    if (!dogId) return;

    const payload = {
      nombre: String(editDog.nombre || '').trim(),
      raza: String(editDog.raza || '').trim(),
      nacimiento: String(editDog.nacimiento || '').trim() || null,
      castrado: !!editDog.castrado,
      notas: String(editDog.notas || '').trim(),
    };

    if (!payload.nombre) {
      ui.notify({ type: 'error', message: 'El nombre del perro es obligatorio.' });
      return;
    }
    if (!payload.raza) {
      ui.notify({ type: 'error', message: 'La raza/tamaño del perro es obligatoria.' });
      return;
    }

    setDogActionLoading(true);
    try {
      let avatarURL = String(editDog.avatarURL || '').trim();
      if (editDog.avatarFile) {
        avatarURL = await uploadDogPhoto(editDog.avatarFile);
      }

      await http(`/api/perros/admin/${dogId}`, {
        method: 'PUT',
        auth: true,
        data: { ...payload, avatarURL },
      });
      ui.notify({ type: 'success', message: 'Perro actualizado.' });
      cancelEditDog();
      await loadDogs(trainerId);
    } catch (e) {
      console.error(e);
      ui.notify({
        type: 'error',
        message:
          e?.data?.error || e?.data?.message || e?.message || 'No se pudo actualizar el perro.',
      });
    } finally {
      setDogActionLoading(false);
    }
  };

  const submitDeleteDog = async (d) => {
    const dogId = String(pickDogField(d, ['id', 'dogId', 'uuid'], '')).trim();
    const trainerId = String(dogsForTrainerId || '').trim();
    if (!dogId) return;

    const nombre = String(pickDogField(d, ['nombre', 'name'], 'este perro'));
    const ok = await ui.confirm({
      title: 'Eliminar perro',
      message: `¿Eliminar ${nombre}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;

    setDogActionLoading(true);
    try {
      await http(`/api/perros/admin/${dogId}`, { method: 'DELETE', auth: true });
      ui.notify({ type: 'success', message: 'Perro eliminado.' });
      if (String(editingDogId || '') === dogId) cancelEditDog();
      await loadDogs(trainerId);
    } catch (e) {
      console.error(e);
      ui.notify({
        type: 'error',
        message: e?.data?.error || e?.data?.message || e?.message || 'No se pudo eliminar el perro.',
      });
    } finally {
      setDogActionLoading(false);
    }
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ marginTop: 0 }}>Gestión de Adiestradores</h3>
        <button className="btn-ghost" onClick={refresh} disabled={loading}>
          ↻ Recargar
        </button>
      </div>

      {msg && <p style={{ marginTop: 8, color: msg.includes('✅') ? '#2f6f62' : 'crimson' }}>{msg}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((t) => {
            const isDogsOpen = String(dogsForTrainerId || '') === String(t.trainerId || '');
            return (
              <div
                key={String(t.trainerId)}
                style={{ border: '1px solid #eee', borderRadius: 10, padding: 12 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong>{t.displayName || t.email || `#${t.trainerId}`}</strong>
                    {t.email ? <div style={{ fontSize: 12, color: '#666' }}>{t.email}</div> : null}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn-ghost" onClick={() => toggleDogs(t.trainerId)}>
                      {isDogsOpen ? '🐾 Ocultar perros' : '🐾 Gestionar perros'}
                    </button>
                    <button className="btn-primary" onClick={() => guardar(t)}>
                      Guardar
                    </button>
                  </div>
                </div>

                {/* ===== Form perfil adiestrador ===== */}
                <div
                  style={{
                    marginTop: 12,
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  }}
                >
                  <label>
                    Nombre público
                    <input
                      value={t.displayName || ''}
                      onChange={(e) => setField(t.trainerId, { displayName: e.target.value })}
                    />
                  </label>

                  <div className="admin__photoField" style={{ gridColumn: '1 / -1' }}>
                    <div className="admin__photoThumbWrap">
                      {t.photoPreview || t.photoUrl ? (
                        <img
                          className="admin__photoThumb"
                          src={t.photoPreview || getTrainerPhotoSrc(t.photoUrl)}
                          alt="Foto del adiestrador"
                        />
                      ) : (
                        <div className="admin__photoPlaceholder">Sin foto</div>
                      )}
                    </div>

                    <label className="admin__photoLabel">
                      Foto (archivo)
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => pickPhoto(t.trainerId, e.target.files?.[0] || null)}
                      />
                      {t.photoFile ? (
                        <small>
                          Archivo seleccionado: {t.photoFile.name}. Se subirá al guardar.
                        </small>
                      ) : (
                        <small>Selecciona un archivo. Se subirá al guardar.</small>
                      )}
                    </label>

                    {(t.photoUrl || t.photoPreview) && (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => clearPhoto(t.trainerId)}
                      >
                        Quitar foto
                      </button>
                    )}
                  </div>

                  <label>
                    Años de experiencia
                    <input
                      type="number"
                      value={t.experienceYears ?? ''}
                      onChange={(e) =>
                        setField(t.trainerId, {
                          experienceYears: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                      min={0}
                    />
                  </label>

                  <label style={{ gridColumn: '1 / -1' }}>
                    Especialidades (separadas por comas)
                    <input
                      value={t.specialtiesInput || ''}
                      onChange={(e) =>
                        setField(t.trainerId, { specialtiesInput: e.target.value })
                      }
                      placeholder="obediencia, socialización, ..."
                    />
                  </label>

                  <label style={{ gridColumn: '1 / -1' }}>
                    Bio
                    <textarea
                      value={t.bio || ''}
                      onChange={(e) => setField(t.trainerId, { bio: e.target.value })}
                      rows={4}
                      style={{ resize: 'vertical' }}
                    />
                  </label>
                </div>

                {/* ===== Perros del adiestrador (CRUD) ===== */}
                {isDogsOpen && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      border: '1px solid #eee',
                      borderRadius: 10,
                      background: '#fafafa',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <h4 style={{ margin: 0 }}>Perros ({dogs.length})</h4>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="btn-ghost"
                          onClick={() => loadDogs(t.trainerId)}
                          disabled={dogsLoading || dogActionLoading}
                          title="Recargar perros"
                        >
                          ↻ Recargar perros
                        </button>

                        <button
                          className={createOpen ? 'btn-ghost' : 'btn-primary'}
                          onClick={() => {
                            cancelEditDog();
                            setCreateOpen((v) => !v);
                          }}
                          disabled={dogsLoading || dogActionLoading}
                        >
                          {createOpen ? 'Cerrar' : '+ Añadir perro'}
                        </button>
                      </div>
                    </div>

                    {dogsLoading ? (
                      <p style={{ marginTop: 10 }}>Cargando perros…</p>
                    ) : dogsError ? (
                      <p style={{ marginTop: 10, color: 'crimson' }}>{dogsError}</p>
                    ) : null}

                    {/* Form crear */}
                    {createOpen && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          border: '1px dashed #ddd',
                          borderRadius: 10,
                          background: '#fff',
                        }}
                      >
                        <h5 style={{ margin: 0 }}>Añadir perro</h5>

                        <div
                          style={{
                            marginTop: 10,
                            display: 'grid',
                            gap: 10,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            alignItems: 'end',
                          }}
                        >
                          <label>
                            Nombre
                            <input
                              value={createDog.nombre}
                              onChange={(e) => setCreateDog((p) => ({ ...p, nombre: e.target.value }))}
                            />
                          </label>

                          <label>
                            Raza / tamaño
                            <input
                              value={createDog.raza}
                              onChange={(e) => setCreateDog((p) => ({ ...p, raza: e.target.value }))}
                            />
                          </label>

                          <label>
                            Nacimiento
                            <input
                              type="date"
                              value={createDog.nacimiento || ''}
                              onChange={(e) =>
                                setCreateDog((p) => ({ ...p, nacimiento: e.target.value }))
                              }
                            />
                          </label>

                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!createDog.castrado}
                              onChange={(e) =>
                                setCreateDog((p) => ({ ...p, castrado: e.target.checked }))
                              }
                            />
                            Castrado
                          </label>

                          <label style={{ gridColumn: '1 / -1' }}>
                            Foto (opcional)
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                              {createDog.avatarPreview || createDog.avatarURL ? (
                                <img
                                  src={createDog.avatarPreview || absUrl(createDog.avatarURL)}
                                  alt="Foto del perro"
                                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: '1px solid #eee' }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: 10,
                                    border: '1px dashed #ddd',
                                    display: 'grid',
                                    placeItems: 'center',
                                    color: '#777',
                                    fontSize: 12,
                                  }}
                                >
                                  Sin foto
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => pickCreateDogAvatar(e.target.files?.[0] || null)}
                                />
                                {(createDog.avatarPreview || createDog.avatarURL) && (
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={clearCreateDogAvatar}
                                    disabled={dogActionLoading}
                                  >
                                    Quitar foto
                                  </button>
                                )}
                              </div>
                            </div>
                          </label>

                                  <label style={{ gridColumn: '1 / -1' }}>
                                    Notas (opcional)
                            <textarea
                              rows={3}
                              value={createDog.notas}
                              onChange={(e) => setCreateDog((p) => ({ ...p, notas: e.target.value }))}
                              style={{ resize: 'vertical' }}
                            />
                          </label>
<div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1' }}>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={submitCreateDog}
                              disabled={dogActionLoading}
                            >
                              Crear
                            </button>
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() => setCreateOpen(false)}
                              disabled={dogActionLoading}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Listado */}
                    {!dogsLoading && !dogsError && !dogs.length ? (
                      <p style={{ marginTop: 10, color: '#666' }}>
                        Este adiestrador no tiene perros registrados.
                      </p>
                    ) : null}

                    {!dogsLoading && !dogsError && !!dogs.length && (
                      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                        {dogs.map((d) => {
                          const dogId = String(pickDogField(d, ['id', 'dogId', 'uuid'], ''));
                          const nombre = String(pickDogField(d, ['nombre', 'name'], '-'));
                          const raza = String(pickDogField(d, ['raza', 'breed', 'tipo'], '-'));
                          const nacimiento = pickDogField(d, ['nacimiento', 'birth', 'fechaNacimiento'], '');
                          const edad = calcAgeYears(nacimiento);
                          const castrado = toBool(pickDogField(d, ['castrado', 'neutered'], false));
                          const notas = String(pickDogField(d, ['notas', 'notes'], ''));

                          const isEditing = String(editingDogId || '') === String(dogId || '');

                          return (
                            <div
                              key={dogId || `${nombre}-${raza}`}
                              style={{
                                border: '1px solid #e9e9e9',
                                borderRadius: 10,
                                padding: 10,
                                background: '#fff',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div>
                                  <strong>{nombre}</strong>
                                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                                    Raza: {raza}
                                    {edad != null ? ` · Edad: ${edad} años` : ''}
                                    {nacimiento ? ` · Nac.: ${String(nacimiento)}` : ''}
                                    {` · Castrado: ${castrado ? 'Sí' : 'No'}`}
                                  </div>
                                  {notas ? (
                                    <div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>
                                      <strong>Notas:</strong> {notas}
                                    </div>
                                  ) : null}
                                </div>

                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {!isEditing ? (
                                    <>
                                      <button
                                        className="btn-ghost"
                                        onClick={() => startEditDog(d)}
                                        disabled={dogActionLoading}
                                      >
                                        ✏️ Editar
                                      </button>
                                      <button
                                        className="btn-ghost"
                                        onClick={() => submitDeleteDog(d)}
                                        disabled={dogActionLoading}
                                        style={{ color: 'crimson' }}
                                      >
                                        🗑️ Eliminar
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        className="btn-primary"
                                        onClick={submitEditDog}
                                        disabled={dogActionLoading}
                                      >
                                        Guardar cambios
                                      </button>
                                      <button
                                        className="btn-ghost"
                                        onClick={cancelEditDog}
                                        disabled={dogActionLoading}
                                      >
                                        Cancelar
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {isEditing && (
                                <div
                                  style={{
                                    marginTop: 10,
                                    display: 'grid',
                                    gap: 10,
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                    alignItems: 'end',
                                  }}
                                >
                                  <label>
                                    Nombre
                                    <input
                                      value={editDog.nombre}
                                      onChange={(e) => setEditDog((p) => ({ ...p, nombre: e.target.value }))}
                                    />
                                  </label>

                                  <label>
                                    Raza / tamaño
                                    <input
                                      value={editDog.raza}
                                      onChange={(e) => setEditDog((p) => ({ ...p, raza: e.target.value }))}
                                    />
                                  </label>

                                  <label>
                                    Nacimiento
                                    <input
                                      type="date"
                                      value={editDog.nacimiento || ''}
                                      onChange={(e) => setEditDog((p) => ({ ...p, nacimiento: e.target.value }))}
                                    />
                                  </label>

                                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                      type="checkbox"
                                      checked={!!editDog.castrado}
                                      onChange={(e) => setEditDog((p) => ({ ...p, castrado: e.target.checked }))}
                                    />
                                    Castrado
                                  </label>

                                  <label style={{ gridColumn: '1 / -1' }}>
                                    Foto (opcional)
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                      {editDog.avatarPreview || editDog.avatarURL ? (
                                        <img
                                          src={editDog.avatarPreview || absUrl(editDog.avatarURL)}
                                          alt="Foto del perro"
                                          style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: '1px solid #eee' }}
                                        />
                                      ) : (
                                        <div
                                          style={{
                                            width: 64,
                                            height: 64,
                                            borderRadius: 10,
                                            border: '1px dashed #ddd',
                                            display: 'grid',
                                            placeItems: 'center',
                                            color: '#777',
                                            fontSize: 12,
                                          }}
                                        >
                                          Sin foto
                                        </div>
                                      )}

                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          onChange={(e) => pickEditDogAvatar(e.target.files?.[0] || null)}
                                        />
                                        {(editDog.avatarPreview || editDog.avatarURL) && (
                                          <button
                                            type="button"
                                            className="btn-ghost"
                                            onClick={clearEditDogAvatar}
                                            disabled={dogActionLoading}
                                          >
                                            Quitar foto
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </label>

                          <label style={{ gridColumn: '1 / -1' }}>
                            Foto (opcional)
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                              {createDog.avatarPreview || createDog.avatarURL ? (
                                <img
                                  src={createDog.avatarPreview || absUrl(createDog.avatarURL)}
                                  alt="Foto del perro"
                                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: '1px solid #eee' }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: 10,
                                    border: '1px dashed #ddd',
                                    display: 'grid',
                                    placeItems: 'center',
                                    color: '#777',
                                    fontSize: 12,
                                  }}
                                >
                                  Sin foto
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => pickCreateDogAvatar(e.target.files?.[0] || null)}
                                />
                                {(createDog.avatarPreview || createDog.avatarURL) && (
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={clearCreateDogAvatar}
                                    disabled={dogActionLoading}
                                  >
                                    Quitar foto
                                  </button>
                                )}
                              </div>
                            </div>
                          </label>

                                  <label style={{ gridColumn: '1 / -1' }}>
                                    Notas (opcional)
                                    <textarea
                                      rows={3}
                                      value={editDog.notas}
                                      onChange={(e) => setEditDog((p) => ({ ...p, notas: e.target.value }))}
                                      style={{ resize: 'vertical' }}
                                    />
                                  </label>
</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {!items.length && <p style={{ color: '#666' }}>No hay adiestradores para mostrar.</p>}
        </div>
      )}
    </div>
  );
}
