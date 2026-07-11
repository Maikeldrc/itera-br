# QA Defects

Date: 2026-07-11

| Defect ID | Title | Module | URL | Severity | Priority | Environment | Browser | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| QA-DEF-001 | Backend logs raw payer-change update payload during claim update | Claims API | `/api/claims/:id` | High | High | Production code path | N/A | Admin/Billing/Reconciliation | Closed |
| QA-DEF-002 | Missing browser security headers on frontend and incomplete API security headers | Platform Security | `/`, `/api/status` | Medium | High | Production | N/A | All | Closed |

## QA-DEF-001

- Preconditions: Claim update reaches payer-change logic.
- Steps: Inspect `server.ts` around `PUT /api/claims/:id`.
- Expected: Production logs should not include raw claim update payloads that may contain patient, payer, member or financial information.
- Actual: Debug logging printed previous payer, updated payer and `rawClaimUpdates`.
- Root cause: Temporary debug logs remained in production backend route.
- Files affected: `server.ts`.
- Correction applied: Removed debug `console.log` statements while preserving the audit log record for payer changes.
- Regression test: Source grep for `[DEBUG Payer Change]` and `rawClaimUpdates` debug logs; `npm run test`; `npm run lint`; `npm run build`.
- Commit: `7d303f5`.
- Deployment: Cloud Run revision `itera-claim-reconciliation-api-00025-nx7`.
- Result after deployment: Closed. Backend health returned 200 and recent Cloud Run logs show no DEBUG messages in the 15-minute post-deploy window.

## QA-DEF-002

- Preconditions: Public production frontend and backend are reachable.
- Steps: Inspect `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, and `Cache-Control` headers.
- Expected: Frontend and API should provide anti-framing, MIME sniffing protection, privacy-oriented referrer policy, restrictive permissions policy, and a conservative CSP. API responses should not be cached.
- Actual: Frontend did not send CSP, X-Frame-Options, nosniff, Referrer-Policy or Permissions-Policy. Backend did not send CSP, X-Frame-Options or Cache-Control.
- Root cause: Vercel headers were not configured; backend middleware only applied a partial security header set.
- Files affected: `vercel.json`, `server.ts`, `src/securityHeaders.ts`, `src/securityHeaders.test.ts`, `src/runAllTests.ts`.
- Correction applied: Added Vercel security headers, centralized API security headers, added automated header regression tests.
- Regression test: `npm run qa:full`.
- Commit: `dc50a8a`.
- Deployment: Frontend via Vercel from GitHub push; Cloud Run revision `itera-claim-reconciliation-api-00026-fjj`.
- Result after deployment: Closed. Production frontend and backend now return the expected security headers; dashboard loads successfully without console errors; recent Cloud Run logs show no critical errors.
