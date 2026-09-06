import { getDB } from "@/backend/core/db";
import { catalog } from "@/backend/storefront/service";
import { publicUrl } from "@/backend/storefront/pages";
import { appPath } from "@/shared/paths";
import "@/frontend/storefront.css";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: slug + " | AMT Electric",
    description: "Shop " + slug + " electrical supplies",
    alternates: {
      canonical: publicUrl("/store/categories/" + encodeURIComponent(slug)),
    },
  };
}
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const c = await catalog(await getDB(), { category: slug, pageSize: 48 });
  return (
    <main className="sf-public-page">
      <a href={appPath("/store")}>AMT Electric · المتجر</a>
      <h1>{slug}</h1>
      <div className="sf-home-products">
        {c.items.map((p) => (
          <a
            className="sf-product"
            href={appPath("/store/products/" + (p.slug || p.id))}
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
