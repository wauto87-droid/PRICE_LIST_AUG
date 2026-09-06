"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
export default function StoreMerchandising({
  account,
  t,
  onBanners,
}: {
  account: any;
  t: Translate;
  onBanners: (v: boolean) => void;
}) {
  const [home, setHome] = useState<any>();
  useEffect(() => {
    let active = true;
    api("storefront/homepage")
      .then((r) => {
        if (active) {
          setHome(r);
          onBanners(r.banners.length > 0);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [account, onBanners]);
  if (!home) return null;
  return (
    <div className="sf-merchandising">
      {home.banners.map((b: any) => (
        <section className="sf-campaign" key={b.id}>
          {b.data.image && (
            <picture>
              {b.data.mobileImage && (
                <source
                  media="(max-width: 640px)"
                  srcSet={b.data.mobileImage}
                />
              )}
              <img src={b.data.image} alt="" loading="eager" />
            </picture>
          )}
          <div>
            <h2>{t(b.title, b.data.titleAr || b.title)}</h2>
            <p>{t(b.data.text, b.data.textAr || b.data.text)}</p>
            {b.data.link && (
              <a className="sf-primary" href={b.data.link}>
                {t(b.data.button, b.data.buttonAr || b.data.button)}
              </a>
            )}
          </div>
        </section>
      ))}
      {home.sections.map((s: any) => (
        <section className="sf-home-section" key={s.id}>
          <h2>{t(s.title, s.data.titleAr || s.title)}</h2>
          {["CATEGORIES", "BRANDS"].includes(s.data.sectionType) ? (
            <div className="sf-tabs">
              {s.data.names.map((n: string) => (
                <a
                  key={n}
                  href={
                    appPath("/store") +
                    "?" +
                    (s.data.sectionType === "CATEGORIES"
                      ? "category"
                      : "brand") +
                    "=" +
                    encodeURIComponent(n)
                  }
                >
                  {n}
                </a>
              ))}
            </div>
          ) : (
            <div className="sf-home-products">
              {s.items.map((p: any) => (
                <a
                  className="sf-product"
                  key={p.id}
                  href={appPath("/store/products/" + (p.slug || p.id))}
                >
                  {p.images[0] && (
                    <img
                      src={p.images[0].url}
                      alt={p.description}
                      loading="lazy"
                    />
                  )}
                  <div className="sf-product-body">
                    <small>{p.part_number}</small>
                    <h3>{p.description}</h3>
                    <strong>
                      {p.priceIncl === null
                        ? t("Request a quote", "طلب عرض سعر")
                        : "SAR " + p.priceIncl}
                    </strong>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
