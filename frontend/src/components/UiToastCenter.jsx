import React from "react";

function iconFor(type) {
  switch (String(type || "").toLowerCase()) {
    case "success":
      return "✓";
    case "error":
      return "!";
    case "warning":
      return "!";
    default:
      return "i";
  }
}

export default function UiToastCenter({ items = [], onDismiss }) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return null;

  return (
    <div className="df-ui-toast__wrap" aria-live="polite" aria-relevant="additions">
      {arr.map((t) => (
        <div key={t.id} className={`df-ui-toast df-ui-toast--${String(t.type || "info").toLowerCase()}`}>
          <div className="df-ui-toast__icon" aria-hidden="true">
            {iconFor(t.type)}
          </div>

          <div className="df-ui-toast__content">
            {t.title ? <div className="df-ui-toast__title">{t.title}</div> : null}
            <div className="df-ui-toast__message">{t.message}</div>
          </div>

          <button
            type="button"
            className="df-ui-toast__close"
            aria-label="Cerrar"
            onClick={() => onDismiss?.(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
