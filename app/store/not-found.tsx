import { appPath } from "@/shared/paths";
export default function StoreNotFound() {
  return <main className="sf-public-page"><h1>Page unavailable · الصفحة غير متاحة</h1><p>This product or category is unavailable.</p><a href={appPath("/store")}>Return to store · العودة للمتجر</a></main>;
}
