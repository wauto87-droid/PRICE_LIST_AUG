"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";
import type { AdminActionRunner } from "./admin-actions";
const levels = ["DEFAULT", "ALL", "WHOLESALE", "RETAIL", "END_CUSTOMER"];
const conditionFields = [
  "partNumber",
  "description",
  "brand",
  "category",
  "method",
  "sellingLevel",
  "state",
  "price",
  "changePercent",
];
const actionFields = [
  "decision",
  "verified",
  "brand",
  "category",
  "unit",
  "defaultLevel",
  "vat",
  "minimum",
  "minimumEnabled",
  "cost",
  "method",
  "markup",
  "listPrice",
  "baseDiscount",
  "fixedPrice",
  "active",
];
export default function BulkRules({
  t,
  importId,
  onApplied,
  actionBusy = false,
  onAction,
}: {
  t: Translate;
  importId?: string;
  onApplied?: () => Promise<void>;
  actionBusy?: boolean;
  onAction?: AdminActionRunner;
}) {
  const initial = {
    match: "ALL",
    conditions: [],
    actions: [
      {
        field: importId ? "decision" : "markup",
        operation: "SET",
        value: importId ? "UPDATE" : "25",
        level: "DEFAULT",
      },
    ],
  };
  const [definition, setDefinition] = useState<any>(initial),
    [saved, setSaved] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [rule, setRule] = useState<any>(null),
    [name, setName] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [ack, setAck] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selectionChanged, setSelectionChanged] = useState(false),
    [selected, setSelected] = useState<string[] | null>(null);
  const load = async () => {
    const [r, h] = await Promise.all([
      api("bulk-rules"),
      api("bulk-rules/history"),
    ]);
    setSaved(r);
    setHistory(h);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (actionBusy) return;
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
  const edit = (next: any) => {
    setDefinition(next);
    setPreview(null);
    setSelected(null);
  };
  const update = (group: string, index: number, field: string, value: string) =>
    edit({
      ...definition,
      [group]: definition[group].map((v: any, i: number) =>
        i === index ? { ...v, [field]: value } : v,
      ),
    });
  const view = async () => {
    setPreview(
      await api("bulk-preview", "POST", {
        scope: importId ? "IMPORT" : "CATALOG",
        ...(importId ? { importId } : {}),
        ...(rule?.active ? { ruleId: rule.id } : {}),
        definition,
        acknowledgeVerification: ack,
        ...(selected ? { selectedIds: selected } : {}),
      }),
    );
    setSelectionChanged(false);
  };
  return (
    <section className="review-panel bulk-rules">
      <h3>
        {t(
          "Select by rule · preview · apply",
          "تحديد بالقاعدة · معاينة · تطبيق",
        )}
      </h3>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      <p>
        {t(
          "Rules search the entire dataset, not just the visible page. Import rules only stage changes; confirm the import separately.",
          "تبحث القواعد في كامل البيانات. تغييرات الاستيراد مرحلية وتتطلب التأكيد لاحقاً.",
        )}
      </p>
      <div className="form-grid three">
        <label>
          Saved rule / قاعدة محفوظة
          <select
            value={rule?.id ?? ""}
            onChange={(e) => {
              const r = saved.find((x) => x.id === e.target.value);
              setRule(r ?? null);
              setName(r?.name ?? "");
              edit(r?.definition ?? initial);
            }}
          >
            <option value="">One-time / new rule</option>
            {saved.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name / الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Match / المطابقة
          <select
            value={definition.match}
            onChange={(e) => edit({ ...definition, match: e.target.value })}
          >
            <option value="ALL">All conditions / جميع الشروط</option>
            <option value="ANY">Any condition / أي شرط</option>
          </select>
        </label>
      </div>
      {["conditions", "actions"].map((group) => (
        <div key={group}>
          <h4>
            {group === "conditions"
              ? t("Selection conditions", "شروط التحديد")
              : t("Changes to apply", "التغييرات")}
          </h4>
          {definition[group].map((row: any, i: number) => (
            <div className="form-grid three" key={i}>
              <label>
                Field
                <select
                  value={row.field}
                  onChange={(e) => update(group, i, "field", e.target.value)}
                >
                  {(group === "conditions"
                    ? conditionFields
                    : actionFields.filter(
                        (f) =>
                          importId || !["decision", "verified"].includes(f),
                      )
                  ).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Level
                <select
                  value={row.level}
                  onChange={(e) => update(group, i, "level", e.target.value)}
                >
                  {levels.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                Operation
                <select
                  value={group === "conditions" ? row.operator : row.operation}
                  onChange={(e) =>
                    update(
                      group,
                      i,
                      group === "conditions" ? "operator" : "operation",
                      e.target.value,
                    )
                  }
                >
                  {(group === "conditions"
                    ? ["EQ", "CONTAINS", "PREFIX", "GTE", "LTE"]
                    : ["SET", "INCREASE_PERCENT", "DECREASE_PERCENT"]
                  ).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Value
                <input
                  value={row.value}
                  onChange={(e) => update(group, i, "value", e.target.value)}
                />
              </label>
              <button
                onClick={() =>
                  edit({
                    ...definition,
                    [group]: definition[group].filter(
                      (_: any, n: number) => i !== n,
                    ),
                  })
                }
              >
                Remove / إزالة
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              edit({
                ...definition,
                [group]: [
                  ...definition[group],
                  group === "conditions"
                    ? {
                        field: "partNumber",
                        operator: "PREFIX",
                        value: "",
                        level: "DEFAULT",
                      }
                    : {
                        field: importId ? "verified" : "markup",
                        operation: "SET",
                        value: importId ? "true" : "25",
                        level: "DEFAULT",
                      },
                ],
              })
            }
          >
            + {group === "conditions" ? "Condition / شرط" : "Action / إجراء"}
          </button>
        </div>
      ))}
      {importId && (
        <>
          <p>
            States: EXISTING, UNKNOWN, CHANGED, UNCHANGED, VALID, ERROR,
            DUPLICATE. Decisions: UPDATE, KEEP, SKIP, REVIEW. Verification: true
            / false. New items and uncertain OCR must be verified individually.
          </p>
          <div className="actions wrap">
            {["ALL", "VALID", "CHANGED", "UNKNOWN", "DUPLICATE", "ERROR"].map(
              (state) => (
                <button
                  key={state}
                  onClick={() =>
                    edit({
                      ...definition,
                      match: "ALL",
                      conditions:
                        state === "ALL"
                          ? []
                          : [
                              {
                                field: "state",
                                operator: "EQ",
                                value: state,
                                level: "DEFAULT",
                              },
                            ],
                    })
                  }
                >
                  Select {state}
                </button>
              ),
            )}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => {
                setAck(e.target.checked);
                setPreview(null);
              }}
            />
            I checked the selected source values / تحققت من القيم المحددة
          </label>
        </>
      )}
      <div className="actions wrap">
        <button disabled={busy} onClick={() => run(view)}>
          Preview all matches / معاينة المطابقات
        </button>
        <button
          disabled={busy || actionBusy || !name.trim()}
          onClick={() =>
            (onAction ?? (async (_messages, action) => action()))(
              {
                saving: "Saving rule…",
                success: "Rule saved",
                successDetail: "The pricing rule is ready to use.",
                error: "Rule could not be saved",
              },
              async () => {
                await api(
                  "bulk-rules" + (rule ? "/" + rule.id : ""),
                  rule ? "PUT" : "POST",
                  {
                    name,
                    definition,
                    active: rule?.active ?? true,
                    ...(rule ? { version: rule.version } : {}),
                  },
                );
                setRule(null);
                await load();
                setMessage("Rule saved");
              },
            )
          }
        >
          Save / rename
        </button>
        {rule && (
          <>
            <button
              disabled={busy || actionBusy}
              onClick={() =>
                (onAction ?? (async (_messages, action) => action()))(
                  {
                    saving: "Duplicating rule…",
                    success: "Rule duplicated",
                    successDetail: "A copy of the pricing rule was created.",
                    error: "Rule could not be duplicated",
                  },
                  async () => {
                    await api("bulk-rules", "POST", {
                      name: name + " (copy)",
                      definition,
                      active: true,
                    });
                    await load();
                  },
                )
              }
            >
              Duplicate
            </button>
            <button
              disabled={busy || actionBusy}
              onClick={() =>
                (onAction ?? (async (_messages, action) => action()))(
                  {
                    saving: rule.active
                      ? "Deactivating rule…"
                      : "Activating rule…",
                    success: rule.active ? "Rule deactivated" : "Rule activated",
                    successDetail: "The saved rule status was updated.",
                    error: "Rule status could not be changed",
                  },
                  async () => {
                    await api("bulk-rules/" + rule.id, "PUT", {
                      name,
                      definition,
                      active: !rule.active,
                      version: rule.version,
                    });
                    setRule(null);
                    await load();
                  },
                )
              }
            >
              {rule.active ? "Deactivate" : "Activate"}
            </button>
            <button
              disabled={busy || actionBusy}
              onClick={() =>
                (async () => {
                  if (
                    !(await showConfirm(
                      "Delete this saved rule? Execution history will be retained.",
                    ))
                  )
                    return;
                  await (onAction ?? (async (_messages, action) => action()))(
                    {
                      saving: "Deleting rule…",
                      success: "Rule deleted",
                      successDetail:
                        "The saved rule was removed and its history was kept.",
                      error: "Rule could not be deleted",
                    },
                    async () => {
                      await api("bulk-rules/" + rule.id, "DELETE");
                      setRule(null);
                      await load();
                    },
                  );
                })()
              }
            >
              Delete
            </button>
          </>
        )}
      </div>
      {preview && (
        <>
          <h4>
            {preview.matched} matches · {preview.errors} errors
          </h4>
          <p>
            Review the full values below. Preview expires after 30 minutes;
            concurrent changes require a new preview.
          </p>
          {selectionChanged && (
            <p role="status">
              Selection changed. Preview again before applying. / تغير التحديد،
              أعد المعاينة قبل التطبيق.
            </p>
          )}
          <div className="actions wrap">
            <button
              onClick={() => {
                setSelected(preview.items.map((i: any) => i.id));
                setPreview(null);
              }}
            >
              Select visible rows only
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setPreview(null);
              }}
            >
              Select all matching rows
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Part</th>
                  <th>Before → After (excl. VAT)</th>
                  <th>Decision / verification</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"Select " + item.partNumber}
                        checked={selected === null || selected.includes(item.id)}
                        onChange={(e) => {
                          setSelected(
                            e.target.checked
                              ? [...(selected ?? []), item.id]
                              : (selected ?? preview.items.map((i: any) => i.id)).filter((id: string) => id !== item.id),
                          );
                          setSelectionChanged(true);
                        }}
                      />
                    </td>
                    <td>
                      {item.partNumber}
                      <small>{item.states.join(", ")}</small>
                    </td>
                    <td>
                      {item.differences.map((d: any) => (
                        <div key={d.code}>
                          {d.code}: {d.before ?? "New"} → {d.after} (
                          {d.changePercent ?? "—"}%)
                        </div>
                      ))}
                    </td>
                    <td>
                      {item.decision} {String(item.verified ?? "")}
                      <strong role={item.error ? "alert" : undefined}>
                        {item.error}
                      </strong>
                    </td>
                    <td>
                      <details>
                        <summary>Exact changes</summary>
                        <pre>
                          {JSON.stringify(
                            { before: item.before, after: item.after },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions wrap">
            <button
              disabled={busy || preview.page === 0}
              onClick={() =>
                run(async () =>
                  setPreview(
                    await api(
                      `bulk-preview/${preview.id}?page=${preview.page - 1}`,
                    ),
                  ),
                )
              }
            >
              Previous
            </button>
            <span>Page {preview.page + 1}</span>
            <button
              disabled={busy || (preview.page + 1) * 50 >= preview.matched}
              onClick={() =>
                run(async () =>
                  setPreview(
                    await api(
                      `bulk-preview/${preview.id}?page=${preview.page + 1}`,
                    ),
                  ),
                )
              }
            >
              Next
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                actionBusy ||
                selectionChanged ||
                !preview.matched ||
                preview.errors > 0
              }
              onClick={() =>
                (async () => {
                  if (
                    !(await showConfirm(
                      `Apply the reviewed rule to ${preview.matched} records?`,
                    ))
                  )
                    return;
                  await (onAction ?? (async (_messages, action) => action()))(
                    {
                      saving: importId
                        ? "Applying staged rule…"
                        : "Applying rule…",
                      success: importId
                        ? "Rule applied to import"
                        : "Rule applied to catalog",
                      successDetail: importId
                        ? "Changes were staged. Review and confirm the import."
                        : "The catalog was updated successfully.",
                      error: importId
                        ? "Rule could not be applied to the import"
                        : "Rule could not be applied to the catalog",
                    },
                    async () => {
                      await api("bulk-preview/" + preview.id, "POST");
                      setPreview(null);
                      setSelected(null);
                      await onApplied?.();
                      await load();
                      setMessage(
                        importId
                          ? "Changes staged. Review and confirm the import."
                          : "Catalog updated.",
                      );
                    },
                  );
                })()
              }
            >
              Apply reviewed preview
            </button>
          </div>
        </>
      )}
      <details>
        <summary>Rule execution history / سجل التنفيذ</summary>
        {history.map((h) => (
          <p key={h.id}>
            {new Date(h.created_at).toLocaleString()} · {h.scope} · {h.matched}{" "}
            matched · {h.actor_id}
          </p>
        ))}
      </details>
    </section>
  );
}
