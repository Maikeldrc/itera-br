let tokenProvider: (() => Promise<string | null>) | null = null;

export function setApiTokenProvider(provider: (() => Promise<string | null>) | null) {
  tokenProvider = provider;
}

function apiUrl(input: RequestInfo | URL) {
  if (typeof input !== "string") return input;
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  if (!baseUrl || !input.startsWith("/api")) return input;
  return `${baseUrl.replace(/\/$/, "")}${input}`;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const token = tokenProvider ? await tokenProvider() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const method = String(init.method || "GET").toUpperCase();
  const cache = method === "GET" ? "no-store" : init.cache;
  return fetch(apiUrl(input), { ...init, headers, cache });
}
