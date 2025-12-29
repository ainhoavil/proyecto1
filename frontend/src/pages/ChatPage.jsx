// frontend/src/pages/ChatPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { http } from "../helpers/http";
import { isLogged } from "../helpers/auth";
import "../styles/contratar.scss";
import "../styles/chat.scss";

// util
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

function initials(id = "") {
  const s = String(id).trim();
  if (!s) return "?";
  return s.slice(0, 2).toUpperCase();
}

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [errMsg, setErrMsg] = useState("");

  const myUserId = useMemo(() => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return "";
      const payload = JSON.parse(atob(token.split(".")[1] || ""));
      return String(payload?.id || payload?.uid || "");
    } catch {
      return "";
    }
  }, []);

  const listRef = useRef(null);

  const scrollToBottom = (smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    try {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    } catch {
      // ignore
    }
  };

  const loadMessages = async () => {
    if (!conversationId) return;
    setErrMsg("");
    setLoading(true);
    try {
      const data = await http(`/api/chats/${conversationId}/messages`, { auth: true });
      const arr = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setItems(arr);
      setTimeout(() => scrollToBottom(false), 0);
    } catch (e) {
      console.error("Error cargando mensajes:", e);
      const status = e?.status || e?.response?.status;
      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 403) setErrMsg("No tienes permisos para ver este chat.");
      else if (status === 404) setErrMsg("Chat no encontrado.");
      else setErrMsg("No se pudieron cargar los mensajes.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLogged()) {
      navigate(`/login?next=/chat/${conversationId || ""}`, { replace: true });
      return;
    }
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const send = async () => {
    if (!conversationId) return;
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    setErrMsg("");
    try {
      await http(`/api/chats/${conversationId}/messages`, {
        method: "POST",
        auth: true,
        data: { body },
      });

      setText("");
      await loadMessages();
      setTimeout(() => scrollToBottom(true), 0);
    } catch (e) {
      console.error("Error enviando mensaje:", e);
      const status = e?.status || e?.response?.status;
      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 403) setErrMsg("No tienes permisos para enviar mensajes aquí.");
      else setErrMsg("No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    send();
  };

  return (
    <div className="df-chat">
      {/* Header */}
      <div className="df-chat__header">
        <button className="df-btn df-btn--ghost" type="button" onClick={() => navigate(-1)}>
          Volver
        </button>

        <div className="df-chat__titleWrap">
          <div className="df-chat__title">Chat</div>
          <div className="df-chat__subtitle">Conversación vinculada a una reserva</div>
        </div>

        <div className="df-chat__meta">
          <span className="df-chat__metaLabel">ID</span>
          <span className="df-chat__metaValue">{conversationId}</span>
        </div>
      </div>

      {errMsg && <div className="df-alert df-alert--error">{errMsg}</div>}

      {/* Body */}
      <div className="df-chat__panel">
        <div className="df-chat__messages" ref={listRef}>
          {loading ? (
            <div className="df-chat__empty">Cargando mensajes…</div>
          ) : items.length === 0 ? (
            <div className="df-chat__empty">No hay mensajes todavía. Escribe el primero.</div>
          ) : (
            items.map((m) => {
              const mine = myUserId && String(m.senderId) === String(myUserId);

              return (
                <div key={m.id} className={`df-msg ${mine ? "df-msg--mine" : "df-msg--theirs"}`}>
                  {!mine && (
                    <div className="df-msg__avatar" aria-hidden="true">
                      {initials(m.senderId)}
                    </div>
                  )}

                  <div className="df-msg__bubble">
                    <div className="df-msg__text">{m.body}</div>
                    <div className="df-msg__meta">{fmt(m.createdAt)}</div>
                  </div>

                  {mine && (
                    <div className="df-msg__avatar df-msg__avatar--mine" aria-hidden="true">
                      {initials(myUserId)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <form className="df-chat__composer" onSubmit={onSubmit}>
          <input
            className="df-chat__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe un mensaje…"
          />
          <button className="df-btn df-btn--primary" type="submit" disabled={sending || !text.trim()}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </form>

        <div className="df-chat__footnote">
          Solo participan el cliente y el adiestrador (y admin).
        </div>
      </div>
    </div>
  );
}
