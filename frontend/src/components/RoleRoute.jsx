// frontend/src/components/RoleRoute.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/auth';

export default function RoleRoute({ children, allow = [] }) {
  const { role, user, loading } = useAuth();

  if (loading) return null;

  // 1. Si se requiere 'admin' y el usuario tiene la flag isAdmin, permitir acceso
  if (allow.includes('admin') && user?.isAdmin) {
    return children;
  }

  // 2. Comprobación estándar de rol
  if (!allow.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}