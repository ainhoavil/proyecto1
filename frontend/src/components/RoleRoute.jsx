import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/auth';

export default function RoleRoute({ children, allow = [] }) {
  const { role, loading } = useAuth();

  if (loading) return null;
  if (!allow.includes(role)) return <Navigate to="/" replace />;
  return children;
}
