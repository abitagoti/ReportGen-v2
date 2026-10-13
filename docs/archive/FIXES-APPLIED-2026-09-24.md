# ReportGen fixes applied

## Applied
- Changed fresh-install payroll foreign keys referencing `payroll_employees` from `ON DELETE CASCADE` to `ON DELETE RESTRICT` so accidental physical staff deletion cannot cascade-delete payroll, loans, deductions, skips, manual adjustments, or repayments.
- Added an explicit historical-data-safety comment to the schema.
- Made backup retention configurable through `REPORTGEN_MAX_BACKUPS`, with a safe minimum of 4 and a default of 12.

## Verification
- JavaScript syntax checks should be rerun by the next maintainer.
- `npm test` remains blocked in this environment because the `xlsx` dependency could not be installed/loaded (`Cannot find module 'xlsx'`). Run `npm ci` in an internet-enabled development environment before testing.

## Important limitation
The schema change affects fresh databases. Existing SQLite databases retain their original foreign-key definitions and require a controlled migration/rebuild before those constraints change. Do not attempt an uncontrolled in-place rewrite on a live production database.
