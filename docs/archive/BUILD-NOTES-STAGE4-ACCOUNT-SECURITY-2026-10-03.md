# ReportGen Stage 4 — Account Security Update — 2026-10-03

## Included
- Every authenticated user can change their own password from the account chip in the top bar.
- Password changes require the current password, an 8–200 character new password, and confirmation.
- New password must differ from the current password.
- Password changes invalidate all active sessions and require the user to sign in again.
- Password-change events are written to the audit log without storing passwords.
- User/account management is restricted by role hierarchy on the server.
- Users with `users.manage` only receive accounts they are allowed to manage; higher-privilege accounts are not exposed in their user list.
- The System Administrator (`administrator`/legacy `admin` role) is protected from deletion/deactivation.
- The System Administrator deletion/status controls are also hidden in the user-management UI.
- Account deletion remains a history-preserving deactivation: the login is disabled, sessions/access assignments are removed, and historical records remain intact.
- Role-permission management only exposes roles the current manager can edit; a user can never edit their own role permissions.

## Security boundaries
- Server-side checks remain authoritative; UI restrictions are only convenience.
- Existing HTTPS/LAN authentication hardening remains in place.
- No database schema migration is required.
