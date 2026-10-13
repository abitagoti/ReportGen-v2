# ReportGen Stage 4 — Roles & Permissions Corrected Build

This build is based on the verified Stage 3 HTTPS/LAN development build, not the older pre-Stage-3 source.

## Preserved
- Stage 3 HTTPS/LAN authentication hardening and isolated development launcher.
- Owner allocation dashboard preview UI and the reduced dashboard text.
- Stage 3 date input, CSP, loader, network retry and report fixes already present in the base.

## Stage 4 changes
- Role-permission reads for the current role remain available for workspace boot.
- Reading/managing another role requires `roles.manage`.
- A user cannot modify permissions for their own role.
- Administrator permissions remain protected.
- A non-administrator cannot grant a permission they do not currently possess.
- User creation/status/business-access changes respect role hierarchy.
- Users UI separates `users.manage` from `roles.manage`.
- The role-permissions UI never offers the current user's own role.
