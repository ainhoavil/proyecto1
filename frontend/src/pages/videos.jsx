import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isLogged, getRole } from '../helpers/auth';
import { useEditMode } from '../context/editmode';
import { http } from '../helpers/http';

function Videos() {
  const [publicos, setPublicos] = useState([]);
  const [privados, setPrivados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  // Admin inline
  const { editMode } = useEditMode();
  const logged = isLogged();
  const role = getRole();
  const esAdmin = role === 'admin';

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tier, setTier] = useState('public');
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    setCargando(true);
    setError('');
    try {
      // Traemos todos los vídeos y filtramos aquí por tier
      const data = await http('/api/videos'); // GET http://localhost:5000/api/videos
      const pub = data.filter(v => v.tier === 'public');
      const pri = data.filter(v => v.tier === 'private');

      setPublicos(pub);
      setPrivados(logged ? pri : []);
    } catch (e) {
      setError('No se pudieron cargar los vídeos');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { refresh(); }, [logged]);

  const crearVideo = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await http('/api/videos', {
        method: 'POST',
        data: { title, url, tier }, // { title, url, tier: 'public' | 'private' }
        // auth: true, // activa si en el futuro mandas token en Authorization desde http()
      });
      setTitle(''); setUrl(''); setTier('public');
      setMsg('✅ Vídeo creado');
      await refresh();
    } catch (e) {
      setMsg('❌ No se pudo crear el vídeo');
    }
  };

  const borrarVideo = async (id) => {
    try {
      await http(`/api/videos/${id}`, {
        method: 'DELETE',
        // auth: true, // activa si usas token en el futuro
      });
      await refresh();
    } catch (e) {
      alert('No se pudo borrar el vídeo');
    }
  };

  if (cargando) return <div className="card">Cargando…</div>;
  if (error) return <div className="card" style={{ color: 'crimson' }}>{error}</div>;

  return (
    <div className="videos">
      <h1>Zona Multimedia</h1>

      <div className="card">
        <h2>Vídeos públicos</h2>
        <ul>
          {publicos.map(v => (
            <li key={v.id} style={{ display:'flex', gap:8, alignItems:'center' }}>
              <a href={v.url} target="_blank" rel="noreferrer">{v.title}</a>
              {esAdmin && editMode && (
                <button onClick={() => borrarVideo(v.id)} title="Borrar">🗑️</button>
              )}
            </li>
          ))}
          {publicos.length === 0 && <p>No hay vídeos públicos todavía.</p>}
        </ul>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Vídeos para usuarios registrados</h2>
        {!logged && (
          <p>
            Inicia sesión para ver los vídeos privados.{' '}
            <Link to="/login">Ir a iniciar sesión</Link>
          </p>
        )}
        {logged && (
          <ul>
            {privados.map(v => (
              <li key={v.id} style={{ display:'flex', gap:8, alignItems:'center' }}>
                <a href={v.url} target="_blank" rel="noreferrer">{v.title}</a>
                {esAdmin && editMode && (
                  <button onClick={() => borrarVideo(v.id)} title="Borrar">🗑️</button>
                )}
              </li>
            ))}
            {privados.length === 0 && <p>No hay vídeos privados aún.</p>}
          </ul>
        )}
      </div>

      {esAdmin && editMode && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Crear vídeo</h3>
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
          {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
        </div>
      )}

      {role === 'admin' && !editMode && (
        <p style={{ marginTop:12, fontSize:12, opacity:.7 }}>
          Activa el modo <b>Editar</b> desde el navbar para gestionar vídeos.
        </p>
      )}
    </div>
  );
}

export default Videos;
