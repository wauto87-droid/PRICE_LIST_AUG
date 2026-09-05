"use client";
import { useState } from "react";
import type { Translate } from "./api";

export default function BasicImportRepairRow({ row, source, priceType, editable, index, t, onSave }: { row:any; source:{partNumber:unknown;description:unknown;price:unknown;adjustment:unknown}; priceType:"LIST_DISCOUNT"|"COST_MARKUP"; editable:boolean; index:number; t:Translate; onSave:(values:{partNumber:string;description:string;price:string;adjustment:string})=>Promise<void> }) {
  const end=(row.proposed?.levels ?? []).find((level:any)=>level.code==="END_CUSTOMER");
  const [values,setValues]=useState({
    partNumber:String(row.proposed?.partNumber ?? ""), description:String(row.proposed?.description ?? ""),
    price:String(priceType==="COST_MARKUP" ? row.proposed?.cost ?? "" : end?.listPrice ?? row.proposed?.listPrice ?? ""),
    adjustment:String(priceType==="COST_MARKUP" ? end?.markup ?? row.proposed?.markup ?? "" : end?.baseDiscount ?? row.proposed?.baseDiscount ?? ""),
  });
  const [saving,setSaving]=useState(false),[message,setMessage]=useState("");
  const price=Number(values.price), adjustment=Number(values.adjustment || 0);
  const final=Number.isFinite(price)&&Number.isFinite(adjustment) ? (priceType==="COST_MARKUP" ? price*(1+adjustment/100) : price*(1-adjustment/100)) : null;
  async function save(field?:string){setSaving(true);setMessage("");try{await onSave(values);setMessage(t("Saved","تم الحفظ"));if(field){const next=document.querySelector<HTMLInputElement>(`[data-basic-repair-index="${index+1}"][name="${field}"]`);next?.focus();next?.select();}}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}}
  return <div className="basic-repair-editor" data-basic-repair-index={index}>
    {([['partNumber',t("Part Number","رقم الصنف")],['description',t("Description","الوصف")],['price',t("Price","السعر")],['adjustment',priceType==="COST_MARKUP"?t("Markup %","الزيادة %"):t("Discount %","الخصم %")]] as const).map(([field,label])=><label key={field}><span>{label}</span><input name={field} disabled={!editable||saving} inputMode={field==="price"||field==="adjustment"?"decimal":undefined} value={values[field]} onChange={e=>setValues({...values,[field]:e.target.value})} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void save(field)}}}/><small title={String(source[field] ?? "")}>{t("Source", "المصدر")}: {String(source[field] ?? "—")}</small></label>)}
    <div className="basic-repair-final"><span>{t("Normalized final excl. VAT","السعر النهائي قبل الضريبة")}</span><strong>{final==null?"—":final.toFixed(2)}</strong></div>
    {editable&&<button type="button" disabled={saving} onClick={()=>void save()}>{saving?t("Saving…","جارٍ الحفظ…"):t("Save row","حفظ الصف")}</button>}{message&&<small>{message}</small>}
  </div>;
}
