export function humanizeCustomLineError(message: string) {
  if (/unrecognized_keys/i.test(message) && /override|reason/i.test(message))
    return "This custom item still contains old catalog-only pricing fields. Please save again.";
  if (/unitPriceExcl: Use a positive decimal, without commas/i.test(message))
    return "Enter unit price as a number like 12.5 or 100, without commas.";
  if (/quantity: Use a positive decimal, without commas/i.test(message))
    return "Enter quantity as a positive number without commas.";
  if (/description: .*required/i.test(message))
    return "Enter a description for the item.";
  if (/Part reference matches catalog item/i.test(message)) return message;
  return message
    .replace(/^\[\s*\{.*?"message":\s*"([^"]+)".*\}\s*\]$/i, "$1")
    .trim();
}
