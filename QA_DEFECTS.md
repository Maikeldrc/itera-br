# QA Defects

Date: 2026-07-11

| Defect ID | Title | Module | URL | Severity | Priority | Environment | Browser | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| QA-DEF-001 | Backend logs raw payer-change update payload during claim update | Claims API | `/api/claims/:id` | High | High | Production code path | N/A | Admin/Billing/Reconciliation | Closed |

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
