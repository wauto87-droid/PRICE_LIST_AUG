export const formatReusablePrice = (value: unknown) =>
  Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const formatReusableDiscount = (value: unknown) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });
export function moveReusableIndex(
  current: number,
  direction: 1 | -1,
  length: number,
) {
  if (!length) return -1;
  if (current < 0) return direction === 1 ? 0 : length - 1;
  return (current + direction + length) % length;
}
