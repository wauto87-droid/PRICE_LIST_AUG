"use client";
import { useState } from "react";
import ResponsiveTable from "./ResponsiveTable";
type Row = Record<string, any>;
export default function CollectionAssignmentTable({ lines, staff, suppliers, revision, busy, early = false, quoteVersion, orderId, admin, submit }: {
  lines: Row[]; staff: Row[]; suppliers: Row[]; revision: number; busy: boolean; early?: boolean; quoteVersion?: number; orderId?: string; admin: boolean; submit: (value: Row) => Promise<unknown>;
}) {
  const [owners, setOwners] = useState<Record<string,string>>({});
  const [picked, setPicked] = useState<string[]>(early ? [] : lines.map(line => line.itemId));
  const [basis, setBasis] = useState(revision);
  const [error, setError] = useState("");
  if (!lines.length) return null;
  return <form onSubmit={async event => {
    event.preventDefault();
    if (basis !== revision) return;
    const values = new FormData(event.currentTarget);
    const selected = lines.filter(line => picked.includes(line.itemId));
    if (!selected.length || selected.some(line => !owners[line.itemId])) { setError("Select items and an assigned staff member for each item."); return; }
    const saved = await submit({ action: early ? "authorizeEarlyCollection" : "approveCollection", revision: basis, quoteVersion, orderId,
      reason: values.get("reason") || "", overrideReason: values.get("overrideReason") || "", poReference: values.get("poReference") || "",
      lines: selected.map(line => ({ itemId: line.itemId, offerId: line.offerId, quantity: early ? values.get(`quantity:${line.itemId}`) : String(line.remainingToAssign), owner: owners[line.itemId], due: values.get("due") || "" })) });
    if (saved === true) { setPicked([]); setOwners({}); setError(""); }
  }}>
    <h4>{early ? "Authorize early collection" : "Assign collection"}</h4>
    {early && <p role="note">Unconfirmed early collection · Customer confirmation is required before delivery.</p>}
    {basis !== revision && <p role="alert">Workflow changed. Your selections are retained. Review current quantities, then <button type="button" onClick={() => setBasis(revision)}>Use updated version</button>.</p>}
    <label>Bulk assign selected items<select disabled={busy || !picked.length} defaultValue="" onChange={event => { const owner = event.target.value; if (owner) setOwners(current => ({ ...current, ...Object.fromEntries(picked.map(id => [id, owner])) })); }}><option value="">Choose staff</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <div className="table-scroll"><ResponsiveTable><thead><tr><th>Select</th><th>Product / supplier</th><th>Quantity</th><th>Assigned staff</th></tr></thead><tbody>{lines.map(line => <tr key={line.itemId}>
      <td><input type="checkbox" aria-label={`Select collection ${line.name}`} checked={picked.includes(line.itemId)} disabled={busy} onChange={event => setPicked(current => event.target.checked ? [...current,line.itemId] : current.filter(id => id !== line.itemId))}/></td>
      <td><strong>{line.partNumber || "—"}</strong> {line.name}<small>{suppliers.find(shop => shop.id === line.supplier)?.name || line.supplier || "Supplier pending"} · {line.unit}</small></td>
      <td>{early ? <input type="number" name={`quantity:${line.itemId}`} aria-label={`Early quantity ${line.name}`} defaultValue={line.remainingToAssign} min="0.000001" max={line.remainingToAssign} step="any" required disabled={busy || !picked.includes(line.itemId)}/> : `${line.remainingToAssign} ${line.unit}`}</td>
      <td><select aria-label={`Assigned collector ${line.name}`} required={picked.includes(line.itemId)} disabled={busy} value={owners[line.itemId] || ""} onChange={event => setOwners(current => ({ ...current,[line.itemId]:event.target.value }))}><option value="">Choose staff</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></td>
    </tr>)}</tbody></ResponsiveTable></div>
    {early && <label>Reason for early collection<input name="reason" required minLength={5} maxLength={1000}/></label>}
    <label>PO reference (optional)<input name="poReference" maxLength={500}/></label><label>Deadline (optional)<input name="due" type="date"/></label>
    {admin && <label>Administrator reason<input name="overrideReason" required minLength={5}/></label>}
    {error && <p role="alert">{error}</p>}
    <button className="primary" disabled={busy || !picked.length || basis !== revision}>{early ? "Authorize selected early quantities" : "Save collection assignments"}</button>
  </form>;
}
