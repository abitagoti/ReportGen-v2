# Payroll payment reconciliation

Status: part of 2.0.20 RC (not signed off). Full change record: `docs/BUILD-HISTORY.md` ("Payroll payment & reconciliation review").

## How it works
- `payroll_payments` is a ledger of dated instalments against a saved monthly payroll (manual or employee-generated).
- **Net payable** = employee entries' net, or the manual staff selections' net, or the manual total. One helper, `expectedPayrollAmount()`, is used everywhere.
- Paid / balance / overpayment are derived from **posted** payments only. All amounts are rounded to 2 dp (tolerance 0.005).
- Recording a payment that reaches the net payable marks the payroll **paid and locked**. Overpaying needs explicit confirmation.
- **Mark Paid** records the remaining balance as a payment, then locks. It refuses a zero-value payroll.
- A payment made in error is **voided** (reason required, audited, kept in history). Voiding re-opens a payroll that is no longer fully paid. Payments are never deleted.
- A payroll that has any payment record cannot be deleted (route check + database trigger).
- Editing a payroll (PATCH, re-posting a monthly total, skipping a loan month) is rolled back if the new total would be lower than what is already paid.
- The payroll detail page is read-only: saving a draft only finalizes it. Amounts are never re-sent from the page.

## Endpoints
- `GET  /api/payroll/:id/payments` - expected, paid, outstanding, overpayment, payment list (incl. voided)
- `POST /api/payroll/:id/payments` - `{amount, paymentDate, note?, confirmOverpayment?}` (`payroll.create`)
- `POST /api/payroll/:id/payments/:paymentId/void` - `{reason}` (`payroll.finalize`)
- `POST /api/payroll/:id/paid` - settle the balance and lock (`payroll.finalize`)

Dashboard and reports still count **gross** payroll as the cost; payments reconcile against **net** payable.
