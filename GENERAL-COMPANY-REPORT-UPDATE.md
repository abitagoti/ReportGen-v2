# General Company Report and External Business Management Update

## Changes in this build
- Fixed the General Company Report overview totals reducer so earnings, expenses and transaction counts sum across the included businesses instead of remaining at zero.
- Moved business selection into a modal with search, select-all, clear-all and apply selection controls.
- Added a modal to review active businesses without recorded transactions in the selected reporting period.
- The General Company Report selection now lists active external businesses only. Report results still omit businesses with no transactions in the selected period.
- External business management now provides separate Archive and Delete Permanently actions.
- Archive preserves the business, transaction records and shared-expense allocation history, while removing it from the active list.
- Permanent deletion is enforced server-side and is blocked if the business has any transaction records or shared-expense allocation history. A business must have no transactions and no allocation dependencies before it can be deleted.

## Validation
- JavaScript syntax checks passed for the changed page and route files.
- Release manifest generation and integrity verification passed.
- `npm test`: 75 passed; 8 test files could not load because `express` and/or `better-sqlite3` dependencies are not installed in this build environment. No live Windows app/database runtime test was performed.

## Important limitation
This build does not add a transaction-void workflow. Permanent deletion therefore remains blocked whenever any external transaction row exists. An accountant must use an existing approved transaction-removal/void process, if available, before deletion can succeed. Shared-expense allocation history also prevents permanent deletion and should be retained by archiving the business.
