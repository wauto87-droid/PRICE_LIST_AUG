import StoreProductEditLink from "@/frontend/StoreProductEditLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { publicPage, publicUrl } from "@/backend/storefront/pages";
import { appPath } from "@/shared/paths";
import "@/frontend/storefront.css";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await publicPage(slug);
  if (!p) return { title: "Product unavailable", robots: { index: false } };
  return {
    title: p.seo.seoTitle || p.description,
    description: p.seo.seoDescription || p.description,
    alternates: { canonical: publicUrl("/store/products/" + (p.slug || p.id)) },
    openGraph: {
      title: p.seo.seoTitle || p.description,
      description: p.seo.seoDescription || p.description,
      images: p.images.map((i) =>
        publicUrl(i.url.replace("/amt_price_list", "")),
      ),
    },
  };
}
export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const p = await publicPage(slug);
  if (!p) notFound();
  const structured = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.description,
    sku: p.part_number,
    description: p.content.description || p.description,
    image: p.images.map((i) => publicUrl(i.url.replace("/amt_price_list", ""))),
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    offers:
      p.priceIncl === null
        ? undefined
        : {
            "@type": "Offer",
            price: p.priceIncl,
            priceCurrency: "SAR",
            availability:
              p.availability === "BACKORDER"
                ? "https://schema.org/OutOfStock"
                : "https://schema.org/InStock",
            url: publicUrl("/store/products/" + (p.slug || p.id)),
          },
  };
  return (
    <main className="sf-public-page">
      <a href={appPath("/store")}>AMT Electric · المتجر</a>
      <nav>
        <a
          href={appPath(
            "/store/categories/" + encodeURIComponent(p.category || ""),
          )}
        >
          {p.category}
        </a>
      </nav>
      <div className="sf-public-product">
        <div>
          {p.images.map((i) => (
            <img key={i.id} src={i.url} alt={i.caption || p.description} />
          ))}
        </div>
        <article>
          <small>
            {p.brand} · {p.part_number}
          </small>
          <h1>{p.description}</h1>
          <StoreProductEditLink productId={p.id}/>
          <p>{p.content.description}</p>
          <h2>
            {p.priceIncl === null
              ? "Price on request · السعر عند الطلب"
              : "SAR " + p.priceIncl}
          </h2>
          <p>Including VAT · شامل الضريبة</p>
          <p>{p.availability}</p>
          <a
            className="sf-primary"
            href={appPath("/store") + "?q=" + encodeURIComponent(p.part_number)}
          >
            Choose quantity / request a quote · اختر الكمية / اطلب عرضاً
          </a>
          <p>
            Approved companies receive their assigned prices after signing in.
          </p>
          {Array.isArray(p.content.specifications) && (
            <dl>
              {p.content.specifications.map((s: any, i: number) => (
                <div key={i}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </article>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structured).replace(/</g, "\u003c"),
        }}
      />
    </main>
  );
}
