// frontend/src/pages/servicios.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/servicios.scss';
import { useAuth } from '../context/auth';
import { http } from '../helpers/http';
import { useState as useStateReact } from 'react';

/* ==========================
   Utilidades generales
========================== */
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

/* ==========================
   Utilidades subida imagen
========================== */

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Sube una imagen al backend (/files) y devuelve la URL que deberá
 * guardarse en imageUrl del servicio.
 *
 * Reutiliza el mismo sistema que usamos para el avatar de perfil.
 */
async function uploadServiceImage(file) {
  if (!file) throw new Error('No hay archivo');

  const dataUrl = await fileToDataURL(file); // "data:image/jpeg;base64,AAAA..."
  const [meta, b64] = String(dataUrl).split(',');
  let mime = file.type || 'application/octet-stream';

  if (meta && meta.startsWith('data:') && meta.includes(';base64')) {
    mime = meta.substring(meta.indexOf(':') + 1, meta.indexOf(';base64'));
  }

  const payload = { mime, data: b64 };

  // IMPORTANTE: ruta correcta del backend (sin /api)
  const res = await http('/files', {
    method: 'POST',
    data: payload,
    auth: true,
  });

  const fileId = res?.id || res?.fileId || res?.uid || res?.uuid;

  const url =
    res?.url ||
    res?.path ||
    (fileId ? `/files/${fileId}` : null) || // 👈 ahora /files, no /api/files
    res?.imageUrl ||
    res?.location;

  if (!url) {
    console.warn('Respuesta de /files sin URL clara', res);
    throw new Error('El servidor no devolvió URL de imagen');
  }

  return url;
}

/* ==========================
   Componente principal
========================== */

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

    if (isAuthenticated) navigate(destino);
    else navigate(`/login?next=${encodeURIComponent(destino)}`);
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
  const [subiendoNuevaImg, setSubiendoNuevaImg] = useState(false);

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
        imageUrl: (nuevo.imageUrl || '').trim(), // ya viene URL /files/... o nombre clásico
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
      const msg =
        e?.data?.error || e?.data?.message || e?.message || 'No se pudo crear';
      setMsgNuevo(`❌ ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleNuevoImageFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsgNuevo('');
    setSubiendoNuevaImg(true);
    try {
      const url = await uploadServiceImage(file);
      setNuevo((prev) => ({ ...prev, imageUrl: url }));
      setMsgNuevo('✅ Imagen subida. Se usará en este servicio.');
    } catch (err) {
      console.error('Error subiendo imagen de servicio nuevo', err);
      setMsgNuevo('❌ No se pudo subir la imagen.');
    } finally {
      setSubiendoNuevaImg(false);
      e.target.value = '';
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

  // Imagen: soporta tanto nombres antiguos como URLs completas (/files/xxx, http, etc.)
  const getImgSrc = (imageUrl) => {
    if (!imageUrl) return '/img/servicios/default.jpg';

    if (
      imageUrl.startsWith('http://') ||
      imageUrl.startsWith('https://') ||
      imageUrl.startsWith('/files/') || // 👈 nuestras nuevas URLs
      imageUrl.startsWith('/img/')
    ) {
      return imageUrl;
    }

    // caso clásico: sólo nombre de archivo
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
                onChange={(e) =>
                  setNuevo({ ...nuevo, currency: e.target.value })
                }
              />
            </label>

            <label>
              Duración:
              <input
                value={nuevo.duration}
                onChange={(e) =>
                  setNuevo({ ...nuevo, duration: e.target.value })
                }
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
              Imagen (URL o nombre de archivo):
              <input
                value={nuevo.imageUrl}
                onChange={(e) =>
                  setNuevo({ ...nuevo, imageUrl: e.target.value })
                }
                placeholder="adiestramiento-basico.jpg o /files/xxx"
              />
              <small>
                Puedes seguir usando imágenes en <code>/public/img/servicios/</code>{' '}
                o subir una nueva:
              </small>
              <input
                type="file"
                accept="image/*"
                onChange={handleNuevoImageFile}
                disabled={subiendoNuevaImg || saving}
              />
              {subiendoNuevaImg && (
                <small>Subiendo imagen… espera un momento</small>
              )}
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
                  <div>
                    <b>{formatEUR(item.price, item.currency)}</b>
                  </div>
                )}
              </div>

              <div className="actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    abrir(item);
                  }}
                >
                  Ver más
                </button>

                {esAdmin ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      abrir(item);
                    }}
                  >
                    Editar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      contratar(item);
                    }}
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
                <div>
                  <b>{formatEUR(sel.price, sel.currency)}</b>
                </div>
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
                onUploadImage={uploadServiceImage}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================
   EDITOR ADMIN
========================== */

function ServiceEditor({ item, onSave, onDelete, saving, onUploadImage }) {
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
  const [subiendoImg, setSubiendoImg] = useStateReact(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    await onSave(form);
    setMsg('✅ Guardado');
  };

  const handleChange = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadImage) return;
    setMsg('');
    setSubiendoImg(true);
    try {
      const url = await onUploadImage(file);
      setForm((prev) => ({ ...prev, imageUrl: url }));
      setMsg('✅ Imagen subida. No olvides guardar cambios.');
    } catch (err) {
      console.error('Error subiendo imagen en edición de servicio', err);
      setMsg('❌ No se pudo subir la imagen.');
    } finally {
      setSubiendoImg(false);
      e.target.value = '';
    }
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
        <input
          type="number"
          value={form.order}
          onChange={handleChange('order')}
        />
      </label>

      <label className="full">
        Imagen (URL o nombre archivo):
        <input
          value={form.imageUrl}
          onChange={handleChange('imageUrl')}
          placeholder="adiestramiento-basico.jpg o /files/xxx"
        />
        <small>
          Puedes escribir el nombre del archivo clásico o subir una nueva:
        </small>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={subiendoImg || saving}
        />
        {subiendoImg && <small>Subiendo imagen…</small>}
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
