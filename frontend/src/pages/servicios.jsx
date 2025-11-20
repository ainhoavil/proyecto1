// frontend/src/pages/servicios.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/servicios.scss';
import { useAuth } from '../context/auth';
import { http } from '../helpers/http';

function formatEUR(value, currency = 'EUR') {
  if (value == null || value === '') return '';
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
    }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

// === util para sacar modalidades de un servicio ===
function getModalitiesFromItem(item) {
  if (Array.isArray(item?.modalities) && item.modalities.length) {
    return item.modalities;
  }

  const txt = String(item?.mode || '').toLowerCase();
  const set = new Set();

  if (txt.includes('presencial')) set.add('presencial');
  if (txt.includes('online')) set.add('online');
  if (txt.includes('domicilio')) set.add('a domicilio');

  if (!set.size) set.add('presencial');
  return Array.from(set);
}

export default function Servicios() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const [selModalidad, setSelModalidad] = useState(''); // modalidad elegida en el modal
  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();
  const { isAuthenticated, role } = useAuth();

  const esAdmin = role === 'admin';
  const esTrainer = role === 'trainer' || role === 'adiestrador';
  const esUser = role === 'user';

  const refresh = async () => {
    setCargando(true);
    setError('');

    try {
      const data = await http('/api/servicios');

      const sorted = [...(data || [])].sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return (a.order ?? 0) - (b.order ?? 0);
      });

      setItems(sorted);
    } catch {
      setItems([]);
      setError('No se pudo cargar el catálogo.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // contratar: opcionalmente recibe modalidad
  const contratar = (item, modalidad) => {
    const servicio = item?.id || item?.title || '';
    const qs = new URLSearchParams();
    if (servicio) qs.set('servicio', servicio);
    if (modalidad) qs.set('modalidad', modalidad);

    const destino = `/contratar?${qs.toString()}`;

    if (isAuthenticated)
      navigate(destino);
    else
      navigate(`/login?next=${encodeURIComponent(destino)}`);
  };

  const abrir = (item) => {
    setSel(item);
    const mods = getModalitiesFromItem(item);
    setSelModalidad(mods[0] || 'presencial');
  };

  const cerrar = () => {
    setSel(null);
    setSelModalidad('');
  };

  // ---------------------------
  // CREAR SERVICIO (ADMIN)
  // ---------------------------
  const [nuevo, setNuevo] = useState({
    title: '',
    short: '',
    long: '',
    price: '',
    currency: 'EUR',
    duration: '',
    mode: '',
    featured: false,
    order: '',
    imageUrl: '',
  });

  const [msgNuevo, setMsgNuevo] = useState('');

  const crearServicio = async (e) => {
    e.preventDefault();
    setMsgNuevo('');
    setSaving(true);

    try {
      const body = {
        title: (nuevo.title || '').trim(),
        short: (nuevo.short || '').trim(),
        long: (nuevo.long || '').trim(),
        currency: (nuevo.currency || 'EUR').toUpperCase(),
        duration: (nuevo.duration || '').trim(),
        mode: (nuevo.mode || '').trim(),
        featured: !!nuevo.featured,
        order: nuevo.order === '' ? undefined : Number(nuevo.order),
        price: nuevo.price === '' ? null : Number(nuevo.price),
        imageUrl: (nuevo.imageUrl || '').trim(),
      };

      if (!body.title || !body.short) {
        setMsgNuevo('❌ Título y resumen son obligatorios.');
        setSaving(false);
        return;
      }

      await http('/api/servicios', { method: 'POST', data: body, auth: true });
      setMsgNuevo('✅ Servicio creado');

      setNuevo({
        title: '',
        short: '',
        long: '',
        price: '',
        currency: 'EUR',
        duration: '',
        mode: '',
        featured: false,
        order: '',
        imageUrl: '',
      });

      await refresh();
    } catch (e) {
      const msg = e?.data?.error || e?.data?.message || e?.message || 'No se pudo crear';
      setMsgNuevo(`❌ ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------
  // EDITAR SERVICIO (ADMIN)
  // ---------------------------
  const guardarEdicion = async (id, data) => {
    setSaving(true);

    try {
      const payload = {
        ...data,
        currency: (data.currency || 'EUR').toUpperCase(),
      };

      if (payload.price === '') payload.price = null;
      if (payload.order !== '' && payload.order != null)
        payload.order = Number(payload.order);

      await http(`/api/servicios/${id}`, {
        method: 'PATCH',
        data: payload,
        auth: true,
      });

      await refresh();

      setSel((prev) =>
        prev && prev.id === id ? { ...prev, ...payload } : prev
      );
    } catch (e) {
      alert(e?.data?.error || e?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const borrarServicio = async (id) => {
    if (!window.confirm('¿Borrar este servicio?')) return;
    setSaving(true);

    try {
      await http(`/api/servicios/${id}`, {
        method: 'DELETE',
        auth: true,
      });

      cerrar();
      await refresh();
    } catch (e) {
      alert(e?.data?.error || e?.data?.message || 'No se pudo borrar');
    } finally {
      setSaving(false);
    }
  };

  if (cargando) return <div className="card">Cargando…</div>;

  const getImgSrc = (imageUrl) => {
    if (!imageUrl) return '/img/servicios/default.jpg';
    return `/img/servicios/${imageUrl}`;
  };

  return (
    <div className="servicios page-wrapper">
      <h1>Servicios de Adiestramiento</h1>
      {error && <p className="error-msg">{error}</p>}

      {/* CREAR SERVICIO - SOLO ADMIN */}
      {esAdmin && (
        <div className="card admin-create">
          <h2>Crear servicio</h2>
          <form onSubmit={crearServicio} className="admin-form">
            <label className="full">
              Título:
              <input
                value={nuevo.title}
                onChange={(e) => setNuevo({ ...nuevo, title: e.target.value })}
                required
              />
            </label>

            <label className="full">
              Resumen:
              <input
                value={nuevo.short}
                onChange={(e) => setNuevo({ ...nuevo, short: e.target.value })}
                required
              />
            </label>

            <label className="full">
              Descripción:
              <textarea
                rows={3}
                value={nuevo.long}
                onChange={(e) => setNuevo({ ...nuevo, long: e.target.value })}
              />
            </label>

            <label>
              Precio (€):
              <input
                type="number"
                step="0.01"
                value={nuevo.price}
                onChange={(e) => setNuevo({ ...nuevo, price: e.target.value })}
              />
            </label>

            <label>
              Moneda:
              <input
                value={nuevo.currency}
                onChange={(e) => setNuevo({ ...nuevo, currency: e.target.value })}
              />
            </label>

            <label>
              Duración:
              <input
                value={nuevo.duration}
                onChange={(e) => setNuevo({ ...nuevo, duration: e.target.value })}
              />
            </label>

            <label>
              Modalidad:
              <input
                value={nuevo.mode}
                onChange={(e) => setNuevo({ ...nuevo, mode: e.target.value })}
              />
            </label>

            <label>
              Orden:
              <input
                type="number"
                value={nuevo.order}
                onChange={(e) => setNuevo({ ...nuevo, order: e.target.value })}
              />
            </label>

            <label className="full">
              Imagen (nombre de archivo):
              <input
                value={nuevo.imageUrl}
                onChange={(e) =>
                  setNuevo({ ...nuevo, imageUrl: e.target.value })
                }
                placeholder="adiestramiento-basico.jpg"
              />
              <small>Sube la imagen a /public/img/servicios/</small>
            </label>

            <label className="featured-check">
              <input
                type="checkbox"
                checked={nuevo.featured}
                onChange={(e) =>
                  setNuevo({ ...nuevo, featured: e.target.checked })
                }
              />
              Destacado
            </label>

            <div className="form-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Crear'}
              </button>
              {msgNuevo && <span className="msg-inline">{msgNuevo}</span>}
            </div>
          </form>
        </div>
      )}

      {/* GRID DE SERVICIOS */}
      <div className="servicios-grid">
        {items.map((item) => (
          <article
            key={item.id}
            className={`service-card ${item.featured ? 'featured' : ''}`}
            onClick={() => abrir(item)}
          >
            {item.imageUrl && (
              <div
                className="card-img"
                style={{ backgroundImage: `url(${getImgSrc(item.imageUrl)})` }}
              />
            )}

            <div className="card-content">
              {item.featured && <span className="badge">Destacado</span>}
              <h3>{item.title}</h3>
              <p className="short">{item.short}</p>

              <div className="details">
                {item.duration && <div>⏱ {item.duration}</div>}
                {item.mode && <div>📍 {item.mode}</div>}
                {item.price != null && (
                  <div><b>{formatEUR(item.price, item.currency)}</b></div>
                )}
              </div>

              <div className="actions">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); abrir(item); }}
                >
                  Ver más
                </button>

                {esAdmin ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); abrir(item); }}
                  >
                    Editar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); contratar(item); }}
                  >
                    Contratar
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* MODAL DETALLE */}
      {sel && (
        <div className="modal-overlay" onClick={cerrar}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>

            <button className="close-modal" onClick={cerrar} aria-label="Cerrar">
              ✕
            </button>

            {sel.imageUrl && (
              <div
                className="modal-img"
                style={{ backgroundImage: `url(${getImgSrc(sel.imageUrl)})` }}
              />
            )}

            <h3>{sel.title}</h3>
            <p className="modal-description">{sel.long || sel.short}</p>

            <div className="modal-details">
              {sel.duration && <div>⏱ {sel.duration}</div>}
              {sel.mode && <div>📍 {sel.mode}</div>}
              {sel.price != null && (
                <div><b>{formatEUR(sel.price, sel.currency)}</b></div>
              )}
            </div>

            {/* Desplegable de modalidad para el cliente */}
            {!esAdmin && (
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                <label>
                  Modalidad:
                  <select
                    style={{ marginLeft: 8 }}
                    value={selModalidad}
                    onChange={(e) => setSelModalidad(e.target.value)}
                  >
                    {getModalitiesFromItem(sel).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {!esAdmin && (
              <button
                className="modal-btn"
                type="button"
                onClick={() => contratar(sel, selModalidad)}
              >
                Reservar este servicio
              </button>
            )}

            {esAdmin && (
              <ServiceEditor
                key={sel.id}
                item={sel}
                onSave={(changes) => guardarEdicion(sel.id, changes)}
                onDelete={() => borrarServicio(sel.id)}
                saving={saving}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================
// EDITOR ADMIN
// ================================
import { useState as useStateReact } from 'react';

function ServiceEditor({ item, onSave, onDelete, saving }) {
  const [form, setForm] = useStateReact({
    title: item.title || '',
    short: item.short || '',
    long: item.long || '',
    price: item.price ?? '',
    currency: item.currency || 'EUR',
    duration: item.duration || '',
    mode: item.mode || '',
    featured: !!item.featured,
    order: item.order ?? '',
    imageUrl: item.imageUrl || '',
  });

  const [msg, setMsg] = useStateReact('');

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    await onSave(form);
    setMsg('✅ Guardado');
  };

  const handleChange = (field) => (e) => {
    const value =
      e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.value;

    setForm({ ...form, [field]: value });
  };

  return (
    <form onSubmit={submit} className="admin-edit-form">
      <h4>Editar servicio</h4>

      <label className="full">
        Título:
        <input value={form.title} onChange={handleChange('title')} required />
      </label>

      <label className="full">
        Resumen:
        <input value={form.short} onChange={handleChange('short')} required />
      </label>

      <label className="full">
        Descripción:
        <textarea rows={3} value={form.long} onChange={handleChange('long')} />
      </label>

      <label>
        Precio (€):
        <input
          type="number"
          step="0.01"
          value={form.price}
          onChange={handleChange('price')}
        />
      </label>

      <label>
        Moneda:
        <input value={form.currency} onChange={handleChange('currency')} />
      </label>

      <label>
        Duración:
        <input value={form.duration} onChange={handleChange('duration')} />
      </label>

      <label>
        Modalidad:
        <input value={form.mode} onChange={handleChange('mode')} />
      </label>

      <label>
        Orden:
        <input type="number" value={form.order} onChange={handleChange('order')} />
      </label>

      <label className="full">
        Imagen (nombre archivo):
        <input
          value={form.imageUrl}
          onChange={handleChange('imageUrl')}
          placeholder="adiestramiento-basico.jpg"
        />
      </label>

      <label className="featured-check">
        <input
          type="checkbox"
          checked={form.featured}
          onChange={handleChange('featured')}
        />
        Destacado
      </label>

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>

        <button type="button" className="delete-btn" onClick={onDelete}>
          Borrar
        </button>

        {msg && <span className="msg-inline">{msg}</span>}
      </div>
    </form>
  );
}
