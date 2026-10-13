import sqlite3
from pathlib import Path

DB = Path('/mnt/data/stage10a-rollback-test.sqlite')
if DB.exists(): DB.unlink()

con = sqlite3.connect(DB)
con.executescript('''
CREATE TABLE companies(id TEXT PRIMARY KEY);
CREATE TABLE businesses(id TEXT PRIMARY KEY, company_id TEXT NOT NULL);
CREATE TABLE users(id TEXT PRIMARY KEY, company_id TEXT NOT NULL);
CREATE TABLE audit_logs(
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, user_id TEXT,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  business_id TEXT, details_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE accountant_expenses(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, business_id TEXT NOT NULL, amount REAL NOT NULL);
CREATE TABLE accountant_remittances(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, business_id TEXT NOT NULL, amount REAL NOT NULL);
CREATE TABLE capital_contributions(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, business_id TEXT, amount REAL NOT NULL);
CREATE TABLE vendor_payments(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, business_id TEXT, amount REAL NOT NULL);
CREATE TABLE payroll_monthly_totals(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, business_id TEXT NOT NULL, amount REAL NOT NULL);
''')
con.execute("INSERT INTO companies VALUES ('c1')")
con.execute("INSERT INTO businesses VALUES ('b1','c1')")
con.execute("INSERT INTO users VALUES ('u1','c1')")
con.commit()

# Verify the exact invariant Stage 10A is enforcing:
# mutation + audit either both commit or both disappear on failure.
operations = [
    ('accountant_expenses','expense','accountant.expense.created'),
    ('accountant_remittances','remittance','accountant.remittance.created'),
    ('capital_contributions','capital','capital.created'),
    ('vendor_payments','vendor','vendor_payment.created'),
    ('payroll_monthly_totals','payroll','payroll.monthly_total.created'),
]

for table, key, action in operations:
    con.execute('BEGIN')
    con.execute(f"INSERT INTO {table}(id,company_id,business_id,amount) VALUES(?,?,?,?)", (f'{key}-fail','c1','b1',100))
    con.execute("INSERT INTO audit_logs(id,company_id,user_id,action,entity_type,entity_id,business_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (f'audit-{key}-fail','c1','u1',action,key,f'{key}-fail','b1','{}','2026-10-03T00:00:00Z'))
    con.rollback()
    assert con.execute(f"SELECT COUNT(*) FROM {table} WHERE id=?", (f'{key}-fail',)).fetchone()[0] == 0, f'{key}: mutation survived rollback'
    assert con.execute("SELECT COUNT(*) FROM audit_logs WHERE id=?", (f'audit-{key}-fail',)).fetchone()[0] == 0, f'{key}: audit survived rollback'

# Also verify successful commit persists both sides.
con.execute('BEGIN')
con.execute("INSERT INTO accountant_expenses(id,company_id,business_id,amount) VALUES('expense-ok','c1','b1',250)")
con.execute("INSERT INTO audit_logs(id,company_id,user_id,action,entity_type,entity_id,business_id,details_json,created_at) VALUES('audit-expense-ok','c1','u1','accountant.expense.created','accountant_expense','expense-ok','b1','{}','2026-10-03T00:00:00Z')")
con.commit()
assert con.execute("SELECT COUNT(*) FROM accountant_expenses WHERE id='expense-ok'").fetchone()[0] == 1
assert con.execute("SELECT COUNT(*) FROM audit_logs WHERE id='audit-expense-ok'").fetchone()[0] == 1

con.close()
DB.unlink()
print('STAGE10A_RUNTIME_ROLLBACK_TEST_PASS')
