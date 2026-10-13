ReportGen — Global Date Range Refresh Fix v2
Date: 2026-10-02

Fixes:
- Global From/To changes now refresh the business list for the selected range without reloading/resetting the whole workspace.
- Removed the workspace reload from the date-range handler; this prevents page state resets and request races.
- Added a stale-request guard to sales summary loading so an older request cannot overwrite a newer reporting period.
- Business cards use the authoritative /api/businesses range response; sales summary no longer overwrites their values with a potentially stale response.
- Existing page binders continue to refresh their own range-aware datasets when navigation occurs.

Database safety:
- This patch contains no SQLite database and does not delete, reset, migrate, or overwrite user data.
- Changing the reporting calendar only reads reporting data through API endpoints.
- Keep the existing REPORTGEN_DATA_DIR pointing to the existing persistent database.
