# ReportGen Dashboard — Monthly CEO/Owner Expense Fix

## Version
2.0.17 patch

## Problem fixed
The dashboard previously loaded the CEO/Owner expense percentage from the `month` query parameter (normally the start month) and applied that one percentage to the entire selected date range.

For a range spanning multiple calendar months, this was incorrect.

## New behavior
CEO/Owner expense is now calculated independently for every calendar month touched by the selected range.

For each month:

`Owner Expense = applicable monthly percentage × positive gross profit for that month/business`

The applicable percentage follows the existing hierarchy:

1. Business-specific monthly exclusion → 0%
2. Business-specific monthly override → override percentage
3. Company monthly default → default percentage

The selected date range is clipped to each calendar month, so a range such as `2026-07-25` through `2026-09-05` calculates:

- July 25–31 using July's percentage
- August 1–31 using August's percentage
- September 1–5 using September's percentage

The monthly owner expenses are then summed into the dashboard `totals.ownerExpense`, which is deducted from net profit.

## API additions
`ownerAllocation.months` now contains a month-by-month breakdown including:

- month
- selected start/end dates for that month
- default percentage
- gross profit
- total owner expense
- business-level effective percentage/exclusion/source

The existing single-month `defaultPercent`, `allocations`, `selectedExcluded`, `totals.ownerPercent`, and `totals.defaultOwnerPercent` fields are retained for dashboard compatibility and represent the dashboard's selected/start month.

## UI
The dashboard owner-allocation panel now explicitly states that the calculation is month-by-month and shows a month-by-month owner-expense breakdown whenever the selected range spans multiple months.

The editable default/override controls are clearly labelled for the dashboard month they modify.

## Dashboard crash fix retained
The previous `defaultPercent is not defined` response bug remains fixed by returning the defined `defaultOwnerPercent` value.

## Tests added
Added regression coverage for:

- monthly default percentages
- a business-specific monthly override
- a three-month selected range
- partial first/last months
- summed month-by-month owner expense
- net profit using the summed owner expense

## Verification
Passed JavaScript syntax checks for:

- `server/dashboard/dashboardRoutes.js`
- `public/js/pages/dashboard.js`
- `tests/dashboard-summary.test.js`

The full integration test suite requires the project's installed dependencies, including `better-sqlite3`. Those dependencies were not present in the supplied patch ZIP, so a live SQLite integration run was not possible in this environment.
