// frontend/src/pages/servicios.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/servicios.scss';
import { useAuth } from '../context/auth';
import { http } from '../helpers/http';
import { useState as useStateReact } from 'react';

// Base del backend para construir URLs absolutas (imágenes / archivos)
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const absUrl = (u = '') =>
  !u ? '' : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith('/') ? '' : '/'}${u}`;

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
   Utilidades subida/borrado imagen
========================== */

/**
 * Sube una imagen al backend (POST /api/upload-db vía helper) y devuelve la URL
 * que se guarda en imageUrl del servicio.
 */
async function uploadServiceImage(file) {
  if (!file) throw new Error('No hay archivo');

  const form = new FormData();
  form.append('file', file);

  try {
    // Usa el endpoint existente del backend: POST /api/upload-db (FormData)
    // (tu helper http ya lo enruta a /api)
    const res = await http('/upload-db', {
      method: 'POST',
      data: form,
      auth: true,
      timeoutMs: 60000,
    });

    const url = res?.url || res?.path;
    if (!url) throw new Error('No se recibió URL de imagen');

    // Guardamos URL absoluta para que funcione en cualquier vista
    return absUrl(url);
  } catch (e) {
    const msg =
      e?.data?.error ||
      e?.data?.message ||
      e?.message ||
      'No se pudo subir la imagen';
    throw new Error(msg);
  }
}

/**
 * Si imageUrl apunta a /api/files/:id, extrae el id.
 */
function extractFileIdFromImageUrl(imageUrl = '') {
  const s = String(imageUrl || '');

  // Caso absoluto: http://localhost:5000/api/files/<id>
  let m = s.match(/\/api\/files\/([^/?#]+)/i);
  if (m?.[1]) return m[1];

  // Caso relativo antiguo: /files/<id>
  m = s.match(/\/files\/([^/?#]+)/i);
  if (m?.[1]) return m[1];

  return null;
}

/**
 * Borra del backend el fichero si viene de /api/files/:id
 * y siempre devuelve '' para limpiar imageUrl.
 */
async function deleteServiceImageByUrl(imageUrl) {
  const id = extractFileIdFromImageUrl(imageUrl);

  // Si era un archivo de BD, intentamos borrarlo
  if (id) {
    try {
      await http(`/api/files/${id}`, { method: 'DELETE', auth: true });
    } catch (e) {
      const msg = e?.data?.error || e?.data?.message || e?.message || 'No se pudo borrar la imagen';
      throw new Error(msg);
    }
  }

  // Si no era /api/files, simplemente limpiamos el campo (imagen estática o nombre)
  return '';
}

/* ==========================
   Componente principal
========================== */

export default function Servicios() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const [selModalidad, setSelModalidad] = useState('');
  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();
  const { isAuthenticated, role } = useAuth();

  const esAdmin = role === 'admin';

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
    order: '',
    imageUrl: '',
  });

  const [msgNuevo, setMsgNuevo] = useState('');
  const [nuevoImgFile, setNuevoImgFile] = useState(null);

  const crearServicio = async (e) => {
    e.preventDefault();
    setMsgNuevo('');
    setSaving(true);

    try {
      // 1) Si hay archivo seleccionado, se sube AHORA (al publicar)
      let imageUrl = (nuevo.imageUrl || '').trim();
      if (nuevoImgFile) {
        setMsgNuevo('Subiendo imagen…');
        imageUrl = await uploadServiceImage(nuevoImgFile);
      }

      const body = {
        title: (nuevo.title || '').trim(),
        short: (nuevo.short || '').trim(),
        long: (nuevo.long || '').trim(),
        currency: (nuevo.currency || 'EUR').toUpperCase(),
        duration: (nuevo.duration || '').trim(),
        mode: (nuevo.mode || '').trim(),
        order: nuevo.order === '' ? undefined : Number(nuevo.order),
        price: nuevo.price === '' ? null : Number(nuevo.price),
        imageUrl,
        featured: false, // ✅ quitamos la casilla: siempre false
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
        order: '',
        imageUrl: '',
      });
      setNuevoImgFile(null);

      await refresh();
    } catch (e) {
      const msg =
        e?.data?.error || e?.data?.message || e?.message || 'No se pudo crear';
      setMsgNuevo(`❌ ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleNuevoImageFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMsgNuevo('');
    setNuevoImgFile(file);

    // Limpia el input para permitir re-seleccionar el mismo archivo si hace falta
    e.target.value = '';
    setMsgNuevo('✅ Imagen seleccionada. Se subirá al guardar el servicio.');
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

  if (cargando) {
    return (
      <div className="servicios">
        <div className="page-wrapper">
          <div className="servicios__loading card">Cargando…</div>
        </div>
      </div>
    );
  }

  // Imagen: soporta tanto nombres antiguos como URLs completas (/api/files/xxx, http, etc.)
  const getImgSrc = (imageUrl) => {
    if (!imageUrl) return '/img/servicios/default.jpg';

    // URLs absolutas (http/s)
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }

    // Archivos servidos por el backend
    if (imageUrl.startsWith('/api/files/') || imageUrl.startsWith('/files/')) {
      return absUrl(imageUrl);
    }

    // Imágenes estáticas del frontend
    if (imageUrl.startsWith('/img/')) {
      return imageUrl;
    }

    // caso clásico: sólo nombre de archivo
    return `/img/servicios/${imageUrl}`;
  };

  return (
    <div className="servicios page-wrapper">
      {/* ===== HEADER DE PÁGINA ===== */}
      <header className="servicios__header">
        <h1 className="servicios__title">Servicios de Adiestramiento</h1>
        <p className="servicios__subtitle">
          Elige el tipo de servicio que mejor encaja con tu perro y contrátalo
          directamente desde tu cuenta.
        </p>
      </header>

      {error && <p className="error-msg">{error}</p>}

      {/* CREAR SERVICIO - SOLO ADMIN */}
      {esAdmin && (
        <section className="admin-create card">
          <div className="admin-create__header">
            <span className="admin-create__breadcrumb">SERVICIOS</span>
            <h2 className="admin-create__title">Crear nuevo servicio</h2>
            <p className="admin-create__subtitle">
              Define los detalles del servicio que ofrecerás a tus clientes: descripción,
              precio, modalidad y visibilidad en la web.
            </p>
          </div>

          <form onSubmit={crearServicio} className="admin-form">
            <div className="admin-form__group">
              <h3 className="admin-form__group-title">Datos del servicio</h3>

              <label className="full">
                Título del servicio (obligatorio)
                <input
                  value={nuevo.title}
                  onChange={(e) =>
                    setNuevo({ ...nuevo, title: e.target.value })
                  }
                  required
                />
              </label>

              <label className="full">
                Resumen corto (obligatorio)
                <input
                  value={nuevo.short}
                  onChange={(e) =>
                    setNuevo({ ...nuevo, short: e.target.value })
                  }
                  required
                />
                <small>Máx. 140 caracteres. Aparece en la tarjeta del servicio.</small>
              </label>

              <label className="full">
                Descripción detallada (opcional)
                <textarea
                  rows={3}
                  value={nuevo.long}
                  onChange={(e) =>
                    setNuevo({ ...nuevo, long: e.target.value })
                  }
                />
              </label>

              <div className="admin-form__row">
                <label>
                  Precio (€) (obligatorio)
                  <input
                    type="number"
                    step="0.01"
                    value={nuevo.price}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, price: e.target.value })
                    }
                  />
                </label>

                <label>
                  Moneda
                  <input
                    value={nuevo.currency}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, currency: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="admin-form__row">
                <label>
                  Duración del servicio
                  <input
                    value={nuevo.duration}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, duration: e.target.value })
                    }
                  />
                </label>

                <label>
                  Modalidad
                  <input
                    value={nuevo.mode}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, mode: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="admin-form__row">
                <label>
                  Orden en el listado
                  <input
                    type="number"
                    value={nuevo.order}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, order: e.target.value })
                    }
                  />
                </label>
              </div>

              <label className="full">
                Subir imagen destacada
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleNuevoImageFile}
                  disabled={saving}
                />
                {nuevoImgFile && <small>Archivo seleccionado: {nuevoImgFile.name}</small>}
                {!nuevoImgFile && <small>La imagen se subirá al guardar el servicio.</small>}
              </label>

              {/* ✅ Casilla eliminada (Destacado) */}
            </div>

            <div className="form-actions">
              <button type="button" className="btn-secondary" disabled={saving}>
                Descartar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar servicio'}
              </button>
              {msgNuevo && <span className="msg-inline">{msgNuevo}</span>}
            </div>
          </form>
        </section>
      )}

      {/* GRID DE SERVICIOS */}
      <section className="servicios-grid">
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
              <header className="card-header">
                <h3>{item.title}</h3>
                {item.featured && (
                  <span className="badge badge--featured">Destacado</span>
                )}
              </header>

              <p className="short">{item.short}</p>

              <div className="details">
                {item.duration && (
                  <span className="chip chip--soft">{item.duration}</span>
                )}
                {item.mode && (
                  <span className="chip chip--soft">{item.mode}</span>
                )}
                {item.price != null && (
                  <span className="chip chip--strong">
                    {formatEUR(item.price, item.currency)}
                  </span>
                )}
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn-outline"
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
                    className="btn-primary"
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
                    className="btn-primary"
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
      </section>

      {/* MODAL DETALLE */}
      {sel && (
        <div className="modal-overlay" onClick={cerrar}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-modal"
              onClick={cerrar}
              aria-label="Cerrar"
              type="button"
            >
              ✕
            </button>

            {sel.imageUrl && (
              <div
                className="modal-img"
                style={{ backgroundImage: `url(${getImgSrc(sel.imageUrl)})` }}
              />
            )}

            <h3 className="modal-title">{sel.title}</h3>
            <p className="modal-description">{sel.long || sel.short}</p>

            <div className="modal-details">
              {sel.duration && (
                <span className="chip chip--soft">{sel.duration}</span>
              )}
              {sel.mode && <span className="chip chip--soft">{sel.mode}</span>}
              {sel.price != null && (
                <span className="chip chip--strong">
                  {formatEUR(sel.price, sel.currency)}
                </span>
              )}
            </div>

            {!esAdmin && (
              <>
                <div className="modal-field">
                  <label>
                    Modalidad
                    <select
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

                <button
                  className="modal-btn btn-primary"
                  type="button"
                  onClick={() => contratar(sel, selModalidad)}
                >
                  Reservar este servicio
                </button>
              </>
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

/* ==========================
   EDITOR ADMIN
========================== */

function ServiceEditor({ item, onSave, onDelete, saving }) {
  const [form, setForm] = useStateReact({
    title: item.title || '',
    short: item.short || '',
    long: item.long || '',
    price: item.price ?? '',
    currency: item.currency || 'EUR',
    duration: item.duration || '',
    mode: item.mode || '',
    order: item.order ?? '',
    imageUrl: item.imageUrl || '',
    featured: false, // ✅ casilla eliminada: mantenemos campo pero sin UI
  });

  const [msg, setMsg] = useStateReact('');
  const [pendingFile, setPendingFile] = useStateReact(null);
  const [workingImg, setWorkingImg] = useStateReact(false);

  const handleChange = (field) => (e) => {
    const value =
      e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Selecciona archivo, pero NO sube todavía (se sube al guardar)
  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMsg('');
    setPendingFile(file);
    e.target.value = '';
    setMsg('✅ Imagen seleccionada. Se subirá al guardar cambios.');
  };

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');

    try {
      // 1) Si hay archivo pendiente, se sube AHORA (al publicar cambios)
      let next = { ...form };
      if (pendingFile) {
        setWorkingImg(true);
        setMsg('Subiendo imagen…');

        const url = await uploadServiceImage(pendingFile);
        next.imageUrl = url;
      }

      await onSave(next);

      setPendingFile(null);
      setMsg('✅ Guardado');
    } catch (err) {
      const msgErr =
        err?.data?.error || err?.data?.message || err?.message || 'No se pudo guardar';
      setMsg(`❌ ${msgErr}`);
    } finally {
      setWorkingImg(false);
    }
  };

  const eliminarImagen = async () => {
    if (!form.imageUrl && !pendingFile) {
      setMsg('ℹ️ No hay imagen que eliminar.');
      return;
    }

    if (!window.confirm('¿Eliminar la imagen de este servicio?')) return;

    setMsg('');
    setWorkingImg(true);

    try {
      // Si había archivo pendiente aún no subido, solo lo descartamos
      if (pendingFile) {
        setPendingFile(null);
      }

      // Si ya había imageUrl, intentamos borrar en backend si es /api/files/:id
      const cleared = await deleteServiceImageByUrl(form.imageUrl);

      const next = { ...form, imageUrl: cleared };
      setForm(next);

      // Persistimos inmediatamente
      await onSave(next);

      setMsg('✅ Imagen eliminada');
    } catch (err) {
      const msgErr =
        err?.data?.error || err?.data?.message || err?.message || 'No se pudo eliminar la imagen';
      setMsg(`❌ ${msgErr}`);
    } finally {
      setWorkingImg(false);
    }
  };

  return (
    <form onSubmit={submit} className="admin-edit-form">
      <h4 className="admin-edit-form__title">Editar servicio</h4>

      <label className="full">
        Título
        <input value={form.title} onChange={handleChange('title')} required />
      </label>

      <label className="full">
        Resumen
        <input value={form.short} onChange={handleChange('short')} required />
      </label>

      <label className="full">
        Descripción
        <textarea rows={3} value={form.long} onChange={handleChange('long')} />
      </label>

      <div className="admin-form__row">
        <label>
          Precio (€)
          <input
            type="number"
            step="0.01"
            value={form.price}
            onChange={handleChange('price')}
          />
        </label>

        <label>
          Moneda
          <input value={form.currency} onChange={handleChange('currency')} />
        </label>
      </div>

      <div className="admin-form__row">
        <label>
          Duración
          <input value={form.duration} onChange={handleChange('duration')} />
        </label>

        <label>
          Modalidad
          <input value={form.mode} onChange={handleChange('mode')} />
        </label>
      </div>

      <div className="admin-form__row">
        <label>
          Orden
          <input
            type="number"
            value={form.order}
            onChange={handleChange('order')}
          />
        </label>
      </div>

      <label className="full">
        Subir nueva imagen
        <input
          type="file"
          accept="image/*"
          onChange={handleFilePick}
          disabled={saving || workingImg}
        />
        {pendingFile && <small>Archivo seleccionado: {pendingFile.name}</small>}
        {!pendingFile && <small>La imagen se subirá al guardar cambios.</small>}
      </label>

      {/* ✅ Casilla eliminada (Destacado) */}

      <div className="form-actions form-actions--edit">
        <button type="submit" className="btn-primary" disabled={saving || workingImg}>
          {saving || workingImg ? 'Guardando…' : 'Guardar cambios'}
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={eliminarImagen}
          disabled={saving || workingImg}
        >
          Eliminar imagen
        </button>

        <button
          type="button"
          className="delete-btn"
          onClick={onDelete}
          disabled={saving || workingImg}
        >
          Borrar
        </button>

        {msg && <span className="msg-inline">{msg}</span>}
      </div>
    </form>
  );
}
