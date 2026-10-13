# ReportGen Stage 6 — Audit UI & Integrity — 2026-10-03

## Changes
- Added a dedicated Audit Log workspace page for users with `audit.view`.
- Added search, action, user, business, from/to date filters and pagination.
- Added audit metadata endpoint for filter options, scoped to the current company.
- Added readable expandable audit details with client-side redaction of obvious credential/token fields.
- Kept company scoping enforced server-side on every audit query.
- Added useful audit indexes for action, user and business filtering.
- Added SQLite append-only triggers that reject UPDATE/DELETE against `audit_logs` in the live database.
- Existing application audit inserts continue to work because the triggers only block UPDATE/DELETE.

## Important integrity boundary
The live application database treats audit rows as append-only. This is not the same as cryptographically immutable/off-host logging: a database restore/reset or direct filesystem/database access can replace historical data. Those operations remain administrative system operations and should be protected operationally.

## Verification
- Run `node --check` on every JavaScript file before release.
- Run `node tests/audit-ui-integrity.test.js`.
- Re-extract the final ZIP and repeat all JavaScript syntax checks and tests.
