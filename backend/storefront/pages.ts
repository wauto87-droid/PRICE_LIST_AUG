import { getDB, one } from "../core/db";
import { productDetail } from "./service";
import { appPath } from "../../shared/paths";
export const publicUrl = (p: string) =>
  new URL(
    appPath(p),
    process.env.PUBLIC_URL ||
      process.env.APP_ORIGIN ||
      "http://localhost:18180",
  ).toString();
export async function publicPage(slug: string) {
  const db = await getDB();
  if (
    !(await one(db, "SELECT enabled FROM storefront_settings WHERE id=1"))
      ?.enabled
  )
    return null;
  const p = await one(
    db,
    "SELECT id,storefront_content FROM products WHERE (storefront_slug=$1 OR id::text=$1) AND active AND storefront_published",
    [slug],
  );
  if (!p) return null;
  return {
    ...(await productDetail(db, p.id)),
    seo: p.storefront_content || {},
  };
}

export async function categorySeo(name: string) {
  const db=await getDB();
  const category=await one(db,'SELECT id FROM categories WHERE name=$1 AND active',[name]);
  if(!category)return {};
  const settings=await one(db,'SELECT enabled,data FROM storefront_settings WHERE id=1');
  return settings?.enabled ? settings.data.categorySeo?.[category.id] || {} : {};
}
