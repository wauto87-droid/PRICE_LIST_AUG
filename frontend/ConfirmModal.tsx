"use client";
import { useEffect, useState, useRef } from "react";
import type { Translate } from "./api";
import {
  registerConfirmHandler,
  resolveConfirm,
  resolvePrompt,
  type ConfirmPayload,
} from "./confirm";

export default function ConfirmModal({ t }: { t: Translate }) {
  const [payload, setPayload] = useState<ConfirmPayload | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    registerConfirmHandler((item) => {
      setPayload(item);
      setInputValue(item.defaultValue || "");
    });
    return () => {
      registerConfirmHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    if (payload.isPrompt) {
      const timer = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => confirmBtnRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    }
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [payload, inputValue]);

  if (!payload) return null;

  const onConfirm = () => {
    const p = payload;
    setPayload(null);
    if (p.isPrompt) {
      resolvePrompt(inputValue);
    } else {
      resolveConfirm(true);
    }
  };

  const onCancel = () => {
    const p = payload;
    setPayload(null);
    if (p.isPrompt) {
      resolvePrompt(null);
    } else {
      resolveConfirm(false);
    }
  };

  const isDanger = payload.tone === "danger";
  const defaultConfirmText = isDanger ? t("Delete", "حذف") : t("Yes", "نعم");
  const confirmText = payload.confirmText || defaultConfirmText;
  const hasCancel = payload.cancelText !== "";
  const cancelText = payload.cancelText || t("Cancel", "إلغاء");
  const title =
    payload.title ||
    (isDanger
      ? t("Confirm Deletion", "تأكيد الحذف")
      : payload.isPrompt
      ? t("Action Required", "مطلوب إدخال")
      : t("Confirm Action", "تأكيد الإجراء"));

  return (
    <div
      className="app-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={`app-dialog-card ${isDanger ? "is-danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-desc"
      >
        <div className="app-dialog-header">
          <div className={`app-dialog-icon ${payload.tone || "primary"}`}>
            {payload.icon ? (
              <span>{payload.icon}</span>
            ) : isDanger ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            ) : payload.tone === "warning" ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
          </div>
          <div className="app-dialog-text">
            <h3 id="app-dialog-title" className="app-dialog-title">
              {title}
            </h3>
            <p id="app-dialog-desc" className="app-dialog-message">
              {payload.message}
            </p>
          </div>
        </div>

        {payload.isPrompt && (
          <form
            className="app-dialog-prompt-form"
            onSubmit={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="app-dialog-input"
              value={inputValue}
              placeholder={payload.placeholder || ""}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </form>
        )}

        <div className="app-dialog-actions">
          {hasCancel && (
            <button
              type="button"
              className="app-dialog-btn-cancel"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`app-dialog-btn-confirm ${isDanger ? "danger" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

