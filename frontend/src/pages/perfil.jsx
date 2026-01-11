// frontend/src/pages/Perfil.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { useAuth } from "../context/auth";
import { useUi } from "../context/ui";

function nowIso() {
  return new Date().toISOString();
}

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const absUrl = (u = "") =>
  !u ? "" : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`;

export default function PerfilPage() {
  const navigate = useNavigate();
  const ui = useUi();

  const { isAuthenticated, loading: authLoading, logout } = useAuth();

  // ===== sesión =====
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");

  // ===== auth/me (para rol) =====
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (authLoading) return;

    if (!isAuthenticated) {
      setAuthReady(false);
      navigate("/login?next=/perfil", { replace: true });
      return;
    }

    setAuthReady(true);
  }, [authLoading, isAuthenticated, navigate]);

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
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountMsg, setAccountMsg] = useState("");

  // ===== perfil adiestrador (trainer_profiles) =====
  const [trainerProfile, setTrainerProfile] = useState({
    displayName: "",
    bio: "",
    photoUrl: "",
    experienceYears: null,
    specialties: [],
    exists: false,
  });
  const [trainerLoading, setTrainerLoading] = useState(false);
  const [trainerMsg, setTrainerMsg] = useState("");
  const [specInput, setSpecInput] = useState("");

  const roleLower = useMemo(
    () => (me?.rol || me?.role || "").toString().toLowerCase().trim(),
    [me]
  );

  const isTrainer = useMemo(() => roleLower === "adiestrador", [roleLower]);
  const isAdmin = useMemo(() => roleLower === "admin", [roleLower]);
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

  // ======== CAMBIO DE CONTRASEÑA =========
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatNewPassword, setRepeatNewPassword] = useState("");
  const [passMsg, setPassMsg] = useState("");
  const [passError, setPassError] = useState("");
  const [changingPass, setChangingPass] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (changingPass) return;

    setPassMsg("");
    setPassError("");

    if (!currentPassword || !newPassword || !repeatNewPassword) {
      setPassError("Rellena todos los campos.");
      return;
    }

    if (newPassword !== repeatNewPassword) {
      setPassError("Las contraseñas nuevas no coinciden.");
      return;
    }

    const hasLetter = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(String(newPassword));
    const hasNumber = /\d/.test(String(newPassword));

    if (String(newPassword).length < 8 || !hasLetter || !hasNumber) {
      setPassError("La contraseña debe tener al menos 8 caracteres e incluir letras y números.");
      return;
    }

    setChangingPass(true);
    try {
      await http("/api/auth/password", {
        method: "PATCH",
        data: {
          currentPassword,
          newPassword,
        },
        auth: true,
      });

      setPassMsg("Contraseña actualizada correctamente.");
      setCurrentPassword("");
      setNewPassword("");
      setRepeatNewPassword("");
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const backendMsg = err?.data?.error || err?.response?.data?.error || "";

      if (status === 400) {
        setPassError(backendMsg || "Petición incorrecta.");
      } else if (status === 401) {
        setPassError("Tu sesión ha expirado. Inicia sesión otra vez.");
      } else if (status === 404) {
        setPassError("Usuario no encontrado.");
      } else {
        setPassError("No se pudo actualizar la contraseña.");
      }
    } finally {
      setChangingPass(false);
    }
  };

  // ===== cargar datos =====
const loadMe = async () => {
  try {
    // Probamos varias rutas porque tu proyecto mezcla /api y sin /api en otras llamadas
    let data = null;

    try {
      data = await http("/api/auth/me", { auth: true });
    } catch {
      // fallback
      data = await http("/auth/me", { auth: true });
    }

    // Normalizamos rol venga donde venga
    const role =
      data?.rol ||
      data?.role ||
      data?.user?.rol ||
      data?.user?.role ||
      data?.me?.rol ||
      data?.me?.role ||
      data?.profile?.rol ||
      data?.profile?.role ||
      null;

    setMe({ ...(data || {}), role, rol: role });

    // DEBUG (déjalo hasta que lo veas bien)
    console.log("[auth/me] raw:", data);
    console.log("[auth/me] normalized role:", role);

    return role;
  } catch (e) {
    console.log("[auth/me] error:", e);
    setMe(null);
    return null;
  }
};

  const loadProfile = async () => {
    try {
      const data = await http("/perfil", { auth: true });
      const prof = data?.profile || data || {};
      const roleFromProfile = prof?.rol || prof?.role || data?.rol || data?.role || null;
if (roleFromProfile) {
  setMe((prev) => ({ ...(prev || {}), rol: roleFromProfile, role: roleFromProfile }));
  console.log("[perfil] roleFromProfile:", roleFromProfile);
}
      setEmail(data?.email || prof?.email || "");

      setPerfil({
        displayName: prof.displayName || prof.nombre || "",
        prefix: String(prof.prefix || "+34")
          .replace(/[^\d+]/g, "")
          .replace(/(?!^)\+/g, ""),
        phone: String(prof.phone || prof.telefono || "").replace(/\D/g, ""),
        address: prof.address || prof.direccion || "",
        avatarURL: absUrl(prof.avatarURL ?? prof.foto ?? ""),
        notes: prof.notes || prof.notas || "",
      });
    } catch {
      // mantener valores por defecto
    }
  };

  const loadTrainerProfile = async () => {
    if (!isTrainer) return;

    try {
      setTrainerLoading(true);
      setTrainerMsg("");

      const data = await http("/api/trainers/me/profile", { auth: true });

      setTrainerProfile({
        displayName: data?.displayName || "",
        bio: data?.bio || "",
        photoUrl: data?.photoUrl || "",
        experienceYears:
          data?.experienceYears === null || data?.experienceYears === undefined
            ? null
            : Number(data.experienceYears),
        specialties: Array.isArray(data?.specialties) ? data.specialties : [],
        exists: !!data?.exists,
      });
    } catch (e) {
      // si falla no rompemos
      console.error(e);
    } finally {
      setTrainerLoading(false);
    }
  };

  const loadDogs = async () => {
    try {
      const list = await http("/perros", { auth: true });
      const arr = Array.isArray(list?.items) ? list.items : list || [];
      arr.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
      const norm = arr.map((d) => ({
        ...d,
        avatarURL: absUrl(d.avatarURL || d.foto || ""),
      }));
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
      const role = await loadMe();
      await loadProfile();

      // Admin: en este proyecto solo debería poder cambiar contraseña desde este apartado.
      if (String(role || "").toLowerCase().trim() === "admin") {
        setPerros([]);
        setCreatingDog(false);
        return;
      }

      await loadDogs();
    })();
  }, [authReady]);

  // si cambia isTrainer (porque loadMe llega después), cargamos trainer profile
  useEffect(() => {
    if (!authReady) return;
    if (!isTrainer) return;
    loadTrainerProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, isTrainer]);

  // ===== guardar perfil normal =====
  const saveProfileOnly = async () => {
    setPMsg("");
    try {
      const cleanPrefix = (perfil.prefix || "+34")
        .replace(/[^\d+]/g, "")
        .replace(/(?!^)\+/g, "");
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
          email,
        },
        auth: true,
      });

      setPerfil((p) => ({ ...p, prefix: cleanPrefix, phone: cleanPhone }));
      return true;
    } catch {
      return false;
    }
  };

  // ===== guardar perfil adiestrador =====
  const saveTrainerProfile = async () => {
    try {
      setTrainerMsg("");

      const exp =
        trainerProfile.experienceYears === null ||
        trainerProfile.experienceYears === undefined ||
        trainerProfile.experienceYears === ""
          ? null
          : Number(trainerProfile.experienceYears);

      const payload = {
        displayName: String(trainerProfile.displayName || "").trim(),
        bio: String(trainerProfile.bio || "").trim(),
        photoUrl: String(trainerProfile.photoUrl || "").trim(),
        experienceYears: exp,
        specialties: Array.isArray(trainerProfile.specialties)
          ? trainerProfile.specialties
          : [],
      };

      await http("/api/trainers/me/profile", {
        method: "POST",
        data: payload,
        auth: true,
      });

      setTrainerMsg("✅ Perfil de adiestrador guardado");
      return true;
    } catch (e) {
      console.error(e);
      setTrainerMsg("❌ No se pudo guardar el perfil de adiestrador");
      return false;
    }
  };

  // ===== guardar TODO (un único botón) =====
  const saveAll = async () => {
    if (savingProfile) return;
    setSavingProfile(true);
    setPMsg("");

    const okUser = await saveProfileOnly();
    let okTrainer = true;

    if (isTrainer) {
      okTrainer = await saveTrainerProfile();
    }

    if (okUser && okTrainer) setPMsg("✅ Perfil guardado");
    else if (!okUser) setPMsg("❌ No se pudo guardar el perfil");
    else if (!okTrainer) setPMsg("⚠️ Perfil guardado, pero faltó guardar el perfil de adiestrador");

    setSavingProfile(false);
  };

  // ===== subida de archivos =====
  async function uploadImage(file) {
    const form = new FormData();
    form.append("file", file);

    const token = localStorage.getItem("token");

    const res = await fetch(`${API_BASE}/api/upload-db`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });

    if (!res.ok) {
      let err;
      try {
        err = await res.json();
      } catch {
        err = {};
      }
      throw new Error(err.error || "No se pudo subir la imagen");
    }

    const data = await res.json();
    const url = data?.url;
    if (!url) throw new Error("No se recibió URL de imagen");
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
  // ===== ELIMINAR CUENTA (cliente desde perfil) =====
  const onDeleteAccount = async () => {
    const ok = await ui.confirm({
      title: "Eliminar cuenta",
      message: "¿Seguro que quieres eliminar tu cuenta? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    setDeletingAccount(true);
    setAccountMsg("");

    try {
      await http("/auth/me", { method: "DELETE", auth: true });

      ui.notify({
        type: "success",
        title: "Cuenta eliminada",
        message: "Cuenta eliminada. Te hemos enviado un correo de confirmación.",
      });

      setAccountMsg("✅ Cuenta eliminada. Te hemos enviado un correo de confirmación.");
      logout();
      setAuthReady(false);
      navigate("/", { replace: true });
    } catch (err) {
      console.error(err);

      ui.notify({
        type: "error",
        title: "No se pudo eliminar",
        message: err?.message || "No se pudo eliminar la cuenta.",
      });

      setAccountMsg("❌ No se pudo eliminar la cuenta");
    } finally {
      setDeletingAccount(false);
    }
  };

  // ===== ESPECIALIDADES (adiestrador) =====
  const addSpecialty = () => {
    const value = String(specInput || "").trim();
    if (!value) return;

    setTrainerProfile((prev) => {
      const exists = (prev.specialties || []).some(
        (s) => String(s).toLowerCase() === value.toLowerCase()
      );
      if (exists) return prev;
      return { ...prev, specialties: [...(prev.specialties || []), value] };
    });
    setSpecInput("");
  };

  const removeSpecialty = (idx) => {
    setTrainerProfile((prev) => ({
      ...prev,
      specialties: (prev.specialties || []).filter((_, i) => i !== idx),
    }));
  };

  // ===== crear / editar perro =====
  const startCreateDog = () => {
    setEditingDogId("");
    setDogForm(emptyDog);
    setCreatingDog(true);
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
        await http("/perros", { method: "POST", data: base, auth: true });
        await loadDogs();
        setDMsg("✅ Perro guardado");
      } else {
        await http(`/perros/${editingDogId}`, {
          method: "PATCH",
          data: base,
          auth: true,
        });
        await loadDogs();
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

  // ===== foto perro =====
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

  // ===== eliminar perro =====
  const askDeleteDog = (dog) =>
    setModal({ open: true, dog, success: false, loading: false, error: "" });

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

  if (!authReady) {
    return (
      <div className="perfil-page">
        <div className="perfil-container">
          <div className="perfil-card">Cargando sesión…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="perfil-page">
      <div className="perfil-container">
        {/* Cabecera */}
        <header className="perfil-header">
          <h1 className="perfil-title">Mi perfil</h1>
          {isAdmin ? (
            <p className="perfil-lead">
              Desde aquí puedes actualizar tu contraseña de acceso.
            </p>
          ) : (
            <p className="perfil-lead">
              Gestiona tus datos personales y la información de tus perros. Estos datos se compartirán
              con los centros cuando hagas una reserva.
            </p>
          )}
        </header>

        {/* DATOS USUARIO */}
        {!isAdmin && (
          <section className="perfil-card perfil-card--user">
          <h2 className="perfil-card__title">Datos del usuario</h2>

          <div className="perfil-user-grid">
            {/* Avatar */}
            <div className="perfil-avatar">
              <div className="perfil-avatar__circle">
                {perfil.avatarURL ? (
                  <img src={absUrl(perfil.avatarURL)} alt="avatar" className="perfil-avatar__img" />
                ) : (
                  <span className="perfil-avatar__placeholder">Sin foto</span>
                )}
              </div>
              <div className="perfil-avatar__actions">
                <label className="btn-ghost">
                  
                  {perfil.avatarURL ? "Cambiar foto" : "Añadir foto"}
                  <input type="file" accept="image/*" onChange={handlePickProfile} style={{ display: "none" }} />
                </label>
                {perfil.avatarURL && (
                  <button className="btn-danger" onClick={onDeleteProfilePhoto}>
                    Eliminar foto
                  </button>
                )}
              </div>
            </div>

            {/* Campos */}
            <div className="perfil-user-fields">
              <label>
                Nombre (obligatorio)
                <input
                  required
                  value={perfil.displayName}
                  onChange={(e) => setPerfil((p) => ({ ...p, displayName: e.target.value }))}
                  placeholder="Tu nombre"
                />
              </label>

              <div className="perfil-phone-group">
                <span>Teléfono (obligatorio)</span>
                <div className="perfil-phone-row">
                  <input
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
                    value={perfil.phone}
                    onChange={(e) => setPerfil((p) => ({ ...p, phone: e.target.value.replace(/\D/g, "") }))}
                    placeholder="600123123"
                  />
                </div>
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

              <div className="perfil-actions">
                <button
                  className="btn-primary"
                  onClick={saveAll}
                  disabled={!perfil.displayName?.trim() || !perfil.phone?.trim() || savingProfile}
                >
                  {savingProfile ? "Guardando…" : "Guardar perfil"}
                </button>
                {pMsg && <span className="perfil-msg">{pMsg}</span>}
              </div>
            </div>
          </div>
          </section>
        )}

        {/* PERFIL ADIESTRADOR (solo rol adiestrador) */}
        {!isAdmin && isTrainer && (
          <section className="perfil-card perfil-card--trainer">
            <h2 className="perfil-card__title">Perfil de adiestrador</h2>

            {trainerLoading ? (
              <p className="perfil-msg">Cargando datos de adiestrador…</p>
            ) : (
              <>
                <div className="perfil-trainer-grid">
                  <label>
                    Nombre público (opcional)
                    <input
                      value={trainerProfile.displayName}
                      onChange={(e) =>
                        setTrainerProfile((p) => ({
                          ...p,
                          displayName: e.target.value,
                        }))
                      }
                      placeholder="Ej: Federico Pérez"
                    />
                  </label>

                  <label>
                    Años de experiencia (opcional)
                    <input
                      type="number"
                      min="0"
                      value={trainerProfile.experienceYears ?? ""}
                      onChange={(e) =>
                        setTrainerProfile((p) => ({
                          ...p,
                          experienceYears: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                      placeholder="Ej: 5"
                    />
                  </label>
                </div>

                <label style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  Descripción (opcional)
                  <textarea
                    value={trainerProfile.bio}
                    onChange={(e) => setTrainerProfile((p) => ({ ...p, bio: e.target.value }))}
                    placeholder="Describe tu experiencia, metodología, etc."
                    rows={4}
                  />
                </label>

                <div className="perfil-specialties">
                  <div className="perfil-specialties__head">
                    <div>
                      <h3 className="perfil-specialties__title">Especialidades</h3>
                      <p className="perfil-specialties__hint">
                        Estas especialidades se mostrarán en “Adiestradores”.
                      </p>
                    </div>

                    <div className="perfil-specialties__add">
                      <input
                        value={specInput}
                        onChange={(e) => setSpecInput(e.target.value)}
                        placeholder="Ej: Ansiedad por separación"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addSpecialty();
                          }
                        }}
                      />
                      <button type="button" className="btn-secondary" onClick={addSpecialty}>
                        Añadir
                      </button>
                    </div>
                  </div>

                  {trainerProfile.specialties?.length > 0 ? (
                    <div className="perfil-specialties__chips">
                      {trainerProfile.specialties.map((s, idx) => (
                        <span key={`${s}-${idx}`} className="perfil-specialties__chip">
                          {s}
                          <button
                            type="button"
                            className="perfil-specialties__remove"
                            onClick={() => removeSpecialty(idx)}
                            aria-label={`Eliminar ${s}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="perfil-msg">Aún no has añadido especialidades.</p>
                  )}

                  {trainerMsg && <p className="perfil-msg" style={{ marginTop: 10 }}>{trainerMsg}</p>}
                </div>
              </>
            )}
          </section>
        )}

        {/* CAMBIAR CONTRASEÑA */}
        <section className="perfil-card perfil-card--password">
          <h2 className="perfil-card__title">Cambiar contraseña</h2>

          <form onSubmit={handleChangePassword} className="perfil-password-form">
            <label>
              Contraseña actual
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            <label>
              Nueva contraseña
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            <label>
              Repetir nueva contraseña
              <input
                type="password"
                value={repeatNewPassword}
                onChange={(e) => setRepeatNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>

            {passError && <p className="perfil-pass-error">{passError}</p>}
            {passMsg && !passError && <p className="perfil-pass-success">{passMsg}</p>}

            <button className="btn-primary" type="submit" disabled={changingPass} style={{ marginTop: 8 }}>
              {changingPass ? "Guardando…" : "Actualizar contraseña"}
            </button>
          </form>
        </section>

        {/* MIS PERROS */}
        {!isAdmin && (
          <section className="perfil-card perfil-card--dogs">
          <div className="perfil-dogs-header">
            <h2 className="perfil-card__title">Mis perros</h2>
            {!creatingDog && (
              <button className="btn-primary" onClick={startCreateDog}>
                Añadir perro
              </button>
            )}
          </div>

          {(creatingDog || perros.length === 0) && (
            <div className="perfil-dog-editor">
              <h3>{editingDogId ? "Editar perro" : "Añadir perro"}</h3>
              <p className="perfil-dog-editor__hint">
                * La <b>fecha de nacimiento</b> puede ser <b>(aproximada)</b> si es rescatado.
              </p>

              <div className="perfil-dog-editor__grid">
                {/* Foto perro */}
                <div>
                  <div className="perfil-dog-photo__frame">
                    {dogForm.avatarURL ? (
                      <img src={absUrl(dogForm.avatarURL)} alt="perro" className="perfil-dog-photo__img" />
                    ) : (
                      <span className="perfil-avatar__placeholder">Sin foto</span>
                    )}
                  </div>
                  <div className="perfil-dog-photo__actions">
                    <label className="btn-ghost">
                      {dogForm.avatarURL ? "Cambiar foto" : "Añadir foto"}
                      <input type="file" accept="image/*" onChange={handlePickDog} style={{ display: "none" }} />
                    </label>
                    {dogForm.avatarURL && (
                      <button className="btn-danger" onClick={onDeleteDogPhoto}>
                        Eliminar foto
                      </button>
                    )}
                  </div>
                </div>

                {/* Campos perro 1 */}
                <div className="perfil-dog-fields">
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

                {/* Campos perro 2 */}
                <div className="perfil-dog-fields">
                  <label>
                    Fecha de nacimiento (aproximada) (obligatoria)
                    <input
                      required
                      type="date"
                      value={dogForm.nacimiento}
                      onChange={(e) => setDogForm((f) => ({ ...f, nacimiento: e.target.value }))}
                    />
                  </label>
                  <label className="perfil-dog-check">
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

              <div className="perfil-dog-editor__actions perfil-actions">
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
                {dMsg && <span className="perfil-msg">{dMsg}</span>}
              </div>
            </div>
          )}

          {/* Lista perros */}
          {!creatingDog && perros.length > 0 && (
            <div className="perfil-dogs-list">
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
                    <div className="admin-actions perfil-dogs-actions">
                      <button className="btn-ghost" onClick={() => editDog(p)}>
                        Editar
                      </button>
                      <button className="btn-danger" onClick={() => askDeleteDog(p)}>
                        Eliminar
                      </button>
                    </div>
                    {p.avatarURL && (
                      <div className="perfil-dog-list-photo">
                        <img src={absUrl(p.avatarURL)} alt={p.nombre} className="perfil-dog-list-photo__img" />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </section>
        )}

        {/* ELIMINAR CUENTA */}
        {!isAdmin && (
          <section className="perfil-card perfil-card--danger">
            <h2 className="perfil-card__title">Eliminar cuenta</h2>
            <p className="perfil-muted">
              Esto eliminará tu cuenta y tus credenciales de acceso. Esta acción no se puede deshacer.
            </p>
            <div className="perfil-actions">
              <button className="btn-danger" onClick={onDeleteAccount} disabled={deletingAccount}>
                {deletingAccount ? "Eliminando…" : "Eliminar mi cuenta"}
              </button>
              {accountMsg && <span className="perfil-msg">{accountMsg}</span>}
            </div>
          </section>
        )}

        {/* Modal eliminar */}
        {modal.open && (
          <div className="perfil-modal" onClick={() => !modal.loading && closeModal()}>
            <div className="perfil-modal__content" onClick={(e) => e.stopPropagation()}>
              {!modal.success ? (
                <>
                  <p>
                    ¿Seguro que quieres eliminar a <b>{modal.dog?.nombre}</b>?
                  </p>
                  {modal.error && (
                    <p className="perfil-pass-error" style={{ marginTop: 6 }}>
                      {modal.error}
                    </p>
                  )}
                  <div className="perfil-modal__actions">
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
                  <p>
                    ✅ <b>Perro eliminado con éxito</b>
                  </p>
                  <div className="perfil-modal__actions">
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
    </div>
  );
}
