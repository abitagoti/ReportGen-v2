# ReportGen — Monthly Reporting Selector

## What changed
- Replaced the global `From / To` reporting controls in the main application header with a single **Reporting month** selector.
- All operational pages now inherit a full calendar month through `state.dashboardMonth`, `state.dashboardStart`, and `state.dashboardEnd`.
- Changing the global month updates the state and re-renders the current page; page-specific loaders then fetch the selected month.
- Businesses now explicitly load their business-card data when the Businesses page is opened for a month that has not yet been loaded, so cards do not remain at stale `₦0.00 / 0` values until the user changes a date.
- The Reports page keeps its own custom date-range controls. Its Month / Year / Custom reporting modes remain available there.
- No database reset, migration, deletion, recreation, or overwrite was added by this change.

## Database safety
This change contains no SQLite database files and does not call any database reset/reinitialization route. It only changes query parameters used by the UI.

## Verification
- JavaScript syntax checks passed for the modified frontend files.
- Server route syntax checks passed for dashboard and business routes.
- No `.sqlite`, `.db`, `.pfx`, or credential artifacts were included in the source package.
