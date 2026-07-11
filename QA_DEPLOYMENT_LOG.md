# QA Deployment Log

## QA-CYCLE-001

- Date: 2026-07-11
- Starting commit: `b39b660`
- Production URL: https://itera-br.vercel.app/
- Backend URL: https://itera-claim-reconciliation-api-200168383159.us-central1.run.app
- Errors found: QA-DEF-001 raw claim update payload debug logging in backend route.
- Correction commit: `7d303f5`.
- Corrections: removed debug logs; added unified QA unit runner; added QA npm scripts.
- Tests added/updated: `src/runAllTests.ts`, `npm test`, `npm run qa:full`.
- Local tests:
  - `npm run test`: Passed.
  - `npm run lint`: Passed.
  - `npm run build`: Passed.
  - `npm audit --audit-level=high`: Passed with Moderate advisories only.
- Frontend deployment: GitHub push completed; frontend bundle unchanged because no UI code changed.
- Backend deployment: Passed. Cloud Run revision `itera-claim-reconciliation-api-00025-nx7` serves 100% traffic.
- Production validation:
  - Frontend smoke: Passed, dashboard loaded as Admin with 0 claims.
  - Backend health: Passed, 200 online, auth required, Google Sheets configured via ADC.
  - Console errors: None observed in initial dashboard read.
  - Cloud Run logs: Passed after reauthentication; recent startup logs normal.
  - DEBUG log regression: Passed; `gcloud logging read ... textPayload:DEBUG --freshness=15m` returned no records.
- Regression: Related regression passed for backend startup and debug-log absence. Full app regression remains pending.
- Remaining Critical: Unknown until broader testing.
- Remaining High: No known High defects from executed cycle checks; role/API tests pending and may still reveal issues.
- Decision: Continue.

## QA-CYCLE-002

- Date: 2026-07-11
- Starting commit: `e3b6ade`
- Errors found: QA-DEF-002 missing frontend security headers and incomplete API security headers.
- Corrections: added Vercel frontend security headers; added centralized API security headers; added automated security header tests.
- Tests added: `src/securityHeaders.ts`, `src/securityHeaders.test.ts`; integrated into `src/runAllTests.ts`.
- Local tests:
  - `npm run test`: Passed.
  - `npm run lint`: Passed.
  - `npm run qa:full`: Passed.
- Frontend deployment: Passed. Vercel serves the new headers from `vercel.json`.
- Backend deployment: Passed. Cloud Run revision `itera-claim-reconciliation-api-00026-fjj` serves 100% traffic.
- Production validation: Passed for QA-DEF-002. Frontend and backend headers verified; dashboard loaded without console errors; API health 200.
- Regression: Related security header regression passed. Full app regression remains pending.
- Remaining Critical: Unknown until broader testing.
- Remaining High: No known open High from executed checks; role/API/E2E flows pending.
- Decision: Continue.
