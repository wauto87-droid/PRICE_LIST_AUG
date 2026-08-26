import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AMT Electric Price List",
  description: "AMT Electric — secure price lookup and quotations",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "AMT Electric",
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
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(async rs=>{for(const r of rs){if(r.scope===location.origin+'/')await r.unregister();}for(const k of await caches.keys()){if(k.startsWith('amt-shell-'))await caches.delete(k);}if(rs.some(r=>r.scope===location.origin+'/'))location.reload();});}",
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
