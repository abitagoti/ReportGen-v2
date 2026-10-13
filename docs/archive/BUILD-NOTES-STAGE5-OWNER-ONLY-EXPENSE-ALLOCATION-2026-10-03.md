# ReportGen — Owner-Only Expense Allocation

Date: 2026-10-03
Baseline: Stage 5 Permission Isolation v5

## Change
CEO / Owner expense allocation is now exclusive to the Owner role.

### Dashboard
- Owner-only allocation controls and month-by-month allocation breakdown remain visible only to the Owner.
- CEO / Owner expense KPI is hidden from General Manager, Administrator, Accountant, Business Manager and Viewer dashboards.
- Dashboard financial snapshot hides Owner adjustment for non-Owner roles.
- Non-Owner dashboard net profit is calculated before Owner expense allocation.

### Server enforcement
- `/api/dashboard/owner-default`
- `/api/dashboard/owner-adjustment`
- `/api/dashboard/owner-allocation`
- `/api/dashboard/owner-allocation/:businessId/:month`
- `/api/dashboard/owner-allocations`

All of the above now require the authenticated role to be `owner`.
- Non-Owner dashboard responses do not expose owner allocation details.
- Non-Owner dashboard totals report ownerExpense as 0 and net profit before Owner allocation.

### Reports
- The authoritative report endpoint returns no Owner allocation data to non-Owner roles.
- General Manager reports no longer display Owner expense KPI or Owner Expense Allocation sections.
- General Manager report net profit is calculated before Owner allocation.
- Owner reports retain the existing Owner allocation details and calculations.

## Verification
- All JavaScript files syntax-checked with `node --check`.
- Final packaged ZIP will be re-extracted and all extracted JavaScript files syntax-checked again before delivery.
- No database schema change.
- No certificates/private keys added.
- No node_modules included.
