'use client';
import { useEffect,useRef,useState,type ReactNode } from 'react';
export function DNDialog({title,close,children,wide=false}: {title:string;close:()=>void;children:ReactNode;wide?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
 return <dialog ref={ref} className={'dn-dialog '+(wide?'dn-wide':'')} onCancel={e=>{e.preventDefault();close();}}><div className="section-heading"><h2>{title}</h2><button type="button" aria-label="Close / إغلاق" onClick={close}>×</button></div>{children}</dialog>;
}
export function CustomerPicker({label,customers,value,onChange}:any) {const [search,setSearch]=useState('');return <details className="dn-picker"><summary>{label} ({value.length})</summary><input aria-label={label} placeholder={label} value={search} onChange={e=>setSearch(e.target.value)}/><div>{customers.filter((c:any)=>c.customer.toLowerCase().includes(search.toLowerCase())).map((c:any)=><label key={c.customer_key}><input type="checkbox" checked={value.includes(c.customer_key)} onChange={e=>onChange(e.target.checked?[...value,c.customer_key]:value.filter((k:string)=>k!==c.customer_key))}/>{c.customer}</label>)}</div></details>;}
