import { appPath } from "../shared/paths";
// Memory-only state survives development hot-module replacement; never persisted.
const sessionState = globalThis as typeof globalThis & { amtCsrf?: string };
export const setCsrf = (value: string) => {
  sessionState.amtCsrf = value;
};
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const form = body instanceof FormData;
  let result: Response;
  try {
    result = await fetch(appPath("/api/v1/" + path), {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(!form && body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(method !== "GET"
          ? { "X-CSRF-Token": sessionState.amtCsrf ?? "" }
          : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch (error) {
    window.dispatchEvent(new Event("amt-connection-lost"));
    throw error;
  }
  if (result.status === 503)
    window.dispatchEvent(new Event("amt-connection-lost"));
  const data = await result.json();
  if (!result.ok) {
    if (result.status === 401 && path !== "auth/login" && path !== "auth/me")
      window.dispatchEvent(new Event("amt-session-expired"));
    const details = Array.isArray(data.details)
      ? data.details
          .map((i: any) => `${i.path?.join(".")}: ${i.message}`)
          .join("; ")
      : "";
    const error = new Error(
      data.error + (details ? " — " + details : ""),
    ) as Error & { status: number };
    error.status = result.status;
    throw error;
  }
  return data;
}
export type Translate = (en: string, ar: string) => string;
