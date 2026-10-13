# ReportGen — Authoritative Build & Release History

**Current build:** 2.0.20 — **RELEASE CANDIDATE, NOT SIGNED OFF.** Version number intentionally unchanged.

This file is the single history of ReportGen builds. It has two parts:
1. **Current status and open items** (maintained by hand — update this first).
2. **Archived build notes, verbatim** — every original note, unedited, in chronological order. Nothing was deleted; the same files also remain in `docs/archive/`.

Operational documents that are not build notes stay where they were: `README.txt`, `SECURITY-NOTES.md`, `DATABASE-MIGRATION-GUIDE.md`, `DATA-SIZE-AND-RETENTION.md`, `BUILD-SETUP-WIZARD.md`.

---

## Part 1 — Current status (2.0.20 RC review)

### Payroll payment & reconciliation review (still 2.0.20 RC — version not bumped)
Review of the payroll flow found real defects; all fixed with regression tests in `tests/payroll-payment-integrity.test.js` (14 of its 16 tests fail on the previous build).
1. **Saving a payroll could zero every employee.** `savePayrollDetail()` read form fields that the read-only detail page never renders, so it sent `0` for every amount; the server accepted it, wiped the month's loan repayments and saved the payroll. The page now only finalizes a draft (`POST /:id/save`) and never re-sends amounts. `PATCH /api/payroll/:id` additionally rejects an empty entry list or an entry without a gross amount, derives deductions and net itself, and replaces loan repayments only for the staff being edited.
2. **Deleting a half-paid payroll erased its payment history** (`payroll_payments.payroll_id` is `ON DELETE CASCADE`). The route now refuses (409) when any payment record exists, and a database trigger (`trg_payroll_totals_keep_payment_history`) enforces the same for every code path and every existing database. Deleting a payroll also removes its manual staff adjustments (they showed as a phantom amount).
3. **A wrong payment could not be corrected.** Payments are now voided, never deleted: `POST /api/payroll/:id/payments/:paymentId/void` (needs `payroll.finalize`, requires a reason, audited, re-opens a payroll that was locked as paid). Ledger gained `status`, `voided_at`, `voided_by`, `void_reason` (new databases via `schema.sql`, existing ones via guarded `ALTER TABLE`). Overpayment is refused unless `confirmOverpayment: true`. Payment entry and history use dialogs (balance shown, settle/overpay confirmations) instead of `window.prompt`/`alert`.
4. **Duplicate payments on retry.** The client built its idempotency key with `Date.now()`; it is now one key per open dialog.
5. **Floating-point comparisons.** All payroll money maths is rounded to 2 dp with a 0.005 tolerance (`paid >= expected`, deductions = direct + loan). Ten payments of 100000.10 now settle a 1,000,001 payroll.
6. **Edits could undercut payments.** `PATCH`, re-posting a monthly total and skipping a loan month now roll back if the new payable amount would be lower than what is already paid; an edit landing exactly on the paid amount settles and locks the payroll.
7. **KPI cards ignored partial payments** — "Paid"/"Outstanding" now use real recorded payments.
8. **Single definition of "payable".** Five copies of the expected-amount logic were replaced by `expectedPayrollAmount()` / `paidPayrollAmount()` / `reconcilePayrollPayments()`. Duplicate `CREATE TABLE payroll_payments` at route load was removed (schema/migration own it). Mark Paid refuses a zero-value payroll; "Regenerate draft" shows only for drafts; payment buttons show only when a payment is possible.
9. `payroll_payments` and its index were added to the startup integrity check's required tables/indexes.

Known, intentionally unchanged: the dashboard and reports count **gross** payroll as cost, while payments reconcile against **net** payable (after staff deductions and loan repayments). The payroll page now labels the figure "Net payable" to make this visible.

Verification for this change: `npm test` 136/136 and `tsc --noEmit` clean, **run in a review sandbox where native `better-sqlite3` could not be compiled, using a test-only shim over Node's built-in SQLite.** Re-run `npm ci && npm test` with the real driver (and the Windows/GitHub build) before sign-off. Not yet verified against a copy of production data.

### Correction to the Stage 12 note
The archived Stage 12 note reports "61/61 passed" and calls the tree a release candidate. That figure came from a run that **skipped the six database-backed suites** because `node_modules` was absent. When those suites were run, the server **could not start** (see fix 1). Treat Stage 12's readiness claims as superseded by this section.

### Fixed in this review
1. **Startup crash (blocker).** `server/database/integrity.js` joined `payroll_entries` on `staff_id`; that table uses `employee_id`. The tenant-integrity check threw `no such column: child.staff_id` and the server exited. Now uses an explicit table→column map; an unmapped table fails loudly. Regression: `tests/stage12-startup-integrity-regression.test.js` (verified to fail on the original code).
2. **Dashboard / owner-expense tests (stale fixture, code was correct).** Owner expense allocation is Owner-only (Stage 5). The tests logged in as `administrator`. Numbers unchanged; tests now run as `owner`. Added server-side regressions: non-owner roles get `ownerAllocation: null`, `ownerExpense: 0`, no `defaultPercent` in the payload, and net profit computed before allocation; per-month owner expense sums to the total. Payroll tests (full month, every month touched by a range, no pro-rating, drafts excluded) already passed.
3. **Accountant expense permissions (harness bug, code was correct).** The test never mounted `accountantRoutes`, so every call was 404. With routes mounted, view-only → 403 on writes and manage-only → 403 on reads. Added: unauthenticated → 401, and view-only cannot delete.
4. **payroll.salaries migration test (test pollution, code was correct).** `savePermissions()` writes a row for every permission, so the test collided with rows from earlier tests. Now isolated in its own company. Added regression: the startup migration never overrides an explicit `payroll.salaries` decision (revoked stays revoked, granted stays granted).
5. **LAN HTTPS login test (stale expectation, code was correct).** Session cookie is `SameSite=Strict` since Stage 11A; test still expected `Lax`. Test updated and now asserts Strict and not Lax.

6. **Stale health label.** `/api/health` reported a hard-coded `stage5-permission-isolation-v1`. It now reports `reportgen-server@<package.json version>`. Release manifest regenerated and re-verified (version-bound, still 2.0.20). Regression: `tests/stage12-health-build-label.test.js`.

### Corrections to earlier notes
- `PRODUCTION-READINESS-CHANGES.md` / `BUILD-FIX-2026-09-25.md` say `better-sqlite3` always compiles from source. For 13.0.3 that is no longer true: the package ships prebuilt N-API binaries (including `win32-x64`, which exports `napi_register_module_v1`), so no compiler is needed on the machine. N-API is ABI-stable across Node and Electron versions. Still confirm on the real GitHub Windows build.

### Build reproducibility
- Added `package-lock.json` (lockfileVersion 3, includes dev toolchain, `xlsx` alias to `@e965/xlsx` preserved). The CI workflow runs `npm ci`, which fails without a lockfile.
- CI now runs `npm test` and release-integrity verification before packaging the installer.
- `.gitignore` now excludes `node_modules/`. `package.json` gained `engines.node >= 22` (tested on Node 22). Version unchanged.

### Import check (synthetic data, not the real export)
A generated 25,000-row legacy `.xls` in the pizzaHub column layout (Jan–Aug 2026) imported in ~1.5 s, ~550 MB peak memory, 0 rejected rows. Sales, gross and returns totals matched independently computed expected values to the cent, row count and per-month distribution were correct, and re-importing the same period was refused ("Choose add or replace explicitly"). Observation: amounts are stored as SQLite REAL, so reported totals carry floating-point noise at ~1e-6 (e.g. 131108745.80000089); stored/queried cents were exact. Not a defect today, but worth a decision (integer minor units) before long-term financial use.

### Test status
114 / 114 passing locally (Linux, Node 22) after a clean `npm ci`; `tsc --noEmit` clean; release manifest generates and verifies. (Before the payroll payment review above; that review adds 16 tests — see its note for how they were run.)

### NOT yet verified (needs the Windows/GitHub environment or data not available here)
- Windows installer build on GitHub Actions (NSIS, `better-sqlite3` against Electron 44 ABI)
- Windows service install/uninstall, installer upgrade preserving data
- HTTPS certificates and LAN access from a second machine
- Real pizzaHub import (`SalesReportExportFriday-18-September-2026.xls`, ~25,000 rows): the real file was not available; only the synthetic check above was done
- Behaviour on Node 24 (CI uses Node 24; local run was Node 22)

### Product note
`SameSite=Strict` means opening a link to the app from outside (email, chat) arrives without the session cookie on that first navigation; users may need to navigate once inside the app. Acceptable for an on-prem LAN tool, but worth knowing.

---

## Part 2 — Index of archived notes
| # | Date | File | First line |
|---|------|------|-----------|
| 1 | 2026-09-24 | `BUILD-NOTES-CORRECTIONS-2026-09-24-EXPORT-MESSAGING.txt` | ReportGen correction build — 2026-09-24 |
| 2 | 2026-09-24 | `BUILD-NOTES-CORRECTIONS-2026-09-24-LOAN-SKIPS-MANUAL-PAYROLL.md` | ReportGen v2 — Loan Skips and Manual Payroll Staff Confirmation |
| 3 | 2026-09-24 | `BUILD-NOTES-CORRECTIONS-2026-09-24-PAID-PAYROLL-PRINT.txt` | ReportGen Payroll Corrections - Paid Lock and Detailed Print |
| 4 | 2026-09-24 | `BUILD-NOTES-CORRECTIONS-2026-09-24-PAYROLL-FINANCIAL-AUDIT.txt` | ReportGen v2 correction build |
| 5 | 2026-09-24 | `BUILD-NOTES-CORRECTIONS-2026-09-24-REPORT-POLISH.txt` | ReportGen v2 report polish corrections |
| 6 | 2026-09-24 | `BUILD-NOTES-CORRECTIONS-2026-09-24.txt` | ReportGen v2 correction pass - 2026-09-24 |
| 7 | 2026-09-24 | `BUILD-NOTES-REPORT-PRINT-POLISH-2026-09-24.txt` | ReportGen Print View Refinement – 2026-09-24 |
| 8 | 2026-09-24 | `FIXES-APPLIED-2026-09-24.md` | ReportGen fixes applied |
| 9 | 2026-09-25 | `BUILD-FIX-2026-09-25.md` | Build / dependency fix — 2026-09-25 |
| 10 | 2026-09-25 | `BUILD-NOTES-CORRECTIONS-2026-09-25-LAN-SERVICE-AND-REMOTE-CLIENT.md` | 2026-09-25 - LAN service + remote desktop client |
| 11 | 2026-09-25 | `PRODUCTION-READINESS-CHANGES.md` | Production readiness change log |
| 12 | 2026-10-01 | `BUILD-NOTES-DASHBOARD-DATA-FIX-2026-10-01.md` | ReportGen Dashboard Data Fix — 2026-10-01 |
| 13 | 2026-10-01 | `BUILD-NOTES-DASHBOARD-OPTIMIZATION-2026-10-01.md` | ReportGen Dashboard Optimization — 2026-10-01 |
| 14 | 2026-10-01 | `BUILD-NOTES-DASHBOARD-PURCHASE-PLANNING-2026-10-01.md` | ReportGen v2.0.12 — Dashboard Purchase & Profit Planning |
| 15 | 2026-10-01 | `BUILD-NOTES-DASHBOARD-VENDOR-PAYMENTS-2026-10-01.md` | ReportGen v2.0.15 — Dashboard Finance & Vendor Payments |
| 16 | 2026-10-02 | `BUILD-NOTES-DASHBOARD-MONTHLY-OWNER-EXPENSE-2026-10-02.md` | ReportGen Dashboard — Monthly CEO/Owner Expense Fix |
| 17 | 2026-10-02 | `BUILD-NOTES-GLOBAL-DATE-RANGE-REFRESH-2026-10-02.md` | ReportGen — Global Date Range Refresh Fix v2 |
| 18 | 2026-10-02 | `BUILD-NOTES-MONTH-SELECTOR-2026-10-02.md` | ReportGen — Monthly Reporting Selector |
| 19 | 2026-10-03 | `BUILD-NOTES-AUDIT-PERFORMANCE-OPTIMIZATION-2026-10-03.md` | Audit Log Performance Optimization — 2026-10-03 |
| 20 | 2026-10-03 | `BUILD-NOTES-OWNER-ALLOCATION-DASHBOARD-FIX-2026-10-03.md` | ReportGen — Owner Allocation Dashboard Fix — 2026-10-03 |
| 21 | 2026-10-03 | `BUILD-NOTES-REPORT-UPDATE-2026-10-03.md` | ReportGen Owner/Admin Report Update — 2026-10-03 |
| 22 | 2026-10-03 | `BUILD-NOTES-STAGE10A-TRANSACTION-INTEGRITY-2026-10-03.md` | ReportGen Stage 10A — Critical Financial Transaction Integrity |
| 23 | 2026-10-03 | `BUILD-NOTES-STAGE11A-AUTH-HARDENING-2026-10-03.md` | ReportGen Stage 11A — Authentication Hardening |
| 24 | 2026-10-03 | `BUILD-NOTES-STAGE11D-TRANSPORT-LAN-SECURITY-2026-10-03.md` | Stage 11D — Transport & Local-Network Security |
| 25 | 2026-10-03 | `BUILD-NOTES-STAGE11E-RESOURCE-ABUSE-2026-10-03.md` | ReportGen Stage 11E — Database/API Availability & Abuse Resistance |
| 26 | 2026-10-03 | `BUILD-NOTES-STAGE11F-LOGGING-ERROR-HANDLING-2026-10-03.md` | ReportGen Stage 11F — Logging, Error Handling & Operational Security |
| 27 | 2026-10-03 | `BUILD-NOTES-STAGE11G-DEPLOYMENT-INTEGRITY-2026-10-03.md` | Stage 11G — Secure Update & Deployment Integrity |
| 28 | 2026-10-03 | `BUILD-NOTES-STAGE12-PRODUCTION-READINESS-2026-10-03.md` | Stage 12 — Production Readiness & Final QA |
| 29 | 2026-10-03 | `BUILD-NOTES-STAGE3-HTTPS-LAN-AUTH-2026-10-03.md` | ReportGen Stage 3 — HTTPS / LAN Authentication Hardening |
| 30 | 2026-10-03 | `BUILD-NOTES-STAGE4-ACCOUNT-SECURITY-2026-10-03.md` | ReportGen Stage 4 — Account Security Update — 2026-10-03 |
| 31 | 2026-10-03 | `BUILD-NOTES-STAGE4-LOGIN-CLEANUP-2026-10-03.md` | Stage 4 Login Cleanup — 2026-10-03 |
| 32 | 2026-10-03 | `BUILD-NOTES-STAGE4-ROLE-PERMISSIONS-V2.txt` | ReportGen Stage 4 — Role Permissions Runtime Fix |
| 33 | 2026-10-03 | `BUILD-NOTES-STAGE4-ROLES-PERMISSIONS-CORRECTED-2026-10-03.md` | ReportGen Stage 4 — Roles & Permissions Corrected Build |
| 34 | 2026-10-03 | `BUILD-NOTES-STAGE5-FINANCIAL-INTEGRITY.txt` | ReportGen Stage 5 — Financial & Report Integrity |
| 35 | 2026-10-03 | `BUILD-NOTES-STAGE5-FINANCIAL-PERMISSION-AUDIT-V7.md` | ReportGen Stage 5 — Financial Integrity & Permission Audit v7 |
| 36 | 2026-10-03 | `BUILD-NOTES-STAGE5-OWNER-ONLY-EXPENSE-ALLOCATION-2026-10-03.md` | ReportGen — Owner-Only Expense Allocation |
| 37 | 2026-10-03 | `BUILD-NOTES-STAGE5-PERMISSION-ISOLATION.txt` | ReportGen Stage 5 - Permission Isolation (staff / payroll / deductions / salaries) |
| 38 | 2026-10-03 | `BUILD-NOTES-STAGE5-ROLE-NAV-ACCESS.txt` | ReportGen Stage 5 - Role / Navigation Access Fix |
| 39 | 2026-10-03 | `BUILD-NOTES-STAGE6-AUDIT-TRAIL-2026-10-03.md` | ReportGen Stage 6 — Audit Trail Hardening |
| 40 | 2026-10-03 | `BUILD-NOTES-STAGE6-AUDIT-UI-INTEGRITY-2026-10-03.md` | ReportGen Stage 6 — Audit UI & Integrity — 2026-10-03 |
| 41 | 2026-10-03 | `BUILD-NOTES-STAGE7-BACKUP-RECOVERY-INTEGRITY-2026-10-03.md` | ReportGen Stage 7 — Backup / Restore + Disaster Recovery Integrity |
| 42 | 2026-10-03 | `BUILD-NOTES-STAGE9-SESSION-AUTH-HARDENING-2026-10-03.md` | ReportGen Stage 9 — Session & Authentication Hardening |
| 43 | undated | `BUILD-NOTES-STAGE10C.md` | Stage 10C — Duplicate Submission Protection |
| 44 | undated | `BUILD-NOTES-STAGE10D.md` | ReportGen Stage 10D — SQLite & Tenant Integrity |
| 45 | undated | `BUILD-NOTES-STAGE4-ROLE-PERMISSIONS-FIX.txt` | ReportGen Stage 4 — Role Permissions Route Fix |
| 46 | undated | `BUILD-NOTES-STAGE5-FINANCIAL-INTEGRITY-V8.md` | ReportGen Stage 5 — Financial Integrity v8 |
| 47 | undated | `BUILD-NOTES-STAGE5-PERMISSION-ISOLATION-V5.md` | ReportGen Stage 5 — Permission Isolation v5 |
| 48 | undated | `BUILD-NOTES.txt` | ReportGen v89 - Business Manager Pages |
| 49 | undated | `VERSION-2.0-NOTES.md` | ReportGen 2.0 |

---

## Part 3 — Archived notes (verbatim)


<!-- ===== 1. BUILD-NOTES-CORRECTIONS-2026-09-24-EXPORT-MESSAGING.txt (2026-09-24) ===== -->

### 1. `BUILD-NOTES-CORRECTIONS-2026-09-24-EXPORT-MESSAGING.txt` — 2026-09-24

````text
ReportGen correction build — 2026-09-24

Implemented:
- Replaced consolidated Word HTML/.doc export with a genuine .docx export using the docx package.
- Added an embedded SVG business sales contribution chart to the Word document.
- Added dedicated Excel worksheets for each business and each monthly detail section, plus print setup and navigable sheets.
- Updated the browser export fallback filename from .doc to .docx.
- Changed the Messages page so folder selection displays the list first and no message opens automatically.
- Clicking a message opens a full-screen reader modal.
- Added close and outside-click behavior for the message reader modal.
- Preserved reply, delete-for-me, and delete-for-everyone actions inside the message modal.

Installation:
- Run npm install so the new docx dependency is installed.
- Then run npm run build:desktop.

Note:
- The package-lock file may be refreshed by npm install because the environment could not complete package-lock-only resolution during packaging.
````


<!-- ===== 2. BUILD-NOTES-CORRECTIONS-2026-09-24-LOAN-SKIPS-MANUAL-PAYROLL.md (2026-09-24) ===== -->

### 2. `BUILD-NOTES-CORRECTIONS-2026-09-24-LOAN-SKIPS-MANUAL-PAYROLL.md` — 2026-09-24

````text
# ReportGen v2 — Loan Skips and Manual Payroll Staff Confirmation

## Added
- Loan skip records by loan and month.
- Skipping a month excludes that loan from repayment scheduling for that month.
- If a loan has an end month, a newly recorded skipped month extends the end month by one month.
- Manual payroll total modal now shows active staff with separate checkboxes for:
  - Staff deduction applied
  - Loan repayment applied
- When a manual payroll user leaves an active loan unchecked, the month is recorded as a loan skip and a dated loan period is extended by one month.
- Manual payroll remains an externally calculated gross amount and does not create employee payroll entries.
- Generated payroll entries now retain separate staff deduction and loan repayment amounts for detailed review.
- Payroll detail table now displays gross, staff deductions, loan repayment, total deductions, and net per staff member.
- Staff Management includes a management-only loan schedule table with a Skip month action.

## Notes
- Skipping is blocked if a posted repayment already exists for that loan and month.
- Existing payroll data is migrated with zero defaults for the new breakdown columns.
- Full test suite remains dependent on the project's existing `xlsx` installation.
````


<!-- ===== 3. BUILD-NOTES-CORRECTIONS-2026-09-24-PAID-PAYROLL-PRINT.txt (2026-09-24) ===== -->

### 3. `BUILD-NOTES-CORRECTIONS-2026-09-24-PAID-PAYROLL-PRINT.txt` — 2026-09-24

````text
ReportGen Payroll Corrections - Paid Lock and Detailed Print

Implemented:
- Added payroll payment_status and paid_at fields with guarded migration for existing databases.
- Added POST /api/payroll/:id/paid endpoint.
- Paid payroll records are locked against editing and deletion at the server layer.
- Payroll list shows Paid state and Mark Paid action only for saved payroll.
- Paid payroll detail view is read-only.
- Print/Word/Excel HTML output now includes employee, gross, staff deductions, loan repayment, total deductions, and net columns.
- Added guards preventing paid payroll from being regenerated or overwritten through manual monthly-total workflows.

Validation:
- Node syntax checks passed for modified server and frontend JavaScript files.
- Full npm test/build was not run because node_modules is not included in the source archive.

PAYROLL LIMITATIONS CLEARED - 2026-09-24
- Manual payroll now stores staff-level gross, deduction, loan repayment, and net amounts.
- Manual payroll requires the sum of staff gross amounts to equal the monthly payroll total.
- Manual payroll rejects deductions and loan repayment amounts above gross pay.
- Manual payroll detail API exposes staff-level manual entries for print/export and review.
- Existing databases receive guarded migrations for the new manual staff amount columns.
````


<!-- ===== 4. BUILD-NOTES-CORRECTIONS-2026-09-24-PAYROLL-FINANCIAL-AUDIT.txt (2026-09-24) ===== -->

### 4. `BUILD-NOTES-CORRECTIONS-2026-09-24-PAYROLL-FINANCIAL-AUDIT.txt` — 2026-09-24

````text
ReportGen v2 correction build
Date: 2026-09-24

Implemented:
- Manual monthly payroll remains an externally calculated gross payroll recording workflow.
- Manual payroll does not automatically apply staff deductions or loan repayments.
- Employee-generated payroll caps deductions at gross payroll to prevent negative net pay.
- Added payroll loan repayment ledger with unique loan/month records.
- Loan balances now expose total repaid and remaining balance in the loans API.
- Loan repayment amounts are capped at the remaining balance and monthly repayment amount.
- Loan repayments are posted when generated employee payroll is saved.
- Loan repayment ledger entries are removed when the related payroll is deleted.
- Loans automatically change to completed when the remaining balance reaches zero.
- Loan start/end month validation now matches deduction validation.
- Updated manual payroll UI label to clarify that the entered amount is gross payroll calculated externally.
- Updated payroll page explanatory text.

Notes:
- Manual payroll is intentionally not recalculated by ReportGen.
- Generated employee payroll still applies active deductions and scheduled loan repayments.
- Full npm test execution is blocked in this environment because the xlsx dependency is not installed.

PAYROLL / LOAN / DEDUCTION CORRECTIONS APPLIED
- Added business-scope authorization to staff updates, staff status changes, and salary increases.
- Restricted loan listing to assigned businesses.
- Restricted loan skip-history access to the loan's assigned business.
- Added a loan repayment void endpoint: POST /api/payroll/loan-repayments/:id/void.
- Restored active loan status when a completed loan repayment is voided.
- Removed stale loan-skip records when a manual payroll later applies the loan for that month.
- Enforced payroll entry equation: deductions = deductionAmount + loanRepaymentAmount.
- Node syntax validation passed for server/payroll/payrollRoutes.js.

LIMITATION
- Manual payroll remains a business-level total with staff selection flags; a full staff-level manual gross/deduction/net ledger requires a larger UI and schema extension and was not fabricated in this patch.
````


<!-- ===== 5. BUILD-NOTES-CORRECTIONS-2026-09-24-REPORT-POLISH.txt (2026-09-24) ===== -->

### 5. `BUILD-NOTES-CORRECTIONS-2026-09-24-REPORT-POLISH.txt` — 2026-09-24

````text
ReportGen v2 report polish corrections

- Improved Business Manager Executive Financial Summary layout in the browser.
- Improved Sales Trend chart with gridlines, scale labels, day labels, legend, and hover values.
- Added dailyTrend to Business Manager export payload.
- Rebuilt Business Manager DOCX export with a professional cover block, report metadata, cleaner headings, structured executive summary, embedded sales trend chart, sales trend indicators, and cleaner section extraction.
- Avoided duplicating section titles/descriptions inside the Word document.
- Excel export was left unchanged because the user confirmed it is acceptable.

Validation:
- node --check passed for server/reports/reportsRoutes.js
- node --check passed for public/js/pages/manager.js
- Full npm test could not complete in this environment because the xlsx module is not installed in the working environment. Two other tests passed.
````


<!-- ===== 6. BUILD-NOTES-CORRECTIONS-2026-09-24.txt (2026-09-24) ===== -->

### 6. `BUILD-NOTES-CORRECTIONS-2026-09-24.txt` — 2026-09-24

````text
ReportGen v2 correction pass - 2026-09-24

Included:
1. Role-aware workspace labels in the sidebar, topbar, and dashboard hero.
2. Dashboard hero wording no longer hardcodes Owner workspace.
3. Global reporting period control changed from browser-native month input to a consistent select-based month selector for cross-browser rendering.
4. Compose Message now opens in a modal overlay rather than inside the reader panel.
5. Modal supports close button, cancel/discard, outside-click close, and existing send workflow.

Validation:
- JavaScript syntax checks passed for modified files.
- Full npm test suite was not completed in this packaging environment because dependencies were not installed; the sales-import test reported missing xlsx module.

Notes:
- Employee/system-user linking for managers and other login holders is not automatically created in this pass. Payroll continues to use payroll employee records, avoiding automatic salary assumptions for login accounts.

Messaging corrections added:
- Removed the All messages mailbox option; Inbox, Unread, and Sent remain.
- Compose now supports selecting multiple active recipients.
- Backend creates one message record per selected recipient with validation and audit entries.
- Added Reply action that opens the compose modal with recipient, Re: subject, and original message context prefilled.
- Added Delete action for messages where the logged-in user is sender or recipient. Current behavior permanently removes the message for both participants.
- Added DELETE /api/messages/:messageId route.

Messaging and Business Manager corrections:
- Added separate Delete for me and Delete for everyone behavior for internal messages.
- Delete for me hides the message only from the current participant.
- Delete for everyone is available to the sender and removes the message for all participants.
- Added message deletion columns with startup migration for existing databases.
- Business Managers can now access read-only staff list and payroll totals through payroll access guards.
- Business Manager payroll responses are sanitized to totals only; employee-level payroll entries are blocked.
- Business Manager staff responses do not expose base salary.
````


<!-- ===== 7. BUILD-NOTES-REPORT-PRINT-POLISH-2026-09-24.txt (2026-09-24) ===== -->

### 7. `BUILD-NOTES-REPORT-PRINT-POLISH-2026-09-24.txt` — 2026-09-24

````text
ReportGen Print View Refinement – 2026-09-24

Implemented:
- Removed currency icons from percentage and count KPI metrics in the Business Manager report.
- Added compact print-friendly empty states instead of oversized dashboard empty boxes.
- Added a current-month data notice when no sales activity is recorded.
- Prevented misleading comparison deltas from showing as -100% when current-month data is absent.
- Updated management commentary to distinguish missing/no recorded current activity from a genuine decrease.
- Improved printed table alignment, column sizing, wrapping, and the assigned-business contribution table.
- Added print-specific styling for summary metrics, notices, empty states, and tables.

Validation:
- JavaScript syntax checks passed for manager.js, reports.js, and payroll.js.
- This is a static code validation; live browser rendering and database integration testing should still be performed.
````


<!-- ===== 8. FIXES-APPLIED-2026-09-24.md (2026-09-24) ===== -->

### 8. `FIXES-APPLIED-2026-09-24.md` — 2026-09-24

````text
# ReportGen fixes applied

## Applied
- Changed fresh-install payroll foreign keys referencing `payroll_employees` from `ON DELETE CASCADE` to `ON DELETE RESTRICT` so accidental physical staff deletion cannot cascade-delete payroll, loans, deductions, skips, manual adjustments, or repayments.
- Added an explicit historical-data-safety comment to the schema.
- Made backup retention configurable through `REPORTGEN_MAX_BACKUPS`, with a safe minimum of 4 and a default of 12.

## Verification
- JavaScript syntax checks should be rerun by the next maintainer.
- `npm test` remains blocked in this environment because the `xlsx` dependency could not be installed/loaded (`Cannot find module 'xlsx'`). Run `npm ci` in an internet-enabled development environment before testing.

## Important limitation
The schema change affects fresh databases. Existing SQLite databases retain their original foreign-key definitions and require a controlled migration/rebuild before those constraints change. Do not attempt an uncontrolled in-place rewrite on a live production database.
````


<!-- ===== 9. BUILD-FIX-2026-09-25.md (2026-09-25) ===== -->

### 9. `BUILD-FIX-2026-09-25.md` — 2026-09-25

````text
# Build / dependency fix — 2026-09-25

## Issue
`npm ci` failed with many `Missing: <package>@<version> from lock file` errors.
`package-lock.json` had drifted out of sync with `package.json` (most likely from
the Electron version pin and dependency edits noted in `SECURITY-NOTES.md`),
so a clean/reproducible install was not possible.

## Root cause
Lockfile drift, not a missing or broken dependency. `xlsx` itself installs
fine once the lockfile is valid — the "Cannot find module 'xlsx'" failure
described in earlier notes was a downstream symptom of `npm ci` refusing to
run a normal install, not a problem with the `xlsx` package.

## Fix
Regenerated `package-lock.json` (`lockfileVersion: 3`) against the current
`package.json` via `npm install`, then verified with a clean `npm ci`.

## Verification performed
- `npm ci` completes with no missing-from-lockfile errors.
- `npm test` → 4/4 existing tests pass (import mapping x2, server foundation
  config, password hashing).
- `npm audit` → 1 high-severity finding, pre-existing and already documented
  in `SECURITY-NOTES.md`: `xlsx@0.18.5` (prototype pollution / ReDoS
  advisories, no upstream fix available). No change needed beyond what that
  note already recommends.

## Native module build note (environment-specific, not a code bug)
`better-sqlite3@13.0.3` has no prebuilt binary for this platform in this
package version — it always compiles from source via `node-gyp`, which needs:
- Python 3
- a C/C++ build toolchain (e.g. `build-essential` on Linux, Visual Studio
  Build Tools on Windows)
- network access to download matching Node.js headers from `nodejs.org`
  during the build

On a normal developer or production machine with unrestricted internet
access, this happens automatically during `npm install`/`npm ci` and needs
no special handling. It only becomes a blocker in network-restricted
environments (e.g. a sandboxed CI runner or an offline build box) where
`nodejs.org` is not reachable. In that specific case, point `node-gyp` at a
local copy of the Node headers instead of downloading them:

```bash
npm_config_nodedir=/path/to/node/headers npm ci
```
(On most Linux systems with Node's dev headers already present, `/usr` works.)

This is an environment workaround, not a project fix, and is unrelated to
the lockfile issue above.

## Files changed
- `package-lock.json` (regenerated)
- `BUILD-FIX-2026-09-25.md` (new)
````


<!-- ===== 10. BUILD-NOTES-CORRECTIONS-2026-09-25-LAN-SERVICE-AND-REMOTE-CLIENT.md (2026-09-25) ===== -->

### 10. `BUILD-NOTES-CORRECTIONS-2026-09-25-LAN-SERVICE-AND-REMOTE-CLIENT.md` — 2026-09-25

````text
# 2026-09-25 - LAN service + remote desktop client

## 1. Fixed: `start-reportgen-lan.ps1` never actually exposed port 80 on the LAN

`server/deployment/reverseProxy.js` binds its public-facing listener to
`REPORTGEN_HOST`, while `server/server.js` intentionally always binds the app
itself to `127.0.0.1` when the reverse proxy is on. `start-reportgen-lan.ps1`
was setting `REPORTGEN_HOST = '127.0.0.1'` with `REPORTGEN_REVERSE_PROXY = '1'`,
so the proxy - the thing meant to be reachable from other machines - ended up
loopback-only too. Firewall rules, the hosts-file entry, and hostname setup
were all correct; the listener itself was never exposed. Fixed to
`REPORTGEN_HOST = '0.0.0.0'`, matching `start-lan.ps1`, `start-lan-proxy.ps1`,
and `start-lan-https.ps1`, which already set this correctly.

The other three `start-lan*.ps1` scripts are still around for manual/foreground
testing; not consolidated yet.

## 2. Added: real Windows service for the standalone server

`scripts/install-reportgen-service.ps1` (+ matching `uninstall-reportgen-service.ps1`,
and root-level `install-reportgen-service.bat` / `uninstall-reportgen-service.bat`
wrappers) register `server/server.js` as a Windows service via NSSM:

- Starts automatically on boot, before anyone logs in.
- Auto-restarts on crash.
- Keeps running regardless of what the Electron desktop app is doing on any
  machine, including this one.
- Auto-detects mode (`Http` / `Https` / `Local`) from `config/deployment.json`
  when present, or takes `-Mode` explicitly.
- For HTTPS it reuses the certificate + saved PFX password from
  `scripts/generate-reportgen-certificates.ps1` / `start-lan-https.ps1`, since a
  background service has no console to prompt for a password on.

Requires NSSM (https://nssm.cc/) on PATH, at `scripts\nssm.exe`, or via
`-NssmPath`. Not bundled in this repo.

Other machines on the LAN: open a browser to `http://reportgen.local` (or
`https://reportgen.local` in HTTPS mode) - no desktop app install needed there.

## 3. Added: Electron "connect to an existing server" mode

Previously the desktop app could only spawn and use its own private, loopback-only
server (one person, one machine, own database) - by design, since
`electron-main.js` hardcoded `REPORTGEN_HOST: '127.0.0.1'` for the process it spawns.
That spawning behavior is unchanged and remains the default.

New: **ReportGen menu -> Server Connection…** lets someone instead point the
desktop app's window at a server already running elsewhere (e.g. the Windows
service from #2) without spawning a local server at all. The choice is saved
to `connection.json` in the app's data directory and applied on relaunch.
Useful for people who want a native window instead of a browser tab, without
each of them running their own local copy of the app and database.

Files added: `electron-connection-preload.js`, `electron-connection-settings.html`.
`electron-main.js` refactored so `waitForServer` / `createWindow` take a target
URL (loopback for local mode, the saved address for remote mode) instead of
always assuming loopback.
````


<!-- ===== 11. PRODUCTION-READINESS-CHANGES.md (2026-09-25) ===== -->

### 11. `PRODUCTION-READINESS-CHANGES.md` — 2026-09-25

````text
# Production readiness change log

This file is started fresh alongside this work and will grow as further
sections of the production-readiness task are completed. Each entry follows:
issue / root cause / change made / files changed / migration impact / test
performed / test result / remaining limitation.

---

## 1. Dependency install / lockfile (2026-09-25)

- **Issue:** `npm ci` failed with many `Missing: <package>@<version> from
  lock file` errors, blocking any install or test run.
- **Root cause:** `package-lock.json` had drifted out of sync with
  `package.json` (most likely from the Electron pin and other edits noted in
  `SECURITY-NOTES.md`).
- **Change made:** Regenerated `package-lock.json` via `npm install` against
  the current `package.json`.
- **Files changed:** `package-lock.json`, `BUILD-FIX-2026-09-25.md` (new).
- **Migration impact:** None (dependency tooling only).
- **Test performed:** `npm ci` (clean), `npm test`, `npm audit`.
- **Test result:** `npm ci` completes with no errors. `npm test` → 4/4 pass.
  `npm audit` → 1 pre-existing high-severity finding (`xlsx`, no upstream
  fix available, already documented in `SECURITY-NOTES.md`), no new findings.
- **Remaining limitation:** `better-sqlite3` has no prebuilt binary for this
  package version and always compiles from source via `node-gyp`, which
  needs Python 3, a C/C++ toolchain, and network access to `nodejs.org`.
  This is normal on any real dev/production machine with internet access and
  is not a defect; it only becomes a blocker in network-restricted sandboxes,
  where `npm_config_nodedir` can point at local Node headers instead. See
  `BUILD-FIX-2026-09-25.md` for detail.

---

## 2. Existing-database migration safety for payroll foreign keys (section 3.2, 2026-09-25)

- **Issue:** A prior fix changed the fresh-install schema
  (`server/database/schema.sql`) so that `payroll_entries`,
  `payroll_staff_loans`, and `payroll_staff_deductions` reference
  `payroll_employees(id)` with `ON DELETE RESTRICT` instead of `CASCADE`,
  to stop a physical staff deletion from cascade-deleting payroll/loan/
  deduction history. But `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so
  on any database created before that fix, the statement is a no-op and the
  original `CASCADE` definition silently remains — verified in
  `FIXES-APPLIED-2026-09-24.md`, which explicitly flagged this as an open
  risk requiring a controlled migration.
- **Root cause:** SQLite cannot `ALTER TABLE` to change a foreign key
  definition; the only way to change it is a full table rebuild
  (create-new / copy-data / drop-old / rename), and no such migration
  existed for these three tables.
- **Change made:** Added a startup migration in
  `server/database/database.js` that:
  - Checks each affected table's *live* foreign key definition via
    `PRAGMA foreign_key_list`, not `schema.sql` text.
  - Takes a verified, checksummed, self-contained backup
    (`<data dir>/backups/reportgen-premigration-payroll-fk-restrict-*.sqlite`)
    before touching anything, using a WAL checkpoint + file copy (cannot
    reuse `server/database/backupService.js` here — it `require`s `db` from
    this same file, which would be a circular require during this file's
    own startup).
  - Rebuilds only the tables that still need it, inside one transaction,
    reading each table's *current* live schema from `sqlite_master` (so any
    columns added since by other migrations are preserved) and only
    tightening the `payroll_employees` foreign key's `ON DELETE` clause.
  - Verifies row counts, `PRAGMA foreign_key_check`, and
    `PRAGMA integrity_check` before declaring success; throws with a clear
    rollback pointer to the backup file on any failure.
  - Also corrected the same `CASCADE`/`RESTRICT` inconsistency in this
    file's own (normally dead-code, since `schema.sql` already creates these
    tables correctly first) guarded `CREATE TABLE IF NOT EXISTS` block for
    `payroll_loan_repayments`, `payroll_loan_skips`, and
    `payroll_manual_staff_adjustments`, so it is never wrong in the one case
    where it would actually fire.
- **Also found and fixed while testing this (same category of risk):** the
  existing `users` table role-rebuild migration (adds the `general_manager`
  role for pre-existing databases) had **no backup at all**, and — more
  seriously — a real, previously-undetected bug: `ALTER TABLE users RENAME
  TO users_legacy_roles` silently rewrote every *other* table's stored
  foreign key text (e.g. `created_by ... REFERENCES users(id)`) to point at
  `users_legacy_roles`, because SQLite auto-updates cross-table FK
  references on rename by default (`legacy_alter_table = OFF`), independent
  of the `foreign_keys` pragma. Once `users_legacy_roles` was dropped, this
  left dangling, corrupted foreign keys across the database. Fixed by
  setting `PRAGMA legacy_alter_table = ON` around the rename, and by adding
  the same backup-first / whole-database-`foreign_key_check`-after treatment
  used for the payroll migration above.
- **Files changed:** `server/database/database.js`,
  `tests/existing-db-migration.test.js` (new),
  `DATABASE-MIGRATION-GUIDE.md` (new).
- **Migration impact:** Runs automatically on next startup against any
  existing database that still has the old `CASCADE` definition or the
  pre-`general_manager` `users` table. Idempotent — a second boot against an
  already-migrated database performs no backup and no rebuild (verified by
  test). See `DATABASE-MIGRATION-GUIDE.md` for the full explanation, backup
  location, verification commands, and rollback procedure.
- **Test performed:** Built a synthetic "legacy" database on disk (old
  `CASCADE` FKs on the three payroll tables, pre-`general_manager` `users`
  table, with real staff/payroll/loan/deduction rows), then required the
  real `server/database/database.js` module against it end to end - not a
  mock. Verified: pre-migration backups created and checksummed; every
  affected table now reports `RESTRICT` via live `PRAGMA foreign_key_list`;
  all original rows, IDs, and values preserved exactly; no
  `users_legacy_roles` references remain anywhere in the schema;
  whole-database `PRAGMA foreign_key_check` returns no violations;
  `PRAGMA integrity_check` returns `ok`; a physical `DELETE` of a staff
  member with payroll/loan/deduction history now correctly fails with a
  foreign key constraint error; a staff member with no such history can
  still be deleted; a second `require` of the module against the
  now-migrated database performs no further backup or rebuild. All of this
  is captured as 7 passing automated tests in
  `tests/existing-db-migration.test.js`, plus the pre-existing 4 tests still
  pass unmodified (11/11 total via `npm test`).
- **Test result:** Pass (11/11 automated tests; manual deep verification
  also performed and matches).
- **Remaining limitation:** Pre-migration backups
  (`reportgen-premigration-*.sqlite`) are not currently subject to
  `REPORTGEN_MAX_BACKUPS` retention pruning the way regular scheduled
  backups are. In practice this migration only fires once per genuine
  schema transition (idempotency verified above), so this should not
  accumulate meaningfully, but an administrator upgrading a very old
  install through several versions in sequence could see a small number of
  extra files in `<data dir>/backups/` worth being aware of.

## 3. HTTPS / LAN authentication hardening (section 3, 2026-10-03)

- **Issue:** Session-cookie security was derived from deployment configuration rather than the actual request transport. In addition, LAN authentication could be performed over plain HTTP unless the operator manually configured HTTPS.
- **Root cause:** `authRoutes.js` used `secure: config.httpsEnabled || config.reverseProxy`, while the reverse proxy and direct-LAN modes can expose different transport paths.
- **Change made:** Session cookies now use `req.secure`; LAN login is rejected with HTTP 426 by default when the request is not HTTPS; `REPORTGEN_ALLOW_INSECURE_LAN=1` is an explicit legacy exception. HTTPS responses receive HSTS and a restrictive Permissions-Policy, and authentication endpoints are marked `Cache-Control: no-store`.
- **Setup change:** The Electron setup wizard requires HTTPS when LAN sharing is selected and automatically enables HTTPS when LAN access is checked.
- **Files changed:** `server/config.js`, `server/auth/authRoutes.js`, `server/security/headers.js`, `electron-setup-wizard.html`, `scripts/install-reportgen-service.ps1`, `scripts/start-lan.ps1`, `scripts/start-reportgen-lan.ps1`, `tests/security-transport.test.js`, `BUILD-NOTES-STAGE3-HTTPS-LAN-AUTH-2026-10-03.md`.
- **Migration impact:** None; no database schema changes.
- **Test performed:** Syntax-checked all JavaScript files (71/71), syntax-checked the embedded setup-wizard JavaScript, and verified the transport policy configuration defaults/opt-in behavior. Full dependency-backed integration tests remain to be run in an environment with `node_modules` installed.
````


<!-- ===== 12. BUILD-NOTES-DASHBOARD-DATA-FIX-2026-10-01.md (2026-10-01) ===== -->

### 12. `BUILD-NOTES-DASHBOARD-DATA-FIX-2026-10-01.md` — 2026-10-01

````text
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
````


<!-- ===== 13. BUILD-NOTES-DASHBOARD-OPTIMIZATION-2026-10-01.md (2026-10-01) ===== -->

### 13. `BUILD-NOTES-DASHBOARD-OPTIMIZATION-2026-10-01.md` — 2026-10-01

````text
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
````


<!-- ===== 14. BUILD-NOTES-DASHBOARD-PURCHASE-PLANNING-2026-10-01.md (2026-10-01) ===== -->

### 14. `BUILD-NOTES-DASHBOARD-PURCHASE-PLANNING-2026-10-01.md` — 2026-10-01

````text
# ReportGen v2.0.12 — Dashboard Purchase & Profit Planning

## Added
- Separate dashboard Gross Profit and Net Profit figures.
- Gross Profit is calculated as Sales minus Cost of Goods Sold (COGS).
- Dashboard month selector; selecting a month resets the top date range to the complete calendar month.
- Dashboard business selector for company-wide or individual-business views.
- Purchases & Planning section appears only for a complete calendar month.
- Total stock purchases for the selected month/business.
- Estimated remaining purchase balance using cumulative purchases minus cumulative COGS.
- Estimated payable for the next month using the selected month COGS as the planning guide.
- CEO / Owner expense adjustment stored per business and month as a 0–100% gross-profit percentage.
- CEO / Owner expense amount is deducted from Gross Profit when calculating Net Profit.
- Owner adjustment is included in company-wide views by summing each business’s own monthly percentage against that business’s gross profit.

## Planning definitions
- Estimated remaining balance is a management estimate, not a physical stock count and not a confirmed supplier liability.
- Estimated payable next month is a planning guide: current month COGS becomes the following month’s estimated payable.
- Equipment and other non-stock funding are not separated in the existing purchase module because current purchase records are treated as stock purchases; operating expenses remain in the accountant expense module.

## Existing functionality preserved
- Existing Purchases page and records remain unchanged.
- Existing sales import fields remain unchanged.
- Existing accountant expense and payroll records remain unchanged.
- Existing top date-range selector remains the source for partial-period reporting.

## Validation
- Node syntax checks passed for all JavaScript files under `public/js` and `server`.
- Existing test suite was attempted. Tests requiring `better-sqlite3` and `xlsx` could not run because this source ZIP does not contain `node_modules`; the two dependency-independent tests passed.
````


<!-- ===== 15. BUILD-NOTES-DASHBOARD-VENDOR-PAYMENTS-2026-10-01.md (2026-10-01) ===== -->

### 15. `BUILD-NOTES-DASHBOARD-VENDOR-PAYMENTS-2026-10-01.md` — 2026-10-01

````text
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
````


<!-- ===== 16. BUILD-NOTES-DASHBOARD-MONTHLY-OWNER-EXPENSE-2026-10-02.md (2026-10-02) ===== -->

### 16. `BUILD-NOTES-DASHBOARD-MONTHLY-OWNER-EXPENSE-2026-10-02.md` — 2026-10-02

````text
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
````


<!-- ===== 17. BUILD-NOTES-GLOBAL-DATE-RANGE-REFRESH-2026-10-02.md (2026-10-02) ===== -->

### 17. `BUILD-NOTES-GLOBAL-DATE-RANGE-REFRESH-2026-10-02.md` — 2026-10-02

````text
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
````


<!-- ===== 18. BUILD-NOTES-MONTH-SELECTOR-2026-10-02.md (2026-10-02) ===== -->

### 18. `BUILD-NOTES-MONTH-SELECTOR-2026-10-02.md` — 2026-10-02

````text
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
````


<!-- ===== 19. BUILD-NOTES-AUDIT-PERFORMANCE-OPTIMIZATION-2026-10-03.md (2026-10-03) ===== -->

### 19. `BUILD-NOTES-AUDIT-PERFORMANCE-OPTIMIZATION-2026-10-03.md` — 2026-10-03

````text
# Audit Log Performance Optimization — 2026-10-03

## Problem
The Audit Log page could become extremely slow on large audit tables. The previous API requested a page of rows **and** ran a full `COUNT(*)` for every page request. The UI also loaded audit metadata before loading the first page.

## Changes
- Audit API no longer performs a full-table `COUNT(*)` on every request.
- API fetches `limit + 1` rows and returns `pagination.hasMore` instead.
- Audit page defaults to the **last 30 days** instead of implicitly querying the entire company history.
- Added an explicit **All history** option for users who intentionally need the complete history.
- Date-range filtering remains available with From/To.
- Search, action, user and business filters remain available.
- First audit page now loads before metadata, so a large metadata query cannot block the initial audit results.
- Metadata is populated into the existing filter controls after the first page is available.
- Previous/Next pagination no longer requires a total-count query.
- Existing indexed filters on company/time, action, user and business remain in place.

## Expected behavior
Opening Audit Log should now show recent records quickly even when the audit table is large. Users can narrow by date range and/or search term, or deliberately enable All history.

## Verification
- `node --check` on all JavaScript files: PASS.
- Existing audit/security regression tests: PASS.
- Final archive is re-extracted and all extracted JavaScript files are syntax-checked before delivery.
````


<!-- ===== 20. BUILD-NOTES-OWNER-ALLOCATION-DASHBOARD-FIX-2026-10-03.md (2026-10-03) ===== -->

### 20. `BUILD-NOTES-OWNER-ALLOCATION-DASHBOARD-FIX-2026-10-03.md` — 2026-10-03

````text
# ReportGen — Owner Allocation Dashboard Fix — 2026-10-03

## Changes
- Removed the extra explanatory paragraphs from the CEO / Owner expense allocation panel to make the dashboard section more compact.
- Kept the useful gross-profit base as a compact line so the preview calculation remains clear.
- Removed the bottom calculation explanation from the panel.
- Fixed the live percentage preview bug: the input handlers were referencing `allocationBase` and `selectedOwnerGrossProfit` variables that only existed inside the `dashboard()` render function. Typing a percentage therefore could not update the preview.
- Preview bases are now read from the current dashboard state at input time, so typing updates the amount immediately without saving first.
- Both default allocation and selected-business allocation previews are supported.

## Verification
- `node --check public/js/pages/dashboard.js` passed.
- All JavaScript files in the packaged source (excluding node_modules) were syntax-checked before packaging.
- The final ZIP was tested with `unzip -tq` and re-extracted.
- All JavaScript files in the re-extracted ZIP were syntax-checked again.
````


<!-- ===== 21. BUILD-NOTES-REPORT-UPDATE-2026-10-03.md (2026-10-03) ===== -->

### 21. `BUILD-NOTES-REPORT-UPDATE-2026-10-03.md` — 2026-10-03

````text
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
````


<!-- ===== 22. BUILD-NOTES-STAGE10A-TRANSACTION-INTEGRITY-2026-10-03.md (2026-10-03) ===== -->

### 22. `BUILD-NOTES-STAGE10A-TRANSACTION-INTEGRITY-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 10A — Critical Financial Transaction Integrity

## Baseline

Stage 9 — Session & Authentication Hardening.

## Scope

This pass hardens critical financial mutations so the financial write and its corresponding audit record are committed atomically.

Protected areas:

- Accountant expenses
- Accountant remittances
- Capital / purchases
- Vendor payments
- Payroll totals, employee payroll, payroll generation/save/pay, edits/deletes
- Payroll deductions and staff loans
- Loan skip and loan repayment void operations

## Transaction rule

Each protected mutation follows:

`validate → authorize → write related records → audit → commit`

If the mutation or audit write fails, the transaction is rolled back so the financial record and its audit entry cannot diverge.

## Important correction

The employee-level payroll route previously created a new staff record before its payroll writes. It is now included inside the same transaction so a later payroll failure cannot leave an orphan staff record behind.

## Deliberately unchanged

- One-statement writes that have no related audit requirement were not wrapped solely for appearance.
- Sales import was not rewritten; it already has a transaction boundary and will be verified separately in Stage 10B.
- Production data/server were not touched.

## Verification

- All JavaScript files syntax-checked successfully.
- Stage 10A transaction-structure test added.
- Stage 10A runtime SQLite rollback/commit test added.
- Existing financial-integrity, audit-trail, backup/recovery, and session-security static tests remain in the project.
````


<!-- ===== 23. BUILD-NOTES-STAGE11A-AUTH-HARDENING-2026-10-03.md (2026-10-03) ===== -->

### 23. `BUILD-NOTES-STAGE11A-AUTH-HARDENING-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 11A — Authentication Hardening

Date: 2026-10-03

## Changes
- Added a second login throttle keyed by normalized username in addition to the existing IP throttle.
- Added a dummy password verification path for unknown usernames to reduce username-enumeration timing differences.
- Hardened the ReportGen session cookie with SameSite=Strict while retaining HttpOnly, transport-aware Secure, and the configured session TTL.
- Preserved existing session expiry, inactive-user invalidation, CSRF enforcement, and password-reset session invalidation.
- Added regression tests for all Stage 11A authentication controls.

## Verification
- Stage 11A authentication tests: 7/7 passed.
- JavaScript syntax: 93/93 files passed.
- No production server or production database was touched.
````


<!-- ===== 24. BUILD-NOTES-STAGE11D-TRANSPORT-LAN-SECURITY-2026-10-03.md (2026-10-03) ===== -->

### 24. `BUILD-NOTES-STAGE11D-TRANSPORT-LAN-SECURITY-2026-10-03.md` — 2026-10-03

````text
# Stage 11D — Transport & Local-Network Security

Date: 2026-10-03
Version: 2.0.16

## Completed

- Kept ReportGen server binding loopback-only by default.
- Preserved explicit LAN opt-in through `REPORTGEN_HOST`.
- Enforced valid `.local` hostname configuration at startup.
- Added strict Host-header validation at the reverse-proxy boundary.
- Prevented Host-header based open redirects.
- HTTP-to-HTTPS redirect now uses only the configured ReportGen hostname.
- Added explicit API Origin policy; unexpected browser origins are rejected.
- Kept CORS non-permissive; ReportGen does not expose `Access-Control-Allow-Origin: *`.
- Preserved HTTPS-only authentication for LAN use unless insecure LAN access is explicitly enabled.
- Preserved HSTS on secure responses.
- Preserved anti-sniffing, anti-framing, referrer, permissions and CSP headers.
- Verified the certificate download route exposes only the public CA certificate; no PFX/password/private-key route is exposed.
- Reverse proxy continues to terminate TLS and forwards to the loopback-only application server.

## Verification

- Stage 11D transport boundary tests: 7/7 passed.
- JavaScript syntax checks: all project `.js` files passed.
- Sensitive-file scan: no private keys/certificates included in the release tree.
- Package integrity: one top-level `ReportGen` directory.
````


<!-- ===== 25. BUILD-NOTES-STAGE11E-RESOURCE-ABUSE-2026-10-03.md (2026-10-03) ===== -->

### 25. `BUILD-NOTES-STAGE11E-RESOURCE-ABUSE-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 11E — Database/API Availability & Abuse Resistance

Date: 2026-10-03
Version: 2.0.17

## Changes
- Added explicit JSON request-body limit (2 MB) and URL-encoded body limit (256 KB / 200 parameters).
- Added bounded API rate-limit bucket storage so unbounded unique-client keys cannot grow indefinitely in memory.
- Reduced sales workbook processing to single-flight (one active workbook inspect/import at a time) to protect the Electron/LAN server from concurrent high-memory workbook parsing.
- Added multipart field, field-size, part-count, and file-count limits to sales imports.
- Added multipart field, field-size, part-count, and file-count limits to database backup imports while retaining the 10 GB backup file ceiling.
- Added explicit 413 handling for upload/body resource-limit failures.
- Added 35-second HTTP header timeout and 5-second keep-alive timeout while retaining the 30-minute request timeout required by long-running database backup operations.
- Bounded owner report generation to 24 months per request; longer history can be generated as separate reports.
- Existing audit pagination/default 30-day window and report export concurrency controls were retained.

## Verification
- Stage 11E resource-abuse tests: 7/7 passed.
- Stage 11A/11B/11D regression tests: 19/19 passed.
- JavaScript syntax checks: performed across all server/public/test JS files before packaging.
- Sensitive-file scan: no private keys, PFX files, or certificate material packaged.
- ZIP layout: exactly one top-level `ReportGen` directory.
````


<!-- ===== 26. BUILD-NOTES-STAGE11F-LOGGING-ERROR-HANDLING-2026-10-03.md (2026-10-03) ===== -->

### 26. `BUILD-NOTES-STAGE11F-LOGGING-ERROR-HANDLING-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 11F — Logging, Error Handling & Operational Security

Date: 2026-10-03
Version: 2.0.18

## Changes
- Added structured server logging to the persistent ReportGen data directory under `logs/reportgen-server.log`.
- Added bounded 5 MB log rotation with restrictive local file permissions where supported.
- Added request correlation IDs (`X-Request-ID`) for API troubleshooting without exposing request bodies or credentials.
- Added safe error serialization and redaction for passwords, tokens, authorization headers, cookies, secrets, private keys and PFX/passphrase values.
- Disabled stack traces in normal production logs; detailed stacks require explicit `REPORTGEN_DEBUG_LOGS=1`.
- Added standardized safe 500 responses containing only a correlation ID.
- Added a clear 400 response for malformed JSON instead of leaking parser details.
- Added process-level uncaught-exception and unhandled-rejection logging with safe serialization.
- Standardized reverse-proxy and database-operation failure logging through the safe logger.
- Startup logging no longer prints the database path or complete configuration object.
- Existing user-facing error messages remain concise and do not expose raw server exceptions.

## Verification
- Stage 11F operational-security tests: 2/2 passed.
- JavaScript syntax checks passed across server/public/test JavaScript files.
- Sensitive log-redaction checks passed.
- No production source path logs passwords, tokens, authorization headers, private keys or PFX passphrases through the new operational logger.
````


<!-- ===== 27. BUILD-NOTES-STAGE11G-DEPLOYMENT-INTEGRITY-2026-10-03.md (2026-10-03) ===== -->

### 27. `BUILD-NOTES-STAGE11G-DEPLOYMENT-INTEGRITY-2026-10-03.md` — 2026-10-03

````text
# Stage 11G — Secure Update & Deployment Integrity

## Version
ReportGen 2.0.19

## Changes
- Added `RELEASE-MANIFEST.json` with SHA-256 hashes for critical runtime/deployment files.
- Added release-manifest generation and verification scripts.
- Added version-bound release integrity verification before the safe updater starts the server.
- Safe updater no longer runs `npm install` automatically.
- Persistent SQLite data remains outside the application installation directory.
- Desktop setup/connection/certificate state remains in the persistent ReportGen-v2 app-data directory.
- Existing database migration/recovery safeguards remain active: staged databases are integrity-checked before replacement and the previous database is retained until startup verification succeeds.
- Existing NSIS installer stops the ReportGen service before replacing application files and restarts it after installation.
- Uninstall configuration continues to preserve application data.
- Release packaging continues to exclude certificate/private deployment material.

## Verification
- 32/32 targeted Stage 11A/11B/11D/11E/11G security and regression tests passed.
- 102 JavaScript files passed syntax checking.
- Release manifest generated and verified against ReportGen 2.0.19.
- ZIP verified to contain exactly one top-level `ReportGen` folder.
- Sensitive-file scan passed; no private key/certificate artifacts packaged.
````


<!-- ===== 28. BUILD-NOTES-STAGE12-PRODUCTION-READINESS-2026-10-03.md (2026-10-03) ===== -->

### 28. `BUILD-NOTES-STAGE12-PRODUCTION-READINESS-2026-10-03.md` — 2026-10-03

````text
# Stage 12 — Production Readiness & Final QA

Version: 2.0.20
Date: 2026-10-03

## Release-candidate checks

- Dependency-free regression/security suite: 61/61 passed.
- JavaScript syntax check: passed for all JS files in the release tree.
- Release manifest generation: passed.
- Release integrity verification: passed.
- Recovery regression discovered during full-suite run: legacy static assertions expected pre-Stage-11F wording. Updated database recovery comments to retain explicit recovery semantics; targeted recovery/deployment suite: 10/10 passed.
- Full dependency-backed integration suite attempted but six suites could not start because `node_modules` is intentionally absent from this source build. The failures were module-resolution failures (`express` unavailable), not application test assertions. No dependency installation was performed.

## Dependency-backed suites pending installed environment

- dashboard-summary.test.js
- existing-db-migration.test.js
- permission-isolation.test.js
- role-nav-access.test.js
- sales-import.test.js
- security-transport.test.js

These require the production dependency tree and should be executed in the clean build/CI environment before customer distribution.

## Final readiness areas reviewed

- First-launch/setup flow and persistent AppData boundaries
- Authentication/session/CSRF protections
- Role and tenant isolation
- Sales import and financial transaction integrity
- Idempotency and failure recovery
- Audit trail and audit UI protections
- LAN/HTTPS/Host/Origin security
- Request/upload/resource limits
- Logging and safe error handling
- Release/update integrity
- Installer/uninstaller data preservation
- Certificate/private-key exclusion from release artifacts

## Release decision

This source tree is a **release candidate**, not a claim that a dependency-free source ZIP alone replaces final installer/CI integration testing. The remaining six suites require a normal dependency-installed build environment.
````


<!-- ===== 29. BUILD-NOTES-STAGE3-HTTPS-LAN-AUTH-2026-10-03.md (2026-10-03) ===== -->

### 29. `BUILD-NOTES-STAGE3-HTTPS-LAN-AUTH-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 3 — HTTPS / LAN Authentication Hardening

Date: 2026-10-03

## Scope

Stage 3 hardens authentication transport for ReportGen LAN deployments without changing the existing local-only HTTP development path.

## Changes

1. **Secure session-cookie decision fixed**
   - The session cookie is now marked `Secure` from the actual request transport (`req.secure`).
   - It is no longer inferred merely from `REPORTGEN_REVERSE_PROXY`.
   - This prevents a configuration mismatch from producing a `Secure` cookie over plain HTTP or a non-secure cookie over HTTPS.

2. **LAN login requires HTTPS by default**
   - New environment setting: `REPORTGEN_ALLOW_INSECURE_LAN`.
   - Default is `false`.
   - If ReportGen is exposed beyond loopback and a login arrives over HTTP, authentication returns HTTP `426 Upgrade Required` unless the operator explicitly enables the legacy insecure-LAN exception.

3. **HTTPS security headers**
   - HTTPS responses now send HSTS: `max-age=31536000; includeSubDomains`.
   - Added a restrictive `Permissions-Policy` for camera, microphone and geolocation.
   - Authentication responses use `Cache-Control: no-store`.

4. **Setup wizard policy**
   - Sharing the ReportGen host on the local network now requires HTTPS.
   - Enabling LAN access automatically enables the HTTPS option in the wizard.
   - A Windows background service can still be local-only, but a LAN host must use HTTPS.

5. **Legacy HTTP remains explicitly opt-in**
   - Manual `start-lan.ps1`, `start-reportgen-lan.ps1`, and service `-Mode Http` explicitly set `REPORTGEN_ALLOW_INSECURE_LAN=1`.
   - This preserves existing trusted-LAN/manual testing workflows while making the exception visible and deliberate.
   - Production LAN deployments should use the HTTPS path.

## Test / verification

- `node --check` passed for every JavaScript file in the source tree: **71/71**.
- The embedded JavaScript in `electron-setup-wizard.html` was extracted and syntax-checked successfully.
- Configuration policy test passed: insecure LAN access defaults to disabled and only becomes enabled when explicitly configured.
- Full integration tests requiring installed npm dependencies could not be executed in the clean source archive because `node_modules` is intentionally excluded from the deliverable.

## Migration impact

No database migration is required.

Existing HTTPS deployments continue to use the existing PFX/certificate mechanism. Existing plain-HTTP deployments must explicitly opt into the legacy insecure-LAN flag if they continue to use HTTP authentication.

## Development HTTPS isolation launcher

Added `scripts/start-dev-lan-https.ps1` for safe Stage 3 development testing. It deliberately does not read or modify `config/deployment.json`, refuses production ports 4310/80/443, uses application port 4312, HTTP redirect port 8080, and HTTPS port 8443 by default, and points development data at `reportgen-test-data` when available. It generates a development-only CA/server certificate in `%TEMP%\ReportGen-Stage3-Dev`, trusts only that development CA for the current Windows user, and keeps the production certificate/PFX untouched. mDNS is disabled in this launcher so it cannot compete with the production hostname responder on UDP 5353.
````


<!-- ===== 30. BUILD-NOTES-STAGE4-ACCOUNT-SECURITY-2026-10-03.md (2026-10-03) ===== -->

### 30. `BUILD-NOTES-STAGE4-ACCOUNT-SECURITY-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 4 — Account Security Update — 2026-10-03

## Included
- Every authenticated user can change their own password from the account chip in the top bar.
- Password changes require the current password, an 8–200 character new password, and confirmation.
- New password must differ from the current password.
- Password changes invalidate all active sessions and require the user to sign in again.
- Password-change events are written to the audit log without storing passwords.
- User/account management is restricted by role hierarchy on the server.
- Users with `users.manage` only receive accounts they are allowed to manage; higher-privilege accounts are not exposed in their user list.
- The System Administrator (`administrator`/legacy `admin` role) is protected from deletion/deactivation.
- The System Administrator deletion/status controls are also hidden in the user-management UI.
- Account deletion remains a history-preserving deactivation: the login is disabled, sessions/access assignments are removed, and historical records remain intact.
- Role-permission management only exposes roles the current manager can edit; a user can never edit their own role permissions.

## Security boundaries
- Server-side checks remain authoritative; UI restrictions are only convenience.
- Existing HTTPS/LAN authentication hardening remains in place.
- No database schema migration is required.
````


<!-- ===== 31. BUILD-NOTES-STAGE4-LOGIN-CLEANUP-2026-10-03.md (2026-10-03) ===== -->

### 31. `BUILD-NOTES-STAGE4-LOGIN-CLEANUP-2026-10-03.md` — 2026-10-03

````text
# Stage 4 Login Cleanup — 2026-10-03

## Change
- A normal signed-out first load calls `/api/auth/me`, which correctly returns HTTP 401.
- The frontend now treats that 401 as an expected signed-out state and does not display `Authentication required.` on the login screen.
- Other authentication/workspace errors continue to be surfaced.
- API errors now retain their HTTP status on the thrown Error object so the boot flow can distinguish expected 401 from other failures.
- Cache-busted `public/index.html` to load the corrected app bundle.

## Verification
- All JavaScript files must pass `node --check`.
- Package must be re-extracted and all extracted JavaScript checked before delivery.
````


<!-- ===== 32. BUILD-NOTES-STAGE4-ROLE-PERMISSIONS-V2.txt (2026-10-03) ===== -->

### 32. `BUILD-NOTES-STAGE4-ROLE-PERMISSIONS-V2.txt` — 2026-10-03

````text
ReportGen Stage 4 — Role Permissions Runtime Fix
Date: 2026-10-03

Changes
- Kept the role-permission API at /api/permissions/:role and preserved server-side authentication/role checks.
- Added a backend build marker to /api/health: stage4-role-permissions-v2 and permissionsRoutes=true.
- Updated the development HTTPS launcher to use the persistent reportgen-test-data database instead of recreating a disposable copy on every launch.
- The development launcher now checks ports 4312/8080/8443 and stops only a previous ReportGen server process belonging to the same source tree; unrelated processes are not terminated.
- Production ports 4310/80/443 and production data remain untouched.
- Existing HTTPS certificate generation remains development-only.

Verification
- All JavaScript files passed node --check.
- No database, private key, PFX, credential, or Git metadata is included in this ZIP.
- The package was re-extracted and its JavaScript files were checked again before delivery.
- The PowerShell launcher was manually syntax-reviewed; this Linux verification environment does not provide a PowerShell parser.

Runtime note
- After installing this package, start the supplied scripts/start-dev-lan-https.ps1 so the current Stage 4 backend owns port 8443. If another unrelated process already owns one of the development ports, the launcher stops and reports it rather than killing it.
````


<!-- ===== 33. BUILD-NOTES-STAGE4-ROLES-PERMISSIONS-CORRECTED-2026-10-03.md (2026-10-03) ===== -->

### 33. `BUILD-NOTES-STAGE4-ROLES-PERMISSIONS-CORRECTED-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 4 — Roles & Permissions Corrected Build

This build is based on the verified Stage 3 HTTPS/LAN development build, not the older pre-Stage-3 source.

## Preserved
- Stage 3 HTTPS/LAN authentication hardening and isolated development launcher.
- Owner allocation dashboard preview UI and the reduced dashboard text.
- Stage 3 date input, CSP, loader, network retry and report fixes already present in the base.

## Stage 4 changes
- Role-permission reads for the current role remain available for workspace boot.
- Reading/managing another role requires `roles.manage`.
- A user cannot modify permissions for their own role.
- Administrator permissions remain protected.
- A non-administrator cannot grant a permission they do not currently possess.
- User creation/status/business-access changes respect role hierarchy.
- Users UI separates `users.manage` from `roles.manage`.
- The role-permissions UI never offers the current user's own role.
````


<!-- ===== 34. BUILD-NOTES-STAGE5-FINANCIAL-INTEGRITY.txt (2026-10-03) ===== -->

### 34. `BUILD-NOTES-STAGE5-FINANCIAL-INTEGRITY.txt` — 2026-10-03

````text
ReportGen Stage 5 — Financial & Report Integrity
Date: 2026-10-03

Purpose
-------
Make financial report calculations authoritative on the server so browser-supplied
financial totals cannot be used to generate Owner/Admin reports or exports.

Changes
-------
1. Added POST /api/reports/owner-data.
   - Server calculates the selected reporting range directly from the company DB.
   - Frontend report preview now consumes this authoritative payload.
   - Selected business is validated against the authenticated company.

2. Owner/Admin Word and Excel exports now call the same server-side calculation
   engine instead of trusting rows/totals supplied by the browser.

3. Server-side calculation covers:
   - sales, gross sales and returns
   - cost of goods and gross profit
   - operating expenses
   - payroll
   - purchases/capital
   - vendor payments
   - owner expense allocation, including monthly defaults, business overrides
     and exclusions
   - transactions and distinct sales days
   - estimated net profit
   - business and monthly contribution data
   - expense details and owner allocation details

4. Added audit entries for vendor payment create/update/delete and owner allocation
   default/adjustment/update/reset mutations.

5. Spreadsheet import dependency security is preserved in package.json by replacing
   the vulnerable xlsx 0.18.5 dependency with the npm alias @e965/xlsx 0.20.3.
   package-lock.json was removed deliberately because it still described 0.18.5;
   npm install must regenerate a fresh lockfile before packaging/deployment.

Important
---------
The Business Manager export validation remains server-side and continues to verify
its submitted source rows against authoritative DB values. Full conversion of all
Business Manager rich HTML sections to server-rendered financial sections remains
separate work; Stage 5 owner/admin preview + Word/Excel export are fully sourced
from the server calculation engine.

Verification
------------
- 75/75 JavaScript files passed node --check.
- package.json parsed successfully.
- No node_modules included in the deliverable.
- No database files included.
- No certificates/private keys included.
- Final ZIP is re-extracted and all JavaScript files are checked again before delivery.
````


<!-- ===== 35. BUILD-NOTES-STAGE5-FINANCIAL-PERMISSION-AUDIT-V7.md (2026-10-03) ===== -->

### 35. `BUILD-NOTES-STAGE5-FINANCIAL-PERMISSION-AUDIT-V7.md` — 2026-10-03

````text
# ReportGen Stage 5 — Financial Integrity & Permission Audit v7

Date: 2026-10-03

## Scope

Continued from the Stage 5 Permission Isolation v6 baseline.

### Owner Expense Allocation isolation

CEO / Owner Expense Allocation is now Owner-only across the financial report pipeline:

- Dashboard owner-allocation read/write/reset endpoints remain Owner-only.
- Server-side report calculation reads owner allocation rules only for the `owner` role.
- General Manager, Administrator and other non-Owner report users receive profitability calculated without owner expense allocation.
- Owner allocation detail is omitted from non-Owner Excel/Word exports.
- Owner Expense columns and KPI fields are omitted from non-Owner exports rather than exposing zero-valued placeholders.
- The Owner Expense Allocation worksheet is created only for the Owner.
- Owner-facing report UI remains gated by the Owner role.

## Integrity principle

The browser is not trusted as the source of owner allocation or profitability values. Report exports derive their figures from the server/database calculation path.

## Verification

- `node --check server/reports/reportsRoutes.js` — PASS
- Owner-isolation static regression test (`tests/owner-expense-isolation.test.js`) — PASS
- Full JavaScript syntax verification required before packaging.
- Final ZIP is re-extracted and all extracted JavaScript files are syntax-checked before delivery.

## Production safety

This source package does not change or connect to the production service ports 4310/80/443. Development remains isolated to the ReportGen development configuration.
````


<!-- ===== 36. BUILD-NOTES-STAGE5-OWNER-ONLY-EXPENSE-ALLOCATION-2026-10-03.md (2026-10-03) ===== -->

### 36. `BUILD-NOTES-STAGE5-OWNER-ONLY-EXPENSE-ALLOCATION-2026-10-03.md` — 2026-10-03

````text
# ReportGen — Owner-Only Expense Allocation

Date: 2026-10-03
Baseline: Stage 5 Permission Isolation v5

## Change
CEO / Owner expense allocation is now exclusive to the Owner role.

### Dashboard
- Owner-only allocation controls and month-by-month allocation breakdown remain visible only to the Owner.
- CEO / Owner expense KPI is hidden from General Manager, Administrator, Accountant, Business Manager and Viewer dashboards.
- Dashboard financial snapshot hides Owner adjustment for non-Owner roles.
- Non-Owner dashboard net profit is calculated before Owner expense allocation.

### Server enforcement
- `/api/dashboard/owner-default`
- `/api/dashboard/owner-adjustment`
- `/api/dashboard/owner-allocation`
- `/api/dashboard/owner-allocation/:businessId/:month`
- `/api/dashboard/owner-allocations`

All of the above now require the authenticated role to be `owner`.
- Non-Owner dashboard responses do not expose owner allocation details.
- Non-Owner dashboard totals report ownerExpense as 0 and net profit before Owner allocation.

### Reports
- The authoritative report endpoint returns no Owner allocation data to non-Owner roles.
- General Manager reports no longer display Owner expense KPI or Owner Expense Allocation sections.
- General Manager report net profit is calculated before Owner allocation.
- Owner reports retain the existing Owner allocation details and calculations.

## Verification
- All JavaScript files syntax-checked with `node --check`.
- Final packaged ZIP will be re-extracted and all extracted JavaScript files syntax-checked again before delivery.
- No database schema change.
- No certificates/private keys added.
- No node_modules included.
````


<!-- ===== 37. BUILD-NOTES-STAGE5-PERMISSION-ISOLATION.txt (2026-10-03) ===== -->

### 37. `BUILD-NOTES-STAGE5-PERMISSION-ISOLATION.txt` — 2026-10-03

````text
ReportGen Stage 5 - Permission Isolation (staff / payroll / deductions / salaries)
Date: 2026-10-03

Problem
-------
A role given only "View staff" (for example the General Manager) could not open the staff list, and the app
crashed. The staff, payroll and salary areas were also not isolated: salary visibility depended on the role NAME,
so Owner / General Manager always saw every salary, and "View payroll" also exposed the deductions list.

Root causes found
-----------------
1. public/js/pages/payroll.js called can() without importing it (ReferenceError on every load of the Staff page).
2. The staff and deductions pages loaded everything in one Promise.all. Monthly payroll (payroll.view) and the
   users list (users.manage) were requested even when the role did not have them, so one 403 blanked the page.
3. Hiding salaries was decided by role name (isLimited), not by a permission.
4. GET /api/payroll/deductions was open to payroll.view. Deductions-only roles could not fetch the staff names
   needed to record a deduction.
5. public/js/pages/settings.js called an undefined showNotice() when saving the company profile failed.
6. POST /api/payroll/staff bound an undefined value (req.params.id) when a login account was linked.

Changes
-------
New permission: payroll.salaries ("View salaries and per-employee pay")
- Default ON for Owner, Administrator, General Manager and Accountant; OFF for Business Manager and Viewer.
- Existing installs: roles that already have saved permissions get payroll.salaries copied from their current
  payroll.view value (database.js migrateSalaryPermission, idempotent). A role without View payroll therefore
  stops seeing salaries; nothing else is widened.

Server
- permissions.js: new permission and defaults.
- payroll/payrollRoutes.js:
  * Salaries are shown only with payroll.salaries (staff list, monthly detail, entries, checklist).
  * Staff list: staff.view, payroll.view, payroll.deductions, payroll.create or payroll.edit (names only without
    payroll.salaries).
  * GET /api/payroll/entries needs payroll.view + payroll.salaries (per-employee pay).
  * GET /api/payroll/deductions needs payroll.deductions only.
  * GET /api/payroll/manual-checklist needs payroll.view + payroll.salaries.
  * GET /api/payroll/loans/:id/skips needs payroll.loans.
  * Create / edit staff: a salary sent by someone without payroll.salaries is ignored (new staff = 0, edit keeps
    the existing salary). Salary increase needs staff.manage + payroll.salaries.
- organizationRoutes.js: departments and job roles are controlled by staff.manage, not role name.

Client
- payroll.js: imports can; each section (staff, businesses, departments, job roles, payroll totals, loans, users)
  loads only if permitted and a failure in one section shows a message instead of blanking the page.
  Buttons and the salary column follow permissions. Generate draft follows payroll.create.
- app.js / state.js: the Payroll page is the totals-only page unless the user has payroll.salaries; Staff uses
  the read-only directory only for limited roles without staff.manage. bindPayrollPage no longer runs on the
  accountant / totals-only pages.
- settings.js: gated by settings.manage; removed the undefined showNotice call.

Tests
-----
- tests/permission-isolation.test.js (new, 12 tests): staff.view only, payroll.view only, deductions only,
  salaries, staff.manage without salaries, organization setup, migration - for General Manager and Business Manager.
- tests/role-nav-access.test.js: limited roles no longer get View salaries in the "every toggle on" setup.
- Full suite: 45 of 45 pass.

Not changed (decision for you)
------------------------------
- Company-wide vs assigned-business SCOPE is still decided by role (Owner / General Manager / Administrator see
  every business; others only assigned ones). That is scoping, not a feature permission.
- The Dashboard net-profit figure still subtracts payroll for anyone with dashboard.view (a total only, no
  per-employee data).
- expenses.manage, capital.manage and the Accountant-only expense screens are still role-driven.
- A role's permissions are loaded at sign-in or page reload; users must reload after you change their role.
````


<!-- ===== 38. BUILD-NOTES-STAGE5-ROLE-NAV-ACCESS.txt (2026-10-03) ===== -->

### 38. `BUILD-NOTES-STAGE5-ROLE-NAV-ACCESS.txt` — 2026-10-03

````text
ReportGen Stage 5 - Role / Navigation Access Fix
Date: 2026-10-03

Problem
-------
A sidebar link is shown whenever the role's permission is enabled, but several pages then called
API routes that still checked the user's ROLE NAME instead of the permission, so the page opened
and answered "not permitted" (or failed silently). Found by running the real server and opening
every sidebar page as every role, with the permission switched on.

Fixes
-----
Server
- reports/reportsRoutes.js: restored the missing totals() helper. Stage 5's POST /api/reports/owner-data
  called it but it was never defined, so the Owner/General Manager/Administrator Reports page and
  the Word/Excel exports returned HTTP 500. Assigned-business report exports now accept every
  limited role (Business Manager, Viewer), not only Business Manager.
- payroll/payrollRoutes.js: removed the hard-coded role allow-list. Payroll, Staff and Deductions
  are now decided by payroll.view / staff.view / payroll.deductions. Roles other than
  Owner/GM/Administrator/Accountant get the limited view: payroll totals only, staff directory
  without salaries, no employee-level payroll entries.
- accountant/accountantRoutes.js: GET /api/manager/expenses now serves every limited role that has
  expenses.view (it was Business Manager only). Still scoped to assigned businesses.
- businesses/businessRoutes.js: per-business details are readable with businesses.view,
  comparison.view or reports.view (Company Comparison and Reports both depend on this feed).
- sales/salesRoutes.js: removed the Accountant-only block on import history; history.view decides.
- capital/capitalRoutes.js: the Purchases list is scoped to assigned businesses for every limited
  role (previously only Business Manager, so a Viewer with capital.view saw every business).
- vendor/vendorPaymentRoutes.js: non-management roles only see vendor payments for their assigned
  businesses (previously the unfiltered company list).
- server.js: /api/health build marker is now stage5-role-nav-access-v1.

Client
- state.js: new isLimitedRole() helper.
- app.js / pages/manager.js: the assigned-business Expenses, Payroll, Staff and Reports pages are
  used for every limited role, not only Business Manager. Removed the Accountant redirect that sent
  Sales, History, Purchases and Company Comparison back to Businesses even when the link was shown.

Tests
-----
- tests/role-nav-access.test.js (new): opens every sidebar page's API calls as every role with all
  permissions enabled, and checks business scoping and salary redaction.
- Full suite: 33 of 33 pass (27 existing + 6 new). The new test fails on the previous build.

Not changed (decision for you)
------------------------------
- expenses.manage, capital.manage-for-Accountant, analytics.view and the Accountant-only expense
  entry screens are still role-driven. analytics.view has no sidebar link; the Company Comparison
  link uses comparison.view.
- A role's permissions are loaded when the user signs in or reloads the page, so a change made in
  Role permissions applies to that role's users on their next reload.
````


<!-- ===== 39. BUILD-NOTES-STAGE6-AUDIT-TRAIL-2026-10-03.md (2026-10-03) ===== -->

### 39. `BUILD-NOTES-STAGE6-AUDIT-TRAIL-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 6 — Audit Trail Hardening

## Scope

This pass hardens the audit trail for security-sensitive and financial mutations and improves audit-log retrieval without changing the database schema.

## Changes

### Financial / payroll mutations now audited
- Staff creation and updates
- Staff status/archive changes
- Monthly payroll create/update
- Payroll draft generation
- Payroll save/finalize
- Payroll marked paid
- Payroll edit/delete
- Employee payroll entry create/update
- Staff deduction create/delete
- Staff loan creation
- Loan-month skip
- Loan repayment void

Existing salary-increase, deduction-delete and loan-repayment audits are preserved.

### Organization and settings mutations
- Department create/update/delete
- Job-role create/update/delete
- Company settings update

### Existing audit coverage preserved
- Businesses
- Users and account status
- User business access
- Password changes
- Sales imports/templates
- Capital/purchases
- Vendor payments
- Owner expense allocation
- Role permission changes
- Database backup/import
- Internal messages

### Audit API improvements
`GET /api/audit` now supports optional:
- `action`
- `businessId`
- `userId`
- `from`
- `to`
- `limit`
- `offset`

The response includes pagination metadata and the auditing user's ID alongside username/display name.

Malformed historical `details_json` is returned safely as `{ raw: ... }` rather than breaking the audit screen.

## Security notes

- Password values are never written to audit details.
- Audit entries retain company, user, business, IP, user-agent and timestamp context.
- No database migration is required.
- Production ports/data are untouched.

## Verification

- All JavaScript files pass `node --check`.
- Dedicated `tests/audit-trail.test.js` passes.
- Final ZIP is re-extracted and JavaScript syntax checks are repeated.
- No certificates/private keys or `node_modules` are included.
````


<!-- ===== 40. BUILD-NOTES-STAGE6-AUDIT-UI-INTEGRITY-2026-10-03.md (2026-10-03) ===== -->

### 40. `BUILD-NOTES-STAGE6-AUDIT-UI-INTEGRITY-2026-10-03.md` — 2026-10-03

````text
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
````


<!-- ===== 41. BUILD-NOTES-STAGE7-BACKUP-RECOVERY-INTEGRITY-2026-10-03.md (2026-10-03) ===== -->

### 41. `BUILD-NOTES-STAGE7-BACKUP-RECOVERY-INTEGRITY-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 7 — Backup / Restore + Disaster Recovery Integrity
Date: 2026-10-03

## Changes
- Verified SQLite backups now carry a SHA-256 checksum and JSON manifest.
- Backup validation requires SQLite integrity_check, required ReportGen tables, and audit append-only triggers.
- Backup history exposes whether the stored manifest matches the file metadata.
- Added an authenticated backup verification endpoint.
- Restore validates the uploaded database and its checksum when a checksum sidecar is present before staging it.
- Server startup validates a staged database again before replacing the live database.
- A failed staged restore leaves the current database untouched.
- The previous live database is retained as a `.pre-import-*` recovery copy after a successful staged replacement instead of being immediately deleted.
- Existing 10 GB upload limit and free-disk-space safety check remain in place.
- Existing before-import verified safety backup remains in place.
- Existing database import audit event remains in place.

## Verification
- All JavaScript files pass `node --check`.
- Static backup/recovery integrity regression test passes.
- No database migration was introduced by this stage.
- No certificates/private keys or node_modules are included.

## Boundary
The recovery protections validate the live/staged SQLite database and preserve recovery copies, but they do not make filesystem-level database replacement impossible for an administrator with direct operating-system access.
````


<!-- ===== 42. BUILD-NOTES-STAGE9-SESSION-AUTH-HARDENING-2026-10-03.md (2026-10-03) ===== -->

### 42. `BUILD-NOTES-STAGE9-SESSION-AUTH-HARDENING-2026-10-03.md` — 2026-10-03

````text
# ReportGen Stage 9 — Session & Authentication Hardening

## Changes

- Reduced unnecessary SQLite writes from authenticated requests by updating `sessions.last_seen_at` at most once every 5 minutes per active session.
- Added hourly cleanup of expired session rows so stale sessions do not accumulate indefinitely.
- Kept existing immediate removal of an expired session when that session is presented.
- Set the browser session cookie `Max-Age` to the same configured session TTL so browser-side lifetime matches server-side session lifetime.
- Preserved existing HTTPS transport requirements, CSRF protection, password hashing, session-token hashing, password-change session invalidation, and login rate limiting.

## Security/performance rationale

ReportGen performs a session lookup on authenticated API requests. Previously every successful request also issued a SQLite UPDATE for `last_seen_at`. On a busy LAN installation this could create avoidable write contention and database churn. The five-minute write interval preserves useful activity tracking while materially reducing write pressure.

Expired sessions are now periodically removed even when their users never return, keeping the sessions table bounded over long-running deployments.

## Boundary

This stage does not change session TTL, password policy, role permissions, or account behavior. It does not force existing users to log in again.
````


<!-- ===== 43. BUILD-NOTES-STAGE10C.md (undated) ===== -->

### 43. `BUILD-NOTES-STAGE10C.md` — undated

````text
Stage 10C — Duplicate Submission Protection

Implemented request-level idempotency protection for retryable money-changing operations.

Key behavior:
- Explicit `Idempotency-Key` is scoped to company, user and route.
- The server fingerprints method/path/query/body and uploaded-file metadata/content hash.
- Reusing the same key with the same request returns the original successful response instead of repeating the mutation.
- Reusing the same key with different request data returns HTTP 409.
- A request that returns an error releases its key so the user can retry.
- A concurrent duplicate while the original is processing returns HTTP 409 instead of performing a second mutation.
- Ordinary requests without an Idempotency-Key keep their existing behavior; legitimate repeated transactions are not globally deduplicated.
- Main financial UI forms now generate and retain a submission key for the lifetime of the form/request, so network retries reuse the same key.

Protected creation/mutation flows:
- Accountant expenses and remittances
- Capital/purchases
- Vendor payments
- Payroll staff creation, salary increase, monthly totals, entries, generation, save/paid, deductions and loans
- Sales imports

Database:
- Added `idempotency_keys` table through the normal migration path.
- No production database was opened or modified during this build.

Verification:
- Stage 10C static tests: 5/5 passed.
- Stage 10A transaction-integrity test: passed.
- Stage 10B integrity tests: 4/4 passed.
- Server/tests JavaScript syntax checks: passed.
- The ZIP intentionally contains no node_modules; full live Express/SQLite runtime tests were not run.
````


<!-- ===== 44. BUILD-NOTES-STAGE10D.md (undated) ===== -->

### 44. `BUILD-NOTES-STAGE10D.md` — undated

````text
# ReportGen Stage 10D — SQLite & Tenant Integrity

Stage 10D hardens the database boundary after Stages 10A–10C.

## Implemented
- Added `server/database/integrity.js` as a startup integrity guard.
- Requires SQLite `foreign_keys` enforcement to remain enabled.
- Runs `PRAGMA integrity_check` and fails closed on corruption.
- Runs `PRAGMA foreign_key_check` and fails closed on orphaned references.
- Verifies required core/financial tables exist.
- Verifies critical reporting, financial, payroll, sales-import, and idempotency indexes exist.
- Verifies audit append-only triggers still exist.
- Checks tenant ownership where SQLite foreign keys alone are insufficient:
  - business-scoped rows must use a business from the same company;
  - payroll child rows must use staff from the same company;
  - loan children must remain inside the loan's company;
  - sales transactions, imports, and businesses must agree on company/business ownership;
  - user/business access must remain inside one company;
  - idempotency records must match the user's company.
- Verifies every payroll-to-staff foreign key remains `ON DELETE RESTRICT`, preventing accidental deletion of payroll history through a staff cascade.
- Runs the integrity guard after all normal migrations and permission migrations complete.

## Safety boundary
- No production database was opened or modified during this build.
- No blanket uniqueness rule was introduced; legitimate repeated financial transactions remain valid.
- Existing payroll FK migration remains responsible for converting legacy `ON DELETE CASCADE` staff references to `RESTRICT` with backup, row-count, FK, and integrity verification.

## Verification
- Stage 10D static tests: 6/6 passed.
- Stage 10A transaction-integrity regression: passed.
- Stage 10B integrity regression: 4/4 passed.
- Stage 10C idempotency regression: 5/5 passed.
- New and changed JavaScript files syntax-checked.
- Final ZIP re-extraction, syntax, structure, and sensitive-file scans performed before delivery.

## Runtime note
The delivery ZIP intentionally contains no `node_modules`, so a full live better-sqlite3 database execution test is not performed in the packaged source-only artifact. The startup guard is designed to execute against the real database on the user's installed runtime.
````


<!-- ===== 45. BUILD-NOTES-STAGE4-ROLE-PERMISSIONS-FIX.txt (undated) ===== -->

### 45. `BUILD-NOTES-STAGE4-ROLE-PERMISSIONS-FIX.txt` — undated

````text
ReportGen Stage 4 — Role Permissions Route Fix

Fix:
- Corrected GET /api/permissions/:role fall-through bug.
- Reading another role now checks roles.manage directly with hasPermission().
- A permitted request returns the role permissions JSON instead of calling next() into Express 404.
- Users without roles.manage still receive HTTP 403.
- Own-role reads remain available for workspace bootstrap.
- Existing PUT role-permission protections are unchanged.

Verification:
- All JavaScript files passed node --check before packaging.
- Package excludes node_modules, databases, certificates/private keys and Git metadata.
- ZIP was integrity-tested and will be re-extracted and syntax-checked before delivery.
````


<!-- ===== 46. BUILD-NOTES-STAGE5-FINANCIAL-INTEGRITY-V8.md (undated) ===== -->

### 46. `BUILD-NOTES-STAGE5-FINANCIAL-INTEGRITY-V8.md` — undated

````text
# ReportGen Stage 5 — Financial Integrity v8

## Financial calculation consistency hardening

- Business details now distinguish `importedProfit` (the source `profit_amount` aggregate) from authoritative `grossProfit` calculated as sales minus cost of goods.
- Monthly and daily business trends expose calculated `grossProfit` and retain `importedProfit` separately.
- Business-detail UI labels the metric as Gross Profit and renders the calculated `grossProfit` field.
- Owner/Admin report, dashboard, and business-detail financial KPIs now use the same gross-profit basis: sales minus cost of goods.
- Net-profit formulas remain: gross profit minus operating expenses and payroll, with Owner-only expense allocation additionally applied in the Owner report/dashboard.
- Added `tests/financial-integrity.test.js` to guard the calculation contract.

## Verification

- All JavaScript files syntax-checked before packaging.
- Financial integrity static regression test passed.
- Production ports/data are not touched by this source change.
````


<!-- ===== 47. BUILD-NOTES-STAGE5-PERMISSION-ISOLATION-V5.md (undated) ===== -->

### 47. `BUILD-NOTES-STAGE5-PERMISSION-ISOLATION-V5.md` — undated

````text
# ReportGen Stage 5 — Permission Isolation v5

Baseline: `ReportGen-Stage5-Permission-Isolation-v4.zip`

## Changes

### Accountant financial endpoints now honor permissions
- Accountant monthly summary requires `dashboard.view`.
- Accountant expense/remittance/template reads require `expenses.view`.
- Accountant expense/remittance/template creation requires `expenses.manage`.
- Accountant expense/remittance deletion requires `expenses.manage`.
- Existing accountant role and assigned-business scope checks remain in place.
- Default Accountant permissions already include `dashboard.view`, `expenses.view`, and `expenses.manage`, so normal Accountant behavior is preserved.

### Financial mutation audit coverage
Added audit events for:
- `accountant.expense.created`
- `accountant.expense.deleted` (already present, retained)
- `accountant.expense_template.created`
- `accountant.remittance.created`
- `accountant.remittance.deleted` (already present, retained)

## Verification
- Modified server route passes `node --check`.
- Permission-isolation regression test passes syntax validation.
- Full runtime test suite requires installed npm dependencies; this source archive does not contain `node_modules`.
````


<!-- ===== 48. BUILD-NOTES.txt (undated) ===== -->

### 48. `BUILD-NOTES.txt` — undated

````text
ReportGen v89 - Business Manager Pages

Changes:
- Business Manager Staff Management is read-only and shows staff directory only.
- Business Manager Expenses shows month-filtered expenses for assigned businesses only.
- Business Manager Payroll shows monthly payroll totals by assigned business and assigned total.
- Business Manager pages hide salary details, deduction/loan actions, and payroll editing controls.
- Added read-only /api/manager/expenses endpoint with server-side assigned-business filtering.
- Full Financial Report from v88 retained.

Validation:
- Node syntax checks passed for changed JS files.
- npm test remains blocked in this environment because dependencies are not installed (xlsx missing; npm ci timed out).
- ZIP archive integrity verified after packaging.

ReportGen v91 changes:
- Business Manager report export to Word and native Excel XLSX
- Optional report section selection before viewing, printing, or exporting
- Selected sections are respected by Word and Excel export

v92 SECURITY EXPORT VALIDATION (2026-09-23)
- Added server-authoritative Manager export validation endpoint: POST /api/reports/export/manager/validate.
- Validates reporting month, assigned business scope, one source row per selected business, and core financial values against SQLite records.
- Validates sales, gross, returns, transactions, cost of goods, gross profit, expenses, payroll, total expenses, and net profit.
- Manager Excel and Word export routes independently execute the same validation; calling the validation endpoint alone is not sufficient to bypass it.
- Updated Manager frontend to send the selected month and source rows and to validate before requesting the export file.
- JavaScript syntax checks passed.
- Full runtime/integration tests require dependencies installed and a populated test database.


2.0 backup policy:
- Automatic monthly backup checks run hourly and cover servers started on the last day of a month.
- Backups are retained globally at the four most recent verified .sqlite files, including manual and automatic backups.
- This server package is not yet a Windows desktop installer; Electron packaging is a separate next phase.
````


<!-- ===== 49. VERSION-2.0-NOTES.md (undated) ===== -->

### 49. `VERSION-2.0-NOTES.md` — undated

````text
# ReportGen 2.0

This is the second working version of the generic ReportGen build.

- Product version: 2.0.0
- Generic company/business placeholders
- Version-scoped application data directory: `%APPDATA%\ReportGen-v2`
- Targeted uninstall script: `uninstall-reportgen-v2-complete.bat`
- Development desktop startup uses the system Node runtime to avoid native-module ABI conflicts between Node.js and Electron.

Run:

```bash
npm install
npm run start:desktop
```

### Owner report chart update
- Business sales contribution now renders all businesses with sales instead of limiting the chart to the top 8.
- Server-generated report HTML contribution chart also includes all businesses.
````

## Payroll page: month refresh + manual total without staff
- Payroll page now invalidates its cached data inside `payrollPage()` when the global month changes (the old check in `bindPayrollPage()` compared two values already made equal, so it never reloaded). An open payroll detail from another month returns to the Payroll list.
- "Monthly total" form: when a business has no active staff the total is an editable field (prefilled with any existing manual total). With staff it stays calculated and read-only, because the server requires staff gross amounts to equal the total.

## Mobile layout pass
- New `public/css/mobile.css` (loaded after app.css). Phones (<=640px): two-row top bar (menu, title, theme icon, account / reporting month full width), single-column KPI cards so naira amounts are not cut off, duplicate dashboard month picker hidden, larger tap targets and 16px inputs, full-width modals, wide tables scroll inside their panel.
- Theme button is now an icon-only button below 850px (`.theme-icon` / `.theme-label` in `ui.js`).

## Mobile modals
- `mobile.css`: modal backdrop grid column pinned to screen width (wide tables no longer push modals off-screen), modals sized with `dvh` on phones, sideways scroll stays inside the modal body, one-column forms, stacked action buttons, page behind a modal no longer scrolls.

## Mobile modals (follow-up)
- Root cause of modals opening off the right edge on phones: any element wider than the screen made mobile Chrome widen the layout, and fixed modals were sized to that wider area. `mobile.css` now clips horizontal overflow on `html` and `body` (`overflow-x:clip`), so the layout stays screen-wide. Verified in headless Chrome at 360px: modal sits at 8px..352px, top bar stays sticky, vertical scroll unaffected.
- Native month/date pickers now follow the dark/light theme.

## Smoke test (this build)
- Existing suite: 136/136 pass. Headless Chrome at 360px and 1280px: logged in, opened all 11 pages, no JS errors, no failed API calls, no horizontal overflow; month change on Payroll refetches without refresh; Monthly total is editable for a business with no staff; modals fit the screen; payments cannot be deleted (404) and payrolls with payments cannot be deleted (409); void works.
