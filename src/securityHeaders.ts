export const API_SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store"
} as const;

export function applyApiSecurityHeaders(setHeader: (name: string, value: string) => void) {
  Object.entries(API_SECURITY_HEADERS).forEach(([name, value]) => {
    setHeader(name, value);
  });
}
