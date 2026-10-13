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
