# Register Claim Issue Combination Test Plan

## Objective

Certify that the Register Claim Issue coding workflow produces valid adjudication codes for every selectable combination in the current UI catalog:

- Group Code: `CO`, `PR`, `OA`, `PI`
- CARC Code: every CARC exposed for the selected Group Code
- RARC Codes: every possible multi-check subset of the configured RARC catalog
- Quick Chips: every preset shown in the dialog

## Scope

The certification is exhaustive against the application catalog in `src/registerIssueCoding.ts`.

Current exhaustive matrix:

- 4 Group Codes
- 19 CARC options
- 10 RARC options
- 1,024 possible RARC multi-check subsets
- 19,456 advanced Group/CARC/RARC combinations
- 15 Quick Chip presets

## Automated Validation

Run:

```powershell
npm run test
npm run lint
npm run build
```

The automated test validates:

- Every Group Code has at least one selectable CARC.
- Every CARC appears only under its matching Group Code prefix.
- Every valid Group/CARC/RARC-subset combination passes validation.
- `buildIssueCodes` always includes the selected CARC and every selected RARC.
- Generated code arrays are de-duplicated.
- Every Quick Chip maps to an existing CARC/RARC combination.
- Quick category save codes match the same preset codes injected by the advanced builder.
- Invalid mismatched Group/CARC combinations normalize to a valid group default.
- Unknown/duplicate RARCs are removed during normalization.

## Manual Smoke Test

1. Open the Claims worklist as an Admin or billing user with claim edit access.
2. Open `Register Claim Issue` for a claim with at least one CPT line.
3. In `Advanced Code Combinations`, add one combination for each Group Code.
4. Confirm the CARC dropdown changes to only the CARCs for that group.
5. Select multiple RARCs, save as draft, reopen, and verify the note/codes include the selected CARC and RARCs.
6. Apply an issue with:
   - `CO` and patient responsibility `0`
   - `PR` with adjustment amount > `0`
   - multiple RARCs selected
7. Confirm the line balance is not double-reduced by PR patient responsibility.
8. Test every Quick Chip once and confirm it injects a valid advanced combination.

## Pass Criteria

The feature is certified when:

- `npm run test`, `npm run lint`, and `npm run build` all pass.
- The deployed Cloud Run `/api/status` endpoint returns `200`.
- GitHub contains the same commit deployed to Cloud Run.
