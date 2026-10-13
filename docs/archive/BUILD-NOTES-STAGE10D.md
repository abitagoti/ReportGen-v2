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
