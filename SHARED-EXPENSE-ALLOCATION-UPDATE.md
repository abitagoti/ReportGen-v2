# ReportGen v2.0.20 — Shared Expense Allocation Update

## Included
- Reusable shared-expense templates with per-business percentages and exact 100% validation.
- Searchable business selection for ReportGen-linked and external businesses.
- One-time shared expense entry with allocation preview and per-expense percentage overrides.
- Automatic posting of linked-business allocations into the existing `accountant_expenses` ledger, so normal monthly expense lists, owner expense reports, and business financial calculations include the allocated share.
- External business management, plus recording earnings and other expenses in a separate accountant-only ledger.
- Edit/cancel controls on the originating shared expense. Generated linked entries cannot be deleted independently through the accountant expense endpoint.
- Allocation history, audit events, template history protection, and database migration for allocation provenance.
- Consolidated v6 changes: reusable expense item list, mobile sticky Sign Out menu behavior, and in-app Back navigation.

## Isolation and accounting behavior
- Only ReportGen-linked allocations are posted to `accountant_expenses`.
- External business records remain in `external_business_transactions` and are not included in ReportGen company-wide totals.
- Shared expense dates must belong to the selected expense period.
- Template changes do not rewrite prior allocation line percentages or amounts.
- Cancelling a posted shared expense removes its generated entries from active totals and marks the shared expense cancelled; the allocation record remains for history/audit.

## Validation performed
- JavaScript syntax checks passed for all `public/js` and `server` JavaScript files.
- `server/database/schema.sql` executed successfully against an in-memory SQLite database.
- Smoke-tested shared expense, linked expense ledger, and external transaction INSERT statements against SQLite.
- Release manifest integrity verification passed.
- A live ReportGen installation test has not been performed in this environment. Test with a backed-up database before replacing the current stable installation.
