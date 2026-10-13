# ReportGen Owner/Admin Report Update — 2026-10-03

## Scope
Updated the Owner/Administrator consolidated report while preserving the existing Owner Workspace report structure and presentation flow.

## Retained report model
- Executive financial summary
- Business sales contribution visual
- Business contribution summary
- Consolidated monthly performance
- Monthly business contribution breakdown

## Added / expanded information
- Gross sales and returns
- Return rate
- Transactions and sales days
- Average sale
- Operating expenses
- Payroll
- Purchases / capital
- Vendor payments
- Owner expense allocation
- Business-level owner allocation detail
- Expense detail records
- Expanded management commentary
- Business-level expenses, payroll, owner expense and sales days

## Data handling
- Each report month still loads business detail data.
- The report also reads the dashboard summary for each month so owner allocation, net profit, expenses, payroll, purchases and vendor-payment totals use the current server-side dashboard calculations.
- Owner allocation is attached to the corresponding business rows where available.
- Sales days are derived from the returned daily business sales records; months do not overlap, so period sales days are accumulated month by month.

## Export updates
Excel and Word owner/admin exports were expanded to carry the same updated information, including dedicated worksheets/sections for:
- Sales & Returns
- Expense Details
- Owner Expense Allocation
- Payroll / Capital / Vendor Payments

## Loader behavior
Owner report generation now runs inside the existing runtime loader and the loader remains active until report HTML has been rendered. Word and Excel exports also keep the loader active until the generated file response has been received and the file handoff has completed.

## Validation performed
- `node --check public/js/pages/reports.js` — passed
- `node --check server/reports/reportsRoutes.js` — passed
- Confirmed no SQLite/database files were included in the package.
- Confirmed no certificate/private-key files were included in the package.
- Confirmed `node_modules` was not included in the package.

## Note
Full runtime generation/export testing requires the user's installed dependency set and test database. This package was statically validated before delivery; no claim is made that a live report was generated in this environment.
