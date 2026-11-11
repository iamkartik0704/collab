/**
 * Browser-side API client. Same-origin cookies only; on `401 token_expired` it rotates the
 * session once through /api/auth/refresh (shared across concurrent calls) and retries.
 */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
      if (response.status === 409) {
        // Another tab rotated it a moment ago; the cookies are already fresh.
        await new Promise((resolve) => setTimeout(resolve, 250));
        return true;
      }
      return response.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

export interface ApiRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, request: ApiRequest = {}, allowRefresh = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...request.headers };
  if (request.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method: request.method ?? "GET",
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    credentials: "same-origin",
    signal: request.signal,
  });

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (response.status === 401 && error?.code === "token_expired" && allowRefresh && (await refreshSession())) {
      return apiFetch<T>(path, request, false);
    }
    throw new ApiClientError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? "Something went wrong. Please try again.",
      error?.details,
    );
  }
  return payload as T;
}

/** 32-char key for the Idempotency-Key header (one per user-initiated attempt). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Downloads a file from an authenticated GET endpoint (CSV exports). Uses fetch rather than a
 * plain link so an expired access token is rotated first instead of saving a JSON error file.
 */
export async function downloadFile(path: string, fallbackName: string, allowRefresh = true): Promise<void> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "text/csv, application/octet-stream, */*" } });
  if (response.status === 401 && allowRefresh && (await refreshSession())) return downloadFile(path, fallbackName, false);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiClientError(response.status, payload?.error?.code ?? "download_failed", payload?.error?.message ?? "The export could not be downloaded.");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
