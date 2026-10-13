const { concurrencyLimit } = require('../security/resourceProtection');
const express = require('express');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType, ImageRun } = require('docx');
const { requireRole, requirePermission } = require('../auth/middleware');
const { db } = require('../database/database');

const router = express.Router();
const reportWorkloadLimit = concurrencyLimit('report-export', 2);

function n(value) { return Number(value || 0); }
function money(value) { return `₦${n(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pct(value, total) { return total ? `${(n(value) / n(total) * 100).toFixed(1)}%` : '0.0%'; }
function safe(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function totals(rows) {
  return rows.reduce((a, r) => ({
    sales: a.sales + n(r.sales), grossProfit: a.grossProfit + n(r.grossProfit), netProfit: a.netProfit + n(r.netProfit),
    expenses: a.expenses + n(r.expenses), payroll: a.payroll + n(r.payroll), purchases: a.purchases + n(r.purchases),
    transactions: a.transactions + n(r.transactions), returns: a.returns + n(r.returns), gross: a.gross + n(r.gross), ownerExpense: a.ownerExpense + n(r.ownerExpense), vendorPayments: a.vendorPayments + n(r.vendorPayments), salesDays: a.salesDays + n(r.salesDays)
  }), { sales: 0, grossProfit: 0, netProfit: 0, expenses: 0, payroll: 0, purchases: 0, transactions: 0, returns: 0, gross: 0, ownerExpense: 0, vendorPayments: 0, salesDays: 0 });
}
// Roles that see company-wide data. Every other role except the Accountant works from its assigned businesses only.
const MANAGEMENT_ROLES = ['owner','general_manager','administrator','admin'];
const isLimitedRole = req => { const role = String(req.user?.role || '').toLowerCase(); return !MANAGEMENT_ROLES.includes(role) && role !== 'accountant'; };
function requireLimitedRole(req, res, next) {
  if (!isLimitedRole(req)) return res.status(403).json({ error: 'Assigned-business reports are not available for your role.' });
  next();
}
function monthRangeFor(month) {
  const [year, mon] = String(month).split('-').map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}
function monthsBetween(start, end) {
  const out = [];
  let cursor = `${start.slice(0, 7)}-01`;
  const final = `${end.slice(0, 7)}-01`;
  while (cursor <= final) {
    out.push(cursor.slice(0, 7));
    const [year, month] = cursor.slice(0, 7).split('-').map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
    if (out.length > 240) break;
  }
  return out;
}
function clippedMonthRange(month, start, end) {
  const [monthStart, monthEnd] = monthRangeFor(month);
  return [monthStart < start ? start : monthStart, monthEnd > end ? end : monthEnd];
}
function ownerAllocationFor(req, businessId, month, grossProfit) {
  const defaultRow = db.prepare('SELECT percent FROM dashboard_owner_defaults WHERE company_id=? AND month=?').get(req.user.company_id, month);
  const adjustment = db.prepare('SELECT percent,excluded FROM dashboard_owner_adjustments WHERE company_id=? AND business_id=? AND month=?').get(req.user.company_id, businessId, month);
  const defaultPercent = Number(defaultRow?.percent || 0);
  const excluded = !!adjustment?.excluded;
  const percent = excluded ? 0 : Number(adjustment?.percent ?? defaultPercent);
  const ownerExpense = Math.max(0, Number(grossProfit || 0)) * percent / 100;
  return {
    percent, excluded, ownerExpense, source: excluded ? 'excluded' : adjustment ? 'override' : 'default' };
}
function authoritativeOwnerReport(req, body) {
  const includeOwnerAllocation = String(req.user?.role || '').toLowerCase() === 'owner';
  const start = String(body?.range?.start || '');
  const end = String(body?.range?.end || '');
  if (!validDate(start) || !validDate(end) || start > end) {
    const error = new Error('A valid report start and end date are required for export.');
    error.status = 400;
    throw error;
  }
  const requestedMonths = monthsBetween(start, end);
  if (requestedMonths.length > 24) {
    const error = new Error('Report range is limited to 24 months per request. Generate separate reports for longer historical periods.');
    error.status = 413;
    throw error;
  }
  const selectedBusinessId = body?.selectedBusinessId ? String(body.selectedBusinessId) : null;
  const businesses = selectedBusinessId
    ? db.prepare('SELECT id,name FROM businesses WHERE id=? AND company_id=? AND is_active=1').all(selectedBusinessId, req.user.company_id)
    : db.prepare('SELECT id,name FROM businesses WHERE company_id=? AND is_active=1 ORDER BY name').all(req.user.company_id);
  if (selectedBusinessId && !businesses.length) {
    const error = new Error('The selected business is not available in your company.');
    error.status = 403;
    throw error;
  }
  if (!businesses.length) {
    const error = new Error('No active businesses are available for this report.');
    error.status = 400;
    throw error;
  }

  const monthly = [];
  for (const month of monthsBetween(start, end)) {
    const [periodStart, periodEnd] = clippedMonthRange(month, start, end);
    const monthRows = [];
    const monthExpenses = [];
    const monthOwnerAllocations = [];
    for (const business of businesses) {
      const sales = db.prepare(`SELECT COALESCE(SUM(sales_amount),0) sales,COALESCE(SUM(gross_amount),0) gross,COALESCE(SUM(returns_amount),0) returns,COALESCE(SUM(cost_amount),0) cost,COUNT(*) transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id, business.id, periodStart, periodEnd);
      const salesDays = db.prepare(`SELECT COUNT(DISTINCT transaction_date) days FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? AND sales_amount>0`).get(req.user.company_id, business.id, periodStart, periodEnd);
      const expenseRows = db.prepare(`SELECT id,expense_date AS expenseDate,category,description,amount FROM accountant_expenses WHERE company_id=? AND business_id=? AND expense_date BETWEEN ? AND ? ORDER BY expense_date DESC,created_at DESC`).all(req.user.company_id, business.id, periodStart, periodEnd);
      const expenseAmount = expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const payrollStart = periodStart.slice(0, 7);
      const payrollEnd = periodEnd.slice(0, 7);
      const manual = db.prepare(`SELECT COALESCE(SUM(amount),0) amount FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month BETWEEN ? AND ? AND calculation_mode='manual' AND status='saved'`).get(req.user.company_id, business.id, payrollStart, payrollEnd);
      const employee = db.prepare(`SELECT COALESCE(SUM(pe.gross_amount),0) amount FROM payroll_entries pe WHERE pe.company_id=? AND pe.business_id=? AND pe.payroll_month BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM payroll_monthly_totals pm WHERE pm.company_id=pe.company_id AND pm.business_id=pe.business_id AND pm.payroll_month=pe.payroll_month AND pm.calculation_mode='employees' AND pm.status='saved')`).get(req.user.company_id, business.id, payrollStart, payrollEnd);
      const payroll = Number(manual?.amount || 0) + Number(employee?.amount || 0);
      const purchases = db.prepare(`SELECT COALESCE(SUM(amount),0) amount FROM capital_contributions WHERE company_id=? AND business_id=? AND period_start<=? AND period_end>=?`).get(req.user.company_id, business.id, periodEnd, periodStart);
      const vendor = db.prepare(`SELECT COALESCE(SUM(amount),0) amount FROM vendor_payments WHERE company_id=? AND business_id=? AND payment_date BETWEEN ? AND ?`).get(req.user.company_id, business.id, periodStart, periodEnd);
      const salesAmount = Number(sales?.sales || 0);
      const gross = Number(sales?.gross || 0);
      const returns = Number(sales?.returns || 0);
      const cost = Number(sales?.cost || 0);
      const grossProfit = salesAmount - cost;
      const allocation = includeOwnerAllocation ? ownerAllocationFor(req, business.id, month, grossProfit) : { percent: 0, excluded: false, ownerExpense: 0, source: 'not-shown' };
      const netProfit = grossProfit - expenseAmount - payroll - allocation.ownerExpense;
      monthRows.push({
        id: String(business.id), name: business.name, sales: salesAmount, gross, returns, grossProfit,
        netProfit, expenses: expenseAmount, payroll, purchases: Number(purchases?.amount || 0),
        transactions: Number(sales?.transactions || 0), salesDays: Number(salesDays?.days || 0),
        ownerExpense: allocation.ownerExpense, ownerPercent: allocation.percent, ownerExcluded: allocation.excluded,
        vendorPayments: Number(vendor?.amount || 0)
      });
      monthExpenses.push(...expenseRows.map(row => ({ ...row, businessName: business.name })));
      if (includeOwnerAllocation) monthOwnerAllocations.push({ businessId: String(business.id), businessName: business.name, grossProfit, percent: allocation.percent, ownerExpense: allocation.ownerExpense, excluded: allocation.excluded, source: allocation.source });
    }
    const monthTotal = totals(monthRows);
    const businessIds = businesses.map(row => String(row.id));
    const placeholders = businessIds.map(() => '?').join(',');
    const distinctSalesDays = businessIds.length ? db.prepare(`SELECT COUNT(DISTINCT transaction_date) days FROM sales_transactions WHERE company_id=? AND transaction_date BETWEEN ? AND ? AND sales_amount>0 AND business_id IN (${placeholders})`).get(req.user.company_id, periodStart, periodEnd, ...businessIds) : { days: 0 };
    monthTotal.salesDays = Number(distinctSalesDays?.days || 0);
    monthly.push({ month, label: month, rows: monthRows, total: monthTotal, expenseDetails: monthExpenses, ownerAllocations: monthOwnerAllocations });
  }
  const rowMap = new Map();
  monthly.flatMap(month => month.rows).forEach(row => {
    const existing = rowMap.get(row.id) || { id: row.id, name: row.name, sales: 0, gross: 0, returns: 0, grossProfit: 0, netProfit: 0, expenses: 0, payroll: 0, purchases: 0, transactions: 0, salesDays: 0, ownerExpense: 0, vendorPayments: 0 };
    existing.sales += row.sales; existing.gross += row.gross; existing.returns += row.returns; existing.grossProfit += row.grossProfit;
    existing.netProfit += row.netProfit; existing.expenses += row.expenses; existing.payroll += row.payroll; existing.purchases += row.purchases;
    existing.transactions += row.transactions; existing.salesDays += row.salesDays; existing.ownerExpense += row.ownerExpense; existing.vendorPayments += row.vendorPayments;
    rowMap.set(row.id, existing);
  });
  const rows = [...rowMap.values()];
  const t = totals(rows);
  const allBusinessIds = businesses.map(row => String(row.id));
  const allPlaceholders = allBusinessIds.map(() => '?').join(',');
  const distinctPeriodDays = allBusinessIds.length ? db.prepare(`SELECT COUNT(DISTINCT transaction_date) days FROM sales_transactions WHERE company_id=? AND transaction_date BETWEEN ? AND ? AND sales_amount>0 AND business_id IN (${allPlaceholders})`).get(req.user.company_id, start, end, ...allBusinessIds) : { days: 0 };
  t.salesDays = Number(distinctPeriodDays?.days || 0);
  const ownerOnly = String(req.user?.role || '').toLowerCase() === 'owner';
  if (!ownerOnly) {
    rows.forEach(row => { row.ownerExpense = 0; row.ownerPercent = 0; row.ownerExcluded = false; row.netProfit = Number(row.grossProfit || 0) - Number(row.expenses || 0) - Number(row.payroll || 0); });
    monthly.forEach(month => { month.ownerAllocations = []; month.rows.forEach(row => { row.ownerExpense = 0; row.ownerPercent = 0; row.ownerExcluded = false; row.netProfit = Number(row.grossProfit || 0) - Number(row.expenses || 0) - Number(row.payroll || 0); }); month.total.ownerExpense = 0; month.total.netProfit = month.rows.reduce((sum,row) => sum + Number(row.netProfit || 0), 0); });
    t.ownerExpense = 0;
    t.netProfit = Number(t.grossProfit || 0) - Number(t.expenses || 0) - Number(t.payroll || 0);
  }
  return {
    includeOwnerAllocation, label: body?.label || 'Selected period', companyName: body?.companyName || 'Your Company', scopeLabel: selectedBusinessId ? businesses[0].name : 'Company-wide', selectedBusinessId, ownerOnly, rows, t, monthly };
}

router.post('/api/reports/owner-data', requirePermission('reports.view'), requireRole('owner','general_manager','administrator','admin'), (req, res, next) => {
  try {
    res.json(authoritativeOwnerReport(req, req.body));
  } catch (error) { next(error); }
});

router.post('/api/reports/export/excel', reportWorkloadLimit, requirePermission('reports.view'), requireRole('owner','general_manager','administrator','admin'), async (req, res, next) => {
  try {
    const data = authoritativeOwnerReport(req, req.body);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ReportGen';
    workbook.created = new Date();
    workbook.properties.title = `Consolidated Business Performance Report - ${data.label}`;
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EDE7D8' } };
    const headerFont = { bold: true, color: { argb: '222222' } };
    const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F4F0E7' } };
    const formatSheet = (sheet) => {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'middle', wrapText: true }; }));
      sheet.columns.forEach(col => { col.width = Math.min(Math.max(col.width || 12, 12), 28); });
    };
    const addHeader = (sheet, values) => {
      const row = sheet.addRow(values); row.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; });
      return row;
    };
    const addTotal = (sheet, values) => {
      const row = sheet.addRow(values); row.eachCell(cell => { cell.fill = totalFill; cell.font = { bold: true }; });
      return row;
    };
    const summary = workbook.addWorksheet('Executive Summary');
    const reportTitle = data.scopeLabel === 'Company-wide' ? 'Company-wide Business Performance Report' : `Business Performance Report - ${data.scopeLabel}`;
    summary.addRow(['Report', reportTitle]);
    summary.addRow(['Period', data.label]);
    summary.addRow([]);
    addHeader(summary, ['Metric', 'Value']);
    const summaryRows = [['Total sales', data.t.sales], ['Gross profit', data.t.grossProfit], ['Operating expenses', data.t.expenses], ['Payroll', data.t.payroll], ['Purchases / Capital', data.t.purchases], ...(data.includeOwnerAllocation ? [['Owner expense allocation', data.t.ownerExpense]] : []), ['Vendor payments', data.t.vendorPayments], ['Estimated net profit', data.t.netProfit], ['Transactions', data.t.transactions], ['Sales days', data.t.salesDays], ['Return amount', data.t.returns], ['Return rate', data.t.gross ? `${(n(data.t.returns) / n(data.t.gross) * 100).toFixed(1)}%` : '0.0%'], ['Average sale', data.t.transactions ? data.t.sales / data.t.transactions : 0]];
    summaryRows.forEach(([label, value]) => summary.addRow([label, value]));
    summary.getColumn(2).numFmt = '#,##0.00';
    summary.getColumn(1).width = 28; summary.getColumn(2).width = 22;
    formatSheet(summary);

    const contribution = workbook.addWorksheet('Business Contribution');
    addHeader(contribution, ['Business', 'Sales', 'Sales %', 'Gross Profit', 'Gross Profit %', 'Expenses', 'Payroll', ...(data.includeOwnerAllocation ? ['Owner Expense'] : []), 'Net Profit', 'Transactions', 'Sales Days']);
    data.rows.forEach(r => contribution.addRow([r.name, n(r.sales), pct(r.sales, data.t.sales), n(r.grossProfit), pct(r.grossProfit, data.t.grossProfit), n(r.expenses), n(r.payroll), ...(data.includeOwnerAllocation ? [n(r.ownerExpense)] : []), n(r.netProfit), n(r.transactions), n(r.salesDays)]));
    addTotal(contribution, [`${data.scopeLabel} total`, data.t.sales, '100.0%', data.t.grossProfit, '100.0%', data.t.expenses, data.t.payroll, ...(data.includeOwnerAllocation ? [data.t.ownerExpense] : []), data.t.netProfit, data.t.transactions, data.t.salesDays]);
    [2, 4, 6, 7, 8, 9].forEach(i => contribution.getColumn(i).numFmt = '#,##0.00');
    formatSheet(contribution);

    const company = workbook.addWorksheet('Company Monthly Performance');
    addHeader(company, ['Month', 'Total Sales', 'Sales %', 'Gross Profit', 'Profit %', 'Returns', 'Expenses', 'Payroll', 'Purchases', ...(data.includeOwnerAllocation ? ['Owner Expense'] : []), 'Vendor Payments', 'Net Profit', 'Transactions', 'Sales Days']);
    const periodSales = data.monthly.reduce((sum, m) => sum + n(m.total?.sales), 0);
    const periodProfit = data.monthly.reduce((sum, m) => sum + n(m.total?.grossProfit), 0);
    data.monthly.forEach(m => company.addRow([m.month, n(m.total?.sales), pct(m.total?.sales, periodSales), n(m.total?.grossProfit), pct(m.total?.grossProfit, periodProfit), n(m.total?.returns), n(m.total?.expenses), n(m.total?.payroll), n(m.total?.purchases), ...(data.includeOwnerAllocation ? [n(m.total?.ownerExpense)] : []), n(m.total?.vendorPayments), n(m.total?.netProfit), n(m.total?.transactions), n(m.total?.salesDays)]));
    addTotal(company, [`${data.scopeLabel} total`, periodSales, '100.0%', periodProfit, '100.0%', data.monthly.reduce((s, m) => s + n(m.total?.returns), 0), data.monthly.reduce((s, m) => s + n(m.total?.expenses), 0), data.monthly.reduce((s, m) => s + n(m.total?.payroll), 0), data.monthly.reduce((s, m) => s + n(m.total?.purchases), 0), ...(data.includeOwnerAllocation ? [data.monthly.reduce((s, m) => s + n(m.total?.ownerExpense), 0)] : []), data.monthly.reduce((s, m) => s + n(m.total?.vendorPayments), 0), data.monthly.reduce((s, m) => s + n(m.total?.netProfit), 0), data.monthly.reduce((s, m) => s + n(m.total?.transactions), 0), data.monthly.reduce((s, m) => s + n(m.total?.salesDays), 0)]);
    [2, 4, 6, 7, 8, 9, 10, 11, 12].forEach(i => company.getColumn(i).numFmt = '#,##0.00');
    formatSheet(company);

    const monthly = workbook.addWorksheet('Monthly Business Contribution');
    addHeader(monthly, ['Month', 'Business', 'Sales', 'Company Sales %', 'Gross Profit', 'Profit %', 'Expenses', ...(data.includeOwnerAllocation ? ['Owner Expense'] : []), 'Net Profit', 'Transactions', 'Sales Days']);
    data.monthly.forEach(m => {
      (m.rows || []).forEach(r => monthly.addRow([m.month, r.name, n(r.sales), pct(r.sales, m.total?.sales), n(r.grossProfit), pct(r.grossProfit, m.total?.grossProfit), n(r.expenses), ...(data.includeOwnerAllocation ? [n(r.ownerExpense)] : []), n(r.netProfit), n(r.transactions), n(r.salesDays)]));
      addTotal(monthly, [`${m.month} total`, '', n(m.total?.sales), '100.0%', n(m.total?.grossProfit), '100.0%', n(m.total?.expenses), ...(data.includeOwnerAllocation ? [n(m.total?.ownerExpense)] : []), n(m.total?.netProfit), n(m.total?.transactions), n(m.total?.salesDays)]);
    });
    [3, 5, 7, 8, 9].forEach(i => monthly.getColumn(i).numFmt = '#,##0.00');
    formatSheet(monthly);

    const returnsSheet = workbook.addWorksheet('Sales & Returns');
    addHeader(returnsSheet, ['Month', 'Gross Sales', 'Net Sales', 'Returns', 'Return Rate', 'Transactions', 'Sales Days', 'Average Sale']);
    data.monthly.forEach(m => returnsSheet.addRow([m.month, n(m.total?.gross), n(m.total?.sales), n(m.total?.returns), n(m.total?.gross) ? `${(n(m.total?.returns) / n(m.total?.gross) * 100).toFixed(1)}%` : '0.0%', n(m.total?.transactions), n(m.total?.salesDays), n(m.total?.transactions) ? n(m.total?.sales) / n(m.total?.transactions) : 0]));
    addTotal(returnsSheet, [`${data.scopeLabel} total`, n(data.t.gross), n(data.t.sales), n(data.t.returns), n(data.t.gross) ? `${(n(data.t.returns) / n(data.t.gross) * 100).toFixed(1)}%` : '0.0%', n(data.t.transactions), n(data.t.salesDays), n(data.t.transactions) ? n(data.t.sales) / n(data.t.transactions) : 0]);
    [2,3,4,8].forEach(i => returnsSheet.getColumn(i).numFmt = '#,##0.00');
    formatSheet(returnsSheet);

    const expensesSheet = workbook.addWorksheet('Expense Details');
    addHeader(expensesSheet, ['Month', 'Date', 'Business', 'Category', 'Description', 'Amount']);
    data.monthly.forEach(m => (m.expenseDetails || []).forEach(x => expensesSheet.addRow([m.month, x.expenseDate || '', x.businessName || '', x.category || 'Uncategorized', x.description || '', n(x.amount)])));
    addTotal(expensesSheet, ['Period total', '', '', '', '', n(data.t.expenses)]);
    expensesSheet.getColumn(6).numFmt = '#,##0.00'; formatSheet(expensesSheet);

    if (data.includeOwnerAllocation) {
      const allocationSheet = workbook.addWorksheet('Owner Expense Allocation');
      addHeader(allocationSheet, ['Month', 'Business', 'Gross Profit', 'Allocation %', 'Owner Expense', 'Status']);
      data.monthly.forEach(m => (m.ownerAllocations || []).forEach(x => allocationSheet.addRow([m.month, x.businessName, n(x.grossProfit), n(x.percent) / 100, n(x.ownerExpense), x.excluded ? 'Excluded' : x.source === 'override' ? 'Business override' : 'Default allocation'])));
      allocationSheet.getColumn(3).numFmt = '#,##0.00'; allocationSheet.getColumn(4).numFmt = '0.0%'; allocationSheet.getColumn(5).numFmt = '#,##0.00'; formatSheet(allocationSheet);
    }

    // Dedicated worksheets keep the Excel report navigable instead of creating one long worksheet.
    const usedSheetNames = new Set(workbook.worksheets.map(sheet => sheet.name));
    const sheetName = (value, fallback) => {
      let base = String(value || fallback).replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || fallback;
      let name = base, index = 2;
      while (usedSheetNames.has(name)) name = `${base.slice(0, 25)} ${index++}`;
      usedSheetNames.add(name);
      return name;
    };
    data.rows.forEach(r => {
      const sheet = workbook.addWorksheet(sheetName(r.name, 'Business'));
      sheet.addRow([`${r.name} - Performance Detail`]).font = { bold: true, size: 14 };
      sheet.addRow(['Period', data.label]);
      addHeader(sheet, ['Metric', 'Value']);
      [['Sales', n(r.sales)], ['Gross Profit', n(r.grossProfit)], ['Net Profit', n(r.netProfit)], ['Transactions', n(r.transactions)], ['Sales Days', n(r.salesDays)], ['Average Sale', n(r.averageSale)], ['Expenses', n(r.expenses)], ['Payroll', n(r.payroll)], ['Purchases', n(r.purchases)], ...(data.includeOwnerAllocation ? [['Owner Expense', n(r.ownerExpense)]] : []), ['Returns', n(r.returns)]].forEach(row => sheet.addRow(row));
      sheet.getColumn(2).numFmt = '#,##0.00';
      sheet.getColumn(1).width = 28; sheet.getColumn(2).width = 22;
      formatSheet(sheet);
    });
    data.monthly.forEach(m => {
      const sheet = workbook.addWorksheet(sheetName(`${m.month} Detail`, 'Monthly Detail'));
      sheet.addRow([`${m.label || m.month} - Business Detail`]).font = { bold: true, size: 14 };
      addHeader(sheet, ['Business', 'Sales', 'Gross Profit', 'Net Profit', 'Expenses', 'Payroll', 'Purchases', 'Transactions']);
      (m.rows || []).forEach(r => sheet.addRow([r.name, n(r.sales), n(r.grossProfit), n(r.netProfit), n(r.expenses), n(r.payroll), n(r.purchases), n(r.transactions)]));
      addTotal(sheet, ['Month total', n(m.total?.sales), n(m.total?.grossProfit), n(m.total?.netProfit), n(m.total?.expenses), n(m.total?.payroll), n(m.total?.purchases), n(m.total?.transactions)]);
      [2,3,4,5,6,7].forEach(i => sheet.getColumn(i).numFmt = '#,##0.00');
      sheet.autoFilter = { from: 'A2', to: 'H2' };
      formatSheet(sheet);
    });

    workbook.worksheets.forEach(sheet => {
      sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
      sheet.properties.pageSetUpPr = { fitToPage: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.status(200).set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="ReportGen-${String(data.label).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Report'}.xlsx"` }).send(Buffer.from(buffer));
  } catch (error) { next(error); }
});

router.post('/api/reports/export/word', reportWorkloadLimit, requirePermission('reports.view'), requireRole('owner','general_manager','administrator','admin'), async (req, res, next) => {
  try {
    const data = authoritativeOwnerReport(req, req.body);
    const t = data.t;
    const companyName = data.companyName || 'Your Company';
    const reportTitle = data.scopeLabel === 'Company-wide' ? 'Company-wide Business Performance Report' : `Business Performance Report - ${data.scopeLabel}`;
    const periodSales = data.monthly.reduce((sum, m) => sum + n(m.total?.sales), 0);
    const periodProfit = data.monthly.reduce((sum, m) => sum + n(m.total?.grossProfit), 0);
    const text = value => String(value ?? '');
    const cell = (value, options = {}) => new TableCell({ shading: options.fill ? { fill: options.fill } : undefined, margins: { top: 100, bottom: 100, left: 110, right: 110 }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: text(value), size: options.size || 19, bold: !!options.bold, color: options.color || '20252D' })] })] });
    const headerCell = value => cell(value, { fill: '142238', color: 'FFFFFF', bold: true, size: 18 });
    const totalCell = value => cell(value, { fill: 'EEE8DB', bold: true, size: 19 });
    const makeTable = (headers, rows, totalRow) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: headers.map(headerCell) }), ...rows.map((row, index) => new TableRow({ children: row.map(value => cell(value, { fill: index % 2 ? 'FFFFFF' : 'F8F7F3' })) })), ...(totalRow ? [new TableRow({ children: totalRow.map(totalCell) })] : [])] });
    const kpiCell = (label, value) => new TableCell({ shading: { fill: 'F3EFE6' }, margins: { top: 170, bottom: 170, left: 170, right: 170 }, children: [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 16, color: '6D675D' })] }), new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: value, bold: true, size: 26, color: '142238' })] })] });
    const kpis = [['Total sales', money(t.sales)], ['Gross profit', money(t.grossProfit)], ['Operating expenses', money(t.expenses)], ['Payroll', money(t.payroll)], ['Purchases / Capital', money(t.purchases)], ...(data.includeOwnerAllocation ? [['Owner expense', money(t.ownerExpense)]] : []), ['Vendor payments', money(t.vendorPayments)], ['Estimated net profit', money(t.netProfit)], ['Transactions', n(t.transactions).toLocaleString()], ['Sales days', n(t.salesDays).toLocaleString()], ['Return rate', pct(t.returns, t.gross)], ['Net profit margin', pct(t.netProfit, t.sales)]];
    const kpiRows = [];
    for (let i = 0; i < kpis.length; i += 2) kpiRows.push(new TableRow({ children: [kpiCell(...kpis[i]), kpis[i + 1] ? kpiCell(...kpis[i + 1]) : kpiCell('', '')] }));
    const top = [...data.rows].filter(r => n(r.sales) > 0).sort((a, b) => n(b.sales) - n(a.sales));
    const chartWidth = 760;
    const chartHeight = Math.max(180, top.length * 48 + 50);
    const maxBar = top.reduce((max, r) => Math.max(max, n(r.sales)), 0) || 1;
    const chartRows = top.map((r, index) => {
      const y = 30 + index * 48;
      const width = Math.max(1, (n(r.sales) / maxBar) * 470);
      const label = safe(r.name).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      return `<text x="10" y="${y}" font-family="Arial" font-size="14" fill="#222">${label}</text><rect x="10" y="${y + 8}" width="470" height="16" rx="3" fill="#eee9df"/><rect x="10" y="${y + 8}" width="${width.toFixed(2)}" height="16" rx="3" fill="#a87927"/><text x="500" y="${y + 21}" font-family="Arial" font-size="13" fill="#555">${pct(r.sales, t.sales)} · ${money(r.sales)}</text>`;
    }).join('');
    const chartSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}"><rect width="100%" height="100%" fill="#ffffff"/>${chartRows || '<text x="10" y="30" font-family="Arial" font-size="14">No sales data for this period.</text>'}</svg>`;
    const contributionRows = data.rows.map(r => [r.name, money(r.sales), pct(r.sales, t.sales), money(r.grossProfit), pct(r.grossProfit, t.grossProfit), money(r.expenses), money(r.payroll), ...(data.includeOwnerAllocation ? [money(r.ownerExpense)] : []), money(r.netProfit), n(r.transactions).toLocaleString(), n(r.salesDays).toLocaleString()]);
    const companyRows = data.monthly.map(m => [m.label || m.month, money(m.total?.sales), pct(m.total?.sales, periodSales), money(m.total?.grossProfit), pct(m.total?.grossProfit, periodProfit), money(m.total?.returns), money(m.total?.expenses), money(m.total?.payroll), money(m.total?.purchases), ...(data.includeOwnerAllocation ? [money(m.total?.ownerExpense)] : []), money(m.total?.vendorPayments), money(m.total?.netProfit), n(m.total?.transactions).toLocaleString(), n(m.total?.salesDays).toLocaleString()]);
    const children = [
      new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: companyName.toUpperCase(), bold: true, size: 22, color: 'A87927' })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: reportTitle, bold: true, size: 36, color: '142238' })] }),
      new Paragraph({ text: data.label, spacing: { after: 180 } }),
      makeTable(['REPORT SCOPE', 'PREPARED FOR', 'REPORT PERIOD'], [[data.scopeLabel, companyName, data.label]]),
      new Paragraph({ text: 'Executive Financial Summary', heading: HeadingLevel.HEADING_1 }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: kpiRows }),
      new Paragraph({ text: 'Business Sales Contribution', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new ImageRun({ data: Buffer.from(chartSvg), type: 'image/svg+xml', transformation: { width: 650, height: Math.round(chartHeight * 650 / chartWidth) } })], alignment: AlignmentType.CENTER }),
      new Paragraph({ text: 'Business Contribution Summary', heading: HeadingLevel.HEADING_1 }),
      makeTable(['Business','Sales','Sales %','Gross Profit','Profit %','Expenses','Payroll',...(data.includeOwnerAllocation ? ['Owner Expense'] : []),'Net Profit','Transactions','Sales Days'], contributionRows, [`${data.scopeLabel} total`, money(t.sales), '100.0%', money(t.grossProfit), '100.0%', money(t.expenses), money(t.payroll), ...(data.includeOwnerAllocation ? [money(t.ownerExpense)] : []), money(t.netProfit), n(t.transactions).toLocaleString(), n(t.salesDays).toLocaleString()]),
      new Paragraph({ text: `${data.scopeLabel} Monthly Performance`, heading: HeadingLevel.HEADING_1 }),
      makeTable(['Month','Total Sales','Sales %','Gross Profit','Profit %','Returns','Expenses','Payroll','Purchases',...(data.includeOwnerAllocation ? ['Owner Expense'] : []),'Vendor Payments','Net Profit','Transactions','Sales Days'], companyRows, [`${data.scopeLabel} total`, periodSales, '100.0%', periodProfit, '100.0%', data.monthly.reduce((s,m)=>s+n(m.total?.returns),0), data.monthly.reduce((s,m)=>s+n(m.total?.expenses),0), data.monthly.reduce((s,m)=>s+n(m.total?.payroll),0), data.monthly.reduce((s,m)=>s+n(m.total?.purchases),0), ...(data.includeOwnerAllocation ? [data.monthly.reduce((s,m)=>s+n(m.total?.ownerExpense),0)] : []), data.monthly.reduce((s,m)=>s+n(m.total?.vendorPayments),0), data.monthly.reduce((s,m)=>s+n(m.total?.netProfit),0), n(data.monthly.reduce((s,m)=>s+n(m.total?.transactions),0)).toLocaleString(), n(data.monthly.reduce((s,m)=>s+n(m.total?.salesDays),0)).toLocaleString()])
    ];
    for (const m of data.monthly) {
      const rows = (m.rows || []).map(r => [r.name, money(r.sales), pct(r.sales, m.total?.sales), money(r.grossProfit), pct(r.grossProfit, m.total?.grossProfit), money(r.expenses), ...(data.includeOwnerAllocation ? [money(r.ownerExpense)] : []), money(r.netProfit), n(r.transactions).toLocaleString(), n(r.salesDays).toLocaleString()]);
      children.push(new Paragraph({ text: `${data.scopeLabel} Contribution — ${m.label || m.month}`, heading: HeadingLevel.HEADING_1 }));
      children.push(makeTable(['Business','Sales','Company Sales %','Gross Profit','Profit %','Expenses',...(data.includeOwnerAllocation ? ['Owner Expense'] : []),'Net Profit','Transactions','Sales Days'], rows, [`${m.label || m.month} total`, money(m.total?.sales), '100.0%', money(m.total?.grossProfit), '100.0%', money(m.total?.expenses), ...(data.includeOwnerAllocation ? [money(m.total?.ownerExpense)] : []), money(m.total?.netProfit), n(m.total?.transactions).toLocaleString(), n(m.total?.salesDays).toLocaleString()]));
    }
    children.push(new Paragraph({ text: 'Sales & Returns', heading: HeadingLevel.HEADING_1 }));
    children.push(makeTable(['Metric','Value'], [['Gross sales', money(t.gross)], ['Net sales', money(t.sales)], ['Returns', money(t.returns)], ['Return rate', pct(t.returns, t.gross)], ['Sales days', n(t.salesDays).toLocaleString()], ['Average sale', money(t.transactions ? t.sales / t.transactions : 0)]]));
    children.push(new Paragraph({ text: data.includeOwnerAllocation ? 'Payroll, Capital & Owner Allocation' : 'Payroll, Capital & Vendor Payments', heading: HeadingLevel.HEADING_1 }));
    const costRows = [['Payroll', money(t.payroll), pct(t.payroll,t.sales)], ['Purchases / Capital', money(t.purchases), pct(t.purchases,t.sales)], ['Vendor payments', money(t.vendorPayments), pct(t.vendorPayments,t.sales)], ...(data.includeOwnerAllocation ? [['Owner expense allocation', money(t.ownerExpense), pct(t.ownerExpense,t.sales)]] : []), ['Operating expenses', money(t.expenses), pct(t.expenses,t.sales)]];
    children.push(makeTable(['Metric','Amount','% of Sales'], costRows));
    if (data.includeOwnerAllocation) {
      children.push(new Paragraph({ text: 'Owner Expense Allocation Detail', heading: HeadingLevel.HEADING_1 }));
      const ownerRows = data.monthly.flatMap(m => (m.ownerAllocations || []).map(x => [m.label || m.month, x.businessName || '', money(x.grossProfit), `${n(x.percent).toFixed(1)}%`, money(x.ownerExpense), x.excluded ? 'Excluded' : x.source === 'override' ? 'Business override' : 'Default allocation']));
      children.push(makeTable(['Month','Business','Gross Profit','Allocation %','Owner Expense','Status'], ownerRows));
    }
    children.push(new Paragraph({ text: 'Expense Details', heading: HeadingLevel.HEADING_1 }));
    const expenseRows = data.monthly.flatMap(m => (m.expenseDetails || []).map(x => [m.label || m.month, x.expenseDate || '', x.businessName || '', x.category || 'Uncategorized', x.description || '', money(x.amount)]));
    children.push(makeTable(['Month','Date','Business','Category','Description','Amount'], expenseRows.length ? expenseRows : [['—','—','—','—','No expense records','—']]));
    children.push(new Paragraph({ text: 'Management Commentary', heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ text: `Sales were ${money(t.sales)} across ${n(t.transactions).toLocaleString()} transactions and ${n(t.salesDays).toLocaleString()} sales days. Gross profit was ${money(t.grossProfit)} (${pct(t.grossProfit,t.sales)}), while estimated net profit was ${money(t.netProfit)} (${pct(t.netProfit,t.sales)}). Operating expenses were ${money(t.expenses)}, payroll was ${money(t.payroll)}, and purchases were ${money(t.purchases)}${data.includeOwnerAllocation ? `; owner expense allocation was ${money(t.ownerExpense)}` : ''}.` }));
    children.push(new Paragraph({ children: [new TextRun({ text: data.includeOwnerAllocation ? 'Gross profit and estimated net profit are derived from ReportGen data and configured owner allocation rules. Review source records before accounting, tax, or regulatory use.' : 'Gross profit and estimated net profit are derived from ReportGen source records. Review source records before accounting, tax, or regulatory use.', italics: true, size: 16 })] }));
    const document = new Document({ creator: 'ReportGen', title: `${companyName} - ${reportTitle}`, styles: { default: { document: { run: { font: 'Aptos', size: 20 }, paragraph: { spacing: { after: 95 } } } } }, sections: [{ properties: { page: { margin: { top: 720, right: 780, bottom: 720, left: 780 } } }, children }] });
    const buffer = await Packer.toBuffer(document);
    res.status(200).set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="ReportGen-${exportSafeFile(data.scopeLabel)}-${exportSafeFile(data.label)}.docx"` }).send(buffer);
  } catch (error) { next(error); }
});
function exportSafeFile(value) { return String(value || 'Report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Report'; }
function stripHtml(value) { return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }
const MANAGER_SECTION_KEYS = new Set(['intro','summary','comparison','sales','selling','profitable','groups','returns','expenses','businesses','payroll','commentary']);
function sanitizeSectionHtml(value) {
  return String(value || '')
    .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|textarea|select|link|meta)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, 500000);
}
function accessibleBusinessIds(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (['owner','general_manager','administrator','admin'].includes(role)) {
    return new Set(db.prepare('SELECT id FROM businesses WHERE company_id=? AND is_active=1').all(req.user.company_id).map(row => String(row.id)));
  }
  return new Set(db.prepare('SELECT b.id FROM businesses b JOIN user_business_access a ON a.business_id=b.id WHERE b.company_id=? AND b.is_active=1 AND a.user_id=?').all(req.user.company_id, req.user.user_id).map(row => String(row.id)));
}
function assertExportScope(req, body) {
  const ids = Array.isArray(body?.businessIds) ? [...new Set(body.businessIds.map(String).filter(Boolean))] : [];
  if (!ids.length && isLimitedRole(req)) {
    const error = new Error('businessIds are required for assigned-business exports.');
    error.status = 400;
    throw error;
  }
  if (!ids.length) return;
  const allowed = accessibleBusinessIds(req);
  if (ids.some(id => !allowed.has(id))) {
    const error = new Error('Export contains a business outside your permitted scope.');
    error.status = 403;
    throw error;
  }
}
function managerSections(body) {
  if (!Array.isArray(body?.sections)) return [];
  return body.sections
    .filter(s => s && MANAGER_SECTION_KEYS.has(String(s.key)) && typeof s.title === 'string')
    .slice(0, 20)
    .map(s => ({ key: String(s.key), title: String(s.title).slice(0, 200), html: sanitizeSectionHtml(s.html) }));
}
function htmlEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function trustedManagerData(req, validation) {
  const month = validation.month;
  const ids = validation.ids.map(String);
  const placeholders = ids.map(() => '?').join(',');
  const [year, mon] = month.split('-').map(Number);
  const previousDate = new Date(Date.UTC(year, mon - 2, 1));
  const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const details = ids.map(businessId => {
    const current = authoritativeBusinessSnapshot(req, businessId, month);
    const previous = authoritativeBusinessSnapshot(req, businessId, previousMonth);
    const [start, end] = monthBounds(month);
    const daily = db.prepare(`SELECT transaction_date AS day,COALESCE(SUM(sales_amount),0) AS sales,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY transaction_date ORDER BY transaction_date`).all(req.user.company_id, businessId, start, end).map(r => ({day:String(r.day),sales:Number(r.sales||0),transactions:Number(r.transactions||0)}));
    const topProducts = db.prepare(`SELECT COALESCE(product_name,'Unspecified') AS productName,COALESCE(SUM(sales_amount),0) AS sales,COALESCE(SUM(quantity),0) AS quantity,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY product_name ORDER BY sales DESC LIMIT 10`).all(req.user.company_id,businessId,start,end).map(r=>({name:r.productName,sales:Number(r.sales||0),quantity:Number(r.quantity||0),transactions:Number(r.transactions||0)}));
    const topProfitable = db.prepare(`SELECT COALESCE(product_name,'Unspecified') AS productName,COALESCE(SUM(profit_amount),0) AS profit,COALESCE(SUM(sales_amount),0) AS sales FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY product_name ORDER BY profit DESC LIMIT 10`).all(req.user.company_id,businessId,start,end).map(r=>({name:r.productName,profit:Number(r.profit||0),sales:Number(r.sales||0)}));
    const categories = db.prepare(`SELECT COALESCE(category,'Uncategorized') AS category,COALESCE(SUM(sales_amount),0) AS sales FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY category ORDER BY sales DESC`).all(req.user.company_id,businessId,start,end).map(r=>({name:r.category,sales:Number(r.sales||0)}));
    const returns = db.prepare(`SELECT COALESCE(SUM(returns_amount),0) AS amount,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? AND returns_amount>0`).get(req.user.company_id,businessId,start,end);
    const expenses = db.prepare(`SELECT expense_date AS date,category,description,amount FROM accountant_expenses WHERE company_id=? AND business_id=? AND expense_date BETWEEN ? AND ? ORDER BY expense_date DESC,created_at DESC`).all(req.user.company_id,businessId,start,end).map(r=>({date:r.date,category:r.category,description:r.description,amount:Number(r.amount||0)}));
    return {current,previous,daily,topProducts,topProfitable,categories,returns:{amount:Number(returns?.amount||0),transactions:Number(returns?.transactions||0)},expenses};
  });
  const sum=(items,key)=>items.reduce((a,x)=>a+Number(x[key]||0),0);
  const aggregate=(items,which='current')=>items.reduce((a,d)=>{
    const x=which==='current'?d.current:d.previous,s=x.summary||{},f=x.financials||{};
    a.sales+=Number(s.sales||0);a.gross+=Number(s.gross||0);a.returns+=Number(s.returns||0);a.transactions+=Number(s.transactions||0);a.costOfGoods+=Number(f.costOfGoods||0);a.grossProfit+=Number(f.grossProfit||0);a.expenses+=Number(f.expenses||0);a.payroll+=Number(f.payroll||0);a.netProfit+=Number(f.netProfit||0);a.purchases+=Number(f.purchases||0);return a;
  },{sales:0,gross:0,returns:0,transactions:0,costOfGoods:0,grossProfit:0,expenses:0,payroll:0,netProfit:0,purchases:0});
  const current=aggregate(details), previous=aggregate(details,'previous');
  const dailyMap=new Map();details.forEach(d=>d.daily.forEach(x=>{const row=dailyMap.get(x.day)||{day:x.day,sales:0,transactions:0};row.sales+=x.sales;row.transactions+=x.transactions;dailyMap.set(x.day,row);}));
  const daily=[...dailyMap.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const products=new Map(),profitable=new Map(),groups=new Map();details.forEach(d=>{d.topProducts.forEach(x=>{const r=products.get(x.name)||{name:x.name,sales:0,quantity:0,transactions:0};r.sales+=x.sales;r.quantity+=x.quantity;r.transactions+=x.transactions;products.set(x.name,r)});d.topProfitable.forEach(x=>{const r=profitable.get(x.name)||{name:x.name,profit:0,sales:0};r.profit+=x.profit;r.sales+=x.sales;profitable.set(x.name,r)});d.categories.forEach(x=>groups.set(x.name,(groups.get(x.name)||0)+x.sales));});
  const businessRows=details.map(d=>d.current).map(x=>[x.name,x.summary.sales,x.financials.grossProfit,x.financials.expenses,x.financials.payroll,x.financials.netProfit,x.summary.transactions]);
  const expenseRows=details.flatMap(d=>d.expenses.map(x=>[d.current.name,x.date,x.category||'Uncategorized',x.description||'',x.amount]));
  const payrollRows=details.map(d=>[d.current.name,d.current.financials.payroll]);
  const returnRows=details.map(d=>[d.current.name,d.returns.amount,d.returns.transactions]);
  const table=(headers,rows)=>`<table><thead><tr>${headers.map(htmlEsc).map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(htmlEsc).map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const moneyText=v=>money(v);
  const selectedKeys=Array.isArray(bodySections(body))?bodySections(body):[];
  const all={
    intro:`<p>This server-generated report covers the selected assigned-business scope for ${htmlEsc(month)}. Financial values are calculated from ReportGen source records and are not taken from client-supplied report HTML.</p>`,
    summary:table(['Metric','Value'],[['Total sales',moneyText(current.sales)],['Cost of goods',moneyText(current.costOfGoods)],['Gross profit',moneyText(current.grossProfit)],['Operating expenses',moneyText(current.expenses)],['Payroll',moneyText(current.payroll)],['Net profit',moneyText(current.netProfit)],['Transactions',current.transactions.toLocaleString()],['Returns',moneyText(current.returns)],['Return rate',current.gross?`${(current.returns/current.gross*100).toFixed(2)}%`:'0.00%']]),
    comparison:table(['Metric','Current month','Previous month'],[['Sales',moneyText(current.sales),moneyText(previous.sales)],['Cost of goods',moneyText(current.costOfGoods),moneyText(previous.costOfGoods)],['Gross profit',moneyText(current.grossProfit),moneyText(previous.grossProfit)],['Expenses',moneyText(current.expenses),moneyText(previous.expenses)],['Payroll',moneyText(current.payroll),moneyText(previous.payroll)],['Net profit',moneyText(current.netProfit),moneyText(previous.netProfit)],['Purchases',moneyText(current.purchases),moneyText(previous.purchases)],['Transactions',current.transactions.toLocaleString(),previous.transactions.toLocaleString()]]),
    sales:table(['Day','Sales','Transactions'],daily.map(x=>[x.day,moneyText(x.sales),x.transactions])),
    selling:table(['Product','Sales','Quantity','Transactions'],[...products.values()].sort((a,b)=>b.sales-a.sales).slice(0,10).map(x=>[x.name,moneyText(x.sales),x.quantity,x.transactions])),
    profitable:table(['Product','Imported profit','Sales'],[...profitable.values()].sort((a,b)=>b.profit-a.profit).slice(0,10).map(x=>[x.name,moneyText(x.profit),moneyText(x.sales)])),
    groups:table(['Product group','Sales'],[...groups.entries()].sort((a,b)=>b[1]-a[1]).map(x=>[x[0],moneyText(x[1])])),
    returns:table(['Business','Returns','Return transactions'],returnRows),
    expenses:table(['Business','Date','Category','Description','Amount'],expenseRows),
    businesses:table(['Business','Sales','Gross profit','Expenses','Payroll','Net profit','Transactions'],businessRows),
    payroll:table(['Business','Payroll'],payrollRows),
    commentary:`<p>Sales were ${moneyText(current.sales)} across ${current.transactions.toLocaleString()} transactions. Gross profit was ${moneyText(current.grossProfit)}, operating expenses were ${moneyText(current.expenses)}, payroll was ${moneyText(current.payroll)}, and estimated net profit was ${moneyText(current.netProfit)}.</p>`
  };
  return {current,previous,daily,sections:all};
}
function bodySections(body){return Array.isArray(body?.sections)?body.sections.filter(s=>s&&MANAGER_SECTION_KEYS.has(String(s.key))).slice(0,20).map(s=>String(s.key)):[];}
function trustedManagerSections(req, body, validation){
  const trusted=trustedManagerData(req,validation);const requested=new Set(bodySections(body));
  return [...MANAGER_SECTION_KEYS].filter(key=>requested.has(key)).map(key=>({key,title:(body.sections||[]).find(s=>String(s?.key)===key)?.title||key,html:trusted.sections[key]||'<p>No data available.</p>'}));
}

function validMonth(value) { return /^\d{4}-\d{2}$/.test(String(value || '')); }
function monthBounds(month) {
  const [year, mon] = String(month).split('-').map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}
function nearlyEqual(a, b) { return Math.abs(Number(a || 0) - Number(b || 0)) < 0.01; }
function authoritativeBusinessSnapshot(req, businessId, month) {
  const [start, end] = monthBounds(month);
  const b = db.prepare('SELECT id,name FROM businesses WHERE id=? AND company_id=? AND is_active=1').get(businessId, req.user.company_id);
  if (!b) return null;
  const summary = db.prepare(`SELECT COALESCE(SUM(sales_amount),0) sales, COALESCE(SUM(gross_amount),0) gross, COALESCE(SUM(returns_amount),0) returns, COUNT(*) transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id, businessId, start, end);
  const cost = db.prepare(`SELECT COALESCE(SUM(cost_amount),0) amount FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id, businessId, start, end);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) amount FROM accountant_expenses WHERE company_id=? AND business_id=? AND expense_date BETWEEN ? AND ?`).get(req.user.company_id, businessId, start, end);
  const manual = db.prepare(`SELECT COALESCE(SUM(amount),0) amount FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month BETWEEN ? AND ? AND calculation_mode='manual' AND status='saved'`).get(req.user.company_id, businessId, month, month);
  const employees = db.prepare(`SELECT COALESCE(SUM(pe.gross_amount),0) amount FROM payroll_entries pe WHERE pe.company_id=? AND pe.business_id=? AND pe.payroll_month=? AND EXISTS (SELECT 1 FROM payroll_monthly_totals pm WHERE pm.company_id=pe.company_id AND pm.business_id=pe.business_id AND pm.payroll_month=pe.payroll_month AND pm.calculation_mode='employees' AND pm.status='saved')`).get(req.user.company_id, businessId, month);
  const sales = Number(summary.sales || 0), costOfGoods = Number(cost.amount || 0), expenseAmount = Number(expenses.amount || 0);
  const payroll = Number(manual.amount || 0) + Number(employees.amount || 0);
  const grossProfit = sales - costOfGoods;
  return {
    businessId: String(businessId), name: b.name, summary: { sales, gross: Number(summary.gross || 0), returns: Number(summary.returns || 0), transactions: Number(summary.transactions || 0) }, financials: { costOfGoods, grossProfit, expenses: expenseAmount, payroll, totalExpenses: expenseAmount + payroll, netProfit: grossProfit - expenseAmount - payroll } };
}
function validateManagerSource(req, body) {
  const month = validMonth(body?.month) ? String(body.month) : '';
  if (!month) { const e = new Error('A valid reporting month is required for server-side export validation.'); e.status = 400; throw e; }
  const ids = [...new Set((body.businessIds || []).map(String).filter(Boolean))];
  const suppliedRows = Array.isArray(body.rows) ? body.rows : [];
  if (!ids.length || suppliedRows.length !== ids.length) { const e = new Error('Export validation requires one source row per selected business.'); e.status = 400; throw e; }
  const expected = ids.map(id => authoritativeBusinessSnapshot(req, id, month));
  if (expected.some(row => !row)) { const e = new Error('One or more businesses are invalid or unavailable.'); e.status = 403; throw e; }
  const byId = new Map(suppliedRows.map(row => [String(row.businessId || row.business?.id || ''), row]));
  for (const item of expected) {
    const supplied = byId.get(item.businessId);
    if (!supplied) { const e = new Error(`Missing source row for ${item.name}.`); e.status = 400; throw e; }
    const ss = supplied.summary || {}, sf = supplied.financials || {};
    for (const key of ['sales','gross','returns','transactions']) if (!nearlyEqual(ss[key], item.summary[key])) { const e = new Error(`Export data validation failed for ${item.name}: ${key}.`); e.status = 422; throw e; }
    for (const key of ['costOfGoods','grossProfit','expenses','payroll','totalExpenses','netProfit']) if (!nearlyEqual(sf[key], item.financials[key])) { const e = new Error(`Export data validation failed for ${item.name}: ${key}.`); e.status = 422; throw e; }
  }
  return {
    month, ids, expected };
}
router.post('/api/reports/export/manager/validate', requirePermission('reports.view'), requireLimitedRole, (req, res, next) => {
  try { assertExportScope(req, req.body); const result = validateManagerSource(req, req.body); res.json({ valid: true, month: result.month, businesses: result.expected.map(row => ({ id: row.businessId, name: row.name })) }); }
  catch (error) { next(error); }
});

function htmlTables(html) {
  return [...String(html || '').matchAll(/<table[\s\S]*?<\/table>/gi)].map(match => {
    return [...match[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(rowMatch =>
      [...rowMatch[0].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(cell => stripHtml(cell[1]))
    ).filter(row => row.length);
  }).filter(table => table.length);
}
function uniqueWorksheetName(workbook, value, fallback='Section') {
  const used = new Set(workbook.worksheets.map(sheet => sheet.name));
  const base = String(value || fallback).replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || fallback;
  let name = base, index = 2;
  while (used.has(name)) name = `${base.slice(0, 25)} ${index++}`;
  return name;
}

router.post('/api/reports/export/manager/excel', reportWorkloadLimit, requirePermission('reports.view'), requireLimitedRole, async (req, res, next) => {
  try {
    assertExportScope(req, req.body);
    validateManagerSource(req, req.body);
    const sections = trustedManagerSections(req, req.body, validation);
    if (!sections.length) return res.status(400).json({ error: 'Select at least one report section.' });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ReportGen'; workbook.created = new Date();
    workbook.properties.title = `Business Manager Report - ${req.body?.label || 'Selected period'}`;
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EDE7D8' } };
    const titleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F4F0E7' } };
    sections.forEach(section => {
      const sheet = workbook.addWorksheet(uniqueWorksheetName(workbook, section.title));
      const title = sheet.addRow([section.title]); title.font = { bold: true, size: 14 }; title.fill = titleFill;
      sheet.addRow(['Company', req.body?.companyName || 'ReportGen']);
      sheet.addRow(['Period', req.body?.label || 'Selected period']);
      sheet.addRow([]);
      const tables = htmlTables(section.html);
      if (tables.length) {
        tables.forEach((table, tableIndex) => {
          table.forEach((row, rowIndex) => {
            const out = sheet.addRow(row);
            if (rowIndex === 0) { out.font = { bold: true }; out.eachCell(cell => { cell.fill = headerFill; }); }
          });
          if (tableIndex < tables.length - 1) sheet.addRow([]);
        });
      } else {
        const text = stripHtml(section.html);
        if (text) sheet.addRow([text]);
      }
      sheet.columns.forEach(column => { column.width = 24; });
      sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
      sheet.views = [{ state: 'frozen', ySplit: 4 }];
      sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
      sheet.properties.pageSetUpPr = { fitToPage: true };
    });
    const buffer = await workbook.xlsx.writeBuffer();
    res.status(200).set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="ReportGen-${exportSafeFile(req.body?.label)}-Business-Manager.xlsx"` }).send(Buffer.from(buffer));
  } catch (error) { next(error); }
});

function managerTrendSvg(daily) {
  const points = Array.isArray(daily) ? daily.filter(item => n(item?.sales) >= 0) : [];
  const width = 900, height = 300, left = 72, right = 24, top = 24, bottom = 42;
  const chartW = width - left - right, chartH = height - top - bottom;
  const max = Math.max(...points.map(item => n(item.sales)), 1);
  const slot = points.length ? chartW / points.length : chartW;
  const barW = Math.max(4, slot * 0.62);
  const grid = [0, .25, .5, .75, 1].map(rate => {
    const y = top + chartH - chartH * rate;
    const value = money(max * rate).replace('.00', '');
    return `<line x1="${left}" y1="${y.toFixed(2)}" x2="${width-right}" y2="${y.toFixed(2)}" stroke="#ded8cb" stroke-dasharray="4 5"/><text x="${left-10}" y="${(y+4).toFixed(2)}" text-anchor="end" font-family="Arial" font-size="10" fill="#777">${value}</text>`;
  }).join('');
  const bars = points.map((item, index) => {
    const value = n(item.sales), h = value / max * chartH;
    const x = left + index * slot + (slot - barW) / 2;
    const y = top + chartH - h;
    const showLabel = index === 0 || index === points.length - 1 || index % 5 === 0;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1,h).toFixed(2)}" rx="3" fill="#a87927"><title>${safe(item.day)}: ${safe(money(value))}</title></rect>${showLabel ? `<text x="${(x+barW/2).toFixed(2)}" y="${height-15}" text-anchor="middle" font-family="Arial" font-size="10" fill="#777">${safe(String(item.day).slice(-2))}</text>` : ''}`;
  }).join('');
  const empty = points.length ? '' : '<text x="72" y="70" font-family="Arial" font-size="14" fill="#777">No daily sales data available for this period.</text>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${grid}<line x1="${left}" y1="${top+chartH}" x2="${width-right}" y2="${top+chartH}" stroke="#aaa"/>${bars}${empty}</svg>`;
}

function managerProfessionalTable(rows, options = {}) {
  const headerFill = options.headerFill || 'EDE7D8';
  const totalFill = options.totalFill || 'F4F0E7';
  const cell = (value, bold = false, fill = null) => new TableCell({
    shading: fill ? { fill } : undefined,
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: String(value ?? ''), size: 18, bold })] })]
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => new TableRow({ children: row.map(value => cell(value, rowIndex === 0, rowIndex === 0 ? headerFill : (rowIndex === rows.length - 1 && options.total ? totalFill : null))) }))
  });
}

router.post('/api/reports/export/manager/word', reportWorkloadLimit, requirePermission('reports.view'), requireLimitedRole, async (req, res, next) => {
  try {
    assertExportScope(req, req.body);
    const validation = validateManagerSource(req, req.body);
    const sections = trustedManagerSections(req, req.body, validation);
    if (!sections.length) return res.status(400).json({ error: 'Select at least one report section.' });

    const expected = validation.expected || [];
    const scopeName = expected.length === 1 ? expected[0].name : 'All assigned businesses';
    const t = expected.reduce((acc, item) => {
      const s = item.summary || {}, f = item.financials || {};
      acc.sales += n(s.sales); acc.gross += n(s.gross); acc.returns += n(s.returns); acc.transactions += n(s.transactions);
      acc.costOfGoods += n(f.costOfGoods); acc.grossProfit += n(f.grossProfit); acc.expenses += n(f.expenses); acc.payroll += n(f.payroll); acc.netProfit += n(f.netProfit);
      return acc;
    }, { sales: 0, gross: 0, returns: 0, transactions: 0, costOfGoods: 0, grossProfit: 0, expenses: 0, payroll: 0, netProfit: 0 });
    const daily = Array.isArray(req.body?.dailyTrend) ? req.body.dailyTrend : [];
    const sortedDaily = [...daily].sort((a,b) => String(a.day).localeCompare(String(b.day)));
    const highest = [...sortedDaily].sort((a,b) => n(b.sales)-n(a.sales))[0];
    const lowest = [...sortedDaily].filter(item => n(item.sales) > 0).sort((a,b) => n(a.sales)-n(b.sales))[0];
    const avgSale = t.transactions ? t.sales / t.transactions : 0;
    const text = value => String(value ?? '');
    const children = [];
    const heading = (value, level = HeadingLevel.HEADING_1) => new Paragraph({ text: value, heading: level, spacing: { before: 240, after: 120 } });
    const body = (value, options = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, children: [new TextRun({ text: String(value ?? ''), size: options.size || 20, bold: !!options.bold, italics: !!options.italics, color: options.color })] });

    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: text(req.body?.companyName || 'ReportGen').toUpperCase(), bold: true, size: 23, color: 'A87927' })] }));
    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `Financial & Business Performance Report - ${scopeName}`, bold: true, size: 30, color: '142238' })] }));
    children.push(body(text(req.body?.label || 'Selected reporting period'), { size: 22, color: '666666' }));
    children.push(managerProfessionalTable([
      ['Prepared by', text(req.body?.preparedBy || 'Business Manager')],
      ['Reporting scope', scopeName],
      ['Report month', text(validation.month)]
    ]));
    children.push(body(expected.length === 1 ? `This report presents the financial and operating performance of ${scopeName}. Review source records before accounting, tax, or regulatory use.` : 'This report presents the combined financial and operating performance of businesses assigned to this account. Review source records before accounting, tax, or regulatory use.', { size: 18, color: '666666' }));

    for (const section of sections) {
      const tables = htmlTables(section.html);
      if (section.key === 'summary') {
        children.push(heading('Executive Financial Summary'));
        children.push(body('Key financial and operating indicators for the selected reporting month.', { size: 18, color: '666666' }));
        children.push(managerProfessionalTable([
          ['Metric', 'Value'],
          ['Total sales', money(t.sales)], ['Cost of goods', money(t.costOfGoods)], ['Gross profit', money(t.grossProfit)],
          ['Operating expenses', money(t.expenses)], ['Payroll', money(t.payroll)], ['Net profit', money(t.netProfit)],
          ['Gross margin', pct(t.grossProfit, t.sales)], ['Net margin', pct(t.netProfit, t.sales)],
          ['Transactions', n(t.transactions).toLocaleString()], ['Average sale', money(avgSale)], ['Returns', money(t.returns)], ['Return rate', pct(t.returns, t.gross)]
        ]));
        continue;
      }
      if (section.key === 'sales') {
        children.push(heading('Sales Trend'));
        children.push(body('Daily sales activity for the selected reporting month.', { size: 18, color: '666666' }));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: Buffer.from(managerTrendSvg(sortedDaily)), type: 'image/svg+xml', transformation: { width: 620, height: 207 } })] }));
        children.push(managerProfessionalTable([
          ['Indicator', 'Value'],
          ['Highest sales day', highest ? `${highest.day} · ${money(highest.sales)}` : '—'],
          ['Lowest sales day', lowest ? `${lowest.day} · ${money(lowest.sales)}` : '—'],
          ['Sales days', String(sortedDaily.filter(item => n(item.sales) > 0).length)],
          ['Average transaction', money(avgSale)]
        ]));
        continue;
      }
      children.push(heading(section.title));
      if (tables.length) {
        for (const table of tables) {
          if (table.length) children.push(managerProfessionalTable(table, { total: true }));
          children.push(new Paragraph({ text: '', spacing: { after: 80 } }));
        }
      } else {
        let plain = stripHtml(section.html);
        plain = plain.replace(new RegExp(`^${String(section.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim();
        if (plain) children.push(body(plain, { size: 19 }));
      }
    }
    children.push(body('Generated by ReportGen. Review source records before accounting, tax, or regulatory use.', { size: 16, italics: true, color: '777777' }));

    const document = new Document({
      creator: 'ReportGen',
      title: `${req.body?.companyName || 'ReportGen'} - Business Manager Financial Report`,
      styles: { default: { document: { run: { font: 'Aptos', size: 20 }, paragraph: { spacing: { after: 100 } } } } },
      sections: [{ properties: { page: { margin: { top: 720, right: 900, bottom: 720, left: 900 } } }, children }]
    });
    const buffer = await Packer.toBuffer(document);
    res.status(200).set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="ReportGen-${exportSafeFile(req.body?.label)}-Business-Manager.docx"` }).send(buffer);
  } catch (error) { next(error); }
});
module.exports = router;
