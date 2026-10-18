const sellingLevels = new Set(["WHOLESALE", "RETAIL", "END_CUSTOMER"]);

const text = (value: unknown, fallback = "") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

export function quotationSellingLevel(line: any) {
  const candidate =
    line?.input?.sellingLevel ??
    line?.sellingLevel ??
    line?.price?.sellingLevel;
  return sellingLevels.has(candidate) ? candidate : "END_CUSTOMER";
}

function compatibilityIssue(
  input: any,
  explicitKind: "CATALOG" | "CUSTOM" | "",
) {
  if (explicitKind === "CATALOG") {
    if (!text(input.productId))
      return "This saved catalog line is missing its product identity. Remove it and add the catalog item again.";
    if (!text(input.quantity))
      return "This saved catalog line is missing its quantity. Enter the quantity before saving.";
    return "";
  }
  if (explicitKind === "CUSTOM") {
    if (!text(input.description))
      return "This saved custom line is missing its description. Enter the description before saving.";
    if (!text(input.quantity))
      return "This saved custom line is missing its quantity. Enter the quantity before saving.";
    if (!text(input.unitPriceExcl) && input.importMeta?.unresolved !== true)
      return "This saved custom line is missing its unit price. Enter the price before saving.";
    return "";
  }
  return "This saved line is missing its catalog or custom-item identity. Remove it and add the item again.";
}

export function normalizeEditableQuotationLine(line: any) {
  const source = line && typeof line === "object" ? line : {};
  const existing =
    source.input && typeof source.input === "object" ? source.input : null;
  const ambiguousOrigin = source.compatibilityKind === "AMBIGUOUS";
  const explicitKind = ambiguousOrigin
    ? ""
    : existing?.type === "CUSTOM" || source.source === "CUSTOM"
      ? "CUSTOM"
      : existing?.type === "CATALOG" ||
          source.source === "CATALOG" ||
          text(existing?.productId ?? source.productId)
        ? "CATALOG"
        : "";
  const quantity = existing?.quantity !== undefined && existing.quantity !== null
    ? String(existing.quantity).trim()
    : text(source.price?.quantity ?? source.quantity, "1");
  let input: any;

  if (explicitKind === "CATALOG") {
    const adjustmentMode = source.price?.adjustmentMode;
    const requestedMarkup = existing
      ? existing.markup
      : (source.price?.requestedMarkup ?? source.markup);
    input = {
      ...(existing ?? {}),
      type: "CATALOG",
      productId: text(existing?.productId ?? source.productId),
      sellingLevel: quotationSellingLevel(source),
      quantity,
      discount: text(
        existing?.discount ??
          source.price?.requestedDiscount ??
          source.discount,
        "0",
      ),
      ...((existing && existing.markup !== undefined) ||
      (!existing &&
        (adjustmentMode === "MARKUP" || requestedMarkup !== undefined))
        ? { markup: text(requestedMarkup, "0") }
        : {}),
      override: existing?.override === true,
      reason: text(existing?.reason),
    };
  } else {
    input = {
      ...(existing ?? {}),
      type: "CUSTOM",
      partNumber: typeof existing?.partNumber === 'string' ? existing.partNumber : text(source.partNumber),
      description: typeof existing?.description === 'string' ? existing.description : text(source.description),
      unit: typeof existing?.unit === 'string' ? existing.unit : text(source.unit, "pcs"),
      quantity,
      unitPriceExcl: text(
        existing?.unitPriceExcl ??
          source.price?.finalExcl ??
          source.unitPriceExcl,
      ),
      discount: text(existing?.discount ?? source.discount, "0"),
      ...(existing?.markup !== undefined
        ? { markup: text(existing.markup, "0") }
        : {}),
      ...(existing?.importMeta || source.importMeta
        ? { importMeta: existing?.importMeta ?? source.importMeta }
        : {}),
      ...(existing?.watcherEventId || source.watcherEventId
        ? {
            watcherEventId: existing?.watcherEventId ?? source.watcherEventId,
          }
        : {}),
    };
  }

  const issue = compatibilityIssue(input, explicitKind);
  // Keep already-normalized row objects intact: sortable IDs, open details and
  // keyboard focus follow these references when the quotation order changes.
  if (existing && Object.keys(input).length === Object.keys(existing).length &&
      Object.keys(input).every(key => input[key] === existing[key]) &&
      (source.compatibilityIssue || '') === issue &&
      (explicitKind || source.compatibilityKind === 'AMBIGUOUS')) return source;
  const { compatibilityIssue: _oldIssue, ...preserved } = source;
  return {
    ...preserved,
    input,
    ...(!explicitKind ? { compatibilityKind: "AMBIGUOUS" } : {}),
    ...(issue ? { compatibilityIssue: issue } : {}),
  };
}

export function normalizeEditableQuotationCart(cart: any) {
  if (!cart || typeof cart !== "object") return cart;
  const lines = Array.isArray(cart.lines)
    ? cart.lines.map(normalizeEditableQuotationLine)
    : [];
  return { ...cart, lines };
}
