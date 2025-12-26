import { Routes, Route, Navigate } from "react-router-dom";

// Layout
import Navbar from "./components/navbar";
import Topbar from "./components/topbar";
import Footer from "./components/Footer";

// Contextos
import { AuthProvider } from "./context/auth";

// Rutas protegidas
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";

// Páginas públicas
import Home from "./pages/home.jsx";
import Servicios from "./pages/servicios.jsx";
import Contacto from "./pages/contacto.jsx";
import Videos from "./pages/videos.jsx";
import Login from "./pages/login.jsx";
import Register from "./pages/register.jsx";
import Contratar from "./pages/contratar.jsx";
import TrainersList from "./pages/TrainersList.jsx";
import TrainerPublicProfile from "./pages/TrainerPublicProfile.jsx";

// Páginas protegidas
import Reservas from "./pages/reservas.jsx";
import Perfil from "./pages/perfil.jsx";
import AdminPanel from "./pages/admin.jsx";
import TrainerAgenda from "./pages/trainer-Agenda.jsx";

// Styles
import "./styles/global.scss";

export default function App() {
  return (
    <AuthProvider>
      <Topbar />
      <Navbar />

      <main className="container">
        <Routes>
          {/* ===== PÚBLICAS ===== */}
          <Route path="/" element={<Home />} />
          <Route path="/servicios" element={<Servicios />} />
          <Route path="/adiestradores" element={<TrainersList />} />
          <Route path="/adiestradores/:id" element={<TrainerPublicProfile />} />
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

          {/* ===== PANEL ADMIN ===== */}
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute>
                <RoleRoute allow={["admin"]}>
                  <AdminPanel />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* ===== AGENDA ADIESTRADOR ===== */}
          <Route
            path="/trainer-agenda"
            element={
              <ProtectedRoute>
                <RoleRoute allow={["adiestrador", "admin"]}>
                  <TrainerAgenda />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* ===== CATCH ALL ===== */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
    </AuthProvider>
  );
}
