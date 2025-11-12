// frontend/src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/navbar';
import Topbar from './components/topbar';

import { EditModeProvider } from './context/editmode';
import { AuthProvider } from './context/auth';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';

// Páginas principales
import Home from './pages/home.jsx';
import Servicios from './pages/servicios.jsx';
import Reservas from './pages/reservas.jsx';   // 🔹 coordinador de admin/usuario
import Contacto from './pages/contacto.jsx';
import Videos from './pages/videos.jsx';
import Login from './pages/login.jsx';
import Register from './pages/register.jsx';
import Contratar from './pages/contratar.jsx';
import Perfil from './pages/perfil.jsx';

// Si luego haces panel de admin:
// import AdminPanel from './pages/admin/index.jsx';

export default function App() {
  return (
    <AuthProvider>
      <EditModeProvider>
        <Topbar />
        <Navbar />

        <main className="container">
          <Routes>
            {/* ===== PÚBLICAS ===== */}
            <Route path="/" element={<Home />} />
            <Route path="/servicios" element={<Servicios />} />
            <Route path="/contratar" element={<Contratar />} />
            <Route path="/multimedia" element={<Videos />} />
            <Route path="/contacto" element={<Contacto />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* ===== PROTEGIDAS ===== */}
            <Route
              path="/perfil"
              element={
                <ProtectedRoute>
                  <Perfil />
                </ProtectedRoute>
              }
            />

            <Route
              path="/reservas"
              element={
                <ProtectedRoute>
                  <Reservas />  {/* 🔹 el coordinador detecta admin o usuario */}
                </ProtectedRoute>
              }
            />

            {/* ===== EJEMPLO ADMIN FUTURO =====
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute>
                  <RoleRoute allow={['admin']}>
                    <AdminPanel />
                  </RoleRoute>
                </ProtectedRoute>
              }
            />
            */}

            {/* ===== CATCH-ALL ===== */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </EditModeProvider>
    </AuthProvider>
  );
}
