# Stage 11G — Secure Update & Deployment Integrity

## Version
ReportGen 2.0.19

## Changes
- Added `RELEASE-MANIFEST.json` with SHA-256 hashes for critical runtime/deployment files.
- Added release-manifest generation and verification scripts.
- Added version-bound release integrity verification before the safe updater starts the server.
- Safe updater no longer runs `npm install` automatically.
- Persistent SQLite data remains outside the application installation directory.
- Desktop setup/connection/certificate state remains in the persistent ReportGen-v2 app-data directory.
- Existing database migration/recovery safeguards remain active: staged databases are integrity-checked before replacement and the previous database is retained until startup verification succeeds.
- Existing NSIS installer stops the ReportGen service before replacing application files and restarts it after installation.
- Uninstall configuration continues to preserve application data.
- Release packaging continues to exclude certificate/private deployment material.

## Verification
- 32/32 targeted Stage 11A/11B/11D/11E/11G security and regression tests passed.
- 102 JavaScript files passed syntax checking.
- Release manifest generated and verified against ReportGen 2.0.19.
- ZIP verified to contain exactly one top-level `ReportGen` folder.
- Sensitive-file scan passed; no private key/certificate artifacts packaged.
