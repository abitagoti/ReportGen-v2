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
