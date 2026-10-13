# ReportGen v2.0.12 — Dashboard Purchase & Profit Planning

## Added
- Separate dashboard Gross Profit and Net Profit figures.
- Gross Profit is calculated as Sales minus Cost of Goods Sold (COGS).
- Dashboard month selector; selecting a month resets the top date range to the complete calendar month.
- Dashboard business selector for company-wide or individual-business views.
- Purchases & Planning section appears only for a complete calendar month.
- Total stock purchases for the selected month/business.
- Estimated remaining purchase balance using cumulative purchases minus cumulative COGS.
- Estimated payable for the next month using the selected month COGS as the planning guide.
- CEO / Owner expense adjustment stored per business and month as a 0–100% gross-profit percentage.
- CEO / Owner expense amount is deducted from Gross Profit when calculating Net Profit.
- Owner adjustment is included in company-wide views by summing each business’s own monthly percentage against that business’s gross profit.

## Planning definitions
- Estimated remaining balance is a management estimate, not a physical stock count and not a confirmed supplier liability.
- Estimated payable next month is a planning guide: current month COGS becomes the following month’s estimated payable.
- Equipment and other non-stock funding are not separated in the existing purchase module because current purchase records are treated as stock purchases; operating expenses remain in the accountant expense module.

## Existing functionality preserved
- Existing Purchases page and records remain unchanged.
- Existing sales import fields remain unchanged.
- Existing accountant expense and payroll records remain unchanged.
- Existing top date-range selector remains the source for partial-period reporting.

## Validation
- Node syntax checks passed for all JavaScript files under `public/js` and `server`.
- Existing test suite was attempted. Tests requiring `better-sqlite3` and `xlsx` could not run because this source ZIP does not contain `node_modules`; the two dependency-independent tests passed.
