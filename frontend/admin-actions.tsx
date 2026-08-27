"use client";
import { useEffect, useRef } from "react";

export type AdminActionMessages = {
  saving: string;
  success: string;
  error: string;
  savingDetail?: string;
  successDetail?: string;
};

export type AdminActionState =
  | { phase: "idle" }
  | {
      phase: "saving" | "success" | "error";
      title: string;
      message?: string;
    };

export type AdminActionRunner = <T>(
  messages: AdminActionMessages,
  action: () => Promise<T>,
) => Promise<T | undefined>;

export function AdminActionModal({
  state,
  dismiss,
  t,
}: {
  state: AdminActionState;
  dismiss: () => void;
  t: (en: string, ar: string) => string;
}) {
  const panel = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (state.phase === "idle") {
      previousFocus.current?.focus?.();
      previousFocus.current = null;
      return;
    }
    if (!previousFocus.current && document.activeElement instanceof HTMLElement)
      previousFocus.current = document.activeElement;
    panel.current?.focus();
  }, [state.phase]);

  if (state.phase === "idle") return null;

  return (
    <div className="modal-backdrop admin-action-backdrop" role="presentation">
      <section
        ref={panel}
        tabIndex={-1}
        className={`modal admin-action-modal ${state.phase}`}
        role={state.phase === "error" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="admin-action-title"
      >
        <div className={`admin-action-badge ${state.phase}`} aria-hidden>
          {state.phase === "saving" ? "…" : state.phase === "success" ? "✓" : "!"}
        </div>
        <h2 id="admin-action-title">{state.title}</h2>
        {state.message && <p>{state.message}</p>}
        {state.phase === "saving" ? (
          <p className="muted">
            {t(
              "Please wait while AMT finishes this step.",
              "يرجى الانتظار حتى ينهي AMT هذه الخطوة.",
            )}
          </p>
        ) : state.phase === "error" ? (
          <div className="actions footer-actions">
            <button className="primary" type="button" onClick={dismiss} autoFocus>
              {t("Close", "إغلاق")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
