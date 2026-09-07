import { getDB, one } from "@/backend/core/db";
import { notFound } from "next/navigation";
import { catalog } from "@/backend/storefront/service";
import { publicUrl, categorySeo } from "@/backend/storefront/pages";
import { appPath } from "@/shared/paths";
import "@/frontend/storefront.css";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const seo=await categorySeo(slug);
  return {
    title: seo.title || slug + " | AMT Electric",
    description: seo.description || "Shop " + slug + " electrical supplies",
    alternates: {
      canonical: publicUrl("/store/categories/" + encodeURIComponent(slug)),
    },
  };
}
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const seo=await categorySeo(slug);
  const db = await getDB();
  const settings = await one(db, "SELECT enabled FROM storefront_settings WHERE id=1");
  const category = await one(db, "SELECT id FROM categories WHERE name=$1 AND active", [slug]);
  if (!settings?.enabled || !category) notFound();
  const c = await catalog(db, { category: slug, pageSize: 48 });
  return (
    <main className="sf-public-page">
      <a href={appPath("/store")}>AMT Electric · المتجر</a>
      <h1>{slug}</h1>
      {seo.titleAr&&<h2 lang="ar" dir="rtl">{seo.titleAr}</h2>}
      {seo.description&&<p>{seo.description}</p>}
      {seo.descriptionAr&&<p lang="ar" dir="rtl">{seo.descriptionAr}</p>}
      <div className="sf-home-products">
        {!c.items.length && <p>No published products in this category yet. · لا توجد منتجات منشورة في هذا القسم حالياً.</p>}
        {c.items.map((p) => (
          <a
            className="sf-product"
            href={appPath("/store/products/" + encodeURIComponent(p.slug || p.id))}
            key={p.id}
          >
            {p.images[0] && <img src={p.images[0].url} alt={p.description} />}
            <div className="sf-product-body">
              <h2>{p.description}</h2>
              <p>{p.part_number}</p>
              <strong>
                {p.priceIncl === null ? "Request price" : "SAR " + p.priceIncl}
              </strong>
            </div>
          </a>
        ))}
      </div>
      <a href={appPath("/store") + "?category=" + encodeURIComponent(slug)}>
        Browse all {c.total} products · عرض جميع المنتجات
      </a>
    </main>
  );
}
