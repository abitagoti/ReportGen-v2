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
