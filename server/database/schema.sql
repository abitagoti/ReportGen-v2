-- HISTORICAL DATA SAFETY: payroll child records intentionally use RESTRICT for staff references.
-- Staff must be archived/deactivated, never physically deleted.
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_data_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('administrator','admin','owner','general_manager','accountant','business_manager','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, username)
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'business',
  currency TEXT NOT NULL DEFAULT 'NGN',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS user_business_access (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, business_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  details_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_businesses_company ON businesses(company_id);
CREATE INDEX IF NOT EXISTS idx_access_user ON user_business_access(user_id);
CREATE INDEX IF NOT EXISTS idx_access_business ON user_business_access(business_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_logs(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_action ON audit_logs(company_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_user_time ON audit_logs(company_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_business_time ON audit_logs(company_id, business_id, created_at);
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END;

CREATE TABLE IF NOT EXISTS import_templates (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE, name TEXT NOT NULL, source_format TEXT NOT NULL, mapping_json TEXT NOT NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,business_id,name)
);
CREATE TABLE IF NOT EXISTS sales_imports (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, file_name TEXT NOT NULL, file_type TEXT NOT NULL, template_id TEXT REFERENCES import_templates(id) ON DELETE SET NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0, rejected_rows INTEGER NOT NULL DEFAULT 0, transaction_count INTEGER NOT NULL DEFAULT 0, sales_total REAL NOT NULL DEFAULT 0, gross_total REAL NOT NULL DEFAULT 0, returns_total REAL NOT NULL DEFAULT 0, profit_total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('processing','completed','completed_with_warnings','failed','replaced')), warning_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS sales_transactions (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, import_id TEXT NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE, transaction_id TEXT, transaction_date TEXT NOT NULL, product_id TEXT, product_name TEXT, category TEXT, quantity REAL, sales_amount REAL NOT NULL, gross_amount REAL, returns_amount REAL, cost_amount REAL, profit_amount REAL, salesperson TEXT, source_file TEXT NOT NULL, source_sheet TEXT, source_row INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_import_business_period ON sales_imports(business_id,period_start,period_end);
-- Date-leading indexes keep company-wide and business-history queries bounded as transaction volume grows.
CREATE INDEX IF NOT EXISTS idx_sales_tx_company_date_business ON sales_transactions(company_id,transaction_date,business_id);
CREATE INDEX IF NOT EXISTS idx_sales_imports_company_created ON sales_imports(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_tx_business_date ON sales_transactions(business_id,transaction_date);
CREATE INDEX IF NOT EXISTS idx_sales_tx_import ON sales_transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_sales_tx_product ON sales_transactions(business_id,product_name);
CREATE TABLE IF NOT EXISTS sales_import_issues (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE,
  source_row INTEGER,
  severity TEXT NOT NULL CHECK(severity IN ('warning','error','info')),
  code TEXT NOT NULL,
  field TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_import_issues_import ON sales_import_issues(import_id, severity, source_row);

CREATE TABLE IF NOT EXISTS accountant_expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accountant_expenses_business_date ON accountant_expenses(business_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_accountant_expenses_company_date_business ON accountant_expenses(company_id,expense_date,business_id);

CREATE TABLE IF NOT EXISTS accountant_expense_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_accountant_expense_templates_company ON accountant_expense_templates(company_id, is_active);

CREATE TABLE IF NOT EXISTS accountant_remittances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  remittance_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accountant_remittances_business_date ON accountant_remittances(business_id, remittance_date);

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  disclaimer_version TEXT NOT NULL,
  acceptable_use_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_legal_company ON legal_acceptances(company_id, accepted_at);

CREATE TABLE IF NOT EXISTS capital_contributions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  entry_mode TEXT NOT NULL DEFAULT 'individual' CHECK(entry_mode IN ('individual','monthly_total')),
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capital_company_period ON capital_contributions(company_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_capital_business_period ON capital_contributions(business_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS dashboard_owner_adjustments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  percent REAL NOT NULL DEFAULT 0 CHECK(percent >= 0 AND percent <= 100),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
  UNIQUE(company_id,business_id,month)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_owner_adjustment_company_month ON dashboard_owner_adjustments(company_id,month,business_id);

CREATE TABLE IF NOT EXISTS dashboard_owner_defaults (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  percent REAL NOT NULL DEFAULT 0 CHECK(percent >= 0 AND percent <= 100),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,month)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_owner_default_company_month ON dashboard_owner_defaults(company_id,month);

CREATE TABLE IF NOT EXISTS vendor_payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_company_date ON vendor_payments(company_id,payment_date);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_business_date ON vendor_payments(business_id,payment_date);


CREATE TABLE IF NOT EXISTS internal_messages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','archived')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  deleted_by_sender_at TEXT,
  deleted_by_recipient_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON internal_messages(company_id, recipient_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_business ON internal_messages(company_id, business_id, created_at);
CREATE TABLE IF NOT EXISTS payroll_monthly_totals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payroll_month TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  calculation_mode TEXT NOT NULL DEFAULT 'manual' CHECK(calculation_mode IN ('manual','employees')),
  status TEXT NOT NULL DEFAULT 'saved' CHECK(status IN ('draft','saved')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid')),
  paid_at TEXT,
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,business_id,payroll_month)
);
CREATE INDEX IF NOT EXISTS idx_payroll_monthly_company_period ON payroll_monthly_totals(company_id,payroll_month);
CREATE INDEX IF NOT EXISTS idx_payroll_monthly_business_period ON payroll_monthly_totals(business_id,payroll_month);
CREATE TABLE IF NOT EXISTS payroll_payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_id TEXT NOT NULL REFERENCES payroll_monthly_totals(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK(amount > 0),
  payment_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','voided')),
  voided_at TEXT,
  voided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_company_payroll ON payroll_payments(company_id,payroll_id,payment_date);


CREATE TABLE IF NOT EXISTS organization_departments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,name)
);
CREATE INDEX IF NOT EXISTS idx_org_departments_company ON organization_departments(company_id,is_active);

CREATE TABLE IF NOT EXISTS organization_job_roles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department_id TEXT REFERENCES organization_departments(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,name)
);
CREATE INDEX IF NOT EXISTS idx_org_job_roles_company ON organization_job_roles(company_id,is_active);

CREATE TABLE IF NOT EXISTS payroll_employees (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_code TEXT,
  employee_name TEXT NOT NULL,
  role_title TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,business_id,employee_name)
);
CREATE INDEX IF NOT EXISTS idx_payroll_employees_business ON payroll_employees(business_id,is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_employees_code ON payroll_employees(company_id, employee_code) WHERE employee_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS payroll_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  payroll_month TEXT NOT NULL,
  gross_amount REAL NOT NULL CHECK(gross_amount >= 0),
  deductions REAL NOT NULL DEFAULT 0 CHECK(deductions >= 0),
  net_amount REAL NOT NULL CHECK(net_amount >= 0),
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(employee_id,payroll_month)
);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_business_period ON payroll_entries(business_id,payroll_month);


CREATE TABLE IF NOT EXISTS payroll_staff_loans (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  principal_amount REAL NOT NULL CHECK(principal_amount >= 0),
  monthly_amount REAL NOT NULL CHECK(monthly_amount >= 0),
  start_month TEXT NOT NULL, end_month TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
  note TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payroll_loan_skips (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL REFERENCES payroll_staff_loans(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  skip_month TEXT NOT NULL,
  reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(loan_id,skip_month)
);
CREATE INDEX IF NOT EXISTS idx_loan_skips_loan_month ON payroll_loan_skips(loan_id,skip_month);
CREATE INDEX IF NOT EXISTS idx_loan_skips_staff_month ON payroll_loan_skips(staff_id,skip_month);
CREATE TABLE IF NOT EXISTS payroll_manual_staff_adjustments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  payroll_month TEXT NOT NULL,
  deduction_applied INTEGER NOT NULL DEFAULT 0 CHECK(deduction_applied IN (0,1)),
  loan_applied INTEGER NOT NULL DEFAULT 0 CHECK(loan_applied IN (0,1)),
  gross_amount REAL NOT NULL DEFAULT 0 CHECK(gross_amount >= 0),
  deduction_amount REAL NOT NULL DEFAULT 0 CHECK(deduction_amount >= 0),
  loan_repayment_amount REAL NOT NULL DEFAULT 0 CHECK(loan_repayment_amount >= 0),
  net_amount REAL NOT NULL DEFAULT 0 CHECK(net_amount >= 0),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,business_id,staff_id,payroll_month)
);
CREATE INDEX IF NOT EXISTS idx_manual_staff_adjustments_period ON payroll_manual_staff_adjustments(company_id,business_id,payroll_month);
CREATE INDEX IF NOT EXISTS idx_staff_loans_staff ON payroll_staff_loans(staff_id,status);
CREATE TABLE IF NOT EXISTS payroll_loan_repayments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL REFERENCES payroll_staff_loans(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payroll_month TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','voided')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(loan_id,payroll_month)
);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_staff ON payroll_loan_repayments(staff_id,payroll_month);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_business ON payroll_loan_repayments(business_id,payroll_month);
CREATE TABLE IF NOT EXISTS payroll_staff_deductions (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK(amount >= 0), category TEXT NOT NULL, start_month TEXT NOT NULL, end_month TEXT,
  note TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_deductions_staff ON payroll_staff_deductions(staff_id,start_month,end_month);

CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, role, permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_company_role ON role_permissions(company_id, role);
