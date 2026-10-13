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
