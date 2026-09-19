"use client";

import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { showAlert } from "./confirm";

export default function MaintenanceAdmin({ t }: { t: Translate }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    Promise.all([
      api("admin/settings"),
      api("storefront-admin")
    ])
      .then(([workspaceSettings, storefrontSettings]) => {
        setData({
          workspace: workspaceSettings,
          storefrontRaw: storefrontSettings,
          storefront: {
            maintenanceEnabled: storefrontSettings?.data?.maintenanceEnabled ?? false,
            maintenanceText: storefrontSettings?.data?.maintenanceText ?? "",
            maintenanceImage: storefrontSettings?.data?.maintenanceImage ?? null,
          },
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const savedWorkspace = await api("admin/settings", "PUT", data.workspace);
      const savedStorefront = await api("storefront-admin", "PUT", {
        ...data.storefrontRaw?.data,
        enabled: data.storefrontRaw?.enabled ?? true,
        version: data.storefrontRaw?.version,
        maintenanceEnabled: data.storefront.maintenanceEnabled,
        maintenanceText: data.storefront.maintenanceText,
        maintenanceImage: data.storefront.maintenanceImage,
      });
      setData((prev: any) => ({
        ...prev,
        workspace: savedWorkspace,
        storefrontRaw: savedStorefront,
      }));
      setSuccess(t("Maintenance settings saved successfully", "تم حفظ إعدادات الصيانة بنجاح"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isVideoMedia = (url?: string | null) => {
    if (!url) return false;
    return url.startsWith("data:video/") || /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
  };

  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const allowed = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime",
      ];
      if (!allowed.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp|gif|mp4|webm|ogg|mov)$/i)) {
        reject(new Error(t("Use PNG, JPEG, WebP, GIF, or MP4/WebM video under 15 MB", "استخدم ملف PNG أو JPEG أو WebP أو GIF أو فيديو MP4/WebM بحجم أقل من 15 ميغابايت")));
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        reject(new Error(t("File exceeds 15 MB limit", "يتجاوز حجم الملف الحد الأقصى (15 ميغابايت)")));
        return;
      }
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(t("File could not be read", "تعذر قراءة الملف")));
      r.readAsDataURL(file);
    });
  };

  if (!data) return <p role="alert">{error || t("Loading…", "جار التحميل")}</p>;

  return (
    <form onSubmit={save} className="maintenance-settings">
      <h2>{t("Workspace Maintenance (Staff Portal)", "صيانة مساحة العمل (بوابة الموظفين)")}</h2>
      <div className="form-grid">
        <label className="check full-width">
          <input
            type="checkbox"
            checked={data.workspace.workspaceMaintenance || false}
            onChange={(e) =>
              setData({
                ...data,
                workspace: { ...data.workspace, workspaceMaintenance: e.target.checked },
              })
            }
          />
          {t("Enable Workspace Maintenance Mode", "تفعيل وضع الصيانة لمساحة العمل")}
        </label>
        
        <label className="full-width">
          {t("Maintenance Message", "رسالة الصيانة")}
          <textarea
            rows={3}
            value={data.workspace.workspaceMaintenanceText || ""}
            onChange={(e) =>
              setData({
                ...data,
                workspace: { ...data.workspace, workspaceMaintenanceText: e.target.value },
              })
            }
            placeholder={t("We are performing scheduled maintenance...", "نقوم بإجراء صيانة مجدولة...")}
          />
        </label>

        <div className="full-width">
          <label>
            {t("Custom Media (Photo, Animated GIF, or MP4/WebM Video, < 15MB)", "وسائط مخصصة (صورة، GIF متحرك، أو فيديو MP4/WebM، أقل من 15 ميجابايت)")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg,video/quicktime"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  try {
                    const b64 = await toBase64(file);
                    setData({
                      ...data,
                      workspace: { ...data.workspace, workspaceMaintenanceImage: b64 },
                    });
                  } catch (err: any) {
                    await showAlert(err.message, { tone: "danger" });
                  }
                }
              }}
            />
          </label>
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>{t("Or enter media URL:", "أو أدخل رابط الوسائط:")}</span>
            <input
              type="url"
              placeholder="https://.../banner.mp4 or .gif"
              value={data.workspace.workspaceMaintenanceImage || ""}
              onChange={(e) =>
                setData({
                  ...data,
                  workspace: { ...data.workspace, workspaceMaintenanceImage: e.target.value.trim() || null },
                })
              }
              style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
            />
          </div>
        </div>
        {data.workspace.workspaceMaintenanceImage && (
          <div className="full-width" style={{ marginTop: 8, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 13 }}>{t("Media Preview:", "معاينة الوسائط:")}</div>
            {isVideoMedia(data.workspace.workspaceMaintenanceImage) ? (
              <video
                src={data.workspace.workspaceMaintenanceImage}
                autoPlay
                loop
                muted
                playsInline
                controls
                style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 6, display: "block", background: "#000" }}
              />
            ) : (
              <img
                src={data.workspace.workspaceMaintenanceImage}
                alt="Workspace Maintenance Media"
                style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 6, display: "block", objectFit: "contain" }}
              />
            )}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  setData({
                    ...data,
                    workspace: { ...data.workspace, workspaceMaintenanceImage: null },
                  })
                }
              >
                {t("Remove Media", "إزالة الوسائط")}
              </button>
            </div>
          </div>
        )}
      </div>

      <hr />

      <h2>{t("Storefront Maintenance", "صيانة واجهة المتجر")}</h2>
      <div className="form-grid">
        <label className="check full-width">
          <input
            type="checkbox"
            checked={data.storefront.maintenanceEnabled || false}
            onChange={(e) =>
              setData({
                ...data,
                storefront: {
                  ...data.storefront,
                  maintenanceEnabled: e.target.checked,
                },
              })
            }
          />
          {t("Enable Storefront Maintenance Mode", "تفعيل وضع الصيانة لواجهة المتجر")}
        </label>
        
        <label className="full-width">
          {t("Maintenance Message", "رسالة الصيانة")}
          <textarea
            rows={3}
            value={data.storefront.maintenanceText || ""}
            onChange={(e) =>
              setData({
                ...data,
                storefront: {
                  ...data.storefront,
                  maintenanceText: e.target.value,
                },
              })
            }
            placeholder={t("The store is currently undergoing maintenance...", "المتجر يخضع حاليًا للصيانة...")}
          />
        </label>

        <div className="full-width">
          <label>
            {t("Custom Media (Photo, Animated GIF, or MP4/WebM Video, < 15MB)", "وسائط مخصصة (صورة، GIF متحرك، أو فيديو MP4/WebM، أقل من 15 ميجابايت)")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg,video/quicktime"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  try {
                    const b64 = await toBase64(file);
                    setData({
                      ...data,
                      storefront: {
                        ...data.storefront,
                        maintenanceImage: b64,
                      },
                    });
                  } catch (err: any) {
                    await showAlert(err.message, { tone: "danger" });
                  }
                }
              }}
            />
          </label>
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>{t("Or enter media URL:", "أو أدخل رابط الوسائط:")}</span>
            <input
              type="url"
              placeholder="https://.../store_banner.mp4 or .gif"
              value={data.storefront.maintenanceImage || ""}
              onChange={(e) =>
                setData({
                  ...data,
                  storefront: {
                    ...data.storefront,
                    maintenanceImage: e.target.value.trim() || null,
                  },
                })
              }
              style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
            />
          </div>
        </div>
        {data.storefront.maintenanceImage && (
          <div className="full-width" style={{ marginTop: 8, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 13 }}>{t("Media Preview:", "معاينة الوسائط:")}</div>
            {isVideoMedia(data.storefront.maintenanceImage) ? (
              <video
                src={data.storefront.maintenanceImage}
                autoPlay
                loop
                muted
                playsInline
                controls
                style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 6, display: "block", background: "#000" }}
              />
            ) : (
              <img
                src={data.storefront.maintenanceImage}
                alt="Storefront Maintenance Media"
                style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 6, display: "block", objectFit: "contain" }}
              />
            )}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  setData({
                    ...data,
                    storefront: {
                      ...data.storefront,
                      maintenanceImage: null,
                    },
                  })
                }
              >
                {t("Remove Media", "إزالة الوسائط")}
              </button>
            </div>
          </div>
        )}
      </div>

      <hr />

      {error && <p className="notice error">{error}</p>}
      {success && <p className="notice success">{success}</p>}

      <button className="primary" disabled={busy}>
        {busy ? t("Saving…", "جارٍ الحفظ…") : t("Save Maintenance Settings", "حفظ إعدادات الصيانة")}
      </button>
    </form>
  );
}
