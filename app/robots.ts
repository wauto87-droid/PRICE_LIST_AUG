import type { MetadataRoute } from "next";
import { publicUrl } from "@/backend/storefront/pages";
import { appPath } from "@/shared/paths";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: appPath("/store"),
      disallow: [appPath("/api/"), appPath("/customer-quotation/")],
    },
    sitemap: publicUrl("/sitemap.xml"),
  };
}
