# QA Defects

Date: 2026-07-11

| Defect ID | Title | Module | URL | Severity | Priority | Environment | Browser | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| QA-DEF-001 | Backend logs raw payer-change update payload during claim update | Claims API | `/api/claims/:id` | High | High | Production code path | N/A | Admin/Billing/Reconciliation | Closed |
| QA-DEF-002 | Missing browser security headers on frontend and incomplete API security headers | Platform Security | `/`, `/api/status` | Medium | High | Production | N/A | All | Closed |
| QA-DEF-003 | No-op claim save creates misleading audit entries for empty fields and equivalent service lines | Audit / Claims API | `/api/claims/:id` | Medium | High | Production | Chrome/IAB | Admin | Closed |
| QA-DEF-004 | Import modal reopens with previous file, progress and summary state | Import UI | `/claims` | Medium | High | Production | Chrome/IAB | Admin | Closed |
| QA-DEF-005 | Compact CARC/RARC/MA picker is clipped behind lower claim detail content | Claim Detail UI | `/claims` | Medium | High | Production | Chrome/IAB | Admin/Billing/Reconciliation | Fixed locally, pending deploy validation |

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

## QA-DEF-003

- Preconditions: Synthetic claim `CLM-QAAUTOMRN001-20260711-001` exists.
- Steps: Open claim, save/recalculate without a meaningful business-field change.
- Expected: Audit trail should record only real business changes.
- Actual: Audit trail recorded `error_category` from `undefined` to empty and a generic `service_lines_json` update even though values were semantically equivalent.
- Root cause: Google Sheets diff logic compared raw values and raw service line JSON, treating empty values and legacy JSON shape differences as real changes.
- Files affected: `src/googleSheetsService.ts`, `src/googleSheetsService.test.ts`, `src/runAllTests.ts`.
- Correction applied: Added audit comparison normalization for null/undefined/empty strings and canonical service line JSON fields. Added regression test. Added filtering for blank Google Sheets rows so empty `Audit_Log` rows do not render as `Invalid Date` saved actions.
- Regression test: `npm run qa:full`.
- Commit: `1217048`, `9a08164`.
- Deployment: Cloud Run revisions `itera-claim-reconciliation-api-00027-bjj` and `itera-claim-reconciliation-api-00028-tln`.
- Result after deployment: Closed. No-op save no longer creates visible claim timeline events; global Audit Log now shows `0 saved actions` instead of blank rows with `Invalid Date`.

## QA-DEF-004

- Preconditions: An import completed or an XLSX file was selected in the Import Claims modal.
- Steps: Close the modal, then click Import CSV again.
- Expected: New import session starts clean with the drag/drop area, no selected file, no progress bar, and no previous import result.
- Actual: Modal reopened with the previous XLSX file name, 100% progress, and prior result summary.
- Root cause: Import modal state lived in the mounted component and only reset on specific close/remove paths, not on every closed-to-open transition.
- Files affected: `src/components/ImportModal.tsx`.
- Correction applied: Added explicit reset on each modal open transition and centralized selected-file cleanup, including native file input value reset.
- Regression test: `npm run test`; `npm run lint`; `npm run build`.
- Commit: `be94529`.
- Deployment: Vercel production deployment for project `itera-br`.
- Result after deployment: Closed. `https://itera-br.vercel.app/claims` opens Import Claims with dropzone visible, no prior XLSX filename, no progress bar, no import result, no Remove link, and no console errors after close/reopen.

## QA-DEF-005

- Preconditions: Open a claim detail panel with ERA Service Line Capture visible.
- Steps: Click the compact `Add CARC / RARC / MA` button inside a service line row.
- Expected: The code search popover should render above adjacent sections and remain fully visible.
- Actual: The popover rendered inside the horizontally scrolling table container and appeared behind/clipped by the section below.
- Root cause: The compact picker used an absolutely positioned child inside an overflow container.
- Files affected: `src/components/ClaimDetailPanel.tsx`.
- Correction applied: Rendered the compact picker popover through a React portal into `document.body`, positioned it from the trigger button, and raised its stacking context.
- Regression test: `npm run test`; `npm run lint`; `npm run build`.
- Commit: Pending.
- Deployment: Pending.
- Result after deployment: Pending.
