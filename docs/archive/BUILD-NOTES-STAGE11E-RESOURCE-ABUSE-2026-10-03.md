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
