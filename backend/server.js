// backend/server.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";

// ==== Rutas ====
import authRoutes from "./routes/auth.js";
import videoRoutes from "./routes/videos.js";
import reservasRoutes from "./routes/reservas.js";
import contactoRoutes from "./routes/contacto.js";
import settingsRoutes from "./routes/settings.js";
import serviciosRoutes from "./routes/servicios.js";
import paquetesRoutes from "./routes/paquetes.js";
import cuestionariosRoutes from "./routes/cuestionarios.js";
import perfilRoutes from "./routes/perfil.js";
import perrosRoutes from "./routes/perros.js";
import filesRoutes from "./routes/files.js"; // subir/ver fotos
import trainersRoutes from "./routes/trainers.js"; // 🔹 NUEVO: listado adiestradores

// ==== __dirname (ESM) ====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== .env ====
// Intenta cargar .env desde la raíz y, además, desde la carpeta backend
dotenv.config();
dotenv.config({ path: path.join(__dirname, ".env") });

// ==== Configuración base ====
const app = express();
const PORT = process.env.PORT || 5000;

// CORS: permite frontend local y otros orígenes
const ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ==== Middlewares base (ANTES de las rutas) ====
// CORS con autorización Bearer
app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Parsers de cuerpo
app.use(express.json({ limit: "10mb" })); // application/json
app.use(express.urlencoded({ extended: true, limit: "10mb" })); // x-www-form-urlencoded

// Logger
app.use(morgan("dev"));

// ==== Healthcheck ====
app.get("/api/health", async (_req, res) => {
  try {
    const rows = await query('SELECT datetime("now") AS now');
    res.json({ ok: true, now: rows[0]?.now });
  } catch (e) {
    console.error("Error /api/health:", e);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

// ==== Probar conexión a Turso (al arrancar) ====
(async () => {
  try {
    const rows = await query('SELECT datetime("now") AS now');
    console.log("Conectado correctamente a Turso:", rows[0]?.now);
  } catch (err) {
    console.error("Error al conectar con Turso:", err.message);
  }
})();

// ==== Montar rutas principales ====
app.use("/api/auth", authRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/reservas", reservasRoutes);
app.use("/api/contacto", contactoRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/servicios", serviciosRoutes);
app.use("/api/paquetes", paquetesRoutes);
app.use("/api/cuestionarios", cuestionariosRoutes);
app.use("/api/perfil", perfilRoutes);
app.use("/api/perros", perrosRoutes);
app.use("/api", filesRoutes); // /api/upload-db y /api/files/:id
app.use("/api/trainers", trainersRoutes); // 🔹 NUEVO: /api/trainers

// ==== 404 ====
app.use((_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// ==== Error handler ====
app.use((err, _req, res, _next) => {
  console.error("Error interno:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ==== Arrancar servidor ====
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`CORS permitido para: ${ORIGINS.join(", ")}`);
});
