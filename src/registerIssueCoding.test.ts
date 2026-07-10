import {
  ISSUE_GROUP_CODES,
  RARC_CATALOG,
  buildIssueCodes,
  enumerateRarcSubsets,
  getCarcOptionsForGroup,
  normalizeIssueCombination
} from "./registerIssueCoding";

export function runRegisterIssueCodingTests() {
  const results: { name: string; success: boolean; error?: string }[] = [];

  function test(name: string, fn: () => void) {
    try {
      fn();
      results.push({ name, success: true });
    } catch (error: any) {
      results.push({ name, success: false, error: error.message || String(error) });
    }
  }

  test("Every group has at least one CARC option", () => {
    for (const groupCode of ISSUE_GROUP_CODES) {
      const options = getCarcOptionsForGroup(groupCode);
      if (options.length === 0) throw new Error(`${groupCode} has no CARC options.`);
      for (const option of options) {
        if (!option.code.startsWith(`${groupCode}-`)) {
          throw new Error(`${option.code} is not valid for ${groupCode}.`);
        }
      }
    }
  });

  test("All valid Group/CARC/RARC subset combinations build expected codes", () => {
    const rarcSubsets = enumerateRarcSubsets();
    let tested = 0;

    for (const groupCode of ISSUE_GROUP_CODES) {
      for (const carc of getCarcOptionsForGroup(groupCode)) {
        for (const rarcs of rarcSubsets) {
          const codes = buildIssueCodes([{ groupCode, carc: carc.code, rarcs }]);
          const expected = [carc.code, ...rarcs];

          if (codes.length !== expected.length) {
            throw new Error(`${groupCode}/${carc.code}/${rarcs.join(",")} returned ${codes.join(",")}.`);
          }
          for (const code of expected) {
            if (!codes.includes(code)) {
              throw new Error(`${groupCode}/${carc.code}/${rarcs.join(",")} is missing ${code}.`);
            }
          }
          tested += 1;
        }
      }
    }

    const expectedTotal = ISSUE_GROUP_CODES
      .reduce((sum, groupCode) => sum + getCarcOptionsForGroup(groupCode).length, 0) * (2 ** RARC_CATALOG.length);
    if (tested !== expectedTotal) throw new Error(`Expected ${expectedTotal} combinations, tested ${tested}.`);
  });

  test("Mismatched Group/CARC combinations normalize to the selected group", () => {
    const normalized = normalizeIssueCombination({ groupCode: "PR", carc: "CO-16", rarcs: [] });
    if (normalized.carc !== "PR-1") {
      throw new Error(`Expected PR-1, got ${normalized.carc}.`);
    }
  });

  test("Invalid or duplicate RARC codes are removed", () => {
    const codes = buildIssueCodes([{ groupCode: "CO", carc: "CO-16", rarcs: ["N105", "N105", "BAD"] }]);
    if (codes.join("|") !== "CO-16|N105") {
      throw new Error(`Expected CO-16|N105, got ${codes.join("|")}.`);
    }
  });

  return results;
}

const results = runRegisterIssueCodingTests();
const failed = results.filter(result => !result.success);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
if (failed.length > 0) process.exit(1);
