import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import UiConfirmModal from "../components/UiConfirmModal.jsx";
import UiToastCenter from "../components/UiToastCenter.jsx";

/**
 * UI Feedback (replaces native alert/confirm)
 * - confirm(): Promise<boolean>
 * - notify(): fire-and-forget toast
 */
const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);

  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(1);

  const notify = useCallback((opts) => {
    const o = typeof opts === "string" ? { message: opts } : (opts || {});
    const id = String(o.id || toastSeq.current++);
    const type = String(o.type || "info").toLowerCase();
    const title = String(o.title || "").trim();
    const message = String(o.message || "").trim();
    const timeoutMs = Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : 3500;

    if (!message) return;

    setToasts((prev) => [
      ...prev,
      {
        id,
        type,
        title,
        message,
        timeoutMs,
      },
    ]);

    if (timeoutMs > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, timeoutMs);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    const tid = String(id || "").trim();
    if (!tid) return;
    setToasts((prev) => prev.filter((t) => t.id !== tid));
  }, []);

  const confirm = useCallback((opts) => {
    const o = opts || {};
    const title = String(o.title || "Confirmar").trim();
    const message = String(o.message || "").trim();
    const confirmText = String(o.confirmText || "Confirmar").trim();
    const cancelText = String(o.cancelText || "Cancelar").trim();
    const danger = !!o.danger;

    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ title, message, confirmText, cancelText, danger });
    });
  }, []);

  const resolveConfirm = useCallback((result) => {
    const r = !!result;
    try {
      confirmResolverRef.current?.(r);
    } catch {
      // no-op
    }
    confirmResolverRef.current = null;
    setConfirmState(null);
  }, []);

  const value = useMemo(
    () => ({
      notify,
      confirm,
      dismissToast,
    }),
    [notify, confirm, dismissToast]
  );

  return (
    <UiContext.Provider value={value}>
      {children}

      <UiToastCenter items={toasts} onDismiss={dismissToast} />
      <UiConfirmModal state={confirmState} onResolve={resolveConfirm} />
    </UiContext.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) {
    throw new Error("useUi debe usarse dentro de <UiProvider />");
  }
  return ctx;
}
