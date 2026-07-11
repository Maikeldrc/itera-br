# QA Deployment Log

## QA-CYCLE-001

- Date: 2026-07-11
- Starting commit: `b39b660`
- Production URL: https://itera-br.vercel.app/
- Backend URL: https://itera-claim-reconciliation-api-200168383159.us-central1.run.app
- Errors found: QA-DEF-001 raw claim update payload debug logging in backend route.
- Correction commit: This QA cycle commit.
- Corrections: removed debug logs; added unified QA unit runner; added QA npm scripts.
- Tests added/updated: `src/runAllTests.ts`, `npm test`, `npm run qa:full`.
- Local tests:
  - `npm run test`: Passed.
  - `npm run lint`: Passed.
  - `npm run build`: Passed.
  - `npm audit --audit-level=high`: Passed with Moderate advisories only.
- Frontend deployment: Pending for cycle corrections.
- Backend deployment: Pending for cycle corrections.
- Production validation:
  - Frontend smoke: Passed, dashboard loaded as Admin with 0 claims.
  - Backend health: Passed, 200 online, auth required, Google Sheets configured via ADC.
  - Console errors: None observed in initial dashboard read.
  - Cloud Run logs: Blocked by local `gcloud` reauthentication.
- Regression: Pending after deployment.
- Remaining Critical: Unknown until broader testing.
- Remaining High: QA-DEF-001 pending deployment validation; role/API tests pending.
- Decision: Continue.
