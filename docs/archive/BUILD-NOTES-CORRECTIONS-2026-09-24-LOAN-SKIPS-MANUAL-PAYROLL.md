# ReportGen v2 — Loan Skips and Manual Payroll Staff Confirmation

## Added
- Loan skip records by loan and month.
- Skipping a month excludes that loan from repayment scheduling for that month.
- If a loan has an end month, a newly recorded skipped month extends the end month by one month.
- Manual payroll total modal now shows active staff with separate checkboxes for:
  - Staff deduction applied
  - Loan repayment applied
- When a manual payroll user leaves an active loan unchecked, the month is recorded as a loan skip and a dated loan period is extended by one month.
- Manual payroll remains an externally calculated gross amount and does not create employee payroll entries.
- Generated payroll entries now retain separate staff deduction and loan repayment amounts for detailed review.
- Payroll detail table now displays gross, staff deductions, loan repayment, total deductions, and net per staff member.
- Staff Management includes a management-only loan schedule table with a Skip month action.

## Notes
- Skipping is blocked if a posted repayment already exists for that loan and month.
- Existing payroll data is migrated with zero defaults for the new breakdown columns.
- Full test suite remains dependent on the project's existing `xlsx` installation.
