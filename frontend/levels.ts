import type { Translate } from "./api";
export const levelCodes = ["WHOLESALE", "RETAIL", "END_CUSTOMER"] as const;
export function levelLabel(code: string | undefined, t: Translate) {
  return code === "WHOLESALE"
    ? t("Wholesale", "الجملة")
    : code === "RETAIL"
      ? t("Retail", "التجزئة")
      : t("End Customer", "العميل النهائي");
}
export function visibleLevels(
  product: any,
): { code: string; masterExcl: string; masterIncl: string; method?: string }[] {
  return (
    product.sellingLevels ?? [
      {
        code: "END_CUSTOMER",
        masterExcl: product.masterExcl,
        masterIncl: product.masterIncl,
      },
    ]
  );
}
