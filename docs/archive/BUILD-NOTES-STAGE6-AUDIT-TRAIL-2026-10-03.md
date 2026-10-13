# ReportGen Stage 6 — Audit Trail Hardening

## Scope

This pass hardens the audit trail for security-sensitive and financial mutations and improves audit-log retrieval without changing the database schema.

## Changes

### Financial / payroll mutations now audited
- Staff creation and updates
- Staff status/archive changes
- Monthly payroll create/update
- Payroll draft generation
- Payroll save/finalize
- Payroll marked paid
- Payroll edit/delete
- Employee payroll entry create/update
- Staff deduction create/delete
- Staff loan creation
- Loan-month skip
- Loan repayment void

Existing salary-increase, deduction-delete and loan-repayment audits are preserved.

### Organization and settings mutations
- Department create/update/delete
- Job-role create/update/delete
- Company settings update

### Existing audit coverage preserved
- Businesses
- Users and account status
- User business access
- Password changes
- Sales imports/templates
- Capital/purchases
- Vendor payments
- Owner expense allocation
- Role permission changes
- Database backup/import
- Internal messages

### Audit API improvements
`GET /api/audit` now supports optional:
- `action`
- `businessId`
- `userId`
- `from`
- `to`
- `limit`
- `offset`

The response includes pagination metadata and the auditing user's ID alongside username/display name.

Malformed historical `details_json` is returned safely as `{ raw: ... }` rather than breaking the audit screen.

## Security notes

- Password values are never written to audit details.
- Audit entries retain company, user, business, IP, user-agent and timestamp context.
- No database migration is required.
- Production ports/data are untouched.

## Verification

- All JavaScript files pass `node --check`.
- Dedicated `tests/audit-trail.test.js` passes.
- Final ZIP is re-extracted and JavaScript syntax checks are repeated.
- No certificates/private keys or `node_modules` are included.
