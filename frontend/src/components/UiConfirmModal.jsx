import React, { useEffect, useMemo } from "react";

export default function UiConfirmModal({ state, onResolve }) {
  const open = !!state;

  const title = String(state?.title || "Confirmar");
  const message = String(state?.message || "");
  const confirmText = String(state?.confirmText || "Confirmar");
  const cancelText = String(state?.cancelText || "Cancelar");
  const danger = !!state?.danger;

  const messageLines = useMemo(() => {
    if (!message) return [];
    return String(message).split("\n");
  }, [message]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") onResolve?.(false);
      if (e.key === "Enter") onResolve?.(true);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onResolve]);

  if (!open) return null;

  return (
    <div className="df-ui-confirm__overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="df-ui-confirm__modal">
        <div className="df-ui-confirm__header">
          <div className="df-ui-confirm__title">{title}</div>
        </div>

        {message ? (
          <div className="df-ui-confirm__body">
            {messageLines.map((ln, i) => (
              <div key={i} className="df-ui-confirm__line">
                {ln}
              </div>
            ))}
          </div>
        ) : null}

        <div className="df-ui-confirm__actions">
          <button type="button" className="df-ui-btn df-ui-btn--ghost" onClick={() => onResolve?.(false)}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`df-ui-btn df-ui-btn--primary ${danger ? "df-ui-btn--danger" : ""}`}
            onClick={() => onResolve?.(true)}
          >
            {confirmText}
          </button>
        </div>
      </div>

      <button
        type="button"
        className="df-ui-confirm__backdrop"
        aria-label="Cerrar"
        onClick={() => onResolve?.(false)}
      />
    </div>
  );
}
