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

// Styles

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

/* ==================== COMPONENTE PRINCIPAL ==================== */
export default function Admin() {
  const navigate = useNavigate();
  const ui = useUi();
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

        <p className="admin__note">
          Nota: “Chats” y “Contacto” se han retirado del navbar en rol admin. Si más adelante se
          necesitan, se pueden reubicar aquí como accesos del panel.
        </p>
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
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    rol: 'user',
  });
  const [msg, setMsg] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await http('/api/auth/users', { auth: true });
      setUsers(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const changeRole = async (uid, newRole) => {
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
        data: { uid, rol: newRole },
        auth: true,
      });
      loadUsers();
    } catch (e) {
      ui.notify({ type: 'error', message: 'Error cambiando rol.' });
    }
  };

  const createUser = async (e) => {
    e.preventDefault();
    if (!newUser.email || !newUser.password) return;
    try {
      await http('/api/auth/users', { method: 'POST', data: newUser, auth: true });
      setMsg('✅ Usuario creado');
      setNewUser({ name: '', email: '', password: '', rol: 'user' });
      loadUsers();
    } catch (e) {
      setMsg('❌ Error creando usuario. Email duplicado?');
    }
  };

  const deleteUser = async (uid) => {
    const ok = await ui.confirm({
      title: 'Eliminar usuario',
      message: '⚠️ ¿ELIMINAR usuario y todos sus datos?',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await http(`/api/auth/users/${uid}`, { method: 'DELETE', auth: true });
      loadUsers();
    } catch (e) {
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
              <option value="user">Usuario</option>
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
                {users.map((u) => (
                  <tr key={u.uid} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 10 }}>{u.nombre || '-'}</td>
                    <td style={{ padding: 10 }}>{u.email}</td>
                    <td style={{ padding: 10 }}>
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 'bold',
                          background:
                            u.rol === 'admin'
                              ? '#333'
                              : u.rol === 'adiestrador'
                              ? '#e68a4e'
                              : '#eee',
                          color: u.rol === 'user' ? '#333' : '#fff',
                        }}
                      >
                        {u.rol}
                      </span>
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
                        value={u.rol}
                        onChange={(e) => changeRole(u.uid, e.target.value)}
                        style={{
                          padding: 4,
                          borderRadius: 4,
                          border: '1px solid #ccc',
                        }}
                      >
                        <option value="user">Usuario</option>
                        <option value="adiestrador">Adiestrador</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button
                        className="btn-ghost"
                        onClick={() => deleteUser(u.uid)}
                        title="Eliminar"
                        style={{ color: 'crimson' }}
                      >
                        🗑️
                      </button>
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

/* ==================== PESTAÑA SERVICIOS ==================== */
function ServiciosTab() {
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
          <input
            value={nuevo.title}
            onChange={(e) => setNuevo({ ...nuevo, title: e.target.value })}
            required
          />
        </label>
        <label>
          Resumen
          <input
            value={nuevo.short}
            onChange={(e) => setNuevo({ ...nuevo, short: e.target.value })}
            required
          />
        </label>
        <label>
          Precio
          <input
            type="number"
            value={nuevo.price}
            onChange={(e) => setNuevo({ ...nuevo, price: e.target.value })}
          />
        </label>
        <label>
          Duración
          <input
            value={nuevo.duration}
            onChange={(e) => setNuevo({ ...nuevo, duration: e.target.value })}
            placeholder="60 min"
          />
        </label>
        <label>
          Modalidad
          <input
            value={nuevo.mode}
            onChange={(e) => setNuevo({ ...nuevo, mode: e.target.value })}
            placeholder="presencial"
          />
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
                <strong>{s.title}</strong>{' '}
                <small>({formatEUR(s.price)})</small>
                <br />
                <span style={{ fontSize: 12, color: '#666' }}>{s.short}</span>
              </div>
              <button
                onClick={() => borrar(s.id)}
                className="btn-ghost"
                style={{ color: 'crimson' }}
              >
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

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
      // limpia el archivo local para evitar re-subidas por error
      setField(t.trainerId, { photoUrl, photoFile: null, photoPreview: '' });
      refresh();
    } catch (e) {
      console.error(e);
      const msg = e?.data?.error || e?.data?.message || e?.message || 'Error guardando el perfil del adiestrador';
      ui.notify({ type: 'error', message: msg });
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

      {msg && (
        <p style={{ marginTop: 8, color: msg.includes('✅') ? '#2f6f62' : 'crimson' }}>{msg}</p>
      )}

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((t) => (
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
                  {t.email ? (
                    <div style={{ fontSize: 12, color: '#666' }}>{t.email}</div>
                  ) : null}
                </div>

                <button className="btn-primary" onClick={() => guardar(t)}>
                  Guardar
                </button>
              </div>

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
                    onChange={(e) => setField(t.trainerId, { specialtiesInput: e.target.value })}
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
            </div>
          ))}

          {!items.length && <p style={{ color: '#666' }}>No hay adiestradores para mostrar.</p>}
        </div>
      )}
    </div>
  );
}
