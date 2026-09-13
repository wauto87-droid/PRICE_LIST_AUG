"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "@/shared/paths";
import { showConfirm } from "./confirm";

export function ProductImageManager({ productId, t }: { productId: string; t: Translate }) {
  const [items,setItems]=useState<any[]>([]), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  const load=()=>api(`products/${productId}/images`).then(setItems).catch(e=>setError(e.message));
  useEffect(()=>{ void load(); },[productId]);
  async function upload(file?:File){ if(!file)return; setBusy(true);setError(""); try { const form=new FormData();form.set("file",file); await api(`products/${productId}/images`,"POST",form); await load(); } catch(e){setError((e as Error).message)} finally{setBusy(false)} }
  async function save(next=items){setBusy(true);setError("");try{setItems(await api(`products/${productId}/images`,"PUT",{images:next.map(x=>({id:x.id,caption:x.caption??"",version:x.version}))}));}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <fieldset className="product-image-manager"><legend>{t("Product images","صور الصنف")}</legend>
    <p className="muted">{t("Up to 5 JPEG, PNG, or WebP images; 5 MB each.","حتى 5 صور JPEG أو PNG أو WebP؛ 5 ميجابايت لكل صورة.")}</p>
    <div className="product-image-grid">{items.map((item,index)=><div className="product-image-edit" key={item.id}>
      <img src={appPath(`/api/v1/product-images/${item.id}/thumbnail`)} alt={item.caption||item.original_name}/>
      <input value={item.caption??""} placeholder={t("Caption","وصف الصورة")} onChange={e=>setItems(v=>v.map(x=>x.id===item.id?{...x,caption:e.target.value}:x))}/>
      <div className="actions">{index===0 ? <span>{t("Cover image","الصورة الرئيسية")}</span> : <button type="button" disabled={busy} onClick={()=>void save([item,...items.filter(x=>x.id!==item.id)])}>{t("Make cover","تعيين كصورة رئيسية")}</button>}<button type="button" aria-label={t("Move image earlier","تقديم الصورة")} disabled={busy||index===0} onClick={()=>{const n=[...items];[n[index-1],n[index]]=[n[index],n[index-1]];void save(n)}}>↑</button><button type="button" disabled={busy||index===items.length-1} onClick={()=>{const n=[...items];[n[index+1],n[index]]=[n[index],n[index+1]];void save(n)}}>↓</button><button type="button" disabled={busy} onClick={async()=>{if(!await showConfirm(t("Delete this image?","حذف هذه الصورة؟"),{tone:"danger",confirmText:t("Delete","حذف"),title:t("Delete Image","حذف الصورة")}))return;setBusy(true);try{await api(`products/${productId}/images`,"DELETE",{imageId:item.id,version:item.version});await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>×</button></div>
    </div>)}</div>
    <div className="actions"><label className="button"><input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||items.length>=5} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void upload(file)}}/>{t("Upload image","رفع صورة")}</label>{items.length>0&&<button type="button" disabled={busy} onClick={()=>void save()}>{t("Save captions","حفظ الأوصاف")}</button>}</div>{error&&<div className="notice error">{error}</div>}
  </fieldset>;
}

export function ProductImageGallery({ productId, t }: { productId: string; t: Translate }) {
  const [open,setOpen]=useState(false),[items,setItems]=useState<any[]>([]),[index,setIndex]=useState(0),[error,setError]=useState("");
  async function show(){setOpen(true);try{setItems(await api(`products/${productId}/images`));}catch(e){setError((e as Error).message)}}
  const item=items[index];
  return <><button type="button" onClick={()=>void show()}>{t("View images","عرض الصور")}</button>{open&&<div className="modal-backdrop"><section className="modal product-gallery" role="dialog" aria-modal="true"><button className="modal-close" onClick={()=>setOpen(false)}>×</button><h3>{t("Product images","صور الصنف")}</h3>{error&&<div className="notice error">{error}</div>}{item&&<><img src={appPath(`/api/v1/product-images/${item.id}`)} alt={item.caption||item.original_name}/>{item.caption&&<p>{item.caption}</p>}<div className="actions"><button disabled={index===0} onClick={()=>setIndex(i=>i-1)}>{t("Previous","السابق")}</button><span>{index+1} / {items.length}</span><button disabled={index===items.length-1} onClick={()=>setIndex(i=>i+1)}>{t("Next","التالي")}</button><a className="button" href={appPath(`/api/v1/product-images/${item.id}?download=1`)}>{t("Download","تنزيل")}</a></div></>}</section></div>}</>;
}
