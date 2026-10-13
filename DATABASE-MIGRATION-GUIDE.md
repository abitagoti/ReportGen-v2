# ReportGen database migration guide — existing-database safety (section 3.2)

## Fresh databases
A brand-new ReportGen installation creates `reportgen.sqlite` from
`server/database/schema.sql`, which already defines `payroll_entries`,
`payroll_staff_loans`, `payroll_staff_deductions`, `payroll_loan_skips`,
`payroll_manual_staff_adjustments`, and `payroll_loan_repayments` with
`staff_id`/`employee_id REFERENCES payroll_employees(id) ON DELETE RESTRICT`.
Nothing further is required.

## Existing databases (upgrading from an older install)
`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so on a database that already
has these tables, that statement is a no-op — the *original* foreign key
definition (`ON DELETE CASCADE` on older installs) silently remains in
place, even after the application code is upgraded. This matters because a
`CASCADE` foreign key on `payroll_employees` means a physical deletion of a
staff row would cascade-delete their payroll entries, loans, and deductions.
(In this codebase the staff-deletion API route already only archives staff
rather than physically deleting them — see
`server/payroll/payrollRoutes.js` `DELETE /api/payroll/staff/:id` — but the
foreign key is a second, independent layer of protection and should not
silently be the weaker of the two.)

As of this change, `server/database/database.js` detects and fixes this
automatically and safely on startup:

1. On every boot, it checks the **live** foreign key definition of each of
   the six tables above via `PRAGMA foreign_key_list(<table>)` — not the
   `schema.sql` text, since that can silently fail to apply as described.
2. If any table still has the old `CASCADE` behavior, it:
   - Checkpoints the WAL and copies the database file to
     `<data dir>/backups/reportgen-premigration-payroll-fk-restrict-<timestamp>.sqlite`,
     verifies that copy with `PRAGMA integrity_check`, and writes a
     `.sha256` checksum file next to it.
   - Runs `PRAGMA integrity_check` on the live database and refuses to
     proceed if it is not `ok`.
   - Rebuilds only the affected tables inside a single transaction, using
     each table's **current live schema** (read from `sqlite_master`, so any
     columns added since by other migrations are preserved) with only the
     `payroll_employees` foreign key's `ON DELETE` clause changed to
     `RESTRICT`. Every row, ID, other column, default, `CHECK` constraint,
     and index is carried over unchanged.
   - Verifies row counts before/after match per table.
   - Runs `PRAGMA foreign_key_check` and `PRAGMA integrity_check` again
     afterward, and re-checks that every table now actually reports
     `RESTRICT`.
   - If any of these checks fail, it throws with a message pointing at the
     verified pre-migration backup, and does **not** leave the database
     half-migrated (the whole rebuild runs inside one transaction).

The same startup path also covers the existing (already-present, unrelated)
`users` table role migration (adding the `general_manager` role for
databases created before that role existed), which previously ran with
**no backup at all**. It now gets the same backup-first, verify-after
treatment, and a real bug in it was fixed at the same time (see below).

## A bug this work found and fixed: cross-table foreign key corruption
While adding backup and verification around the existing `users` role
migration, testing surfaced a real, pre-existing bug: SQLite, by default,
automatically rewrites **other tables'** stored foreign key text when you
`ALTER TABLE ... RENAME TO ...` a table they reference — regardless of the
`foreign_keys` pragma. The migration renames `users` to `users_legacy_roles`,
recreates `users`, copies the data back, and drops `users_legacy_roles`. Every
other table with e.g. `created_by ... REFERENCES users(id)` (payroll
tables, `organization_job_roles`, and others) had its stored definition
silently rewritten to reference `users_legacy_roles` — and was left with a
dangling foreign key once that table was dropped, corrupting referential
integrity database-wide. This was invisible before because nothing ran
`PRAGMA foreign_key_check` after this migration.

The fix: set `PRAGMA legacy_alter_table = ON` before the rename (restoring
it to `OFF` afterward), which disables that automatic rewrite so other
tables' unchanged `REFERENCES users(id)` text continues to correctly
resolve to the newly created `users` table. The migration now also runs a
full, whole-database `PRAGMA foreign_key_check` (not just against `users`)
afterward to catch this class of problem going forward.

## Where backups are stored
`<data dir>/backups/`, where `<data dir>` is `REPORTGEN_DATA_DIR` if set,
otherwise the platform default (see `server/config.js`). Pre-migration
safety backups are named `reportgen-premigration-<label>-<timestamp>.sqlite`
with a matching `.sha256` file. These are separate from, and in addition to,
the regular scheduled/manual backups made by `server/database/backupService.js`
(`reportgen-<timestamp>.sqlite`), which are subject to `REPORTGEN_MAX_BACKUPS`
retention pruning. Pre-migration backups are not currently auto-pruned; they
are only created once per genuine schema transition (the check is
idempotent — a second boot against an already-migrated database creates no
new backup), so in practice this does not accumulate unboundedly.

## Verification commands
Run these against a copy of the database, not the live file, if you want to
check state manually:

```bash
# Confirm current foreign key behavior for a table:
sqlite3 reportgen.sqlite "PRAGMA foreign_key_list(payroll_entries);"

# Whole-database referential integrity:
sqlite3 reportgen.sqlite "PRAGMA foreign_key_check;"

# Structural integrity:
sqlite3 reportgen.sqlite "PRAGMA integrity_check;"
```

A clean migration shows `RESTRICT` in the `on_delete` column of the first
command, and no rows from the second or third.

## Rollback procedure
If the migration throws (backup failed integrity check, row-count mismatch,
or post-migration `foreign_key_check`/`integrity_check` failure), the
application will refuse to continue and the error message names the exact
pre-migration backup file to use. To roll back:

1. Stop the ReportGen server.
2. Move/rename the current (possibly migrated or partially-processed)
   `reportgen.sqlite` out of the data directory.
3. Copy the named backup file from `<data dir>/backups/` to
   `<data dir>/reportgen.sqlite`.
4. Delete any `-wal`/`-shm` sidecar files next to the restored database (the
   backup itself is a checkpointed, self-contained file and does not need
   them).
5. Verify the checksum: `sha256sum -c reportgen-premigration-....sqlite.sha256`.
6. Restart the server and confirm it boots and the migration completes
   cleanly against the restored file, or investigate further before
   retrying.

**Never run this migration path directly against a live production database
without first taking your own independent backup (via the in-app backup
feature or a manual file copy with the server stopped), in addition to the
automatic pre-migration backup described above.**
