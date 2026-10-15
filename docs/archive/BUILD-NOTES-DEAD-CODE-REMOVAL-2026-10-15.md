# ReportGen — Dead code removal (2026-10-15)

Baseline: `ReportGen-2_0_20-permission-audit-fixes`. Method: TypeScript `checkJs` + `noUnusedLocals` (iterated until zero findings), parser-based cross-file scan for exports nothing imports, file reachability, CSS class usage against all markup/JS, duplicate-function and commented-out-code scans.

## Removed
- **Unused declarations (48):** imports, variables and functions that were never read, in `app.js`, `accountant.js`, `accountantSharedExpenses.js`, `analysis.js`, `businesses.js`, `capital.js`, `dashboard.js`, `generalCompanyReport.js`, `manager.js`, `ownerExpenses.js`, `payroll.js`, `reports.js` (an entire unused month-fetch/aggregate cluster), `users.js`, `vendorPayments.js`, `electron-main.js`, and server routes (`requireRole` imports, `payrollRoutes.requireManagement` and `readOnlyManagementRoles`, `messageRoutes.oversightRoles`, `reportsRoutes` section helpers, `transport.js` `net`, `server.js` `warn`, `databaseRoutes` `logFile`, unused `employeeCode` destructure).
- **Exported but never called:** `canDeleteImports` (ui.js), `loadCapital` (capital.js), `bindInitial` (import.js), `requireBusinessAccess` (auth/middleware.js, never mounted on any route), `isLastDay` (backupScheduler.js), `allowedHttpsOrigin` (transport.js).
- **Whole files:** `public/js/components/dateRangePicker.js` (imported nowhere), `public/assets/reportgen-favicon.svg` (index.html uses the PNG).
- **CSS:** 82 selectors for classes no markup or script uses (old date-range picker, contribution visuals, old messages/mail layout, period toolbars, progress bar, brand row), plus the empty `@media` blocks they left, and the unused custom properties `--blue`, `--radius`, `--radius-sm`.

## Tests changed (they asserted dead code existed)
- `stage11b-authorization-audit`: the "business access middleware" test checked SQL text inside the unmounted `requireBusinessAccess`. It now verifies the helpers routes actually use (sales, payroll, dashboard, accountant, vendor) each join `businesses` and filter by `company_id`.
- `manager-export-integrity`: no longer requires the unused `managerSections` client-HTML parser; it now asserts the parser stays removed and that exports never use client-supplied HTML.

## Reviewed, deliberately kept
- API endpoints with no caller in the client, Electron, scripts or tests (reachable, authenticated HTTP surface, so not provably dead): `GET /api/capital/return`, `GET /api/legal/status`, `POST /api/legal/accept`, `GET /api/network/hostname-status`, `GET /api/permissions/catalog`, `GET /api/sales/fields`, `GET|POST /api/sales/templates`, `GET /api/settings/network/diagnostics`, `POST /api/payroll/loan-repayments/:id/void`.
- Operator `.ps1`/`.bat` helpers that nothing calls by name but humans run (`scripts/lan-diagnostics.ps1`, `check-proxy-ports.ps1`, `start-lan.ps1`, `start-lan-proxy.ps1`, `start-reportgen-lan.ps1`, `start-dev-lan-https.ps1`, `setup-reportgen-client-hostname.ps1`).
- Exports used only inside their own file or only by tests.
- Unused function parameters (callback signatures such as `(req,res)`).
