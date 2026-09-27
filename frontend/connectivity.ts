export type HealthTransition = {
  failures: number;
  state: "ONLINE" | "OFFLINE" | "UNCHANGED";
};

export function healthTransition(
  failures: number,
  successful: boolean,
  browserOnline = true,
): HealthTransition {
  if (!browserOnline) return { failures: 3, state: "OFFLINE" };
  if (successful) return { failures: 0, state: "ONLINE" };
  const next = failures + 1;
  return {
    failures: next,
    state: next >= 3 ? "OFFLINE" : "UNCHANGED",
  };
}
