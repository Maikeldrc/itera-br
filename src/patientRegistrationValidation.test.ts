import { validateUniquePatientProvider } from "./patientRegistrationValidation";

export function runPatientRegistrationValidationTests() {
  const existingClaims = [
    {
      claim_id: "CLM-10293-20260709-001",
      patient_id: "MRN-10293",
      provider_id: "PROV_01",
      provider_npi: "1982736450"
    },
    {
      claim_id: "CLM-20400-20260709-001",
      patient_id: "MRN-20400",
      provider_id: "PROV_02",
      provider_npi: "1457382910",
      deleted_flag: true
    }
  ];

  const failures: string[] = [];

  if (validateUniquePatientProvider({ patient_id: "10293", provider_id: "prov_01" }, existingClaims).length !== 1) {
    failures.push("Duplicate MRN/provider was not blocked.");
  }

  if (validateUniquePatientProvider({ patient_id: "10293", provider_id: "LEGACY_01", provider_npi: "1982736450" }, existingClaims).length !== 1) {
    failures.push("Duplicate MRN/provider NPI was not blocked.");
  }

  if (validateUniquePatientProvider({ patient_id: "MRN-10293", provider_id: "PROV_02" }, existingClaims).length !== 0) {
    failures.push("Same MRN with a different provider was incorrectly blocked.");
  }

  if (validateUniquePatientProvider({ patient_id: "MRN-20400", provider_id: "PROV_02" }, existingClaims).length !== 0) {
    failures.push("Deleted claims should not block patient registration.");
  }

  if (validateUniquePatientProvider({ patient_id: "MRN-10293", provider_id: "PROV_01" }, existingClaims, "CLM-10293-20260709-001").length !== 0) {
    failures.push("Current claim should be excluded during updates.");
  }

  return failures;
}
