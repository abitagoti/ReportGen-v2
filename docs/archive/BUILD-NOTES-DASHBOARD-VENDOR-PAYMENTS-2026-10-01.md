# ReportGen v2.0.15 — Dashboard Finance & Vendor Payments

## Included
- Added lightweight Vendor Payments tracker: date, amount, optional business, optional note.
- Added dashboard Vendor Payments card for management roles; card opens Vendor Payments history.
- Vendor Payments do not affect COGS, purchases, profit, payroll, expenses, or purchase planning.
- Added month-specific owner expense default allocation with per-business override/exclusion/reset.
- Moved COGS into the primary financial KPI row.
- Changed rolling purchase balance to remain signed so a shortfall is visible instead of being clamped to zero.
- Added Additional Funding Required when estimated balance is negative.
- Renamed next-month estimate to Next-month Purchase Guide while retaining the API compatibility field.
- Preserved the existing ReportGen visual language and did not modify LAN/server/service configuration.

## Database safety
- New `vendor_payments` table is created by schema and guarded migration for existing installations.
- New `dashboard_owner_defaults` table is created by schema and guarded migration.
- Existing owner adjustment rows remain valid; `excluded` is added with a default of 0.

## Vendor payment rules
- Vendor name is intentionally not tracked.
- Business is optional; unassigned payments remain company-wide.
- Multiple entries may be recorded for the same day.
- Notes are optional reminders only.
