// frontend/src/components/RoleRoute.jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/auth";

export default function RoleRoute({ children, allow = [] }) {
  const { role, user, loading } = useAuth();

  // Mientras se cargan los datos de auth, mejor mostrar algo
  if (loading) {
    return <div className="page-wrapper">Cargando permisos…</div>;
  }

  // Si el backend marca isAdmin en el token, forzamos rol admin
  const effectiveRole = user?.isAdmin ? "admin" : role;

  // Si hay lista de roles permitidos y el usuario NO está en la lista → fuera
  if (allow.length > 0 && !allow.includes(effectiveRole)) {
    return <Navigate to="/" replace />;
  }

  // Tiene permiso → renderizamos el contenido protegido
  return children;
}
