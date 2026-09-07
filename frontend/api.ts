import { appPath } from "../shared/paths";
// Memory-only state survives development hot-module replacement; never persisted.
const sessionState = globalThis as typeof globalThis & { amtCsrf?: string };
const jsonContentType =
  /\b(?:application\/json|application\/[\w.+-]+\+json)\b/i;
export const setCsrf = (value: string) => {
  sessionState.amtCsrf = value;
};
const unexpectedResponseError = (
  result: Response,
  contentType: string,
  raw: string,
) => {
  const preview = raw.trim().slice(0, 80).toLowerCase();
  const looksHtml =
    preview.startsWith("<!doctype") ||
    preview.startsWith("<html") ||
    preview.startsWith("<");
  const error = new Error(
    looksHtml
      ? "The server returned a page instead of app data. Refresh and try again."
      : `The server returned an unexpected response${contentType ? ` (${contentType})` : ""}. Refresh and try again.`,
  ) as Error & { status: number };
  error.status = result.status;
  return error;
};
export async function readApiResponse(result: Response) {
  if (result.status === 204) return null;
  const contentType = result.headers.get("content-type") ?? "";
  const raw = await result.text();
  if (!raw) return null;
  if (!jsonContentType.test(contentType))
    throw unexpectedResponseError(result, contentType, raw);
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error(
      "The server returned invalid data. Refresh and try again.",
    ) as Error & { status: number };
    error.status = result.status;
    throw error;
  }
}
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
  // A provider-specific 503 (for example WhatsApp) is not a lost connection.
  // The app health probe determines server availability; keep HTTP errors local.
  if (result.status === 401 && path !== "auth/login" && path !== "auth/me")
    window.dispatchEvent(new Event("amt-session-expired"));
  const data = await readApiResponse(result);
  if (!result.ok) {
    const details = Array.isArray(data?.details)
      ? data?.details
          .map((i: any) => {
            const pathLabel = Array.isArray(i.path)
              ? i.path.filter(Boolean).join(".")
              : "";
            return pathLabel ? `${pathLabel}: ${i.message}` : String(i.message);
          })
          .filter(Boolean)
          .join("; ")
      : "";
    const error = new Error(
      (data?.error || `Request failed (${result.status})`) +
        (details ? " — " + details : ""),
    ) as Error & { status: number };
    error.status = result.status;
    throw error;
  }
  return data;
}
export type Translate = (en: string, ar: string) => string;
