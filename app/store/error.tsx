"use client";
import { appPath } from "@/shared/paths";
export default function StoreError({ reset }: { reset: () => void }) {
  return <main className="sf-public-page"><h1>Store temporarily unavailable · المتجر غير متاح مؤقتاً</h1><p>Please retry in a moment. Your saved cart is kept.</p><button onClick={reset}>Try again · حاول مرة أخرى</button> <a href={appPath("/store")}>Return to store · العودة للمتجر</a></main>;
}
