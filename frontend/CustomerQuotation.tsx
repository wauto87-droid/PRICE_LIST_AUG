"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
export default function CustomerQuotation({ token }: { token: string }) {
  const [quote, setQuote] = useState<any>(),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  useEffect(() => {
    api("customer-quotation/" + encodeURIComponent(token))
      .then(setQuote)
      .catch((e) => setError(e.message));
  }, [token]);
  async function respond(decision: "ACCEPTED" | "DECLINED") {
    try {
      const note =
        (
          document.getElementById(
            "customer-response-note",
          ) as HTMLTextAreaElement
        )?.value || "";
      const result = await api(
        "customer-quotation/" + encodeURIComponent(token) + "/respond",
        "POST",
        { decision, note },
      );
      setDone(result.status);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (error)
    return (
      <main className="customer-quote-page">
        <div className="card notice error">{error}</div>
      </main>
    );
  if (!quote)
    return (
      <main className="customer-quote-page">
        <div className="card">Opening quotation…</div>
      </main>
    );
  return (
    <main className="customer-quote-page">
      <section className="card customer-quote-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">AMT ELECTRIC</div>
            <h1>{quote.number}</h1>
          </div>
          <span className="pill success">{quote.status}</span>
        </div>
        <h2>{quote.customer?.name || "Customer"}</h2>
        <div className="dense-table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Part number</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit excl. VAT</th>
                <th>Total incl. VAT</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line: any, index: number) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <strong>{line.partNumber}</strong>
                  </td>
                  <td>{line.description}</td>
                  <td>{line.price?.quantity}</td>
                  <td>{line.price?.finalExcl}</td>
                  <td>{line.price?.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="customer-quote-total">
          <span>Total / الإجمالي</span>
          <strong>SAR {quote.totals?.total}</strong>
        </div>
        {done ? (
          <div className="notice success">Response recorded: {done}</div>
        ) : (
          <div className="customer-response">
            <label>
              Message / ملاحظة
              <textarea id="customer-response-note" maxLength={1000} />
            </label>
            <div className="actions">
              <button className="primary" onClick={() => respond("ACCEPTED")}>
                Accept quotation / قبول العرض
              </button>
              <button className="danger" onClick={() => respond("DECLINED")}>
                Decline / رفض
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
