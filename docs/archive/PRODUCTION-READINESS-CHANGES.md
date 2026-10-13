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
