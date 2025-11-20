// frontend/src/pages/videos.jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../helpers/http';
import { useAuth } from '../context/auth';
import '../styles/contratar.scss';

export default function Videos() {
  const { isAuthenticated, role } = useAuth();
  const esAdmin = role === 'admin';

  const [publicos, setPublicos] = useState([]);
  const [privados, setPrivados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tier, setTier] = useState('public'); // public | private
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // === Cargar vídeos ===
  const refresh = async () => {
    setCargando(true);
    setError('');
    try {
      // Traemos todos los vídeos y filtramos por tier
      const data = await http('/api/videos'); // GET backend
      const arr = Array.isArray(data) ? data : data?.items || [];
      const pub = arr.filter((v) => (v.tier || 'public') === 'public');
      const pri = arr.filter((v) => (v.tier || 'public') === 'private');

      setPublicos(pub);
      setPrivados(isAuthenticated ? pri : []);
    } catch (e) {
      console.error(e);
      setError('No se pudieron cargar los vídeos');
      setPublicos([]);
      setPrivados([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [isAuthenticated]);

  // === Crear vídeo (solo admin) ===
  const crearVideo = async (e) => {
    e.preventDefault();
    setMsg('');

    if (!title.trim() || !url.trim()) {
      setMsg('Título y URL son obligatorios.');
      return;
    }

    setSaving(true);
    try {
      await http('/api/videos', {
        method: 'POST',
        data: { title: title.trim(), url: url.trim(), tier },
        auth: true, // el backend usa el token para comprobar que es admin
      });

      setTitle('');
      setUrl('');
      setTier('public');
      setMsg('✅ Vídeo creado');

      await refresh();
    } catch (e) {
      console.error(e);
      setMsg(
        e?.data?.error ||
          e?.data?.message ||
          e?.message ||
          '❌ No se pudo crear el vídeo'
      );
    } finally {
      setSaving(false);
    }
  };

  // === Borrar vídeo (solo admin) ===
  const borrarVideo = async (id) => {
    if (!window.confirm('¿Eliminar este vídeo?')) return;

    try {
      await http(`/api/videos/${id}`, {
        method: 'DELETE',
        auth: true,
      });
      await refresh();
    } catch (e) {
      console.error(e);
      alert(
        e?.data?.error ||
          e?.data?.message ||
          e?.message ||
          'No se pudo borrar el vídeo'
      );
    }
  };

  if (cargando) return <div className="card">Cargando…</div>;
  if (error)
    return (
      <div className="card" style={{ color: 'crimson' }}>
        {error}
      </div>
    );

  return (
    <div className="videos card contratar-page">
      <h1>Zona Multimedia</h1>

      {/* === Bloque admin para crear vídeos === */}
      {esAdmin && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2>Gestionar vídeos (admin)</h2>
          <form
            onSubmit={crearVideo}
            style={{ display: 'grid', gap: 8, maxWidth: 420 }}
          >
            <label>
              Título:
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <label>
              URL:
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                placeholder="https://…"
              />
            </label>
            <label>
              Nivel:
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
              >
                <option value="public">Público</option>
                <option value="private">Solo usuarios registrados</option>
              </select>
            </label>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar vídeo'}
            </button>
          </form>
          {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
        </div>
      )}

      {/* === Vídeos públicos === */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Vídeos públicos</h2>
        {publicos.length === 0 ? (
          <p>No hay vídeos públicos todavía.</p>
        ) : (
          <ul>
            {publicos.map((v) => (
              <li
                key={v.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <a href={v.url} target="_blank" rel="noreferrer">
                  {v.title}
                </a>
                {esAdmin && (
                  <button
                    onClick={() => borrarVideo(v.id)}
                    title="Borrar"
                    className="btn-ghost"
                  >
                    🗑️
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* === Vídeos privados === */}
      <div className="card">
        <h2>Vídeos para usuarios registrados</h2>

        {!isAuthenticated && (
          <p>
            Inicia sesión para ver los vídeos privados.{' '}
            <Link to="/login">Ir a iniciar sesión</Link>
          </p>
        )}

        {isAuthenticated && (
          <>
            {privados.length === 0 ? (
              <p>No hay vídeos privados aún.</p>
            ) : (
              <ul>
                {privados.map((v) => (
                  <li
                    key={v.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <a href={v.url} target="_blank" rel="noreferrer">
                      {v.title}
                    </a>
                    {esAdmin && (
                      <button
                        onClick={() => borrarVideo(v.id)}
                        title="Borrar"
                        className="btn-ghost"
                      >
                        🗑️
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
