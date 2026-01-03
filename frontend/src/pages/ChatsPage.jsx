// frontend/src/pages/ChatsPage.jsx
// ============================================================
// Lista de chats del usuario
// - UI lista + abrir chat + borrar (si el backend lo soporta)
// - Buscador por nombre (filtra en frontend)
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../helpers/http";
import { isLogged } from "../helpers/auth";
import "../styles/contratar.scss";
import "../styles/chat.scss";

// API base para construir URLs de avatar si vienen como ruta relativa
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");

function normalizeAvatarUrl(url = "") {
  const s = String(url || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${API_BASE}${s}`;
  return `${API_BASE}/${s}`;
}

function fmt(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function initialFromName(name = "") {
  const s = String(name || "").trim();
  if (!s) return "?";
  return s.slice(0, 1).toUpperCase();
}

function getConvId(c = {}) {
  return String(c?.conversationId || c?.id || c?.conversation_id || "").trim();
}

function getTrainerId(c = {}) {
  return String(c?.trainerId || c?.trainer_id || "").trim();
}

function getClientId(c = {}) {
  return String(c?.clientId || c?.client_id || "").trim();
}

function pickOtherParty({ chat, myUserId }) {
  const trainerId = getTrainerId(chat);
  const clientId = getClientId(chat);

  const iAmTrainer = myUserId && trainerId && String(myUserId) === String(trainerId);
  const iAmClient = myUserId && clientId && String(myUserId) === String(clientId);

  // Campos “enriquecidos” si el backend los devuelve (no asumimos que existan)
  const trainerName =
    chat?.trainerName ?? chat?.trainer_name ?? chat?.trainerNombre ?? chat?.trainer_nombre ?? "";
  const trainerEmail = chat?.trainerEmail ?? chat?.trainer_email ?? "";
  const trainerAvatar =
    chat?.trainerAvatar ??
    chat?.trainer_avatar ??
    chat?.trainerPhoto ??
    chat?.trainer_photo ??
    chat?.trainerFoto ??
    chat?.trainer_foto ??
    "";

  const clientName =
    chat?.clientName ?? chat?.client_name ?? chat?.clientNombre ?? chat?.client_nombre ?? "";
  const clientEmail = chat?.clientEmail ?? chat?.client_email ?? "";
  const clientAvatar =
    chat?.clientAvatar ??
    chat?.client_avatar ??
    chat?.clientPhoto ??
    chat?.client_photo ??
    chat?.clientFoto ??
    chat?.client_foto ??
    "";

  // Si el backend ya te pasa “other…”
  const otherName =
    chat?.otherName ?? chat?.other_name ?? chat?.otherUserName ?? chat?.other_user_name ?? "";
  const otherEmail =
    chat?.otherEmail ?? chat?.other_email ?? chat?.otherUserEmail ?? chat?.other_user_email ?? "";
  const otherAvatar =
    chat?.otherAvatar ??
    chat?.other_avatar ??
    chat?.otherPhoto ??
    chat?.other_photo ??
    chat?.otherPhotoUrl ??
    chat?.other_photo_url ??
    "";

  if (otherName || otherEmail || otherAvatar) {
    const label = String(otherName || otherEmail || "Usuario").trim() || "Usuario";
    return {
      id: String(chat?.otherId || chat?.other_id || "").trim(),
      label,
      avatar: String(otherAvatar || "").trim(),
      roleLabel: "Contacto",
    };
  }

  if (iAmTrainer) {
    const label = String(clientName || clientEmail || clientId || "Cliente").trim() || "Cliente";
    return {
      id: clientId,
      label,
      avatar: String(clientAvatar || "").trim(),
      roleLabel: "Cliente",
    };
  }

  if (iAmClient) {
    const label = String(trainerName || trainerEmail || trainerId || "Adiestrador").trim() || "Adiestrador";
    return {
      id: trainerId,
      label,
      avatar: String(trainerAvatar || "").trim(),
      roleLabel: "Adiestrador",
    };
  }

  // fallback si no puedo deducir
  const label = String(trainerName || trainerEmail || trainerId || "Chat").trim() || "Chat";
  return {
    id: trainerId || clientId,
    label,
    avatar: String(trainerAvatar || clientAvatar || "").trim(),
    roleLabel: "Chat",
  };
}

export default function ChatsPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");
  const [items, setItems] = useState([]);
  const [deletingId, setDeletingId] = useState("");

  // ✅ buscador por nombre (frontend)
  const [qName, setQName] = useState("");

  const myUserId = useMemo(() => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return "";
      const payload = JSON.parse(atob(token.split(".")[1] || ""));
      return String(payload?.id || payload?.uid || payload?.sub || "");
    } catch {
      return "";
    }
  }, []);

  const loadChats = async () => {
    setErrMsg("");
    setLoading(true);

    try {
      // Nota: este endpoint lo añadiremos en backend (GET /api/chats)
      const data = await http("/api/chats", { auth: true });
      const arr = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setItems(arr);
    } catch (e) {
      console.error("Error cargando chats:", e);
      const status = e?.status || e?.response?.status;

      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 404) setErrMsg("Tu backend todavía no tiene la ruta para listar chats (GET /api/chats).");
      else setErrMsg("No se pudieron cargar tus chats.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLogged()) {
      navigate("/login?next=/chats", { replace: true });
      return;
    }
    loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openChat = (conversationId) => {
    const id = String(conversationId || "").trim();
    if (!id) return;
    navigate(`/chat/${id}`);
  };

  const deleteChat = async (conversationId) => {
    const id = String(conversationId || "").trim();
    if (!id) return;
    if (deletingId) return;

    const ok = window.confirm(
      "¿Seguro que quieres borrar este chat?\n\nSolo desaparecerá para ti. La otra persona lo seguirá viendo."
    );
    if (!ok) return;

    setDeletingId(id);
    setErrMsg("");

    try {
      // Nota: este endpoint lo añadiremos en backend (DELETE /api/chats/:conversationId)
      await http(`/api/chats/${id}`, { method: "DELETE", auth: true });

      // UI optimista
      setItems((prev) => prev.filter((c) => getConvId(c) !== id));
    } catch (e) {
      console.error("Error borrando chat:", e);
      const status = e?.status || e?.response?.status;

      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 404) setErrMsg("Tu backend todavía no tiene la ruta para borrar chats (DELETE /api/chats/:id).");
      else setErrMsg(e?.data?.error || "No se pudo borrar el chat.");
    } finally {
      setDeletingId("");
    }
  };

  const filtered = useMemo(() => {
    const q = String(qName || "").trim().toLowerCase();
    if (!q) return items;

    return (Array.isArray(items) ? items : []).filter((c) => {
      const other = pickOtherParty({ chat: c, myUserId });
      const label = String(other?.label || "").toLowerCase();
      return label.includes(q);
    });
  }, [items, qName, myUserId]);

  return (
    <div className="contratar-page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <p className="reservas-eyebrow">Mensajería</p>
          <h1 style={{ margin: "4px 0 0" }}>Mis chats</h1>
          <p className="reservas-subtitle" style={{ marginTop: 6 }}>
            Conversaciones entre cliente y adiestrador.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="btn-ghost" type="button" onClick={() => navigate(-1)}>
            Volver
          </button>
          <button className="btn-ghost" type="button" onClick={loadChats} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {errMsg ? (
        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <b>Atención:</b> {errMsg}
        </div>
      ) : null}

      {/* Buscador por nombre */}
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Buscar por nombre</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
          Escribe el nombre del usuario.
        </div>

        <input
          value={qName}
          onChange={(e) => setQName(e.target.value)}
          placeholder="Ej: Laura, Pedro, Ana…"
          style={{
            width: "100%",
            borderRadius: 999,
            border: "1px solid #f0d7c7",
            padding: "10px 14px",
            fontSize: 13,
            outline: "none",
            background: "#fffdfb",
          }}
        />
      </div>

      {/* Lista */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div className="card" style={{ padding: 14 }}>
            Cargando tus chats…
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ padding: 14 }}>
            {String(qName || "").trim()
              ? "No se encontraron chats con ese nombre."
              : "No tienes chats todavía."}
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Normalmente se crean al abrir el chat desde una reserva.
            </div>
          </div>
        ) : (
          filtered.map((c) => {
            const id = getConvId(c);
            const other = pickOtherParty({ chat: c, myUserId });

            const avatarUrl = normalizeAvatarUrl(other.avatar);
            const initial = initialFromName(other.label);

            const lastPreview = String(
              c?.lastMessagePreview ??
                c?.last_message_preview ??
                c?.lastMessage ??
                c?.last_message ??
                ""
            ).trim();

            const lastAt =
              c?.lastMessageAt ??
              c?.last_message_at ??
              c?.updatedAt ??
              c?.updated_at ??
              c?.createdAt ??
              c?.created_at ??
              "";

            return (
              <div key={id || Math.random()} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div className="df-msg__avatar" aria-hidden="true">
                    {avatarUrl ? (
                      <img className="df-msg__avatarImg" src={avatarUrl} alt="" />
                    ) : (
                      <span className="df-msg__avatarInitial">{initial}</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div
                        style={{
                          fontWeight: 900,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {other.label} <span style={{ fontSize: 12, opacity: 0.6 }}>· {other.roleLabel}</span>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: "nowrap" }}>
                        {fmt(lastAt)}
                      </div>
                    </div>

                    <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                      {lastPreview ? lastPreview : <span style={{ opacity: 0.6 }}>(Sin texto)</span>}
                    </div>

                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6, wordBreak: "break-all" }}>
                      ID: {id || "(sin id)"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn-primary" type="button" onClick={() => openChat(id)} disabled={!id}>
                      Abrir
                    </button>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => deleteChat(id)}
                      disabled={!id || deletingId === id}
                      title="Borrar chat (solo para ti)"
                    >
                      {deletingId === id ? "Borrando…" : "Borrar"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
