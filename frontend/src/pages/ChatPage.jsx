// frontend/src/pages/ChatPage.jsx
// Chat Cliente–Adiestrador
// ✅ 1 chat por adiestrador (1 conversación por pareja trainer+client)
// ✅ Soporta adjuntos: fotos / vídeos / archivos (vía /api/upload-db)
// ✅ Emoticonos (picker simple)
// ✅ Avatar por mensaje: foto si existe, si no inicial (o "?" si no hay nombre)
// ✅ Polling sin saltos visuales (solo auto-scroll si el usuario está abajo)
// ✅ Borrado lógico desde UI (botón "Borrar chat")
// ✅ Mejora: si vienes desde Reservas, al volver/borrar te lleva a /reservas
// ✅ Mejora: decode JWT base64url robusto
//
// FIX FRONTEND (2026-01):
// ✅ Si el chat fue borrado por este usuario, el backend debería responder 404/410 al leer.
//    En ese caso:
//    - mostramos "Has eliminado este chat" (sin re-abrir)
//    - detenemos polling para no insistir
//    - deshabilitamos composer/borrar (porque ya no existe para ti)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { http } from "../helpers/http";
import { useUi } from "../context/ui";
import { isLogged, getToken } from "../helpers/auth";

// API base para construir URLs de archivos (no usa fetch helper)
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");

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

// JWT base64url safe decode
function decodeJwtPayload(token) {
  try {
    const part = (token || "").split(".")[1] || "";
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 ? "=".repeat(4 - (base64.length % 4)) : "";
    const json = atob(base64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Avatar helpers (foto de perfil + fallback a inicial)
function getSenderName(m = {}) {
  const v =
    m?.senderName ??
    m?.sender_name ??
    m?.senderNombre ??
    m?.senderFullName ??
    m?.name ??
    m?.nombre ??
    m?.sender?.name ??
    m?.sender?.nombre ??
    m?.userName ??
    m?.username ??
    "";
  return String(v || "").trim();
}

function getSenderAvatar(m = {}) {
  const v =
    // ✅ backend nuevo
    m?.senderPhotoUrl ??
    m?.sender_photo_url ??
    // ✅ variantes comunes
    m?.senderAvatar ??
    m?.sender_avatar ??
    m?.senderPhoto ??
    m?.sender_photo ??
    m?.senderImage ??
    m?.sender_image ??
    m?.avatar ??
    m?.avatarUrl ??
    m?.photoURL ??
    m?.picture ??
    "";
  return String(v || "").trim();
}

function initialFromName(name = "") {
  const s = String(name || "").trim();
  if (!s) return "?";
  return s.slice(0, 1).toUpperCase();
}

function normalizeAvatarUrl(url = "") {
  const s = String(url || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${API_BASE}${s}`;
  return `${API_BASE}/${s}`;
}

function isImage(mime = "") {
  return String(mime).toLowerCase().startsWith("image/");
}

function isVideo(mime = "") {
  return String(mime).toLowerCase().startsWith("video/");
}

function fileUrl(fileId) {
  return `${API_BASE}/api/files/${fileId}`;
}

function niceFileName(a) {
  const name = String(a?.name || "").trim();
  if (name) return name;
  const id = String(a?.id || "");
  if (!id) return "Archivo";
  return `Archivo ${id.slice(0, 6)}…`;
}

function niceSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

const EMOJIS = [
  "😀","😅","😂","😊","😍","😎","🤔","😴","😭","😡",
  "👍","🙏","👏","✅","⚠️","❤️","🎉","📅","📎","🐶","🐾",
];

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const ui = useUi();
  const location = useLocation();

  // ✅ si vienes desde reservas, volvemos ahí
  const backUrl = useMemo(() => {
    const from = location?.state?.from;
    return typeof from === "string" && from.trim() ? from : "/reservas";
  }, [location?.state]);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // ✅ borrado lógico desde UI
  const [deletingChat, setDeletingChat] = useState(false);

  // ✅ si el chat está “no accesible para mí” (borrado lógico / no existe)
  const [chatUnavailable, setChatUnavailable] = useState(false);

  // adjuntos
  const [attachments, setAttachments] = useState([]); // [{id,mime,name,size}]
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  // emoji
  const [emojiOpen, setEmojiOpen] = useState(false);

  const myUserId = useMemo(() => {
    const token = getToken();
    if (!token) return "";
    const payload = decodeJwtPayload(token);
    return String(payload?.id || payload?.uid || payload?.sub || "");
  }, []);

  const myName = useMemo(() => {
    const token = getToken();
    if (!token) return "";
    const payload = decodeJwtPayload(token);
    return String(
      payload?.name ||
        payload?.nombre ||
        payload?.username ||
        payload?.userName ||
        payload?.email ||
        ""
    ).trim();
  }, []);

  const myAvatar = useMemo(() => {
    const token = getToken();
    if (!token) return "";
    const payload = decodeJwtPayload(token);
    return String(
      payload?.avatar ||
        payload?.avatarUrl ||
        payload?.photo ||
        payload?.photoURL ||
        payload?.picture ||
        payload?.image ||
        ""
    ).trim();
  }, []);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  // ✅ Mantener experiencia de scroll: solo auto-scroll si el usuario está cerca del fondo
  const stickToBottomRef = useRef(true);

  // ✅ para no spamear el endpoint de "marcar como leído"
  const lastMarkedRef = useRef("");

  const isNearBottom = () => {
    const el = listRef.current;
    if (!el) return true;
    const threshold = 90; // px
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    return remaining <= threshold;
  };

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

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      stickToBottomRef.current = isNearBottom();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    stickToBottomRef.current = true;

    return () => {
      el.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const markUnavailable = (message) => {
    setChatUnavailable(true);
    setItems([]);
    setErrMsg(message || "Has eliminado este chat.");
    // evitar que el usuario intente enviar
    setText("");
    setAttachments([]);
    setEmojiOpen(false);
  };

  const loadMessages = async ({ silent = false } = {}) => {
    if (!conversationId) return;
    if (chatUnavailable) return; // ✅ si ya no es accesible, no insistimos

    const shouldStick = silent ? stickToBottomRef.current : true;

    setErrMsg("");
    if (!silent) setLoading(true);

    try {
      const data = await http(`/api/chats/${conversationId}/messages`, { auth: true });
      const arr = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

      // Marcar como leído (solo si hay mensajes del otro usuario y han cambiado desde la última marca)
      try {
        const me = String(myUserId || "").trim();
        if (me) {
          const lastOther = [...arr].reverse().find((m) => {
            const sid = String(m?.senderId || m?.sender_id || "").trim();
            return sid && sid !== me;
          });
          const sig = lastOther
            ? `${String(lastOther.id || "")}:${String(lastOther.createdAt || lastOther.created_at || "")}`
            : "";
          if (sig && sig !== lastMarkedRef.current) {
            lastMarkedRef.current = sig;
            // best-effort (no bloquea la UI)
            http(`/api/chats/${conversationId}/read`, { method: "POST", auth: true }).catch(() => {});
          }
        }
      } catch {
        // ignore
      }

      setItems((prev) => {
        const prevLast = prev?.length ? prev[prev.length - 1] : null;
        const nextLast = arr?.length ? arr[arr.length - 1] : null;

        const sameLength = (prev?.length || 0) === (arr?.length || 0);
        const sameLast =
          prevLast && nextLast
            ? String(prevLast.id) === String(nextLast.id) &&
              String(prevLast.createdAt || prevLast.created_at || "") ===
                String(nextLast.createdAt || nextLast.created_at || "")
            : !prevLast && !nextLast;

        if (silent && sameLength && sameLast) return prev;
        return arr;
      });

      requestAnimationFrame(() => {
        if (shouldStick) scrollToBottom(false);
      });
    } catch (e) {
      console.error("Error cargando mensajes:", e);
      const status = e?.status || e?.response?.status;
      const apiErr = String(e?.data?.error || e?.message || "");

      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 403) setErrMsg("No tienes permisos para ver este chat.");
      else if (status === 404 || status === 410) {
        // ✅ Caso “borrado lógico” para este usuario (o no existente)
        const lower = apiErr.toLowerCase();
        if (
          lower.includes("no encontrado") ||
          lower.includes("chat no encontrado") ||
          lower.includes("eliminado") ||
          lower.includes("deleted")
        ) {
          markUnavailable("Has eliminado este chat.");
        } else {
          markUnavailable("Chat no encontrado.");
        }
      } else setErrMsg("No se pudieron cargar los mensajes.");

      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLogged()) {
      navigate(`/login?next=/chat/${conversationId || ""}`, { replace: true });
      return;
    }
    // reset flags al cambiar de conversación
    setChatUnavailable(false);
    lastMarkedRef.current = "";
    loadMessages({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    if (chatUnavailable) return; // ✅ no polling si no existe para mí
    const t = setInterval(() => {
      loadMessages({ silent: true });
    }, 4500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, chatUnavailable]);

  const insertEmoji = (emoji) => {
    const el = inputRef.current;
    if (!el) {
      setText((t) => `${t}${emoji}`);
      return;
    }

    const start = Number.isFinite(el.selectionStart) ? el.selectionStart : text.length;
    const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;

    setText(next);
    setEmojiOpen(false);

    requestAnimationFrame(() => {
      try {
        el.focus();
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
      } catch {
        // ignore
      }
    });
  };

  const onPickFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (uploading) return;
    if (chatUnavailable) return;

    setUploadErr("");
    setUploading(true);

    try {
      const maxTotal = 5;
      const availableSlots = Math.max(0, maxTotal - attachments.length);
      const slice = list.slice(0, availableSlots);

      for (const file of slice) {
        const form = new FormData();
        form.append("file", file);

        const resp = await http("/api/upload-db", {
          method: "POST",
          auth: true,
          data: form,
          timeoutMs: 60000,
        });

        const id = String(resp?.id || "").trim();
        const mime = String(resp?.mime || file.type || "application/octet-stream")
          .toLowerCase()
          .trim();
        if (!id) throw new Error("No se recibió id del archivo");

        setAttachments((prev) => [
          ...prev,
          {
            id,
            mime,
            name: resp?.name || file.name || null,
            size: resp?.size ?? file.size ?? null,
          },
        ]);
      }

      if (list.length > availableSlots) {
        setUploadErr("Has adjuntado el máximo de 5 archivos por mensaje.");
      }
    } catch (e) {
      console.error("Error subiendo archivo:", e);
      const msg =
        e?.data?.error ||
        e?.message ||
        "No se pudo subir el archivo. Revisa el tipo o el tamaño.";
      setUploadErr(msg);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const send = async () => {
    if (!conversationId) return;
    if (sending) return;
    if (chatUnavailable) return;

    const bodyTrim = text.trim();
    if (!bodyTrim && attachments.length === 0) return;

    setSending(true);
    setErrMsg("");

    try {
      await http(`/api/chats/${conversationId}/messages`, {
        method: "POST",
        auth: true,
        data: {
          body: bodyTrim,
          attachments,
        },
      });

      setText("");
      setAttachments([]);
      setEmojiOpen(false);

      stickToBottomRef.current = true;

      await loadMessages({ silent: false });
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (e) {
      console.error("Error enviando mensaje:", e);
      const status = e?.status || e?.response?.status;
      const apiErr = String(e?.data?.error || e?.message || "");

      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 403) setErrMsg("No tienes permisos para enviar mensajes aquí.");
      else if (status === 404 || status === 410) {
        const lower = apiErr.toLowerCase();
        if (lower.includes("eliminado") || lower.includes("no encontrado")) {
          markUnavailable("Has eliminado este chat.");
        } else {
          markUnavailable("Chat no encontrado.");
        }
      } else setErrMsg(e?.data?.error || "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    send();
  };

  const handleDeleteChat = async () => {
    if (!conversationId) return;
    if (deletingChat) return;
    if (chatUnavailable) {
      // ya está borrado para mí: simplemente volver
      navigate(backUrl, { replace: true });
      return;
    }

    const ok = await ui.confirm({
      title: "Borrar chat",
      message:
        "¿Seguro que quieres borrar este chat?\n\nSolo desaparecerá para ti. La otra persona lo seguirá viendo.",
      confirmText: "Borrar",
      cancelText: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    setDeletingChat(true);
    setErrMsg("");

    try {
      await http(`/api/chats/${conversationId}`, {
        method: "DELETE",
        auth: true,
      });

      // ✅ tras borrar, volvemos a donde veníamos (reservas por defecto)
      navigate(backUrl, { replace: true });
    } catch (e) {
      console.error("Error borrando chat:", e);
      const status = e?.status || e?.response?.status;
      if (status === 401) setErrMsg("Tu sesión ha expirado. Inicia sesión otra vez.");
      else if (status === 403) setErrMsg("No tienes permisos para borrar este chat.");
      else setErrMsg(e?.data?.error || "No se pudo borrar el chat.");
    } finally {
      setDeletingChat(false);
    }
  };

  const composerDisabled =
    chatUnavailable || deletingChat || sending || uploading;

  return (
    <div className="df-chat">
      {/* Header */}
      <div className="df-chat__header">
        <button className="df-btn df-btn--ghost" type="button" onClick={() => navigate(backUrl)}>
          Volver
        </button>

        <div className="df-chat__titleWrap">
          <div className="df-chat__title">Chat</div>
          <div className="df-chat__subtitle">Conversación privada entre cliente y adiestrador</div>
        </div>

        <div className="df-chat__meta">
          <span className="df-chat__metaLabel">ID</span>
          <span className="df-chat__metaValue">{conversationId}</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button
            className="df-btn df-btn--ghost"
            type="button"
            onClick={() => navigate("/chats")}
            title="Ver lista de chats"
          >
            Mis chats
          </button>

          <button
            className="df-btn df-btn--ghost"
            type="button"
            onClick={handleDeleteChat}
            disabled={deletingChat}
            title="Borrar chat (solo para ti)"
          >
            {deletingChat ? "Borrando…" : chatUnavailable ? "Volver" : "Borrar chat"}
          </button>
        </div>
      </div>

      {errMsg && <div className="df-alert df-alert--error">{errMsg}</div>}

      {/* Body */}
      <div className="df-chat__panel">
        <div className="df-chat__messages" ref={listRef}>
          {loading ? (
            <div className="df-chat__empty">Cargando mensajes…</div>
          ) : items.length === 0 ? (
            <div className="df-chat__empty">
              {chatUnavailable ? "Este chat no está disponible para ti." : "No hay mensajes todavía. Escribe el primero."}
            </div>
          ) : (
            items.map((m) => {
              const mine = myUserId && String(m.senderId) === String(myUserId);
              const atts = Array.isArray(m.attachments) ? m.attachments : [];

              const senderName = getSenderName(m) || (mine ? myName : "");
              const senderAvatarRaw = getSenderAvatar(m) || (mine ? myAvatar : "");
              const senderAvatar = normalizeAvatarUrl(senderAvatarRaw);
              const senderInitial = initialFromName(senderName);

              return (
                <div key={m.id} className={`df-msg ${mine ? "df-msg--mine" : "df-msg--theirs"}`}>
                  <div className={`df-msg__avatar ${mine ? "df-msg__avatar--mine" : ""}`} aria-hidden="true">
                    {senderAvatar ? (
                      <img className="df-msg__avatarImg" src={senderAvatar} alt="" />
                    ) : (
                      <span className="df-msg__avatarInitial">{senderInitial}</span>
                    )}
                  </div>

                  <div className="df-msg__bubble">
                    {m.body ? <div className="df-msg__text">{m.body}</div> : null}

                    {atts.length > 0 && (
                      <div className="df-msg__attachments">
                        {atts.map((a) => {
                          const url = fileUrl(a.id);
                          const name = niceFileName(a);
                          const size = niceSize(a.size);

                          if (isImage(a.mime)) {
                            return (
                              <a
                                key={a.id}
                                className="df-attach df-attach--image"
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                title={name}
                              >
                                <img className="df-attach__img" src={url} alt={name} />
                              </a>
                            );
                          }

                          if (isVideo(a.mime)) {
                            return (
                              <div key={a.id} className="df-attach df-attach--video">
                                <video className="df-attach__video" src={url} controls />
                                <div className="df-attach__caption">
                                  {name}
                                  {size ? <span> · {size}</span> : null}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <a
                              key={a.id}
                              className="df-attach df-attach--file"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title={name}
                            >
                              <span className="df-attach__icon">📎</span>
                              <span className="df-attach__name">{name}</span>
                              {size ? <span className="df-attach__size">{size}</span> : null}
                            </a>
                          );
                        })}
                      </div>
                    )}

                    <div className="df-msg__meta">{fmt(m.createdAt)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <form className="df-chat__composer" onSubmit={onSubmit}>
          <div className="df-chat__composerLeft">
            <button
              className="df-btn df-btn--ghost df-btn--icon"
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              title="Emoticonos"
              disabled={composerDisabled}
            >
              🙂
            </button>

            <button
              className="df-btn df-btn--ghost df-btn--icon"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={composerDisabled}
              title="Adjuntar archivo"
            >
              📎
            </button>

            <input
              ref={fileRef}
              className="df-chat__file"
              type="file"
              multiple
              accept="image/*,video/*,application/pdf,text/plain"
              onChange={(e) => onPickFiles(e.target.files)}
              disabled={composerDisabled}
            />
          </div>

          <div className="df-chat__composerMain">
            {emojiOpen && !composerDisabled && (
              <div className="df-emoji">
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="df-emoji__btn"
                    onClick={() => insertEmoji(em)}
                    title={em}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}

            <input
              ref={inputRef}
              className="df-chat__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (e.nativeEvent?.isComposing) return;
                e.preventDefault();
                if (composerDisabled) return;
                send();
              }}
              placeholder={chatUnavailable ? "Chat eliminado para ti." : "Escribe un mensaje…"}
              disabled={composerDisabled}
            />

            {attachments.length > 0 && (
              <div className="df-pending">
                {attachments.map((a) => (
                  <div key={a.id} className="df-pending__item">
                    <span className="df-pending__label">{niceFileName(a)}</span>
                    <button
                      type="button"
                      className="df-pending__remove"
                      onClick={() => removeAttachment(a.id)}
                      title="Quitar"
                      disabled={composerDisabled}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploadErr && <div className="df-chat__uploadErr">{uploadErr}</div>}
          </div>

          <button
            className="df-btn df-btn--primary"
            type="submit"
            disabled={composerDisabled || (!text.trim() && attachments.length === 0)}
          >
            {sending ? "Enviando…" : uploading ? "Subiendo…" : "Enviar"}
          </button>
        </form>

        <div className="df-chat__footnote">Solo participan el cliente y el adiestrador (y admin).</div>
      </div>
    </div>
  );
}
