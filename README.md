# ITERA Claim Reconciliation

Portal full-stack para conciliación de claims, pagos, denials, pendientes, distribución de ingresos y reporting operacional de ITERA HEALTH.

## Local Development

```powershell
npm install
$env:PORT="3002"
npm run dev
```

Build y validación:

```powershell
npm run lint
npm run build
```

## Reports

El módulo está disponible desde el menú **Reports**:

- `/reports`
- `/reports/billing-summary`
- `/reports/provider-vs-itera`
- `/reports/collections`
- `/reports/denials`
- `/reports/pending`
- `/reports/coverage`

Incluye:

- Filtros por fechas de servicio, mes, práctica, provider, servicio, CPT, billing owner, payment receiver, estado, payer, submission date y payment date.
- Agrupación configurable.
- KPIs de billed, paid, difference, collection rate, denials, pending, pacientes y coverage.
- Separación de métricas de ITERA y Provider.
- Aging de pendientes: `0-30`, `31-60`, `61-90` y `91+ days`.
- Exportación CSV de la vista filtrada.
- Vistas guardadas localmente en el navegador.
- Tabla sortable con métricas a nivel de service line.

### Report formulas

- `Difference = Total Billed - Total Paid`
- Alternativa configurable: `Net Collectible Revenue - Total Paid`
- `Collection Rate = Total Paid / selected basis`
- `Denial Rate = Denied Claims / Total Claims`
- `Coverage % = Unique Billable Patients / Eligible Patients`

Cuando no existe denominador en `Eligibility_Coverage`, Coverage muestra `N/A`.

## Google Sheets

Variables:

```env
GOOGLE_CLIENT_EMAIL="service-account@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="ONLY_IF_NOT_USING_ADC_STORE_IN_SECRET_MANAGER"
GOOGLE_SHEET_ID="spreadsheet-id"
```

### Claims

Además de los campos existentes, Reports soporta:

| Field | Description |
|---|---|
| `cpt_description` | Descripción del CPT |
| `submission_date` | Fecha de envío al payer |
| `itera_billed_fee` | Fee facturado por ITERA |
| `billable_flag` | Indica paciente/claim facturable |
| `voided_flag` | Excluye claims anulados de pacientes facturables |
| `corrected_claim_flag` | Identifica claims corregidos |

Si estos campos están vacíos, el motor usa fee schedules, fechas de creación y reglas existentes como fallback.

### Fee_Schedule

Tab opcional para reporting:

| Field |
|---|
| `fee_schedule_id` |
| `cpt_hcpcs` |
| `cpt_description` |
| `service_type` |
| `unit_price` |
| `itera_fee` |
| `effective_date` |
| `active` |

La aplicación mantiene compatibilidad con el tab existente `FeeSchedules`.

### Eligibility_Coverage

Tab opcional:

| Field |
|---|
| `coverage_id` |
| `practice_id` |
| `practice_name` |
| `service_type` |
| `period` |
| `total_eligible_patients` |
| `notes` |
| `created_at` |
| `updated_at` |

`period` usa formato `YYYY-MM`.

## Architecture

- `src/reportsEngine.ts`: normalización, filtros, agrupación, KPIs, coverage y aging.
- `src/reportsEngine.test.ts`: pruebas básicas del motor.
- `src/components/reports/ReportsPage.tsx`: composición de la pantalla.
- `src/components/reports/ReportComponents.tsx`: filtros, tabs, badges, KPIs y export.
- `src/components/reports/ReportsTable.tsx`: tabla sortable.

Los cálculos no viven dentro de los componentes visuales.
