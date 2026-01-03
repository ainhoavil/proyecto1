import { Routes, Route, Navigate, useLocation } from "react-router-dom";

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
import Login from "./pages/login.jsx";
import Register from "./pages/register.jsx";
import Contratar from "./pages/contratar.jsx";
import TrainersList from "./pages/TrainersList.jsx";
import TrainerPublicProfile from "./pages/TrainerPublicProfile.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

// Páginas protegidas
import Reservas from "./pages/reservas.jsx";
import Perfil from "./pages/perfil.jsx";
import AdminPanel from "./pages/admin.jsx";
import TrainerAgenda from "./pages/trainer-Agenda.jsx";
import TrainerClients from "./pages/trainer-clients.jsx";
import TrainerClientDetail from "./pages/trainer-client-detail.jsx";

// ✅ Chat
import ChatPage from "./pages/ChatPage.jsx";

// Styles
import "./styles/global.scss";

export default function App() {
  const location = useLocation();

  // Rutas "pantalla completa" (sin container global)
  const fullWidthPaths = new Set([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ]);

  const isFullWidth =
    fullWidthPaths.has(location.pathname) ||
    // Por si el reset trae querystring (?token=...)
    location.pathname.startsWith("/reset-password");

  return (
    <AuthProvider>
      <Topbar />
      <Navbar />

      <main className={isFullWidth ? "" : "container"}>
        <Routes>
          {/* ===== PÚBLICAS ===== */}
          <Route path="/" element={<Home />} />
          <Route path="/servicios" element={<Servicios />} />
          <Route path="/adiestradores" element={<TrainersList />} />
          <Route path="/adiestradores/:id" element={<TrainerPublicProfile />} />
          <Route path="/contratar" element={<Contratar />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

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

          {/* ✅ CHAT POR RESERVA (PROTEGIDA) */}
          <Route
            path="/chat/:conversationId"
            element={
              <ProtectedRoute>
                <ChatPage />
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

          {/* ===== PANEL ADIESTRADOR: CLIENTES + NOTAS PRIVADAS ===== */}
          <Route
            path="/trainer/clientes"
            element={
              <ProtectedRoute>
                <RoleRoute allow={["adiestrador"]}>
                  <TrainerClients />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/trainer/clientes/:clientId"
            element={
              <ProtectedRoute>
                <RoleRoute allow={["adiestrador"]}>
                  <TrainerClientDetail />
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
