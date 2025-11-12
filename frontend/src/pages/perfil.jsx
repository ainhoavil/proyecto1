// frontend/src/pages/Perfil.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { isLogged } from "../helpers/auth";
import "../styles/contratar.scss";

function nowIso() {
  return new Date().toISOString();
}

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const absUrl = (u = "") =>
  !u ? "" : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`;

export default function PerfilPage() {
  const navigate = useNavigate();

  // ===== sesión =====
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!isLogged()) {
      navigate("/login?next=/perfil", { replace: true });
      return;
    }
    setAuthReady(true);
  }, [navigate]);

  // ===== perfil =====
  const [perfil, setPerfil] = useState({
    displayName: "",
    prefix: "+34",
    phone: "",
    address: "",
    avatarURL: "",
    notes: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [pMsg, setPMsg] = useState("");

  // ===== perros =====
  const [perros, setPerros] = useState([]);
  const [savingDog, setSavingDog] = useState(false);
  const [dMsg, setDMsg] = useState("");

  // Modal eliminar perro
  const [modal, setModal] = useState({
    open: false,
    dog: null,
    success: false,
    loading: false,
    error: "",
  });

  // Vista crear/editar perro
  const [creatingDog, setCreatingDog] = useState(false);

  // Perro en edición/creación
  const emptyDog = useMemo(
    () => ({
      id: "",
      nombre: "",
      raza: "",
      nacimiento: "",
      castrado: false,
      notas: "",
      avatarURL: "",
    }),
    []
  );
  const [dogForm, setDogForm] = useState(emptyDog);
  const [editingDogId, setEditingDogId] = useState("");

  // ===== cargar datos =====
  const loadProfile = async () => {
    try {
      const data = await http("/perfil", { auth: true });
      const prof = data?.profile || data || {};
      setEmail(data?.email || prof?.email || "");
      setPerfil({
        displayName: prof.displayName || prof.nombre || "",
        prefix: String(prof.prefix || "+34").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, ""),
        phone: String(prof.phone || prof.telefono || "").replace(/\D/g, ""),
        address: prof.address || prof.direccion || "",
        avatarURL: absUrl(prof.avatarURL ?? prof.foto ?? ""),
        notes: prof.notes || prof.notas || "",
      });
    } catch {
      // mantener valores por defecto
    }
  };

  const loadDogs = async () => {
    try {
      const list = await http("/perros", { auth: true });
      const arr = Array.isArray(list?.items) ? list.items : list || [];
      arr.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
      // normaliza URLs de imagen
      const norm = arr.map((d) => ({ ...d, avatarURL: absUrl(d.avatarURL || d.foto || "") }));
      setPerros(norm);
      setCreatingDog(norm.length === 0);
    } catch {
      setPerros([]);
      setCreatingDog(true);
    }
  };

  useEffect(() => {
    if (!authReady) return;
    (async () => {
      await loadProfile();
      await loadDogs();
    })();
  }, [authReady]);

  // ===== guardar perfil =====
  const saveProfile = async () => {
    setPMsg("");
    setSavingProfile(true);
    try {
      const cleanPrefix = (perfil.prefix || "+34").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
      const cleanPhone = String(perfil.phone || "").replace(/\D/g, "");

      await http("/perfil", {
        method: "PATCH",
        data: {
          displayName: (perfil.displayName || "").trim(),
          prefix: cleanPrefix,
          phone: cleanPhone,
          address: (perfil.address || "").trim(),
          avatarURL: perfil.avatarURL ? absUrl(perfil.avatarURL) : "",
          notes: (perfil.notes || "").trim(),
          updatedAt: nowIso(),
          email, // opcional
        },
        auth: true,
      });
      setPerfil((p) => ({ ...p, prefix: cleanPrefix, phone: cleanPhone }));
      setPMsg("✅ Perfil guardado");
    } catch {
      setPMsg("❌ No se pudo guardar el perfil");
    } finally {
      setSavingProfile(false);
    }
  };

  // ===== subida de archivos (perfil y perros) =====
  async function uploadImage(file) {
    const form = new FormData();
    form.append("file", file);
    const res = await http("/upload-db", {
      method: "POST",
      data: form,
      auth: true,
    });
    const url = res?.url || res?.Location || res?.secure_url;
    if (!url) throw new Error("No URL");
    return absUrl(url);
  }

  // ===== foto de perfil =====
  const handlePickProfile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await uploadImage(file);
      setPerfil((p) => ({ ...p, avatarURL: url }));
      await http("/perfil", {
        method: "PATCH",
        data: { avatarURL: url, updatedAt: nowIso() },
        auth: true,
      });
      setPMsg("✅ Foto de perfil actualizada");
    } catch (err) {
      console.error(err);
      setPMsg("❌ No se pudo subir la foto");
    }
  };

  const onDeleteProfilePhoto = async () => {
    if (!perfil.avatarURL) return;
    try {
      await http("/perfil", {
        method: "PATCH",
        data: { avatarURL: "", updatedAt: nowIso() },
        auth: true,
      });
      setPerfil((p) => ({ ...p, avatarURL: "" }));
      setPMsg("✅ Foto de perfil eliminada");
    } catch (err) {
      console.error(err);
      setPMsg("❌ No se pudo eliminar la foto");
    }
  };

  // ===== crear / actualizar perro =====
  const startCreateDog = () => {
    setEditingDogId("");
    setDogForm(emptyDog);
    setCreatingDog(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const editDog = (dog) => {
    setEditingDogId(dog.id);
    setDogForm({
      id: dog.id,
      nombre: dog.nombre || "",
      raza: dog.raza || "",
      nacimiento: (dog.nacimiento || "").slice(0, 10),
      castrado: !!dog.castrado,
      notas: dog.notas || "",
      avatarURL: absUrl(dog.avatarURL || ""),
    });
    setCreatingDog(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelDogForm = () => {
    setEditingDogId("");
    setDogForm(emptyDog);
    setCreatingDog(false);
  };

  const saveDog = async () => {
    setDMsg("");
    if (!dogForm.nombre.trim()) {
      setDMsg("⚠️ El nombre es obligatorio.");
      return;
    }
    if (!dogForm.raza.trim()) {
      setDMsg("⚠️ La raza/tamaño es obligatoria.");
      return;
    }
    if (!dogForm.nacimiento) {
      setDMsg("⚠️ La fecha de nacimiento es obligatoria.");
      return;
    }

    setSavingDog(true);
    try {
      const base = {
        nombre: dogForm.nombre.trim(),
        raza: dogForm.raza.trim(),
        nacimiento: dogForm.nacimiento,
        castrado: !!dogForm.castrado,
        notas: (dogForm.notas || "").trim(),
        avatarURL: dogForm.avatarURL ? absUrl(dogForm.avatarURL) : "",
        updatedAt: nowIso(),
      };

      if (!editingDogId) {
        await http("/perros", {
          method: "POST",
          data: base,
          auth: true,
        });
        await loadDogs(); // fuerza lectura real de BD
        setDMsg("✅ Perro guardado");
      } else {
        await http(`/perros/${editingDogId}`, {
          method: "PATCH",
          data: base,
          auth: true,
        });
        await loadDogs(); // fuerza lectura real de BD
        setDMsg("✅ Perro guardado");
      }

      setEditingDogId("");
      setDogForm(emptyDog);
      setCreatingDog(false);
    } catch (err) {
      console.error(err);
      setDMsg("❌ No se pudo guardar el perro");
    } finally {
      setSavingDog(false);
    }
  };

  // ===== foto de perro =====
  const handlePickDog = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const url = await uploadImage(file);
      setDogForm((f) => ({ ...f, avatarURL: url }));
      setDMsg("✅ Foto del perro lista (no olvides Guardar)");
    } catch (err) {
      console.error(err);
      setDMsg("❌ No se pudo subir la foto del perro");
    }
  };

  const onDeleteDogPhoto = async () => {
    if (!dogForm.avatarURL) return;
    try {
      setDogForm((f) => ({ ...f, avatarURL: "" }));
      if (editingDogId) {
        await http(`/perros/${editingDogId}`, {
          method: "PATCH",
          data: { avatarURL: "", updatedAt: nowIso() },
          auth: true,
        });
      }
      setDMsg("✅ Foto del perro eliminada");
    } catch (err) {
      console.error(err);
      setDMsg("❌ No se pudo eliminar la foto del perro");
    }
  };

  // ===== eliminar perro con modal =====
  const askDeleteDog = (dog) => {
    setModal({ open: true, dog, success: false, loading: false, error: "" });
  };

  const confirmDeleteDog = async () => {
    if (!modal.dog || modal.loading) return;
    setModal((m) => ({ ...m, loading: true, error: "" }));
    try {
      await http(`/perros/${modal.dog.id}`, { method: "DELETE", auth: true });
      await loadDogs();
      setModal((m) => ({ ...m, success: true, loading: false }));
    } catch (e) {
      console.error("Error eliminando perro:", e);
      setModal((m) => ({
        ...m,
        loading: false,
        error: "No se pudo eliminar. Revisa tu conexión o el backend.",
      }));
    }
  };

  const closeModal = () =>
    setModal({ open: false, dog: null, success: false, loading: false, error: "" });

  if (!authReady) return <div className="card">Cargando sesión…</div>;

  return (
    <div className="card contratar-page" style={{ maxWidth: 980, margin: "0 auto" }}>
      <h1>Mi perfil</h1>

      {/* PERFIL */}
      <section className="card" style={{ padding: "1rem", marginBottom: 16 }}>
        <h2>Datos del usuario</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "120px 1fr" }}>
          {/* Avatar */}
          <div>
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                overflow: "hidden",
                background: "#eee",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {perfil.avatarURL ? (
                <img
                  src={absUrl(perfil.avatarURL)}
                  alt="avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontSize: 12, color: "#777" }}>Sin foto</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <label className="btn-ghost">
                Cambiar foto
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePickProfile}
                  style={{ display: "none" }}
                />
              </label>
              {perfil.avatarURL && (
                <button className="btn-danger" onClick={onDeleteProfilePhoto}>
                  Eliminar foto
                </button>
              )}
            </div>
          </div>

          {/* Campos */}
          <div style={{ display: "grid", gap: 8 }}>
            <label>
              Nombre (obligatorio)
              <input
                required
                value={perfil.displayName}
                onChange={(e) => setPerfil((p) => ({ ...p, displayName: e.target.value }))}
                placeholder="Tu nombre"
              />
            </label>

            <label>Teléfono (obligatorio)</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ width: 70 }}
                value={perfil.prefix}
                onChange={(e) =>
                  setPerfil((p) => ({
                    ...p,
                    prefix: e.target.value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, ""),
                  }))
                }
                placeholder="+34"
              />
              <input
                type="tel"
                pattern="[0-9]*"
                style={{ flex: 1 }}
                value={perfil.phone}
                onChange={(e) =>
                  setPerfil((p) => ({
                    ...p,
                    phone: e.target.value.replace(/\D/g, ""),
                  }))
                }
                placeholder="600123123"
              />
            </div>

            <label>
              Dirección (opcional)
              <input
                value={perfil.address}
                onChange={(e) => setPerfil((p) => ({ ...p, address: e.target.value }))}
                placeholder="Calle, nº, ciudad…"
              />
            </label>

            <label>
              Notas (opcional)
              <textarea
                rows={3}
                value={perfil.notes}
                onChange={(e) => setPerfil((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Preferencias, horarios, etc."
              />
            </label>

            <div className="actions" style={{ marginTop: 6 }}>
              <button
                className="btn-primary"
                onClick={saveProfile}
                disabled={!perfil.displayName?.trim() || !perfil.phone?.trim() || savingProfile}
              >
                {savingProfile ? "Guardando…" : "Guardar perfil"}
              </button>
              {pMsg && <span style={{ marginLeft: 8 }}>{pMsg}</span>}
            </div>
          </div>
        </div>
      </section>

      {/* PERROS */}
      <section className="card" style={{ padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Mis perros</h2>
          {!creatingDog && (
            <button className="btn-primary" onClick={startCreateDog}>
              Añadir perro
            </button>
          )}
        </div>

        {(creatingDog || perros.length === 0) && (
          <div className="card" style={{ padding: "0.8rem", margin: "12px 0 16px" }}>
            <h3 style={{ marginTop: 0 }}>{editingDogId ? "Editar perro" : "Añadir perro"}</h3>
            <p style={{ marginTop: 0, color: "#666" }}>
              * La <b>fecha de nacimiento</b> puede ser <b>(aproximada)</b> si es rescatado.
            </p>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "120px 1fr 1fr",
                alignItems: "start",
              }}
            >
              {/* Foto perro */}
              <div>
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#eee",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {dogForm.avatarURL ? (
                    <img
                      src={absUrl(dogForm.avatarURL)}
                      alt="perro"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: "#777" }}>Sin foto</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <label className="btn-ghost">
                    Cambiar foto
                    <input type="file" accept="image/*" onChange={handlePickDog} style={{ display: "none" }} />
                  </label>
                  {dogForm.avatarURL && (
                    <button className="btn-danger" onClick={onDeleteDogPhoto}>
                      Eliminar foto
                    </button>
                  )}
                </div>
              </div>

              {/* Campos perro */}
              <div style={{ display: "grid", gap: 8 }}>
                <label>
                  Nombre (obligatorio)
                  <input
                    required
                    value={dogForm.nombre}
                    onChange={(e) => setDogForm((f) => ({ ...f, nombre: e.target.value }))}
                    placeholder="Nombre del perro"
                  />
                </label>
                <label>
                  Raza/Tamaño (obligatorio)
                  <input
                    required
                    value={dogForm.raza}
                    onChange={(e) => setDogForm((f) => ({ ...f, raza: e.target.value }))}
                    placeholder="Ej.: mestizo mediano, pastor alemán…"
                  />
                </label>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <label>
                  Fecha de nacimiento (aproximada) (obligatoria)
                  <input
                    required
                    type="date"
                    value={dogForm.nacimiento}
                    onChange={(e) => setDogForm((f) => ({ ...f, nacimiento: e.target.value }))}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!dogForm.castrado}
                    onChange={(e) => setDogForm((f) => ({ ...f, castrado: e.target.checked }))}
                  />
                  Castrado/esterilizado (opcional)
                </label>
                <label>
                  Observaciones (opcional)
                  <input
                    value={dogForm.notas}
                    onChange={(e) => setDogForm((f) => ({ ...f, notas: e.target.value }))}
                    placeholder="Miedos, reactividad, alergias…"
                  />
                </label>
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn-secondary" onClick={cancelDogForm}>
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={saveDog}
                disabled={savingDog || !dogForm.nombre?.trim() || !dogForm.raza?.trim() || !dogForm.nacimiento}
              >
                {savingDog ? "Guardando…" : editingDogId ? "Guardar cambios" : "Añadir perro"}
              </button>
              {dMsg && <span style={{ marginLeft: 8 }}>{dMsg}</span>}
            </div>
          </div>
        )}

        {/* Lista perros */}
        {!creatingDog && perros.length > 0 && (
          <ul className="reservas-list">
            {perros.map((p) => (
              <li key={p.id} className="reserva-item">
                <div className="reserva-main">
                  <div className="title">
                    {p.nombre} {p.raza ? `· ${p.raza}` : ""}
                  </div>
                  <div className="meta">
                    {p.nacimiento ? `Nac.: ${String(p.nacimiento).slice(0, 10)} · ` : ""}
                    {p.castrado ? "Castrado · " : ""}
                    {p.notas || ""}
                  </div>
                </div>
                <div className="admin-actions" style={{ gap: 8 }}>
                  <button className="btn-ghost" onClick={() => editDog(p)}>
                    Editar
                  </button>
                  <button className="btn-danger" onClick={() => askDeleteDog(p)}>
                    Eliminar
                  </button>
                </div>
                {p.avatarURL && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <img
                      src={absUrl(p.avatarURL)}
                      alt={p.nombre}
                      style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 12 }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Modal eliminar */}
      {modal.open && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !modal.loading && closeModal()}
        >
          <div
            className="card"
            style={{ background: "#fff", padding: 20, borderRadius: 12, width: "90%", maxWidth: 420, textAlign: "center" }}
            onClick={(e) => e.stopPropagation()}
          >
            {!modal.success ? (
              <>
                <p>
                  ¿Seguro que quieres eliminar a <b>{modal.dog?.nombre}</b>?
                </p>
                {modal.error && <p style={{ color: "crimson", marginTop: 6 }}>{modal.error}</p>}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                  <button className="btn-secondary" onClick={closeModal} disabled={modal.loading}>
                    Cancelar
                  </button>
                  <button className="btn-danger" onClick={confirmDeleteDog} disabled={modal.loading}>
                    {modal.loading ? "Eliminando…" : "Confirmar"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>✅ <b>Perro eliminado con éxito</b></p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                  <button className="btn-primary" onClick={closeModal}>
                    Cerrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
