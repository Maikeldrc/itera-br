# QA Test Data

Date: 2026-07-11

Rules:
- All production test data created by QA must use prefix `QA_AUTO_`.
- Descriptions/notes must include: `Automated QA synthetic data. Safe to delete.`
- Do not delete data without `QA_AUTO_` and without an entry in this file.

| Type | Identifier | Created At | Test | Status | Preserve? | Notes |
|---|---|---:|---|---|---|---|
| Claim | CLM-QAAUTOMRN001-20260711-001 | 2026-07-11 10:06 ET | QA-CYCLE-003 | Active synthetic production claim | Yes, until CRUD/regression cycle completes | Patient `QA_AUTO_PATIENT_001`, MRN `QA_AUTO_MRN_001`, provider `PROV_01`, payer `00283`, CPT `99453`, DOS `2026-07-11`. Automated QA synthetic data. Safe to delete. |
