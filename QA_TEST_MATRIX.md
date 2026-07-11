# QA Test Matrix

Date: 2026-07-11
Environment: Production

| Test ID | Module | Feature | Test Type | Priority | Role | Preconditions | Test Data | Steps | Expected Result | Actual Result | Status | Defect ID | Evidence | Last Run | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QA-TC-001 | Production | Frontend loads | E2E | Critical | Admin | Existing browser session | None | Open https://itera-br.vercel.app/ | App loads dashboard without console errors | Dashboard loaded as Admin with 0 claims; console errors none | Passed |  | Emitted dashboard screenshot | 2026-07-11 | In-app browser screenshot could not be written to repo due tool EPERM. |
| QA-TC-002 | Backend | Health check | API | Critical | Public | None | None | GET Cloud Run `/api/status` | 200, online, authRequired true, Sheets configured | 200; authRequired true; Google Sheets configured via ADC; tests 15/15 | Passed |  | Command output | 2026-07-11 | No secrets returned. |
| QA-TC-003 | Unit | Register Claim Issue code combinations | Unit | Critical | N/A | Repo checkout | Static catalogs | Run `npm run test` | All Group/CARC/RARC combinations pass | 19,456 advanced combinations passed | Passed |  | Terminal output | 2026-07-11 | Included in unified suite. |
| QA-TC-004 | Unit | Reconciliation financial engine | Unit | Critical | N/A | Repo checkout | Synthetic in test | Run `npm run test` | All financial scenarios pass | 13 reconciliation tests passed | Passed |  | Terminal output | 2026-07-11 | Included in unified suite. |
| QA-TC-005 | Unit | Reports aggregation | Unit | High | N/A | Repo checkout | Synthetic in test | Run `npm run test` | Report KPI aggregation passes | Passed | Passed |  | Terminal output | 2026-07-11 | Included in unified suite. |
| QA-TC-006 | Unit | Patient/provider duplicate validation | Unit | High | N/A | Repo checkout | Synthetic in test | Run `npm run test` | Duplicate MRN/provider rules pass | Passed | Passed |  | Terminal output | 2026-07-11 | Included in unified suite. |
| QA-TC-007 | Security | Dependency audit | Security | High | N/A | Installed deps | None | Run `npm audit --audit-level=high` | No High/Critical vulnerabilities | Passed with 8 Moderate advisories | Passed |  | Terminal output | 2026-07-11 | Breaking-force fix not applied. |
| QA-TC-008 | Security | Secret scan | Security | Critical | N/A | Repo checkout | None | Search for common secret markers excluding lock/dist/node_modules | No committed secrets | No matches found | Passed |  | `rg` output exit 1/no matches | 2026-07-11 | Extend with dedicated scanner later. |
| QA-TC-009 | Privacy | No debug claim payload logs | Security | High | N/A | Source inspection | None | Search backend for debug payer logs | No raw claim payload debug logs | Failed before fix; corrected in cycle 001 | Passed | QA-DEF-001 | Diff and grep output | 2026-07-11 | Needs deployed validation. |
| QA-TC-010 | Visual | Dashboard desktop 1366+ | Visual | Medium | Admin | Authenticated browser | None | Capture dashboard screenshot | No overlap/truncation in first viewport | Passed on emitted screenshot | Passed |  | Emitted screenshot | 2026-07-11 | More viewports pending. |
| QA-TC-011 | Logs | Cloud Run recent logs | Security | High | Admin/GCP | Valid gcloud auth | None | `gcloud logging read` | Logs readable; no repeated critical errors | Reauthentication blocked | Blocked |  | Command output | 2026-07-11 | Needs `gcloud auth login`. |
| QA-TC-012 | Import | Modal fresh state after close | E2E | High | Admin | Prior import completed | QA_AUTO XLSX | Open import, close, reopen | Modal opens clean | Not run in cycle 001 | Not Run |  |  |  | Recent fix deployed before this QA cycle; requires regression. |

Matrix status: Initial. Negative, boundary, concurrency, role and endpoint cases remain to be expanded and executed.
