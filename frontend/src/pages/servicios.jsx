// frontend/src/pages/servicios.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/contratar.scss';
import { useEditMode } from '../context/editmode';
import { useAuth } from '../context/auth';
import { http } from '../helpers/http';

function formatEUR(value, currency = 'EUR') {
  if (value == null || value === '') return '';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

export default function Servicios() {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();
  const { editMode } = useEditMode();
  const { isAuthenticated, role } = useAuth();
  const esAdmin = role === 'admin';

  const refresh = async () => {
    setCargando(true);
    setError('');
    try {
      const data = await http('/api/servicios');
      const sorted = [...(data || [])].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
      setItems(sorted);
    } catch {
      setItems([]);
      setError('No se pudo cargar el catálogo.');
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => { refresh(); }, []);

  const contratar = (item) => {
    const servicio = encodeURIComponent(item?.id || item?.title);
    if (isAuthenticated) {
      navigate(`/contratar?servicio=${servicio}`);
    } else {
      navigate(`/login?next=${encodeURIComponent(`/contratar?servicio=${servicio}`)}`);
    }
  };

  const abrir = (item) => setSel(item);
  const cerrar = () => setSel(null);

  const [nuevo, setNuevo] = useState({
    title: '', short: '', long: '', price: '', currency: 'EUR',
    duration: '', mode: '', featured: false, order: ''
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
      };
      if (!body.title || !body.short) {
        setMsgNuevo('❌ Título y resumen son obligatorios.');
        setSaving(false);
        return;
      }
      await http('/api/servicios', { method: 'POST', data: body, auth: true });
      setMsgNuevo('✅ Servicio creado');
      setNuevo({ title: '', short: '', long: '', price: '', currency: 'EUR', duration: '', mode: '', featured: false, order: '' });
      await refresh();
    } catch (e) {
      const msg = e?.data?.error || e?.data?.message || e?.message || 'No se pudo crear';
      setMsgNuevo(`❌ ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const guardarEdicion = async (id, data) => {
    setSaving(true);
    try {
      const payload = { ...data, currency: (data.currency || 'EUR').toUpperCase() };
      if (payload.price === '') payload.price = null;
      if (payload.order !== '' && payload.order != null) payload.order = Number(payload.order);
      await http(`/api/servicios/${id}`, { method: 'PATCH', data: payload, auth: true });
      await refresh();
      setSel((prev) => (prev && prev.id === id ? { ...prev, ...payload } : prev));
    } catch (e) {
      const msg = e?.data?.error || e?.data?.message || 'No se pudo guardar';
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const borrarServicio = async (id) => {
    if (!window.confirm('¿Borrar este servicio?')) return;
    setSaving(true);
    try {
      await http(`/api/servicios/${id}`, { method: 'DELETE', auth: true });
      cerrar();
      await refresh();
    } catch (e) {
      const msg = e?.data?.error || e?.data?.message || 'No se pudo borrar';
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (cargando) return <div className="card">Cargando…</div>;

  return (
    <div className="servicios">
      <h1>Nuestros Servicios de Adiestramiento</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {esAdmin && editMode && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Crear servicio</h2>
          <form
            onSubmit={crearServicio}
            style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', maxWidth: 900 }}
          >
            <label style={{ gridColumn: '1 / -1' }}>
              Título:
              <input value={nuevo.title} onChange={(e) => setNuevo({ ...nuevo, title: e.target.value })} required />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Resumen:
              <input value={nuevo.short} onChange={(e) => setNuevo({ ...nuevo, short: e.target.value })} required />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Descripción:
              <textarea rows={3} value={nuevo.long} onChange={(e) => setNuevo({ ...nuevo, long: e.target.value })} />
            </label>
            <label>
              Precio (€):
              <input type="number" step="0.01" value={nuevo.price} onChange={(e) => setNuevo({ ...nuevo, price: e.target.value })} placeholder="Vacío = sin precio" />
            </label>
            <label>
              Moneda:
              <input value={nuevo.currency} onChange={(e) => setNuevo({ ...nuevo, currency: e.target.value })} />
            </label>
            <label>
              Duración:
              <input value={nuevo.duration} onChange={(e) => setNuevo({ ...nuevo, duration: e.target.value })} placeholder="6 sesiones · 60 min" />
            </label>
            <label>
              Modalidad:
              <input value={nuevo.mode} onChange={(e) => setNuevo({ ...nuevo, mode: e.target.value })} placeholder="presencial / domicilio / online" />
            </label>
            <label>
              Orden:
              <input type="number" value={nuevo.order} onChange={(e) => setNuevo({ ...nuevo, order: e.target.value })} placeholder="10, 20, 30…" />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={nuevo.featured} onChange={(e) => setNuevo({ ...nuevo, featured: e.target.checked })} />
              Destacado
            </label>

            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Crear'}</button>
              {msgNuevo && <span style={{ marginLeft: 8 }}>{msgNuevo}</span>}
            </div>
          </form>
        </div>
      )}

      {/* Grid de tarjetas */}
      <div
        className="servicios-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}
      >
        {items.map((item) => (
          <article
            key={item.id}
            className="service-card"
            onClick={() => abrir(item)}
            style={{
              border: '1px solid #eee',
              borderRadius: 12,
              padding: 16,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              cursor: 'pointer'
            }}
          >
            <h3 style={{ margin: '6px 0' }}>{item.title}</h3>
            <p style={{ opacity: 0.9 }}>{item.short}</p>

            <div style={{ fontSize: 14, opacity: 0.8, display: 'grid', gap: 4 }}>
              {item.duration && <div>⏱ {item.duration}</div>}
              {item.mode && <div>📍 {item.mode}</div>}
              {item.price != null && <div><b>{formatEUR(item.price, item.currency)}</b></div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
              <button onClick={(e) => { e.stopPropagation(); abrir(item); }}>Ver más</button>
              {esAdmin && editMode ? (
                <button onClick={(e) => { e.stopPropagation(); abrir(item); }}>Editar</button>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); contratar(item); }}>Contratar</button>
              )}
            </div>
          </article>
        ))}
      </div>

      {/* Modal */}
      {sel && (
        <div
          className="modal-overlay"
          onClick={cerrar}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ background: '#fff', borderRadius: 12, maxWidth: 700, width: '100%', padding: 20, display: 'grid', gap: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <h3 style={{ margin: 0 }}>{sel.title}</h3>
              <button onClick={cerrar} aria-label="cerrar">✖</button>
            </div>

            {/* Vista normal */}
            {(!esAdmin || !editMode) && (
              <>
                <p style={{ whiteSpace: 'pre-wrap' }}>{sel.long || sel.short}</p>
                <div style={{ fontSize: 14, opacity: 0.8, display: 'grid', gap: 4 }}>
                  {sel.duration && <div>⏱ {sel.duration}</div>}
                  {sel.mode && <div>📍 {sel.mode}</div>}
                  {sel.price != null && <div><b>{formatEUR(sel.price, sel.currency)}</b></div>}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={() => contratar(sel)}>Contratar</button>
                </div>
              </>
            )}

            {/* Vista admin edición */}
            {esAdmin && editMode && (
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
  });
  const [msg, setMsg] = useStateReact('');

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    await onSave(form);
    setMsg('✅ Guardado');
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
      <label style={{ gridColumn: '1 / -1' }}>
        Título:
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
      </label>
      <label style={{ gridColumn: '1 / -1' }}>
        Resumen:
        <input value={form.short} onChange={(e) => setForm({ ...form, short: e.target.value })} required />
      </label>
      <label style={{ gridColumn: '1 / -1' }}>
        Descripción:
        <textarea rows={3} value={form.long} onChange={(e) => setForm({ ...form, long: e.target.value })} />
      </label>
      <label>
        Precio (€):
        <input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Vacío = sin precio" />
      </label>
      <label>
        Moneda:
        <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
      </label>
      <label>
        Duración:
        <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
      </label>
      <label>
        Modalidad:
        <input value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} />
      </label>
      <label>
        Orden:
        <input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
        Destacado
      </label>

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        <button type="button" onClick={onDelete} style={{ background: '#f44336', color: '#fff' }}>
          Borrar
        </button>
        {msg && <span style={{ marginLeft: 8 }}>{msg}</span>}
      </div>
    </form>
  );
}
