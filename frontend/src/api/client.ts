export const API_BASE =
  import.meta.env.VITE_API_URL ?? "/api/v1";

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

async function toApiError(response: Response): Promise<ApiError> {
  let detail = "Request failed";
  try {
    const data = await response.json();
    detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    detail = response.statusText || detail;
  }
  return new ApiError(response.status, detail);
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = localStorage.getItem("astra_refresh_token");
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

function ensureRefresh(): Promise<boolean> {
  refreshInFlight ??= refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function notifySessionExpired() {
  clearTokens();
  window.dispatchEvent(new Event("astra:session-expired"));
}

async function handleUnauthorized(
  path: string,
  auth: boolean,
  error: ApiError,
): Promise<boolean> {
  if (!auth || error.status !== 401 || path === "/auth/refresh") {
    return false;
  }
  const refreshed = await ensureRefresh();
  if (refreshed) return true;
  notifySessionExpired();
  return false;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
): Promise<T> {
  const buildHeaders = () => {
    const headers = new Headers(options.headers);
    if (!headers.has("Content-Type") && options.body) {
      headers.set("Content-Type", "application/json");
    }
    if (auth) {
      const token = getAccessToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  };

  let response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const error = await toApiError(response);
    if (await handleUnauthorized(path, auth, error)) {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: buildHeaders(),
      });
      if (!response.ok) throw await toApiError(response);
    } else {
      throw error;
    }
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiForm<T>(
  path: string,
  formData: FormData,
  method: "POST" | "PATCH" = "POST",
): Promise<T> {
  const buildHeaders = () => {
    const headers = new Headers();
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  };

  let response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildHeaders(),
    body: formData,
  });

  if (!response.ok) {
    const error = await toApiError(response);
    if (await handleUnauthorized(path, true, error)) {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: buildHeaders(),
        body: formData,
      });
      if (!response.ok) throw await toApiError(response);
    } else {
      throw error;
    }
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
