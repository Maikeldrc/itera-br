# QA Architecture

Date: 2026-07-11
Production URL: https://itera-br.vercel.app/
Backend health URL: https://itera-claim-reconciliation-api-200168383159.us-central1.run.app/api/status

## Component Diagram

```text
Browser
  -> Vercel static frontend (React 19, Vite, Tailwind, lucide-react)
  -> Cloud Run backend API (Express, bundled from server.ts)
      -> Firebase Admin / Google Identity Platform token verification
      -> Google Sheets API (operational data and catalogs)
      -> Google Drive API (Supporting Documents uploads)
```

## Frontend

- Framework: React 19 with Vite.
- Entry point: `src/main.tsx`, main shell in `src/App.tsx`.
- API client: `src/apiClient.ts`, sends Firebase bearer token to `VITE_API_BASE_URL` for `/api/*`.
- Authentication: Firebase client SDK in `src/auth.tsx`.
- Main modules: Dashboard, Claims Worklist, Payment Control, Denials Report, Claims with Errors, Physician Balances, Reports, Audit Log, Settings.
- Reporting engine: `src/reportsEngine.ts` plus UI under `src/components/reports/`.

## Backend

- Framework: Express in `server.ts`.
- Runtime: Cloud Run Node 22 container from `Dockerfile`.
- Auth: `REQUIRE_AUTH=true` in production, Firebase Admin verifies bearer tokens. Local fallback can use `X-User-Email` only when auth is not required.
- Authorization: route role guards in `server.ts`; frontend menu/provider filtering in `src/accessControl.ts`.
- Health: `/api/status`.

## Data Store

- Primary production store: Google Sheets via `src/googleSheetsService.ts`.
- Operational tabs: `Claims`, `Payments`, `Notes`, `Audit_Log`.
- Catalog/config tabs: `Providers`, `Payers`, `Users`, `Settings`, `FeeSchedules`, `Fee_Schedule`, `Eligibility_Coverage`.
- File store: Google Drive folder configured by `SUPPORTING_DOCUMENTS_FOLDER_ID`.

## API Surface

- Public: `GET /api/status`.
- Authenticated read/write:
  - `/api/auth/me`
  - `/api/sync`
  - `/api/admin/clear-operational-data`
  - `/api/supporting-documents`
  - `/api/claims`, `/api/claims/:id`, `/api/claims/bulk-update`
  - `/api/payments`
  - `/api/notes`
  - `/api/audit-logs`
  - `/api/providers`
  - `/api/payers`, `/api/payers/import-pverify`
  - `/api/users`
  - `/api/settings`
  - `/api/fee-schedules`
  - `/api/report-fee-schedules`
  - `/api/eligibility-coverage`

## Deployment

- Frontend: Vercel, SPA rewrite in `vercel.json`.
- Backend: Cloud Run service `itera-claim-reconciliation-api` in `us-central1`, deploy script `scripts/deploy-cloud-run.ps1`.
- Backend image: built by Google Cloud Build and deployed with `gcloud run deploy`.
- Required backend env vars are documented in `.env.example`.

## Initial Risks

- Google Cloud log inspection is currently blocked by expired local `gcloud` reauthentication.
- Bundle size warning: production JS bundle is over Vite's default 500 kB warning threshold.
- Moderate transitive dependency advisory exists under Firebase/Google packages; no High/Critical vulnerabilities from `npm audit --audit-level=high`.
- Production has zero claims after cleanup, limiting data-rich production flow validation until synthetic records are created.
