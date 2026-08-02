const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";
const DEFAULT_TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getAccessToken() {
  return localStorage.getItem("astra_access_token");
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("astra_access_token", access);
  localStorage.setItem("astra_refresh_token", refresh);
}

export function clearTokens() {
  localStorage.removeItem("astra_access_token");
  localStorage.removeItem("astra_refresh_token");
  localStorage.removeItem("astra_user");
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!headers.has("Content-Type") && options.body && !isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? mergeAbortSignals([options.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(408, "Request timed out. Is the backend running?");
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(408, "Request was cancelled or timed out.");
    }
    throw err;
  }

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const data = await response.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      detail = response.statusText || detail;
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
