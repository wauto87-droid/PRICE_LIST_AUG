"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import ProductEditor, { blankProduct } from "./ProductEditor";
import { tierColumns } from "@/backend/pricing/transfer";
const mappingFields = [
  "partNumber",
  "description",
  "brand",
  "category",
  "cost",
  "markup",
  "listPrice",
  "baseDiscount",
  "minimum",
  "vat",
  "unit",
  "quantityPrecision",
  "aliases",
  "method",
  "active",
  "minimumEnabled",
  "keywords",
  "defaultLevel",
  ...tierColumns,
];
const synonyms: Record<string, string[]> = {
  partNumber: ["partnumber", "partno", "itemcode", "code", "item"],
  description: ["description", "desc", "itemdescription"],
  cost: ["cost", "purchasecost"],
  listPrice: ["price", "listprice"],
  baseDiscount: ["discount", "disc"],
  minimum: ["minprice", "minimumprice"],
  markup: ["markup"],
};
export default function Imports({ t }: { t: Translate }) {
  const [jobs, setJobs] = useState<any[]>([]),
    [job, setJob] = useState<any>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [defaults, setDefaults] = useState<any>({
      method: "LIST_DISCOUNT",
      markup: "25",
      baseDiscount: "0",
      vat: "15",
      minimumEnabled: false,
    }),
    [editing, setEditing] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => api("imports").then(setJobs);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api("auth/me")
      .then((s) => setDefaults((d: any) => ({ ...d, vat: s.settings.vat })))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!jobs.some((j) => ["UPLOADED", "PROCESSING"].includes(j.status)))
      return;
    const timer = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [jobs]);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const j = await api("imports/" + id);
    setJob(j);
    setDefaults(Object.keys(j.defaults).length ? j.defaults : defaults);
    if (Object.keys(j.mapping).length) setMapping(j.mapping);
    else {
      const auto: Record<string, string> = {};
      for (const field of mappingFields) {
        const found = (j.summary.columns || []).find((c: string) =>
          [
            field.toLowerCase().replace(/[^a-z0-9]/g, ""),
            ...(synonyms[field] || []),
          ].includes(c.toLowerCase().replace(/[^a-z0-9]/g, "")),
        );
        if (found) auto[field] = found;
      }
      setMapping(auto);
    }
  }
  return (
    <>
      <div className="section-title">
        <div>
          <h2>{t("Safe supplier imports", "استيراد آمن من الموردين")}</h2>
          <p className="muted">
            {t(
              "Upload → map → review → verify → confirm. Nothing publishes automatically.",
              "رفع ← ربط ← مراجعة ← تحقق ← تأكيد. لا يتم النشر تلقائياً.",
            )}
          </p>
        </div>
      </div>
      <label className="upload-zone">
        {t(
          "Choose Excel, CSV, or PDF price list",
          "اختر قائمة أسعار Excel أو CSV أو PDF",
        )}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              run(async () => {
                const form = new FormData();
                form.append("file", file);
                await api("imports", "POST", form);
              });
          }}
        />
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("File", "الملف")}</th>
              <th>{t("Status", "الحالة")}</th>
              <th>{t("Rows", "الصفوف")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  {j.filename}
                  <small>{new Date(j.created_at).toLocaleString()}</small>
                </td>
                <td>
                  <span className="pill">{j.status}</span>
                  {j.error && <small>{j.error}</small>}
                </td>
                <td>{j.summary.rows ?? "—"}</td>
                <td>
                  <button disabled={busy} onClick={() => run(() => open(j.id))}>
                    {t("Review", "مراجعة")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {job && (
        <div className="modal-backdrop">
          <section className="modal wide">
            <div className="section-title">
              <h2>{job.filename}</h2>
              <button onClick={() => setJob(null)}>×</button>
            </div>
            <p>
              {job.status} · {job.rows.length} {t("rows", "صفوف")}
            </p>
            {job.summary.warnings?.map((w: string) => (
              <div className="notice" key={w}>
                {w}
              </div>
            ))}
            {job.status === "AWAITING_REVIEW" && (
              <>
                <h3>
                  {t(
                    "1. Column mapping & defaults",
                    "١. ربط الأعمدة والقيم الافتراضية",
                  )}
                </h3>
                <div className="form-grid three">
                  {mappingFields.map((field) => (
                    <label key={field}>
                      {field}
                      <select
                        value={mapping[field] || ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [field]: e.target.value })
                        }
                      >
                        <option value="">
                          {t("Use default / empty", "افتراضي / فارغ")}
                        </option>
                        {job.summary.columns?.map((c: string) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    {t("Pricing method", "طريقة التسعير")}
                    <select
                      value={defaults.method}
                      onChange={(e) =>
                        setDefaults({ ...defaults, method: e.target.value })
                      }
                    >
                      <option>COST_MARKUP</option>
                      <option>LIST_DISCOUNT</option>
                    </select>
                  </label>
                  {["markup", "baseDiscount", "vat"].map((f) => (
                    <label key={f}>
                      {f}
                      <input
                        value={defaults[f]}
                        onChange={(e) =>
                          setDefaults({ ...defaults, [f]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={defaults.minimumEnabled}
                      onChange={(e) =>
                        setDefaults({
                          ...defaults,
                          minimumEnabled: e.target.checked,
                        })
                      }
                    />
                    {t("Enable minimum protection", "تفعيل حماية الحد الأدنى")}
                  </label>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("imports/" + job.id + "/mapping", "POST", {
                        mapping: Object.fromEntries(
                          Object.entries(mapping).filter(([, v]) => v),
                        ),
                        defaults,
                        version: job.version,
                      });
                      await open(job.id);
                    })
                  }
                >
                  {t("Apply mapping & validate", "تطبيق الربط والتحقق")}
                </button>
                <h3>{t("2. Review every row", "٢. مراجعة كل صف")}</h3>
                <p className="muted">
                  {t(
                    "UPDATE creates new products or updates matched products. KEEP/SKIP leaves live data unchanged. Verify each selected row against the original file.",
                    "تحديث ينشئ أصنافاً جديدة أو يحدث الأصناف المطابقة. إبقاء/تخطي لا يغير البيانات. تحقق من كل صف محدد مقابل الملف الأصلي.",
                  )}
                </p>
                <div className="actions wrap">
                  <button
                    onClick={() =>
                      setJob({
                        ...job,
                        rows: job.rows.map((r: any) => ({
                          ...r,
                          decision: "SKIP",
                        })),
                      })
                    }
                  >
                    {t("Skip all", "تخطي الكل")}
                  </button>
                  <button
                    onClick={() =>
                      setJob({
                        ...job,
                        rows: job.rows.map((r: any) => ({
                          ...r,
                          decision: r.errors.length ? "SKIP" : "UPDATE",
                        })),
                      })
                    }
                  >
                    {t(
                      "Select valid rows for update",
                      "تحديد الصفوف الصالحة للتحديث",
                    )}
                  </button>
                </div>
              </>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("Incoming / current", "وارد / حالي")}</th>
                    <th>{t("Validation", "التحقق")}</th>
                    <th>{t("Decision", "القرار")}</th>
                    <th>{t("Verified", "تم التحقق")}</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((r: any, i: number) => (
                    <tr key={r.id}>
                      <td>{r.row_number}</td>
                      <td>
                        <strong>
                          {r.proposed?.partNumber ||
                            t("Not mapped", "غير مربوط")}
                        </strong>
                        <small>{r.proposed?.description}</small>
                        <details>
                          <summary>
                            {t("Source & differences", "المصدر والفروقات")}
                          </summary>
                          <pre>
                            {JSON.stringify(
                              {
                                source: r.raw,
                                current: r.current,
                                incoming: r.proposed,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                        {job.status === "AWAITING_REVIEW" && (
                          <button onClick={() => setEditing(r)}>
                            {t("Correct row", "تصحيح الصف")}
                          </button>
                        )}
                      </td>
                      <td>
                        {r.confidence === "LOW" && (
                          <span className="pill warning">
                            {t("LOW CONFIDENCE", "ثقة منخفضة")}
                          </span>
                        )}
                        {r.duplicate_id && (
                          <span className="pill">{t("DUPLICATE", "مكرر")}</span>
                        )}
                        <small className="error-text">
                          {r.errors.join("; ")}
                        </small>
                      </td>
                      <td>
                        <select
                          disabled={job.status !== "AWAITING_REVIEW"}
                          value={r.decision}
                          onChange={(e) =>
                            setJob({
                              ...job,
                              rows: job.rows.map((x: any, n: number) =>
                                n === i
                                  ? { ...x, decision: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        >
                          {["REVIEW", "KEEP", "UPDATE", "SKIP"].map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          disabled={job.status !== "AWAITING_REVIEW"}
                          checked={r.verified}
                          aria-label={"Verify row " + r.row_number}
                          onChange={(e) =>
                            setJob({
                              ...job,
                              rows: job.rows.map((x: any, n: number) =>
                                n === i
                                  ? { ...x, verified: e.target.checked }
                                  : x,
                              ),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {job.status === "AWAITING_REVIEW" && (
              <div className="actions footer-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("imports/" + job.id + "/review", "POST", {
                        rows: job.rows.map((r: any) => ({
                          id: r.id,
                          decision: r.decision,
                          verified: r.verified,
                        })),
                      });
                      await open(job.id);
                    })
                  }
                >
                  {t("Save review decisions", "حفظ قرارات المراجعة")}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        t(
                          "Publish the saved, verified rows to the live catalog? Unsaved decisions are not applied.",
                          "نشر الصفوف المحفوظة والمتحقق منها؟ القرارات غير المحفوظة لا تطبق.",
                        ),
                      )
                    )
                      run(async () => {
                        await api("imports/" + job.id + "/confirm", "POST", {
                          version: job.version,
                        });
                        await open(job.id);
                      });
                  }}
                >
                  {t("Confirm import", "تأكيد الاستيراد")}
                </button>
              </div>
            )}
            {job.status === "IMPORTED" && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      t(
                        "Roll back this import? Later product edits will block rollback.",
                        "التراجع عن الاستيراد؟ التعديلات اللاحقة ستمنع التراجع.",
                      ),
                    )
                  )
                    run(async () => {
                      await api("imports/" + job.id + "/rollback", "POST", {});
                      await open(job.id);
                    });
                }}
              >
                {t("Roll back import", "التراجع عن الاستيراد")}
              </button>
            )}
            {error && <div className="notice error">{error}</div>}
          </section>
        </div>
      )}
      {editing && (
        <ProductEditor
          t={t}
          initial={{ ...blankProduct, ...defaults, ...editing.proposed }}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            await api("imports/" + job.id + "/review", "POST", {
              rows: [
                {
                  id: editing.id,
                  decision: "REVIEW",
                  verified: false,
                  proposed: p,
                },
              ],
            });
            setEditing(null);
            await open(job.id);
          }}
        />
      )}
    </>
  );
}
