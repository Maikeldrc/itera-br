# QA Security Report

Date: 2026-07-11
Environment: Production and local source review

## Checks Run

| Check | Result | Evidence |
|---|---|---|
| Production backend health exposes no secrets | Passed | `/api/status` returned configuration booleans only. |
| Auth required in production | Passed | `/api/status` shows `authRequired: true`. |
| Google Sheets production mode | Passed | `/api/status` shows configured true, ADC true, fallback false, seed false. |
| Supporting documents folder configured | Passed | `/api/status` shows `supportingDocumentsFolderConfigured: true`. |
| High/Critical dependency audit | Passed | `npm audit --audit-level=high` returned no High/Critical findings. |
| Moderate dependency advisories | Open | 8 Moderate advisories via Google/Firebase transitive `uuid`; force fix would introduce breaking Firebase Admin upgrade. |
| Secret pattern scan | Passed initial | `rg` scan for common key/secret markers found no committed secrets outside ignored lock/dist/node_modules. |
| Raw payload logging | Closed | QA-DEF-001 removed debug logs from claim update route and no recent DEBUG logs were found after deployment. |
| Cloud Run log inspection | Passed | Recent service logs after revision `itera-claim-reconciliation-api-00025-nx7` show normal startup and no repeated critical errors. |

## Residual Risks

- Authorization must still be tested with multiple roles and direct API calls.
- IDOR/provider isolation needs synthetic role-specific tests.
- Dedicated secret scanner and security headers review remain pending.
- File upload security needs production test with allowed and disallowed file types.
