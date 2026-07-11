# QA Performance Report

Date: 2026-07-11
Environment: Production

## Checks Run

| Check | Result | Evidence | Notes |
|---|---|---|---|
| Frontend smoke load | Passed | Browser loaded dashboard | No console errors observed. |
| Backend health latency | Passed | `Invoke-WebRequest` returned 200 | Full latency not captured in first cycle. |
| Production build bundle size | Warning | Vite build warning | JS bundle approximately 805.76 kB uncompressed / 195.70 kB gzip. |

## Residual Risks

- No Lighthouse run yet.
- No measured p95 API timings yet.
- Large claims table and 3,200-row import performance require controlled synthetic tests.
