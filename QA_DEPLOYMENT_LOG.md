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

## QA-CYCLE-003

- Date: 2026-07-11
- Starting commit: `41d320f`
- Production data created: `CLM-QAAUTOMRN001-20260711-001` for `QA_AUTO_PATIENT_001` / `QA_AUTO_MRN_001`.
- Production validation:
  - New Claim UI: Passed; claim created with provider `PROV_01`, payer `00283`, RPM CPT `99453`, DOS `2026-07-11`.
  - Dashboard persistence: Passed; dashboard updated to 1 claim and `$23.59` billed/open A/R.
  - Worklist persistence: Passed; search `QA_AUTO` returns the synthetic claim.
  - Claim detail/timeline: Passed for create visibility; found QA-DEF-003.
  - Audit Log: Passed for global visibility of synthetic claim audit events; found QA-DEF-003.
  - Console errors: None observed during create/detail/audit flow.
- Errors found: QA-DEF-003 no-op save creates misleading audit entries.
- Corrections: normalized audit diff comparisons for empty values and equivalent service line JSON; added regression test.
- Tests added: `src/googleSheetsService.test.ts`, integrated into `src/runAllTests.ts`.
- Local tests:
  - `npm run test`: Passed.
  - `npm run lint`: Passed.
  - `npm run qa:full`: Passed.
- Frontend deployment: Passed from GitHub push.
- Backend deployment: Passed. Cloud Run revision `itera-claim-reconciliation-api-00028-tln` serves 100% traffic after blank audit-row filter.
- Production validation after fix: Passed for executed regression. No-op save no longer creates visible timeline events; Audit Log shows `0 saved actions`, no `Invalid Date`, and no console errors.
- Regression: Passed for no-op audit normalization and blank Audit_Log row rendering. Broader audit persistence scenarios remain to be expanded.
- Decision: Continue.

## QA-CYCLE-004

- Date: 2026-07-11
- Starting commit: `9a08164`
- Errors found: QA-DEF-004 import modal reopens with previous XLSX file, completed progress bar and prior result after closing and opening a new import session.
- Corrections: reset Import Claims modal state on every closed-to-open transition; clear native file inputs when removing selected file.
- Files changed: `src/components/ImportModal.tsx`, QA documentation.
- Local tests:
  - `npm run test`: Passed.
  - `npm run lint`: Passed.
  - `npm run build`: Passed.
- Frontend deployment: Passed. Initial CLI attempt linked to `itera-br-update`; relinked checkout to Vercel project `itera-br` and deployed production successfully.
- Backend deployment: Not required; frontend-only change.
- Production validation after fix: Passed on `https://itera-br.vercel.app/claims`. Import modal opens clean, close/reopen keeps it clean, and console errors/warnings were not observed.
- Regression: Passed for QA-TC-012.
- Decision: Continue.

## QA-CYCLE-005

- Date: 2026-07-13
- Starting commit: `fde70e3`
- Errors found: QA-DEF-005 compact CARC/RARC/MA picker in Claim Detail was clipped/hidden behind lower content.
- Corrections: moved compact ERA code picker popover to a React portal with fixed viewport positioning and higher stacking context.
- Additional coverage: centralized backend API role groups and added automated access-control tests for role groups, menu access and provider filtering.
- Files changed: `src/components/ClaimDetailPanel.tsx`, `src/apiAuthorizationPolicy.ts`, `src/accessControl.test.ts`, `src/runAllTests.ts`, `server.ts`, QA documentation.
- Local tests:
  - `npm run test`: Passed.
  - `npm run lint`: Passed.
  - `npm run build`: Passed.
- Frontend deployment: Pending.
- Backend deployment: Pending.
- Production validation after fix: Pending.
- Regression: Pending.
- Decision: Continue.
