import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { http } from "../helpers/http";
import { useUi } from "../context/ui";
import "../styles/contratar.scss";

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const absUrl = (u = "") =>
  !u ? "" : /^https?:\/\//i.test(u) ? u : `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`;

function fmt(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function fmtDateOnly(v) {
  if (!v) return "";
  try {
    // nacimiento suele venir como YYYY-MM-DD
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }
    return s;
  } catch {
    return String(v);
  }
}

export default function TrainerClientDetail() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const ui = useUi();

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [notice, setNotice] = useState({ type: "", text: "" });

  // notas
  const [notes, setNotes] = useState([]);
  const [dogFilter, setDogFilter] = useState(""); // "" => todas
  const [newDogId, setNewDogId] = useState("");
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);

  // edición nota
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");

  const showError = (t) => setNotice({ type: "error", text: t });
  const showSuccess = (t) => setNotice({ type: "success", text: t });

  const loadClient = async () => {
    setLoading(true);
    setNotice({ type: "", text: "" });
    try {
      const data = await http(`/api/trainers/me/clients/${clientId}`, { auth: true });
      setClient(data);
    } catch (e) {
      console.error(e);
      showError("No se pudo cargar el cliente (o no tienes permisos).");
      setClient(null);
    } finally {
      setLoading(false);
    }
  };

  const loadNotes = async () => {
    if (!clientId) return;
    try {
      const data = await http(`/api/trainer-notes`, {
        auth: true,
        query: {
          clientId,
        },
      });

      const arr = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setNotes(arr);
    } catch (e) {
      console.error(e);
      // Importante: este endpoint solo lo ve el adiestrador
      showError("No se pudieron cargar las notas privadas.");
      setNotes([]);
    }
  };

  useEffect(() => {
    if (!clientId) return;
    loadClient();
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Ajuste: por defecto, al entrar, ponemos el select de “nuevo” en el filtro actual
  useEffect(() => {
    setNewDogId(dogFilter);
  }, [dogFilter]);

  const dogs = Array.isArray(client?.perros) ? client.perros : [];

  // Perfil del cliente (normalizado)
  const clientProfile = client?.profile || client || {};
  const clientPhoto = absUrl(clientProfile.foto || clientProfile.avatarURL || "");
  const clientPhone = String(clientProfile.telefono || "").trim();
  const clientPrefix = String(clientProfile.prefix || "").trim();
  const clientAddress = String(clientProfile.direccion || "").trim();
  const clientProfileNotes = String(
    clientProfile.notas || client?.profileNotes || ""
  ).trim();

  const dogNameById = useMemo(() => {
    const m = new Map();
    for (const d of dogs) m.set(String(d.id), d.nombre || "Perro");
    return m;
  }, [dogs]);

  const filteredNotes = useMemo(() => {
    const arr = Array.isArray(notes) ? notes : [];
    if (!dogFilter) return arr;
    return arr.filter((n) => String(n.dogId || "") === String(dogFilter));
  }, [notes, dogFilter]);

  const openChat = async () => {
    try {
      const resp = await http(`/api/chats/by-client/${clientId}`, {
        method: "POST",
        auth: true,
      });
      const conversationId = resp?.conversationId || resp?.id;
      if (!conversationId) {
        showError("No se pudo abrir el chat (sin conversationId)");
        return;
      }
      navigate(`/chat/${conversationId}`);
    } catch (e) {
      console.error(e);
      showError("No se pudo abrir el chat con este cliente.");
    }
  };

  const createNote = async (e) => {
    e.preventDefault();
    if (saving) return;
    const text = String(newText || "").trim();
    if (!text) {
      showError("Escribe una nota antes de guardar.");
      return;
    }
    setSaving(true);
    try {
      await http(`/api/trainer-notes`, {
        method: "POST",
        auth: true,
        data: {
          clientId,
          dogId: newDogId || null,
          text,
        },
      });
      setNewText("");
      showSuccess("Nota guardada.");
      await loadNotes();
    } catch (e2) {
      console.error(e2);
      showError(e2?.data?.error || "No se pudo guardar la nota.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (note) => {
    setEditingId(note.id);
    setEditingText(note.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async (noteId) => {
    const text = String(editingText || "").trim();
    if (!text) {
      showError("El texto no puede estar vacío.");
      return;
    }
    try {
      await http(`/api/trainer-notes/${noteId}`, {
        method: "PATCH",
        auth: true,
        data: { text },
      });
      showSuccess("Nota actualizada.");
      cancelEdit();
      await loadNotes();
    } catch (e) {
      console.error(e);
      showError(e?.data?.error || "No se pudo actualizar la nota.");
    }
  };

  const deleteNote = async (noteId) => {
    const ok = await ui.confirm({
      title: 'Borrar nota',
      message: '¿Borrar esta nota privada?',
      confirmText: 'Borrar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await http(`/api/trainer-notes/${noteId}`, {
        method: "DELETE",
        auth: true,
      });
      showSuccess("Nota borrada.");
      await loadNotes();
    } catch (e) {
      console.error(e);
      showError(e?.data?.error || "No se pudo borrar la nota.");
    }
  };

  return (
    <div className="reservas-page">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn-secondary" type="button" onClick={() => navigate("/trainer/clientes")}>← Volver</button>

        <h2 style={{ margin: 0 }}>Cliente</h2>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-primary" type="button" onClick={openChat}>💬 Abrir chat</button>
        </div>
      </div>

      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : !client ? (
        <p>No se pudo cargar el cliente.</p>
      ) : (
        <>
          {/* ===== Perfil del cliente ===== */}
          <div
            style={{
              marginTop: 14,
              padding: 16,
              border: "1px solid #d8dbe0",
              borderRadius: 12,
              background: "#fff",
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              {/* Foto */}
              <div style={{ width: 92, height: 92, flex: "0 0 auto" }}>
                {clientPhoto ? (
                  <img
                    src={clientPhoto}
                    alt="foto cliente"
                    style={{
                      width: 92,
                      height: 92,
                      borderRadius: 14,
                      objectFit: "cover",
                      border: "1px solid rgba(0,0,0,0.08)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 92,
                      height: 92,
                      borderRadius: 14,
                      background: "rgba(0,0,0,0.06)",
                      display: "grid",
                      placeItems: "center",
                      color: "rgba(0,0,0,0.55)",
                      fontWeight: 700,
                      border: "1px solid rgba(0,0,0,0.08)",
                    }}
                    title="Sin foto"
                  >
                    👤
                  </div>
                )}
              </div>

              {/* Datos */}
              <div style={{ display: "grid", gap: 6, minWidth: 240, flex: "1 1 280px" }}>
                <div style={{ display: "grid", gap: 2 }}>
                  <h3 style={{ margin: 0 }}>{client.nombre || client.email}</h3>
                  <p style={{ margin: 0, opacity: 0.75 }}>{client.email}</p>
                </div>

                <div style={{ display: "grid", gap: 4 }}>
                  <div>
                    <b>Teléfono:</b>{" "}
                    {clientPhone ? `${clientPrefix || ""}${clientPrefix && clientPhone ? " " : ""}${clientPhone}` : "—"}
                  </div>
                  <div>
                    <b>Dirección:</b> {clientAddress || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Notas del perfil (del cliente) */}
            {clientProfileNotes ? (
              <div>
                <b>Notas del cliente (perfil)</b>
                <div
                  style={{
                    marginTop: 6,
                    whiteSpace: "pre-wrap",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.08)",
                    background: "#fbfbfb",
                  }}
                >
                  {clientProfileNotes}
                </div>
              </div>
            ) : null}

            {/* Perros */}
            <div style={{ display: "grid", gap: 10 }}>
              <b>Perros del cliente</b>
              {dogs.length === 0 ? (
                <p style={{ margin: 0, opacity: 0.7 }}>No hay perros registrados.</p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {dogs.map((d) => {
                    const dogPhoto = absUrl(d.avatarURL || "");
                    const born = fmtDateOnly(d.nacimiento);
                    return (
                      <div
                        key={d.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          padding: 12,
                          background: "#fffdfb",
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div style={{ width: 82, height: 82, flex: "0 0 auto" }}>
                            {dogPhoto ? (
                              <img
                                src={dogPhoto}
                                alt={d.nombre || "perro"}
                                style={{
                                  width: 82,
                                  height: 82,
                                  borderRadius: 14,
                                  objectFit: "cover",
                                  border: "1px solid rgba(0,0,0,0.08)",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 82,
                                  height: 82,
                                  borderRadius: 14,
                                  background: "rgba(0,0,0,0.06)",
                                  display: "grid",
                                  placeItems: "center",
                                  color: "rgba(0,0,0,0.55)",
                                  fontWeight: 700,
                                  border: "1px solid rgba(0,0,0,0.08)",
                                }}
                                title="Sin foto"
                              >
                                🐶
                              </div>
                            )}
                          </div>

                          <div style={{ display: "grid", gap: 6, flex: "1 1 260px", minWidth: 220 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 800, fontSize: 16 }}>{d.nombre || "Perro"}</span>
                              {d.raza ? <span style={{ opacity: 0.75 }}>{d.raza}</span> : null}
                            </div>

                            <div style={{ display: "grid", gap: 4 }}>
                              <div>
                                <b>Nacimiento:</b> {born || "—"}
                              </div>
                              <div>
                                <b>Castrado:</b> {d.castrado ? "Sí" : "No"}
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", opacity: 0.75, fontSize: 12 }}>
                              {d.createdAt ? <span>Creado: {fmt(d.createdAt)}</span> : null}
                              {d.updatedAt ? <span>Actualizado: {fmt(d.updatedAt)}</span> : null}
                            </div>
                          </div>
                        </div>

                        {d.notas ? (
                          <div>
                            <b>Notas del perro (perfil)</b>
                            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{d.notas}</div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ===== Notas privadas ===== */}
          <div
            style={{
              marginTop: 16,
              padding: 16,
              border: "1px solid #d8dbe0",
              borderRadius: 12,
              background: "#fff",
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>🗒️ Notas privadas</h3>
              <span style={{ opacity: 0.7, fontSize: 13 }}>(solo las ve el adiestrador)</span>
            </div>

            {/* Filtro por perro */}
            <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
              <label style={{ fontWeight: 600 }}>Filtrar por perro</label>
              <select value={dogFilter} onChange={(e) => setDogFilter(e.target.value)}>
                <option value="">Todos (incluye notas generales)</option>
                {dogs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </div>

            {/* Crear nota */}
            <form onSubmit={createNote} style={{ display: "grid", gap: 8, maxWidth: 720 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontWeight: 600 }}>Asignar nota a</label>
                <select value={newDogId} onChange={(e) => setNewDogId(e.target.value)}>
                  <option value="">Nota general (sin perro)</option>
                  {dogs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                rows={4}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Escribe una nota privada (no se envía al chat)…"
              />

              <button className="btn-primary" type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar nota"}
              </button>
            </form>

            {/* Lista */}
            <div style={{ display: "grid", gap: 10 }}>
              {filteredNotes.length === 0 ? (
                <p style={{ opacity: 0.7, margin: 0 }}>No hay notas para este filtro.</p>
              ) : (
                filteredNotes.map((n) => {
                  const dogLabel = n.dogId ? dogNameById.get(String(n.dogId)) || "Perro" : "General";
                  return (
                    <div
                      key={n.id}
                      style={{
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 10,
                        padding: 12,
                        background: "#fffdfb",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{dogLabel}</span>
                          <span style={{ opacity: 0.65, fontSize: 12 }}>{fmt(n.createdAt)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          {editingId === n.id ? (
                            <>
                              <button className="btn-secondary" type="button" onClick={() => saveEdit(n.id)}>Guardar</button>
                              <button className="btn-outline" type="button" onClick={cancelEdit}>Cancelar</button>
                            </>
                          ) : (
                            <>
                              <button className="btn-secondary" type="button" onClick={() => startEdit(n)}>Editar</button>
                              <button className="btn-outline" type="button" onClick={() => deleteNote(n.id)}>Borrar</button>
                            </>
                          )}
                        </div>
                      </div>

                      {editingId === n.id ? (
                        <textarea
                          rows={4}
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                        />
                      ) : (
                        <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
