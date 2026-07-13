import { runPatientRegistrationValidationTests } from "./patientRegistrationValidation.test";
import { runReconciliationEngineTests } from "./reconciliationEngine.test";
import { runRegisterIssueCodingTests } from "./registerIssueCoding.test";
import { runReportsEngineTests } from "./reportsEngine.test";
import { runSecurityHeadersTests } from "./securityHeaders.test";
import { runGoogleSheetsServiceTests } from "./googleSheetsService.test";
import { runAccessControlTests } from "./accessControl.test";

const failures: string[] = [];

const reconciliationResults = runReconciliationEngineTests();
for (const result of reconciliationResults) {
  if (!result.success) {
    failures.push(`Reconciliation engine: ${result.name}: ${result.error || "failed"}`);
  }
}

for (const failure of runReportsEngineTests()) {
  failures.push(`Reports engine: ${failure}`);
}

for (const failure of runPatientRegistrationValidationTests()) {
  failures.push(`Patient registration validation: ${failure}`);
}

for (const failure of runSecurityHeadersTests()) {
  failures.push(`Security headers: ${failure}`);
}

for (const failure of runAccessControlTests()) {
  failures.push(`Access control: ${failure}`);
}

for (const failure of await runGoogleSheetsServiceTests()) {
  failures.push(`Google Sheets service: ${failure}`);
}

const codingResult = runRegisterIssueCodingTests();
for (const failure of codingResult.failures) {
  failures.push(`Register issue coding: ${failure}`);
}

if (failures.length > 0) {
  console.error("QA unit test suite failed:");
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  [
    `QA unit test suite passed.`,
    `Reconciliation tests: ${reconciliationResults.length}.`,
    `Register issue coding: ${codingResult.coverage.groupCodes} groups, ${codingResult.coverage.carcCodes} CARCs, ${codingResult.coverage.rarcCodes} RARCs, ${codingResult.coverage.rarcSubsets} RARC subsets, ${codingResult.coverage.advancedCombinations} advanced combinations, ${codingResult.coverage.quickPresets} quick presets.`
  ].join(" ")
);
