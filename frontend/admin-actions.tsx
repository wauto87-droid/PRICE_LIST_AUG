"use client";
import { useEffect, useRef, useState } from "react";

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
      startedAt?: number;
      progress?: number | null;
      remainingSeconds?: number | null;
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
  useEffect(() => {
    if (state.phase !== "saving" || !state.startedAt) {
      setElapsedSeconds(0);
      return;
    }
    const tick = () =>
      setElapsedSeconds(
        Math.max(0, Math.round((Date.now() - state.startedAt!) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state]);

  if (state.phase === "idle") return null;
  const progressValue =
    state.phase === "saving" && typeof state.progress === "number"
      ? Math.max(0, Math.min(100, state.progress))
      : null;
  const remainingLabel =
    state.phase !== "saving"
      ? ""
      : state.remainingSeconds && state.remainingSeconds > 0
        ? t(
            `About ${state.remainingSeconds}s remaining`,
            `متبقي تقريباً ${state.remainingSeconds} ثانية`,
          )
        : t(
            "Estimating remaining time…",
            "جارٍ تقدير الوقت المتبقي…",
          );

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
          <>
            <div
              className={`admin-progress ${progressValue === null ? "indeterminate" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue ?? undefined}
            >
              <span style={progressValue === null ? undefined : { width: `${progressValue}%` }} />
            </div>
            <div className="admin-progress-meta">
              <span>{remainingLabel}</span>
              <span>
                {t(
                  `Elapsed ${elapsedSeconds}s`,
                  `المنقضي ${elapsedSeconds} ثانية`,
                )}
              </span>
            </div>
            <p className="muted">
              {t(
                "Please wait while AMT finishes this step.",
                "يرجى الانتظار حتى ينهي AMT هذه الخطوة.",
              )}
            </p>
          </>
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
