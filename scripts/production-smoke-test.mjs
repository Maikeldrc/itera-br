const baseUrl = (process.env.PRODUCTION_URL || "https://itera-br.vercel.app").replace(/\/$/, "");

const checks = [
  { label: "App shell", path: "/", expectText: "root" },
  { label: "Claims route", path: "/claims", expectText: "root" },
  { label: "Payment Import route", path: "/payment-reconciliation-import", expectText: "root" },
  { label: "Import Exceptions route", path: "/import-exceptions", expectText: "root" },
  { label: "RCM Work Queue route", path: "/rcm-work-queue", expectText: "root" },
  { label: "RCM Productivity route", path: "/rcm-productivity", expectText: "root" }
];

async function checkRoute(check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, { redirect: "follow" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${check.label} returned HTTP ${response.status}`);
  }
  if (check.expectText && !body.includes(check.expectText)) {
    throw new Error(`${check.label} did not include expected app shell marker "${check.expectText}"`);
  }
  return { ...check, status: response.status };
}

const startedAt = Date.now();
const results = [];
for (const check of checks) {
  try {
    results.push({ ...(await checkRoute(check)), ok: true });
  } catch (error) {
    results.push({ ...check, ok: false, error: error.message });
  }
}

const failed = results.filter(result => !result.ok);
console.table(results.map(result => ({
  check: result.label,
  path: result.path,
  ok: result.ok,
  status: result.status || "-",
  error: result.error || ""
})));

console.log(`Production smoke test completed in ${Date.now() - startedAt}ms against ${baseUrl}.`);
if (failed.length > 0) {
  process.exitCode = 1;
}
