# ReportGen Dashboard Optimization — 2026-10-01

## Fixed
- Initialized and reset `dashboardBusinessId` explicitly in application state.
- Prevented stale/background dashboard summary requests from overwriting a newly selected business.
- Restored the previous business selection if a business-specific dashboard request fails.
- Removed duplicate initial `render()` calls during application boot.
- Deferred non-critical workspace loading until after the first UI paint.
- Removed eager purchase-module data loading during startup; purchases load when the Purchases page is opened.
- Startup branding is now non-blocking after the health check.
- Removed a redundant purchases database query from the dashboard summary endpoint.

## Calendar verification
The top custom date-range calendar contains working Previous and Next month controls. They shift the calendar view by one month without changing the selected reporting dates until a day is explicitly selected.

## Validation
- All JavaScript source files pass `node --check`.
- Calendar previous/next controls and UTC month-shift logic verified statically.
- Full dependency-based test suite was not run because this source build intentionally has no `node_modules` directory.
