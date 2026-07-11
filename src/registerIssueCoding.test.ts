import {
  CARC_CATALOG,
  ISSUE_GROUP_CODES,
  QUICK_ISSUE_PRESETS,
  RARC_CATALOG,
  buildIssueCodes,
  enumerateIssueCombinationTestCases,
  enumerateRarcSubsets,
  getCarcGroup,
  getCarcOptionsForGroup,
  normalizeIssueCombination,
  quickCodesForCategory,
  validateIssueCombination
} from "./registerIssueCoding";

export function runRegisterIssueCodingTests() {
  const failures: string[] = [];
  const rarcSubsets = enumerateRarcSubsets();
  const testCases = enumerateIssueCombinationTestCases();

  const expectedCaseCount = CARC_CATALOG.length * (2 ** RARC_CATALOG.length);
  if (testCases.length !== expectedCaseCount) {
    failures.push(`Expected ${expectedCaseCount} advanced combinations, got ${testCases.length}.`);
  }

  ISSUE_GROUP_CODES.forEach(groupCode => {
    const groupCarcs = getCarcOptionsForGroup(groupCode);
    if (groupCarcs.length === 0) {
      failures.push(`Group ${groupCode} has no selectable CARC codes.`);
    }
    groupCarcs.forEach(carc => {
      if (getCarcGroup(carc.code) !== groupCode) {
        failures.push(`CARC ${carc.code} is exposed under the wrong group ${groupCode}.`);
      }
    });
  });

  testCases.forEach(combination => {
    const errors = validateIssueCombination(combination);
    if (errors.length > 0) {
      failures.push(`Valid combination failed: ${combination.groupCode}/${combination.carc}/${combination.rarcs.join("+") || "none"} -> ${errors.join("; ")}`);
      return;
    }

    const codes = buildIssueCodes([combination]);
    if (!codes.includes(combination.carc)) {
      failures.push(`Built codes missed CARC ${combination.carc}.`);
    }
    combination.rarcs.forEach(rarc => {
      if (!codes.includes(rarc)) {
        failures.push(`Built codes missed RARC ${rarc} for ${combination.carc}.`);
      }
    });
    if (new Set(codes).size !== codes.length) {
      failures.push(`Built codes include duplicates for ${combination.carc}/${combination.rarcs.join("+")}.`);
    }
  });

  QUICK_ISSUE_PRESETS.forEach(preset => {
    const groupCode = getCarcGroup(preset.carc);
    const combination = { groupCode, carc: preset.carc, rarcs: preset.rarcs };
    const errors = validateIssueCombination(combination);
    if (errors.length > 0) {
      failures.push(`Quick preset "${preset.label}" is invalid: ${errors.join("; ")}`);
    }

    const categoryCodes = quickCodesForCategory(preset.category);
    const expectedCodes = [preset.carc, ...preset.rarcs];
    expectedCodes.forEach(code => {
      if (!categoryCodes.includes(code)) {
        failures.push(`Quick category ${preset.category} missed code ${code}.`);
      }
    });
  });

  const invalidCarc = normalizeIssueCombination({ groupCode: "PR", carc: "CO-16", rarcs: ["N105", "BAD-RARC", "N105"] });
  if (invalidCarc.carc !== "PR-1") {
    failures.push(`Invalid PR/CO mismatch did not normalize to PR-1. Got ${invalidCarc.carc}.`);
  }
  if (invalidCarc.rarcs.join(",") !== "N105") {
    failures.push(`Invalid or duplicate RARCs were not normalized. Got ${invalidCarc.rarcs.join(",")}.`);
  }

  const duplicateCodes = buildIssueCodes([
    { groupCode: "CO", carc: "CO-16", rarcs: ["N105"] },
    { groupCode: "CO", carc: "CO-16", rarcs: ["N105", "N781"] }
  ]);
  if (duplicateCodes.join(",") !== "CO-16,N105,N781") {
    failures.push(`Duplicate code collapse failed. Got ${duplicateCodes.join(",")}.`);
  }

  return {
    failures,
    coverage: {
      groupCodes: ISSUE_GROUP_CODES.length,
      carcCodes: CARC_CATALOG.length,
      rarcCodes: RARC_CATALOG.length,
      rarcSubsets: rarcSubsets.length,
      advancedCombinations: testCases.length,
      quickPresets: QUICK_ISSUE_PRESETS.length
    }
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const result = runRegisterIssueCodingTests();
  if (result.failures.length > 0) {
    console.error("Register Claim Issue coding certification failed:");
    result.failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log(
    `Register Claim Issue coding certification passed: ${result.coverage.groupCodes} groups, ` +
    `${result.coverage.carcCodes} CARCs, ${result.coverage.rarcCodes} RARCs, ` +
    `${result.coverage.rarcSubsets} RARC subsets, ${result.coverage.advancedCombinations} advanced combinations, ` +
    `${result.coverage.quickPresets} quick presets.`
  );
}
