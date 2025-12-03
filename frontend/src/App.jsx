import { Routes, Route, Navigate } from "react-router-dom";

// Layout
import Navbar from "./components/navbar";
import Topbar from "./components/topbar";
import Footer from "./components/Footer"; // 👈 NUEVO

// Contextos
import { AuthProvider } from "./context/auth";

// Rutas protegidas
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";

// Páginas públicas
import Home from "./pages/home.jsx";
import Servicios from "./pages/servicios.jsx";
import Reservas from "./pages/reservas.jsx";
import Contacto from "./pages/contacto.jsx";
import Videos from "./pages/videos.jsx";
import Login from "./pages/login.jsx";
import Register from "./pages/register.jsx";
import Contratar from "./pages/contratar.jsx";

// Páginas protegidas
import Perfil from "./pages/perfil.jsx";

// Import global styles
import "./styles/global.scss";

export default function App() {
  return (
    <AuthProvider>
      {/* Layout superior */}
      <Topbar />
      <Navbar />

      {/* Contenido principal */}
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
                <Reservas />
              </ProtectedRoute>
            }
          />

          {/* ===== CATCH-ALL ===== */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Footer siempre al final */}
      <Footer />
    </AuthProvider>
  );
}
