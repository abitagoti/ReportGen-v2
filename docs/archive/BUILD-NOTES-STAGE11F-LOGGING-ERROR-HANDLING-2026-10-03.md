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
