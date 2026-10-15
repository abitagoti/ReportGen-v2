# ReportGen — Permission audit fixes (2026-10-14)

Baseline: `ReportGen-2_0_20-individual-permissions-effective-fix`.

## Changes
- **permissions.js** – the override column is detected once (it used to run `PRAGMA table_info` on every check) and each request resolves its permission set once (`effectivePermissionSet`) instead of re-querying per `hasPermission` call.
- **database.js** – `migrateUserPermissionOverrides()` rebuilds a legacy `decision` override table into the current `effect` schema (atomic; newest duplicate wins; unrecognised values and rows for deleted users are dropped). Exported for tests.
- **rolePolicy.js / permissionsRoutes.js / userRoutes.js** – new `canOverrideTarget`: individual overrides may only be set for accounts strictly below the actor's role (peers and Administrators excluded). `GET /api/users` returns `canEditPermissions` and the Users page hides the Permissions button when it is false. Peer status/business-access management is unchanged (rolePolicy.test.js asserts Owner→Owner).
- **accountantRoutes.js** – `/api/owner/expenses` and `/api/owner/expense-summary` now also check `expenses.view` (summary: `expenses.view` or `dashboard.view`), so a Deny override applies to them.
- **capitalRoutes.js / capital.js** – edit and delete follow one rule: company-wide roles manage any record; any other user holding `capital.manage` (role default or individual override) only their own records for businesses they are assigned to, and cannot move them to an unassigned business or make them company-wide. Previously edit was owner-only and delete required the literal `business_manager` role.
- **api.js / app.js** – after a 403 the browser re-reads `/api/permissions/effective` (max once per 15 s) and re-renders if it changed, so permission changes no longer need a manual reload.
- **RELEASE-MANIFEST.json** regenerated (database.js is hash-checked).

## Reviewed and deliberately unchanged
Role checks in reports, vendor payments, sales, dashboard, payroll and the workspace page routing decide *data scope* (company-wide vs assigned businesses) or *which workspace* a role family uses, and each has a permission-checked path for limited roles. `requireManagement` in payrollRoutes.js is defined but never called.

## Tests added
- `tests/individual-permission-behavior.test.js` – real resolver against a real DB (every permission × allow/deny/inherit, request cache).
- `tests/permission-overrides-migration.test.js` – legacy-table upgrade.
- `tests/individual-permission-routes.test.js` – HTTP checks of the route changes.
- `server/security/rolePolicy.test.js` – `canOverrideTarget` cases.
