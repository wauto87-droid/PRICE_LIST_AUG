const linePrefix = (message: string) => {
  const match = message.match(/lines\.(\d+)\./i);
  return match ? `Line ${Number(match[1]) + 1}: ` : "";
};

export function humanizeCustomLineError(message: string) {
  const prefix = linePrefix(message);
  if (message.trim().startsWith("[")) {
    try {
      const issues = JSON.parse(message);
      if (Array.isArray(issues) && issues.length) {
        const issue = issues[0];
        const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
        const issueMsg = String(issue.message || "");
        if (/unitPriceExcl/i.test(path) || /unitPriceExcl/i.test(issueMsg)) {
          return `${prefix}Enter unit price as a number like 12.5 or 100, without commas.`;
        }
        if (/quantity/i.test(path) || /quantity/i.test(issueMsg)) {
          return `${prefix}Enter quantity as a positive number without commas.`;
        }
        if (/discount/i.test(path) || /discount/i.test(issueMsg)) {
          if (/Maximum/i.test(issueMsg)) return `${prefix}Discount cannot be more than 100%.`;
          return `${prefix}Enter discount as a number like 0, 5, or 12.5 without commas.`;
        }
        if (/description/i.test(path)) {
          return `${prefix}Enter a description for the item.`;
        }
        if (/partNumber/i.test(path)) {
          return `${prefix}Enter a part number or reference for the item.`;
        }
        if (issue.message) return `${prefix}${issue.message}`;
      }
    } catch {}
  }
  if (/unrecognized_keys/i.test(message) && /override|reason/i.test(message))
    return `${prefix}This custom item still contains old catalog-only pricing fields. Please save again.`;
  if (/Please correct the highlighted values\s*—\s*Invalid input/i.test(message))
    return `${prefix}One of the quotation lines still has an invalid value. Check quantity and unit price.`;
  if (/unitPriceExcl.*Use a positive decimal, without commas/is.test(message))
    return `${prefix}Enter unit price as a number like 12.5 or 100, without commas.`;
  if (/quantity.*Use a positive decimal, without commas/is.test(message))
    return `${prefix}Enter quantity as a positive number without commas.`;
  if (/discount.*Use a positive decimal, without commas/is.test(message))
    return `${prefix}Enter discount as a number like 0, 5, or 12.5 without commas.`;
  if (/discount.*Maximum is 100%/is.test(message))
    return `${prefix}Discount cannot be more than 100%.`;
  if (/description: .*required/i.test(message))
    return `${prefix}Enter a description for the item.`;
  if (/partNumber: .*required/i.test(message))
    return `${prefix}Enter a part number or reference for the item.`;
  if (/Part reference matches catalog item/i.test(message)) return message;
  return message
    .replace(/^\[\s*\{[\s\S]*?"message":\s*"([^"]+)"[\s\S]*\}\s*\]$/i, "$1")
    .replace(/^Please correct the highlighted values\s*—\s*/i, prefix)
    .trim();
}
