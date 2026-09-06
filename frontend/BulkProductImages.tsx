"use client";
import { useState } from "react";
import { api, readApiResponse, type Translate } from "./api";
import { appPath } from "../shared/paths";
type Match = {
  file: File;
  productId: string;
  partNumber: string;
  status: string;
};
export default function BulkProductImages({ t }: { t: Translate }) {
  const [rows, setRows] = useState<Match[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function review(files: File[]) {
    setBusy(true);
    setError("");
    try {
      if (files.length > 200)
        throw new Error(t("Choose at most 200 images", "اختر حتى 200 صورة"));
      const result = await api("storefront-admin/image-matches", "POST", {
        names: files.map((f) => f.name),
      });
      setRows(
        files.map((file, i) => ({
          file,
          productId: result.items[i].productId || "",
          partNumber: result.items[i].partNumber,
          status:
            file.size > 5 * 1024 * 1024
              ? t("Too large: maximum 5 MB", "الحجم الأقصى 5 ميغابايت")
              : result.items[i].productId
                ? "READY"
                : t(
                    "No unique exact SKU match; rename this file and review again",
                    "لا يوجد تطابق فريد لرقم الصنف؛ أعد تسمية الملف ثم راجعه",
                  ),
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    setBusy(true);
    setError("");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== "READY") continue;
      try {
        const form = new FormData();
        form.set("file", row.file);
        const response = await fetch(
          appPath(`/api/v1/products/${row.productId}/images`),
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": (globalThis as any).amtCsrf || "" },
            body: form,
          },
        );
        const result = await readApiResponse(response);
        if (!response.ok) throw new Error(result?.error || "Upload failed");
        setRows((current) =>
          current.map((r, j) => (j === i ? { ...r, status: "UPLOADED" } : r)),
        );
      } catch (e) {
        setRows((current) =>
          current.map((r, j) =>
            j === i ? { ...r, status: (e as Error).message } : r,
          ),
        );
      }
    }
    setBusy(false);
  }
  return (
    <details>
      <summary>{t("Bulk product images", "صور المنتجات بالجملة")}</summary>
      <p>
        {t(
          "Name each image with its exact SKU, for example SWITCH-1.jpg. Optional __2, __3 suffixes add more images. Review matches before uploading. JPEG, PNG or WebP; 5 MB each; five images per product.",
          "سمّ كل صورة برقم الصنف المطابق مثل SWITCH-1.jpg. يمكن إضافة __2 أو __3 لصور إضافية. راجع المطابقة قبل الرفع. JPEG أو PNG أو WebP؛ حتى 5 ميغابايت للصورة وخمس صور للمنتج.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      <input
        aria-label={t("Choose product images", "اختر صور المنتجات")}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={(e) => review(Array.from(e.target.files || []))}
      />
      {!!rows.length && (
        <>
          <table className="dense-table">
            <thead>
              <tr>
                <th>{t("File", "الملف")}</th>
                <th>{t("Product", "المنتج")}</th>
                <th>{t("Result", "النتيجة")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.file.name}</td>
                  <td>{r.partNumber}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            disabled={busy || !rows.some((r) => r.status === "READY")}
            onClick={upload}
          >
            {t("Upload reviewed matches", "رفع الصور المتطابقة بعد المراجعة")}
          </button>
        </>
      )}
    </details>
  );
}
