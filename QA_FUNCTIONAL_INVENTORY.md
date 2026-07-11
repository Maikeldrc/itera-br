# QA Functional Inventory

Date: 2026-07-11
Environment: Production

| ID | Module | Route | Feature | Roles | APIs | Entities | Criticality | Coverage Status | Observations |
|---|---|---|---|---|---|---|---|---|---|
| QA-FUNC-001 | Auth | `/` | Firebase session load and user mapping | All active users | `/api/auth/me` | Users | Critical | Smoke passed | Production session loaded as Admin. |
| QA-FUNC-002 | Dashboard | `/` | Reconciliation KPI overview | All roles with dashboard | `/api/claims`, `/api/providers`, `/api/payers`, `/api/settings` | Claims, Providers, Payers, Settings | High | Smoke passed empty-state | Shows 0 claims and no console errors. |
| QA-FUNC-003 | Claims | `/claims` | Claims Worklist filters, table, selection, export | All primary roles | `/api/claims` | Claims | Critical | Not run | Needs synthetic claims. |
| QA-FUNC-004 | Claims | `/claims` | New Claim creation and reconciliation | Admin, Billing Manager, Reconciliation Specialist | `POST /api/claims` | Claims, Audit_Log | Critical | Local logic tested | Needs production synthetic flow. |
| QA-FUNC-005 | Claims | `/claims` | Register Claim Issue, Group/CARC/RARC combinations | Admin, Billing Manager, Reconciliation Specialist | `PUT /api/claims/:id`, `/api/supporting-documents` | Claims, Notes, Audit_Log, Drive | Critical | Automated local passed | 19,456 advanced combinations covered by unit suite. |
| QA-FUNC-006 | Claims | `/claims` | Supporting Documents upload to Drive | Admin, Billing Manager, Reconciliation Specialist | `POST /api/supporting-documents` | Google Drive, Audit_Log | High | Not run | Requires synthetic claim and small test file. |
| QA-FUNC-007 | Import | `/claims` modal | CSV/XLSX import with progress, summary and corrected-row retry | Admin, Billing Manager | `POST /api/import-csv` | Claims, Audit_Log | Critical | Partially covered manually in prior cycle; not run in cycle 001 | Needs controlled QA_AUTO file. |
| QA-FUNC-008 | Payments | `/payments` | Payment Control and missing ERA review | Admin, Billing Manager, Reconciliation Specialist, Provider Viewer | `/api/payments`, `/api/claims` | Payments, Claims | High | Not run | Needs synthetic paid/pending ERA claims. |
| QA-FUNC-009 | Denials | `/denials` | Denied/rejected claims report | Admin, Billing Manager, Reconciliation Specialist, Auditor | `/api/claims` | Claims | High | Empty-state only | Needs synthetic denied claims. |
| QA-FUNC-010 | Errors | `/errors` | Claims blocked by errors/locks | Admin, Billing Manager, Reconciliation Specialist, Auditor | `/api/claims` | Claims | High | Empty-state only | Needs synthetic error claim. |
| QA-FUNC-011 | Providers | `/providers` | Physician balances and settlements | Admin, Billing Manager, Provider Viewer, Auditor | `/api/providers`, `/api/claims` | Providers, Claims | High | Not run | Needs claims tied to providers. |
| QA-FUNC-012 | Reports | `/reports` | Operational reporting, filters, export and settlement matrix | All primary roles | `/api/claims`, `/api/report-fee-schedules`, `/api/eligibility-coverage` | Claims, Fee_Schedule, Eligibility_Coverage | High | Local engine tested | Needs UI production screenshots and export validation. |
| QA-FUNC-013 | Audit Log | `/audit-log` | HIPAA audit history | Admin, Billing Manager, Auditor | `/api/audit-logs` | Audit_Log | Critical | Empty-state likely | Needs synthetic audit event. |
| QA-FUNC-014 | Settings | `/settings` | Language, users, providers, payers, fee schedules, contract rules | Admin, Billing Manager | `/api/users`, `/api/providers`, `/api/payers`, `/api/fee-schedules`, `/api/settings` | Catalogs, Settings | Critical | Not run | Must avoid modifying real catalog data without QA_AUTO identifiers. |
| QA-FUNC-015 | Settings | `/settings` | Admin operational cleanup | Admin | `/api/admin/clear-operational-data` | Claims, Payments, Notes, Audit_Log | Critical | Code inspected | Must be tested only after QA_AUTO data is tracked. |

Inventory status: Initial. Additional hidden or code-only functions still require endpoint-by-endpoint validation.
