# ReportGen Stage 5 — Financial Integrity & Permission Audit v7

Date: 2026-10-03

## Scope

Continued from the Stage 5 Permission Isolation v6 baseline.

### Owner Expense Allocation isolation

CEO / Owner Expense Allocation is now Owner-only across the financial report pipeline:

- Dashboard owner-allocation read/write/reset endpoints remain Owner-only.
- Server-side report calculation reads owner allocation rules only for the `owner` role.
- General Manager, Administrator and other non-Owner report users receive profitability calculated without owner expense allocation.
- Owner allocation detail is omitted from non-Owner Excel/Word exports.
- Owner Expense columns and KPI fields are omitted from non-Owner exports rather than exposing zero-valued placeholders.
- The Owner Expense Allocation worksheet is created only for the Owner.
- Owner-facing report UI remains gated by the Owner role.

## Integrity principle

The browser is not trusted as the source of owner allocation or profitability values. Report exports derive their figures from the server/database calculation path.

## Verification

- `node --check server/reports/reportsRoutes.js` — PASS
- Owner-isolation static regression test (`tests/owner-expense-isolation.test.js`) — PASS
- Full JavaScript syntax verification required before packaging.
- Final ZIP is re-extracted and all extracted JavaScript files are syntax-checked before delivery.

## Production safety

This source package does not change or connect to the production service ports 4310/80/443. Development remains isolated to the ReportGen development configuration.
