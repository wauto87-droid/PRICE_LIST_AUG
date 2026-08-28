"use client";
import { useEffect, useState } from "react";
import type { Translate } from "./api";
import { registerConfirmHandler, resolveConfirm } from "./confirm";

export default function ConfirmModal({ t }: { t: Translate }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    registerConfirmHandler((msg) => {
      setMessage(msg);
    });
    return () => {
      registerConfirmHandler(null);
    };
  }, []);

  if (!message) return null;

  return (
    <div className="modal-backdrop" style={{ zIndex: 1000 }}>
      <section className="modal" style={{ width: "min(400px, 100%)", textAlign: "center" }}>
        <p style={{ fontSize: "16px", marginBottom: "24px", lineHeight: "1.5", color: "#333", whiteSpace: "pre-wrap" }}>
          {message}
        </p>
        <div className="actions" style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button
            className="primary"
            onClick={() => {
              setMessage(null);
              resolveConfirm(true);
            }}
            style={{ minWidth: "100px" }}
          >
            {t("Yes", "نعم")}
          </button>
          <button
            onClick={() => {
              setMessage(null);
              resolveConfirm(false);
            }}
            style={{ minWidth: "100px" }}
          >
            {t("Cancel", "إلغاء")}
          </button>
        </div>
      </section>
    </div>
  );
}
