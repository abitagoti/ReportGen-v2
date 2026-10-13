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
