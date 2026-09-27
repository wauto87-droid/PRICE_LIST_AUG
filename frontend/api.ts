import { appPath } from "../shared/paths";
// Memory-only state survives development hot-module replacement; never persisted.
const sessionState = globalThis as typeof globalThis & { amtCsrf?: string };
const jsonContentType =
  /\b(?:application\/json|application\/[\w.+-]+\+json)\b/i;
export const setCsrf = (value: string) => {
  sessionState.amtCsrf = value;
};
export type ApiOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  affectsConnectivity?: boolean;
};
export const requestWasCancelled = (error: unknown) =>
  (error as any)?.name === "AbortError" || (error as any)?.code === "REQUEST_CANCELLED";
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
  options: ApiOptions = {},
): Promise<T> {
  const form = body instanceof FormData;
  let result: Response;
  const timeout = options.timeoutMs
    ? AbortSignal.timeout(options.timeoutMs)
    : undefined;
  const signal = options.signal && timeout
    ? AbortSignal.any([options.signal, timeout])
    : options.signal ?? timeout;
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
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      const cancelled = new Error("Request cancelled") as Error & { code: string };
      cancelled.name = "AbortError";
      cancelled.code = "REQUEST_CANCELLED";
      throw cancelled;
    }
    if (timeout?.aborted) {
      const timedOut = new Error("The request took too long. Try again.") as Error & { code: string };
      timedOut.code = "REQUEST_TIMEOUT";
      throw timedOut;
    }
    if (error instanceof TypeError) {
      const unreachable = new Error(
        "Cannot reach the server. Check your connection and try again.",
      ) as Error & { code: string; affectsConnectivity: boolean };
      unreachable.code = "NETWORK_UNREACHABLE";
      unreachable.affectsConnectivity = options.affectsConnectivity ?? false;
      throw unreachable;
    }
    throw error;
  }
  // A provider-specific 503 (for example WhatsApp) is not a lost connection.
  // The app health probe determines server availability; keep HTTP errors local.
  if (result.status === 401 && path !== "auth/login" && path !== "auth/me")
    window.dispatchEvent(new Event("amt-session-expired"));
  const data = await readApiResponse(result);
  if (
    data?.error === "MAINTENANCE_MODE" ||
    (result.status === 503 && data?.maintenance)
  ) {
    window.dispatchEvent(
      new CustomEvent("amt-maintenance-active", { detail: data.maintenance }),
    );
  }
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

export function uploadApi<T = any>(
  path: string,
  file: File,
  uploadId: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", appPath("/api/v1/" + path));
    request.withCredentials = true;
    request.timeout = 5 * 60 * 1000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-CSRF-Token", sessionState.amtCsrf ?? "");
    request.setRequestHeader("X-AMT-Filename", encodeURIComponent(file.name));
    request.setRequestHeader("X-AMT-Upload-ID", uploadId);
    request.setRequestHeader("X-AMT-File-Size", String(file.size));
    request.upload.onprogress = (event) =>
      onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size);
    request.onerror = () => reject(new Error("Upload interrupted. Check the connection and retry."));
    request.ontimeout = () => reject(new Error("Upload took too long. Retry the same file."));
    request.onabort = () => {
      const cancelled = new Error("Upload cancelled") as Error & { code: string };
      cancelled.name = "AbortError";
      cancelled.code = "REQUEST_CANCELLED";
      reject(cancelled);
    };
    request.onload = () => {
      let data: any = null;
      try {
        data = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        reject(new Error("The server returned an unexpected upload response."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        const error = new Error(data?.error || `Upload failed (${request.status})`) as Error & { status: number };
        error.status = request.status;
        reject(error);
        return;
      }
      resolve(data as T);
    };
    request.send(file);
  });
}
export type Translate = (en: string, ar: string) => string;
export async function downloadApi(path: string, body: unknown, filename: string) {
 const result=await fetch(appPath('/api/v1/'+path),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':sessionState.amtCsrf??''},body:JSON.stringify(body)});
 if(!result.ok){const data=await readApiResponse(result);throw new Error(data?.error||`Export failed (${result.status})`);}
 const url=URL.createObjectURL(await result.blob());const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
