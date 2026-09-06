import type { MetadataRoute } from "next";
import { getDB, one } from "@/backend/core/db";
import { publicUrl } from "@/backend/storefront/pages";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = await getDB();
  const s = await one(db, "SELECT enabled FROM storefront_settings WHERE id=1");
  if (!s?.enabled) return [];
  const products = (
    await db.query(
      "SELECT id,storefront_slug FROM products WHERE active AND storefront_published ORDER BY id LIMIT 45000",
    )
  ).rows;
  const categories = (
    await db.query(
      "SELECT DISTINCT c.name FROM categories c JOIN products p ON p.category_id=c.id WHERE p.active AND p.storefront_published",
    )
  ).rows;
  return [
    { url: publicUrl("/store") },
    ...products.map((p) => ({
      url: publicUrl("/store/products/" + (p.storefront_slug || p.id)),
    })),
    ...categories.map((c) => ({
      url: publicUrl("/store/categories/" + encodeURIComponent(c.name)),
    })),
  ];
}
