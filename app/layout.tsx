import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appPath } from "../shared/paths";
import ConnectionNotice from "../frontend/ConnectionNotice";
export const metadata: Metadata = {
  title: "PRICE LIST",
  description: "AMT Electric — secure price lookup and quotations",
  manifest: appPath("/manifest.webmanifest"),
  icons: { icon: appPath("/icon-192.png"), apple: appPath("/icon-192.png") },
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "PRICE LIST",
    statusBarStyle: "default",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#cc0000",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConnectionNotice />
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(async rs=>{for(const r of rs){if(r.scope===location.origin+'/amt_price_list/')await r.unregister();}for(const k of await caches.keys()){if(k.startsWith('amt-price-list-shell-'))await caches.delete(k);}if(rs.some(r=>r.scope===location.origin+'/amt_price_list/'))location.reload();});}",
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
