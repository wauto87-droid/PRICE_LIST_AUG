const linePrefix = (message: string) => {
  const match = message.match(/lines\.(\d+)\./i);
  return match ? `Line ${Number(match[1]) + 1}: ` : "";
};

export function humanizeCustomLineError(message: string) {
  const prefix = linePrefix(message);
  if (/unrecognized_keys/i.test(message) && /override|reason/i.test(message))
    return `${prefix}This custom item still contains old catalog-only pricing fields. Please save again.`;
  if (/Please correct the highlighted values\s*—\s*Invalid input/i.test(message))
    return `${prefix}One of the quotation lines still has an invalid value. Check quantity, unit price, and description.`;
  if (/unitPriceExcl: Use a positive decimal, without commas/i.test(message))
    return `${prefix}Enter unit price as a number like 12.5 or 100, without commas.`;
  if (/quantity: Use a positive decimal, without commas/i.test(message))
    return `${prefix}Enter quantity as a positive number without commas.`;
  if (/discount: Use a positive decimal, without commas/i.test(message))
    return `${prefix}Enter discount as a number like 0, 5, or 12.5 without commas.`;
  if (/discount: Maximum is 100%/i.test(message))
    return `${prefix}Discount cannot be more than 100%.`;
  if (/description: .*required/i.test(message))
    return `${prefix}Enter a description for the item.`;
  if (/partNumber: .*required/i.test(message))
    return `${prefix}Enter a part number or reference for the item.`;
  if (/unitPriceExcl: Use a positive decimal, without commas/i.test(message))
    return `${prefix}Enter unit price as a number like 12.5 or 100, without commas.`;
  if (/Part reference matches catalog item/i.test(message)) return message;
  return message
    .replace(/^\[\s*\{.*?"message":\s*"([^"]+)".*\}\s*\]$/i, "$1")
    .replace(/^Please correct the highlighted values\s*—\s*/i, prefix)
    .trim();
}
