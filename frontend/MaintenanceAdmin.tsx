"use client";

import { useEffect, useState } from "react";
import { api, type Translate } from "./api";

export default function MaintenanceAdmin({ t }: { t: Translate }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    Promise.all([
      api("admin/settings"),
      api("storefront/admin/settings")
    ])
      .then(([workspaceSettings, storefrontSettings]) => {
        setData({
          workspace: workspaceSettings,
          storefront: storefrontSettings.settings.data, // Admin settings for storefront might be inside a particular structure. Let's assume it matches storefront/admin/settings
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
      await api("admin/settings", {
        method: "POST",
        body: data.workspace,
      });
      await api("storefront/admin/settings", {
        method: "POST",
        body: { settings: { data: data.storefront } },
      });
      setSuccess(t("Maintenance settings saved successfully", "تم حفظ إعدادات الصيانة بنجاح"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 500000) {
        reject(new Error("Use PNG/JPEG/WebP smaller than 500 KB"));
        return;
      }
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Image could not be read"));
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

        <label className="full-width">
          {t("Custom Image (PNG/JPEG/WebP, < 500KB)", "صورة مخصصة (أقل من 500 كيلوبايت)")}
          <input
            type="file"
            accept="image/png, image/jpeg, image/webp"
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
                  alert(err.message);
                }
              }
            }}
          />
        </label>
        {data.workspace.workspaceMaintenanceImage && (
          <div className="full-width">
            <img src={data.workspace.workspaceMaintenanceImage} alt="Workspace Maintenance Banner" style={{ maxHeight: 150 }} />
            <div>
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
                {t("Remove Image", "إزالة الصورة")}
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

        <label className="full-width">
          {t("Custom Image (PNG/JPEG/WebP, < 500KB)", "صورة مخصصة (أقل من 500 كيلوبايت)")}
          <input
            type="file"
            accept="image/png, image/jpeg, image/webp"
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
                  alert(err.message);
                }
              }
            }}
          />
        </label>
        {data.storefront.maintenanceImage && (
          <div className="full-width">
            <img src={data.storefront.maintenanceImage} alt="Storefront Maintenance Banner" style={{ maxHeight: 150 }} />
            <div>
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
                {t("Remove Image", "إزالة الصورة")}
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
