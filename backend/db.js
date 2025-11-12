// backend/db.js
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "url";

// === __dirname para módulos ESM ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Cargar variables de entorno ===
// Busca primero en /backend/.env, si no, en la raíz
const envPath = path.resolve(__dirname, ".env");
dotenv.config({ path: envPath });

// === Validar variables críticas ===
if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("❌ Falta TURSO_DATABASE_URL en el archivo .env");
}
if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error("❌ Falta TURSO_AUTH_TOKEN en el archivo .env");
}

// === Crear cliente Turso ===
let db;
try {
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  console.log("🟢 Cliente Turso inicializado");
} catch (err) {
  console.error("❌ Error inicializando cliente Turso:", err);
  process.exit(1);
}

// === Helper de consulta universal ===
export async function query(sql, params = []) {
  try {
    const res = await db.execute({ sql, args: params });
    return res.rows || [];
  } catch (err) {
    console.error("❌ Error ejecutando query:", sql, err);
    throw err;
  }
}

// === Activar claves foráneas (foreign keys) ===
// En Turso/libSQL, esto debe hacerse tras inicializar el cliente.
// Se ejecuta una vez al importar el módulo.
(async () => {
  try {
    await db.execute("PRAGMA foreign_keys = ON;");
    console.log("🔗 Foreign keys activadas (PRAGMA foreign_keys = ON)");
  } catch (err) {
    console.warn("⚠️ No se pudieron activar foreign_keys:", err.message);
  }
})();

// === Exportar cliente ===
export { db };
