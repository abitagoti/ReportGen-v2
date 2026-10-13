# ReportGen Stage 5 — Permission Isolation v5

Baseline: `ReportGen-Stage5-Permission-Isolation-v4.zip`

## Changes

### Accountant financial endpoints now honor permissions
- Accountant monthly summary requires `dashboard.view`.
- Accountant expense/remittance/template reads require `expenses.view`.
- Accountant expense/remittance/template creation requires `expenses.manage`.
- Accountant expense/remittance deletion requires `expenses.manage`.
- Existing accountant role and assigned-business scope checks remain in place.
- Default Accountant permissions already include `dashboard.view`, `expenses.view`, and `expenses.manage`, so normal Accountant behavior is preserved.

### Financial mutation audit coverage
Added audit events for:
- `accountant.expense.created`
- `accountant.expense.deleted` (already present, retained)
- `accountant.expense_template.created`
- `accountant.remittance.created`
- `accountant.remittance.deleted` (already present, retained)

## Verification
- Modified server route passes `node --check`.
- Permission-isolation regression test passes syntax validation.
- Full runtime test suite requires installed npm dependencies; this source archive does not contain `node_modules`.
