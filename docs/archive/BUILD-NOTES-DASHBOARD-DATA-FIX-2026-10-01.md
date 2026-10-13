# ReportGen Dashboard Data Fix — 2026-10-01

## Findings
- Dashboard refresh failures were being swallowed by the frontend, leaving stale/empty dashboard values visible.
- Dashboard business selector was sourced from the dashboard summary response instead of the authoritative workspace business list.
- The top reporting date range and dashboard month control did not share one refresh path.
- Existing installations could lack `payroll_monthly_totals.calculation_mode`, while the dashboard queries that column.

## Changes
- Dashboard business selector now uses `state.businesses`.
- Reporting-period refresh now reloads sales and dashboard data for the exact selected start/end range.
- Dashboard month changes reload both sales and dashboard summaries.
- Refresh failures now surface an actionable dashboard error instead of silently leaving stale figures.
- Workspace extras now load using the current reporting start/end range.
- Added guarded migration for `payroll_monthly_totals.calculation_mode` on older databases.

## Preservation
- No LAN/server binding, HTTPS, hostname, Windows-service, or installation configuration was changed.
- No business, sales, expense, payroll, purchase, or vendor-payment records are modified by the migration.
