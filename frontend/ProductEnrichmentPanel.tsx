"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";

export default function ProductEnrichmentPanel({
  t,
  selected,
  setSelected,
  filters,
  onConfirmed,
}: {
  t: Translate;
  selected: Record<string, number>;
  setSelected: (value: Record<string, number>) => void;
  filters: any;
  onConfirmed: () => void;
}) {
  const [config, setConfig] = useState<any>(null),
    [key, setKey] = useState(""),
    [geminiKey, setGeminiKey] = useState(""),
    [model, setModel] = useState("gpt-5.4-nano"),
    [randomCount, setRandomCount] = useState("20"),
    [jobs, setJobs] = useState<any[]>([]),
    [current, setCurrent] = useState<any>(null),
    [reviewed, setReviewed] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = async () => {
    const [c, j] = await Promise.all([
      api("product-enrichment/configuration"),
      api("product-enrichment"),
    ]);
    setConfig(c);
    setModel(c.model);
    setJobs(j);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!current || !["PENDING", "RUNNING"].includes(current.status)) return;
    const timer = setInterval(
      () =>
        api("product-enrichment/" + current.id)
          .then(setCurrent)
          .catch(() => undefined),
      1500,
    );
    return () => clearInterval(timer);
  }, [current?.id, current?.status]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const suggestion = (row: any) => row.suggestion ?? {};
  const suggestionPayload = (row: any) => {
    const s = suggestion(row);
    return {
      description: s.description || "",
      shortDescription: s.shortDescription || "",
      detailedDescription: s.detailedDescription || "",
      manufacturer: s.manufacturer || "",
      productName: s.productName || "",
      productType: s.productType || "",
      series: s.series || "",
      specifications: s.specifications || [],
      applications: s.applications || [],
      confidence: s.confidence || row.confidence || "MEDIUM",
    };
  };
  const sourceLabel = (source: any) => {
    if (source.title) return source.title;
    try {
      return new URL(source.url).hostname;
    } catch {
      return t("Research source", "مصدر البحث");
    }
  };
  const updateLocal = (rowId: string, changes: any) =>
    setCurrent((c: any) => ({
      ...c,
      rows: c.rows.map((r: any) =>
        r.id === rowId
          ? { ...r, suggestion: { ...suggestion(r), ...changes } }
          : r,
      ),
    }));
  const saveRow = (row: any) =>
    run(async () => {
      setCurrent(
        await api(`product-enrichment/${row.id}/suggestion`, "PUT", {
          suggestion: suggestionPayload(row),
        }),
      );
      setMessage(t("Suggestion saved.", "تم حفظ الاقتراح."));
    });
  return (
    <section className="card product-enrichment-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {t("AI PRODUCT FINDER", "باحث تفاصيل المنتجات بالذكاء الاصطناعي")}
          </span>
          <h3>
            {t(
              "Find missing descriptions and product details",
              "البحث عن الأوصاف وتفاصيل المنتجات المفقودة",
            )}
          </h3>
          <p className="muted">
            {t(
              "AI suggestions are staged for review and never update products until you confirm selected rows.",
              "تظل اقتراحات الذكاء الاصطناعي للمراجعة ولا تُحدّث المنتجات حتى تؤكد الصفوف المحددة.",
            )}
          </p>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && <div className="notice success">{message}</div>}
      <details className="ai-config" open={!config?.configured}>
        <summary>
          {t("OpenAI configuration", "إعداد OpenAI")} ·{" "}
          {config?.configured
            ? t("Configured", "مُعد")
            : t("Not configured", "غير مُعد")}
        </summary>
        <div className="form-grid">
          <label>
            {t("OpenAI API key", "مفتاح OpenAI API")}
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              placeholder={config?.maskedKey || "sk-…"}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label>
            {t("Gemini API key", "مفتاح Gemini API")}
            <input
              type="password"
              autoComplete="new-password"
              value={geminiKey}
              placeholder={config?.geminiMaskedKey || "AIzaSy…"}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
          </label>
          <label>
            {t("Model", "النموذج")}
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
        </div>
        <div className="actions wrap">
          <button
            disabled={busy || (!key && !geminiKey && !config?.configured)}
            onClick={() =>
              void run(async () => {
                const payload: any = { model };
                if (key) payload.apiKey = key;
                if (geminiKey) payload.geminiApiKey = geminiKey;
                const next = await api(
                  "product-enrichment/configuration",
                  "PUT",
                  payload,
                );
                setConfig(next);
                setKey("");
                setGeminiKey("");
                setMessage(
                  t(
                    "AI configuration saved.",
                    "تم حفظ إعداد الذكاء الاصطناعي.",
                  ),
                );
              })
            }
          >
            {t("Save secure configuration", "حفظ الإعداد الآمن")}
          </button>
          <button
            disabled={busy || !config?.configured}
            onClick={() =>
              void run(async () => {
                await api("product-enrichment/configuration/test", "POST", {});
                setMessage(
                  t("API connection succeeded.", "نجح الاتصال بالـ API."),
                );
              })
            }
          >
            {t("Test connection", "اختبار الاتصال")}
          </button>
        </div>
        {config && !config.encryptionConfigured && (
          <div className="notice error">
            {t(
              "AI_SECRET_ENCRYPTION_KEY is missing on the server.",
              "مفتاح تشفير الذكاء الاصطناعي مفقود في الخادم.",
            )}
          </div>
        )}
      </details>
      <div className="actions wrap">
        <label className="inline-field">
          {t("Random count", "عدد عشوائي")}
          <input
            type="number"
            min="1"
            max="100"
            value={randomCount}
            onChange={(e) => setRandomCount(e.target.value)}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const rows = await api("product-enrichment/random", "POST", {
                filters,
                count: Number(randomCount),
              });
              setSelected(
                Object.fromEntries(rows.map((x: any) => [x.id, x.version])),
              );
              setMessage(
                t(
                  `${rows.length} random filtered products selected.`,
                  `${rows.length} منتجاً عشوائياً تمت تصفيته وتحديده.`,
                ),
              );
            })
          }
        >
          {t("Select random", "تحديد عشوائي")}
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !Object.keys(selected).length ||
            Object.keys(selected).length > 100 ||
            !config?.configured
          }
          onClick={() =>
            void run(async () => {
              const job = await api("product-enrichment", "POST", {
                items: Object.entries(selected).map(([id, version]) => ({
                  id,
                  version,
                })),
                filters,
              });
              const full = await api("product-enrichment/" + job.id);
              setCurrent(full);
              setSelected({});
              await load();
            })
          }
        >
          {t(
            `Find using AI (${Object.keys(selected).length})`,
            `البحث باستخدام الذكاء الاصطناعي (${Object.keys(selected).length})`,
          )}
        </button>
        {Object.keys(selected).length > 100 && (
          <span className="error-text">
            {t("Choose no more than 100 products.", "اختر 100 منتج كحد أقصى.")}
          </span>
        )}
      </div>
      {!!jobs.length && (
        <div className="actions wrap ai-job-history">
          <strong>{t("Recent research", "الأبحاث الأخيرة")}</strong>
          {jobs.map((job) => (
            <button
              key={job.id}
              className={current?.id === job.id ? "primary" : ""}
              onClick={() =>
                void api("product-enrichment/" + job.id).then((next) => {
                  setReviewed({});
                  setCurrent(next);
                })
              }
            >
              {new Date(job.created_at).toLocaleString()} · {job.status}
            </button>
          ))}
        </div>
      )}
      {current && (
        <div className="ai-review">
          <div className="section-heading">
            <div>
              <h3>{t("Research review", "مراجعة البحث")}</h3>
              <p>
                {current.status} · {current.progress?.processedRows ?? 0}/
                {current.progress?.totalRows ?? current.rows.length}
                {current.progress?.remainingSeconds > 0
                  ? ` · ~${current.progress.remainingSeconds}s`
                  : ""}
              </p>
            </div>
            {!["PENDING", "RUNNING"].includes(current.status) && (
              <button
                onClick={() =>
                  void run(async () => {
                    await api("product-enrichment/" + current.id, "DELETE");
                    setCurrent(null);
                    await load();
                  })
                }
              >
                {t("Delete report", "حذف التقرير")}
              </button>
            )}
          </div>
          <progress max="100" value={current.progress?.percentage ?? 0} />
          <div className="ai-review-list">
            {current.rows.map((row: any) => {
              const s = suggestion(row),
                ready = ["FOUND", "UNCERTAIN"].includes(row.status);
              return (
                <article
                  key={row.id}
                  className={`ai-review-row ${row.status.toLowerCase()}`}
                >
                  <div className="ai-review-select">
                    <input
                      type="checkbox"
                      disabled={!ready}
                      checked={!!reviewed[row.id]}
                      onChange={(e) =>
                        setReviewed({ ...reviewed, [row.id]: e.target.checked })
                      }
                    />
                    <div>
                      <strong>{row.source_part}</strong>
                      <span className="status">
                        {row.status} · {row.confidence || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="ai-original">
                    <small>{t("Original", "الأصلي")}</small>
                    <p>{row.original_description || "—"}</p>
                  </div>
                  {ready ? (
                    <div className="ai-suggestion form-grid">
                      <label className="span-all">
                        {t("Suggested description", "الوصف المقترح")}
                        <textarea
                          value={s.description || ""}
                          onChange={(e) =>
                            updateLocal(row.id, { description: e.target.value })
                          }
                        />
                      </label>
                      <label className="span-all">
                        {t("Short Description (Listings)", "وصف قصير")}
                        <textarea
                          value={s.shortDescription || ""}
                          onChange={(e) =>
                            updateLocal(row.id, { shortDescription: e.target.value })
                          }
                        />
                      </label>
                      <label className="span-all">
                        {t("Detailed Description (Product Page)", "وصف مفصل")}
                        <textarea
                          value={s.detailedDescription || ""}
                          onChange={(e) =>
                            updateLocal(row.id, { detailedDescription: e.target.value })
                          }
                        />
                      </label>
                      {[
                        ["manufacturer", "Manufacturer", "الشركة المصنعة"],
                        ["productName", "Product name", "اسم المنتج"],
                        ["productType", "Product type", "نوع المنتج"],
                        ["series", "Series", "السلسلة"],
                      ].map(([key, en, ar]) => (
                        <label key={key}>
                          {t(en, ar)}
                          <input
                            value={s[key] || ""}
                            onChange={(e) =>
                              updateLocal(row.id, { [key]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        {t(
                          "Specifications (one Label: Value per line)",
                          "المواصفات (الاسم: القيمة في كل سطر)",
                        )}
                        <textarea
                          value={(s.specifications || [])
                            .map((x: any) => `${x.label}: ${x.value}`)
                            .join("\n")}
                          onChange={(e) =>
                            updateLocal(row.id, {
                              specifications: e.target.value
                                .split("\n")
                                .filter(Boolean)
                                .map((line) => {
                                  const [label, ...rest] = line.split(":");
                                  return {
                                    label: label.trim(),
                                    value: rest.join(":").trim(),
                                  };
                                })
                                .filter((x) => x.label && x.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        {t(
                          "Applications (one per line)",
                          "الاستخدامات (واحد في كل سطر)",
                        )}
                        <textarea
                          value={(s.applications || []).join("\n")}
                          onChange={(e) =>
                            updateLocal(row.id, {
                              applications: e.target.value
                                .split("\n")
                                .map((x) => x.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                      <div className="actions wrap span-all">
                        <button onClick={() => void saveRow(row)}>
                          {t("Save edited suggestion", "حفظ الاقتراح المعدل")}
                        </button>
                        {(row.sources || []).map((source: any) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {sourceLabel(source)}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="notice">
                      {row.error ||
                        s.reason ||
                        t(
                          "No reliable exact match was found.",
                          "لم يتم العثور على تطابق دقيق موثوق.",
                        )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="actions wrap">
            <button
              className="primary"
              disabled={busy || !Object.values(reviewed).some(Boolean)}
              onClick={() =>
                void run(async () => {
                  const rowIds = Object.entries(reviewed)
                    .filter(([, v]) => v)
                    .map(([id]) => id);
                  for (const rowId of rowIds) {
                    const row = current.rows.find(
                      (item: any) => item.id === rowId,
                    );
                    if (row)
                      await api(
                        `product-enrichment/${row.id}/suggestion`,
                        "PUT",
                        { suggestion: suggestionPayload(row) },
                      );
                  }
                  await api(
                    `product-enrichment/${current.id}/confirm`,
                    "POST",
                    { rowIds },
                  );
                  setReviewed({});
                  setCurrent(await api("product-enrichment/" + current.id));
                  onConfirmed();
                  setMessage(
                    t(
                      `${rowIds.length} product(s) confirmed.`,
                      `تم تأكيد ${rowIds.length} منتج.`,
                    ),
                  );
                })
              }
            >
              {t(
                "Confirm selected reviewed rows",
                "تأكيد الصفوف المحددة بعد المراجعة",
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
