import fs from "node:fs";
import { API_SECURITY_HEADERS, applyApiSecurityHeaders } from "./securityHeaders";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runSecurityHeadersTests() {
  const failures: string[] = [];
  const test = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err: any) {
      failures.push(`${name}: ${err.message || String(err)}`);
    }
  };

  test("API headers include anti-framing, no-sniff, no-referrer, no-store and restrictive CSP", () => {
    const captured: Record<string, string> = {};
    applyApiSecurityHeaders((name, value) => {
      captured[name] = value;
    });

    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      assert(captured[name] === value, `${name} was not applied.`);
    }
    assert(captured["X-Frame-Options"] === "DENY", "API must deny framing.");
    assert(captured["Cache-Control"] === "no-store", "API responses must not be cached.");
    assert(captured["Content-Security-Policy"].includes("default-src 'none'"), "API CSP must default to none.");
    assert(captured["Content-Security-Policy"].includes("frame-ancestors 'none'"), "API CSP must block embedding.");
  });

  test("Vercel frontend headers include core browser security controls", () => {
    const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    const headerRules = vercel.headers || [];
    const allHeaders = new Map<string, string>();
    for (const rule of headerRules) {
      for (const header of rule.headers || []) {
        allHeaders.set(header.key, header.value);
      }
    }

    const requiredHeaders = [
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy"
    ];
    for (const header of requiredHeaders) {
      assert(allHeaders.has(header), `Missing frontend header ${header}.`);
    }
    assert(allHeaders.get("X-Frame-Options") === "DENY", "Frontend must deny framing.");
    assert(allHeaders.get("X-Content-Type-Options") === "nosniff", "Frontend must set nosniff.");
    assert(allHeaders.get("Referrer-Policy") === "no-referrer", "Frontend must not leak referrers.");
    assert(allHeaders.get("Content-Security-Policy")?.includes("frame-ancestors 'none'"), "Frontend CSP must block embedding.");
    assert(allHeaders.get("Content-Security-Policy")?.includes("object-src 'none'"), "Frontend CSP must block plugins.");
    assert(allHeaders.get("Content-Security-Policy")?.includes("identitytoolkit.googleapis.com"), "Frontend CSP must allow Firebase Auth.");
    assert(allHeaders.get("Content-Security-Policy")?.includes("itera-claim-reconciliation-api-200168383159.us-central1.run.app"), "Frontend CSP must allow production API.");
  });

  return failures;
}
