// frontend/src/pages/Register.jsx
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { http } from '../helpers/http';
import { useAuth } from '../context/auth';

export default function Register() {
  const [nombre, setNombre] = useState('');
  const [email, setEmail]   = useState('');
  const [pass, setPass]     = useState('');
  const [pass2, setPass2]   = useState('');
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess } = useAuth();

  const params = new URLSearchParams(location.search);
  const nextParam = params.get('next') || '';

  const handleRegister = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    if (pass !== pass2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (pass.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      // Esperado: POST /api/auth/register { name, email, password }
      const res = await http('/api/auth/register', {
        method: 'POST',
        data: { name: nombre, email, password: pass },
      });

      // Si el backend devuelve token, iniciamos sesión automáticamente
      const token =
        res?.token || res?.accessToken || res?.jwt || res?.data?.token || null;

      const role =
        res?.user?.role || res?.role || res?.data?.user?.role || 'client';

      const user =
        res?.user || res?.data?.user || { email, name: nombre };

      if (token) {
        // Sesión directa
        loginSuccess({ token, role, user });
        const next = nextParam || location.state?.next || '/';
        navigate(next, { replace: true });
      } else {
        // Sin token: redirige a login llevando next
        const nextLogin = nextParam
          ? `/login?next=${encodeURIComponent(nextParam)}`
          : '/login';
        navigate(nextLogin, { replace: true });
      }
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (status === 409) setError('Ese email ya está registrado.');
      else if (status === 400) setError('Datos inválidos. Revisa el formulario.');
      else setError('No se pudo crear la cuenta. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = email && pass && pass2 && !loading;

  return (
    <div className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
      <h1>Crear cuenta</h1>
      <form onSubmit={handleRegister} style={{ display: 'grid', gap: 12 }}>
        <label>
          Nombre (opcional)
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="name"
            placeholder="Tu nombre"
          />
        </label>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            inputMode="email"
            placeholder="tucorreo@ejemplo.com"
          />
        </label>

        <label>
          Contraseña
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={showPass1 ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Mínimo 6 caracteres"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowPass1(v => !v)}
              aria-label={showPass1 ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{ minWidth: 90 }}
            >
              {showPass1 ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </label>

        <label>
          Repite la contraseña
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={showPass2 ? 'text' : 'password'}
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Repite la contraseña"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowPass2(v => !v)}
              aria-label={showPass2 ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{ minWidth: 90 }}
            >
              {showPass2 ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </label>

        <button type="submit" disabled={!canSubmit}>
          {loading ? 'Creando…' : 'Registrarse'}
        </button>

        {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}
      </form>

      <p style={{ marginTop: 12 }}>
        ¿Ya tienes cuenta?{' '}
        <Link to={nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : '/login'}>
          Inicia sesión
        </Link>
      </p>
    </div>
  );
}
