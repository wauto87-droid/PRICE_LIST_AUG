"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { appPath } from "../shared/paths";

export default function StoreProductEditLink({ productId }: { productId: string }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    api("auth/me").then(result => {
      const permissions = result.user?.permissions || [];
      if (active) setAllowed(["STOREFRONT_MANAGE", "PRODUCT_EDIT", "PRODUCT_VIEW"].every(p => permissions.includes(p)));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return allowed ? <a href={appPath("/") + "?commerce=storefront&storeTab=products&editProduct=" + encodeURIComponent(productId)} className="button">Edit product · تعديل المنتج</a> : null;
}
