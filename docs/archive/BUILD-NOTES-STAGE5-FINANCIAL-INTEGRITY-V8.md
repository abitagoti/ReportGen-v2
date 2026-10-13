# ReportGen Stage 5 — Financial Integrity v8

## Financial calculation consistency hardening

- Business details now distinguish `importedProfit` (the source `profit_amount` aggregate) from authoritative `grossProfit` calculated as sales minus cost of goods.
- Monthly and daily business trends expose calculated `grossProfit` and retain `importedProfit` separately.
- Business-detail UI labels the metric as Gross Profit and renders the calculated `grossProfit` field.
- Owner/Admin report, dashboard, and business-detail financial KPIs now use the same gross-profit basis: sales minus cost of goods.
- Net-profit formulas remain: gross profit minus operating expenses and payroll, with Owner-only expense allocation additionally applied in the Owner report/dashboard.
- Added `tests/financial-integrity.test.js` to guard the calculation contract.

## Verification

- All JavaScript files syntax-checked before packaging.
- Financial integrity static regression test passed.
- Production ports/data are not touched by this source change.
