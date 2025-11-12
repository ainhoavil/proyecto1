// frontend/src/pages/Login.jsx
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { http } from '../helpers/http';
import { useAuth } from '../context/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const { loginSuccess } = useAuth();

  // Propaga ?next= tanto al enlace de registro como a la redirección post-login
  const params = new URLSearchParams(location.search);
  const nextParam = params.get('next') || '';

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);

    try {
      // POST /api/auth/login { email, password }
      const res = await http('/api/auth/login', {
        method: 'POST',
        data: { email, password: pass },
      });

      // Adapta a varios formatos posibles de respuesta
      const token =
        res?.token ||
        res?.accessToken ||
        res?.jwt ||
        res?.data?.token ||
        null;

      const role =
        res?.user?.role ||
        res?.role ||
        res?.data?.user?.role ||
        'client';

      const user =
        res?.user ||
        res?.data?.user ||
        { email };

      // Actualiza el contexto (esto también sincroniza localStorage en tu AuthProvider)
      if (typeof loginSuccess === 'function') {
        loginSuccess({ token, role, user });
      } else {
        // Fallback por si aún no montaste el AuthProvider
        localStorage.setItem('usuarioLogueado', '1');
        localStorage.setItem('rol', role);
        if (token) localStorage.setItem('token', token);
        if (user) localStorage.setItem('user', JSON.stringify(user));
      }

      // Redirección respetando ?next=
      const next = nextParam || location.state?.next || '/';
      navigate(next, { replace: true });
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (status === 401) setError('Email o contraseña incorrectos.');
      else if (status === 400) setError('Solicitud inválida. Revisa los campos.');
      else if (status === 429) setError('Demasiados intentos. Prueba de nuevo en unos minutos.');
      else setError('No se pudo iniciar sesión. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>Iniciar sesión</h1>

      <form onSubmit={handleLogin} style={{ display: 'grid', gap: 12 }}>
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
            autoFocus
          />
        </label>

        <label>
          Contraseña
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Tu contraseña"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="btn-link"
              style={{ minWidth: 90 }}
            >
              {showPass ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </label>

        <button type="submit" disabled={loading || !email || !pass}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>

        {error && (
          <div role="alert" style={{ color: 'crimson' }}>
            {error}
          </div>
        )}
      </form>

      <p style={{ marginTop: 12 }}>
        ¿Aún no tienes cuenta?{' '}
        <Link to={nextParam ? `/register?next=${encodeURIComponent(nextParam)}` : '/register'}>
          Regístrate aquí
        </Link>
      </p>
    </div>
  );
}
