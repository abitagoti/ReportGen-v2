const express = require('express');
const { db } = require('../database/database');
const { requireAuth } = require('../auth/middleware');
const { hasPermission } = require('../permissions');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { audit } = require('../audit/auditService');
const { requireIdempotency } = require('../security/idempotency');
const router = express.Router();
// Payment ledger (payroll_payments) is created and migrated in database/schema.sql + database.js.
// All payroll money maths goes through these helpers so every screen and route agrees.
const r2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const MONEY_TOLERANCE = 0.005;
function expectedPayrollAmount(companyId, payroll){
  // Net payable for the month: employee entries (net) or the manual staff selections (net), else the manual total.
  if (payroll.calculationMode === 'employees') {
    return r2(db.prepare('SELECT COALESCE(SUM(net_amount),0) AS amount FROM payroll_entries WHERE company_id=? AND business_id=? AND payroll_month=?').get(companyId, payroll.businessId, payroll.payrollMonth).amount);
  }
  const x = db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(net_amount),0) AS net FROM payroll_manual_staff_adjustments WHERE company_id=? AND business_id=? AND payroll_month=?').get(companyId, payroll.businessId, payroll.payrollMonth);
  return r2(Number(x.n) > 0 ? x.net : payroll.amount);
}
function paidPayrollAmount(companyId, payrollId){
  return r2(db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM payroll_payments WHERE company_id=? AND payroll_id=? AND status='posted'").get(companyId, payrollId).amount);
}
function payrollForPayments(companyId, payrollId){
  return db.prepare('SELECT id,business_id AS businessId,payroll_month AS payrollMonth,amount,calculation_mode AS calculationMode,status,payment_status AS paymentStatus FROM payroll_monthly_totals WHERE id=? AND company_id=?').get(payrollId, companyId);
}
function markPaid(companyId, payrollId, stamp){
  db.prepare("UPDATE payroll_monthly_totals SET payment_status='paid',paid_at=?,updated_at=? WHERE id=? AND company_id=?").run(stamp, stamp, payrollId, companyId);
}
// Call inside the transaction of any edit that can change the payable amount. Recorded payments
// may never exceed the new total (the edit is rolled back); an exact settlement locks the payroll.
function reconcilePayrollPayments(companyId, payrollId, stamp){
  const payroll = payrollForPayments(companyId, payrollId);
  if (!payroll) return;
  const paid = paidPayrollAmount(companyId, payrollId);
  if (paid <= 0) return;
  const expected = expectedPayrollAmount(companyId, payroll);
  if (paid > expected + MONEY_TOLERANCE) throw new Error(`This change would make the payroll total (${expected.toFixed(2)}) lower than the payments already recorded (${paid.toFixed(2)}). Void the excess payment first.`);
  if (expected > 0 && paid >= expected - MONEY_TOLERANCE && payroll.paymentStatus !== 'paid') markPaid(companyId, payrollId, stamp);
}

const managementRoles = ['owner','general_manager','administrator','admin'];
const accountantRole = 'accountant';
const roleOf = req => String(req.user.role || '').toLowerCase();
const isManagement = req => managementRoles.includes(roleOf(req));
const isAccountant = req => roleOf(req) === accountantRole;
// Roles other than management and the Accountant (Business Manager, Viewer) get the limited payroll view:
// payroll totals and a staff directory without salaries. What they can open is decided by the permission toggles.
// Whether the caller may see salaries / per-employee pay is decided by the payroll.salaries permission, not the role name.
const canSalaries = req => hasPermission(req,'payroll.salaries');
const isLimited = req => !canSalaries(req);
function assignedBusinessIds(req){
  if (isManagement(req)) return db.prepare('SELECT id FROM businesses WHERE company_id=? AND is_active=1').all(req.user.company_id).map(x=>x.id);
  return db.prepare('SELECT b.id FROM businesses b JOIN user_business_access a ON a.business_id=b.id WHERE b.company_id=? AND b.is_active=1 AND a.user_id=?').all(req.user.company_id,req.user.user_id).map(x=>x.id);
}
function canUseBusiness(req,businessId){ return assignedBusinessIds(req).includes(String(businessId)); }
function validMonth(v){ return /^\d{4}-\d{2}$/.test(String(v||'')) ? String(v) : new Date().toISOString().slice(0,7); }
function shiftMonth(month, delta){ const [y,m]=String(month).split('-').map(Number); const d=new Date(Date.UTC(y,m-1+delta,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; }
function validMonthStrict(v){ return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(String(v||'')); }
function requireAccess(req,res){ if(!hasPermission(req,'payroll.view')) {res.status(403).json({error:'You do not have access to payroll.'});return false;} return true; }
function requireAnyPerm(req,res,permissions){ if(!permissions.some(p=>hasPermission(req,p))){res.status(403).json({error:'You do not have permission for this action.'});return false;} return true; }
function requirePerm(req,res,permission){ if(!hasPermission(req,permission)){res.status(403).json({error:'You do not have permission for this action.'});return false;} return true; }
function loanBalance(loan){
  const repaid = Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payroll_loan_repayments WHERE loan_id=? AND status='posted'").get(loan.id)?.total || 0);
  return Math.max(0, Number(loan.principalAmount || loan.principal_amount || 0) - repaid);
}
function activeLoansForMonth(companyId, staffId, month){
  return db.prepare(`SELECT l.id,l.principal_amount AS principalAmount,l.monthly_amount AS monthlyAmount,l.start_month AS startMonth,l.end_month AS endMonth
    FROM payroll_staff_loans l
    WHERE l.company_id=? AND l.staff_id=? AND l.status='active' AND l.start_month<=? AND (l.end_month IS NULL OR l.end_month>=?)
      AND NOT EXISTS (SELECT 1 FROM payroll_loan_skips s WHERE s.loan_id=l.id AND s.skip_month=?)
    ORDER BY l.created_at,l.id`).all(companyId,staffId,month,month,month);
}
function scheduledLoanRepayment(companyId, staffId, month){
  return activeLoansForMonth(companyId,staffId,month).reduce((sum,loan)=>sum+Math.min(Number(loan.monthlyAmount||0),loanBalance(loan)),0);
}
function staffColumns(){ return 'id,company_id AS companyId,business_id AS businessId,employee_code AS employeeCode,employee_name AS employeeName,role_title AS roleTitle,department,user_id AS userId,base_salary AS baseSalary,status,status_reason AS statusReason,archive_date AS archiveDate,return_date AS returnDate,is_active AS isActive'; }
const STAFF_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;
function nextGeneratedCode(companyId){
  const company=db.prepare('SELECT COALESCE(NULLIF(staff_id_prefix,\'\'),\'STF\') AS staffIdPrefix FROM companies WHERE id=?').get(companyId);
  const prefix=String(company?.staffIdPrefix||'STF').toUpperCase();
  const existingCodes=db.prepare('SELECT employee_code AS employeeCode FROM payroll_employees WHERE company_id=? AND employee_code LIKE ?').all(companyId,`${prefix}-%`);
  const nextNumber=existingCodes.reduce((max,row)=>{const m=String(row.employeeCode||'').match(new RegExp(`^${prefix}-(\\d+)$`));return m?Math.max(max,Number(m[1])):max;},0)+1;
  return `${prefix}-${String(nextNumber).padStart(4,'0')}`;
}
// Server-side backstop for Staff ID integrity: any code the client supplies (on
// update, or inline-create from a payroll entry) must match the same format the
// generator produces and be unique within the company. If none is supplied, one
// is generated exactly the way staff creation always has. Never trust a raw
// employeeCode from the request body without running it through this.
function resolveEmployeeCode(companyId, requestedCode, excludeStaffId){
  const trimmed = String(requestedCode||'').trim().toUpperCase();
  if(!trimmed) return { code: nextGeneratedCode(companyId), error: null };
  if(!STAFF_CODE_RE.test(trimmed)) return { code:null, error:'Staff ID must be 2-12 characters (letters, numbers, dashes), starting with a letter or number.' };
  const clash = db.prepare('SELECT id FROM payroll_employees WHERE company_id=? AND upper(employee_code)=? AND id!=?').get(companyId, trimmed, excludeStaffId||'');
  if(clash) return { code:null, error:'That Staff ID is already in use.' };
  return { code: trimmed, error: null };
}

router.get('/api/payroll/monthly', requireAuth, (req,res)=>{
  if(!requireAccess(req,res)) return; const month=validMonth(req.query.month), ids=assignedBusinessIds(req);
  if(!ids.length) return res.json({month,businesses:[]}); const ph=ids.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT b.id AS businessId,b.name AS businessName,
    (SELECT p.id FROM payroll_monthly_totals p WHERE p.business_id=b.id AND p.company_id=? AND p.payroll_month=?) AS payrollId,
    COALESCE((SELECT p.status FROM payroll_monthly_totals p WHERE p.business_id=b.id AND p.company_id=? AND p.payroll_month=?),'none') AS payrollStatus,
    COALESCE((SELECT p.payment_status FROM payroll_monthly_totals p WHERE p.business_id=b.id AND p.company_id=? AND p.payroll_month=?),'unpaid') AS paymentStatus,
    COALESCE((SELECT p.amount FROM payroll_monthly_totals p WHERE p.business_id=b.id AND p.company_id=? AND p.payroll_month=?),0) AS manualAmount,
    COALESCE((SELECT SUM(pp.amount) FROM payroll_payments pp JOIN payroll_monthly_totals pt ON pt.id=pp.payroll_id WHERE pp.company_id=? AND pp.status='posted' AND pt.business_id=b.id AND pt.payroll_month=?),0) AS amountPaid,
    COALESCE((SELECT SUM(e.gross_amount) FROM payroll_entries e WHERE e.business_id=b.id AND e.company_id=? AND e.payroll_month=?),0) AS employeeGrossTotal,
    COALESCE((SELECT SUM(e.deductions) FROM payroll_entries e WHERE e.business_id=b.id AND e.company_id=? AND e.payroll_month=?),0) AS employeeDeductionsTotal,
    COALESCE((SELECT SUM(e.net_amount) FROM payroll_entries e WHERE e.business_id=b.id AND e.company_id=? AND e.payroll_month=?),0) AS employeeNetTotal,
    COALESCE((SELECT SUM(a.net_amount) FROM payroll_manual_staff_adjustments a WHERE a.business_id=b.id AND a.company_id=? AND a.payroll_month=?),0) AS manualNetTotal,
    COALESCE((SELECT p.calculation_mode FROM payroll_monthly_totals p WHERE p.business_id=b.id AND p.company_id=? AND p.payroll_month=?),'manual') AS calculationMode,
    (SELECT COUNT(e.id) FROM payroll_entries e WHERE e.business_id=b.id AND e.company_id=? AND e.payroll_month=?) AS employeeCount
    FROM businesses b WHERE b.company_id=? AND b.id IN (${ph}) ORDER BY b.name`).all(req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,month,req.user.company_id,...ids)
    .map(r=>{
      const has=Boolean(r.payrollId);
      const total=!has?0:r2(r.calculationMode==='employees'?r.employeeNetTotal:(Number(r.manualNetTotal||0)>0?r.manualNetTotal:r.manualAmount));
      const paid=r2(r.amountPaid);
      return {...r,payrollTotal:total,amountPaid:paid,outstanding:r2(Math.max(0,total-paid)),overpayment:r2(Math.max(0,paid-total))};
    });
  const businesses=isLimited(req)
    ? rows.map(r=>({businessId:r.businessId,businessName:r.businessName,payrollStatus:r.payrollStatus,payrollTotal:r.payrollTotal}))
    : rows;
  res.json({month,businesses});
});

router.get('/api/payroll/entries', requireAuth, (req,res)=>{
  if(!requireAccess(req,res)) return;
  if(!canSalaries(req))return res.status(403).json({error:'You can view payroll totals only. Per-employee pay needs the View salaries permission.'});
  const businessId=String(req.query.businessId||''),month=validMonth(req.query.month);
  if(!businessId||!canUseBusiness(req,businessId)) return res.status(403).json({error:'You are not assigned to this business.'});
  const employees=db.prepare(`SELECT ${staffColumns()} FROM payroll_employees WHERE company_id=? AND business_id=? ORDER BY employee_name`).all(req.user.company_id,businessId);
  const entries=db.prepare(`SELECT e.id,e.employee_id AS employeeId,e.payroll_month AS payrollMonth,e.gross_amount AS grossAmount,e.deductions,e.deduction_amount AS deductionAmount,e.loan_repayment_amount AS loanRepaymentAmount,e.net_amount AS netAmount,e.note FROM payroll_entries e WHERE e.company_id=? AND e.business_id=? AND e.payroll_month=? ORDER BY e.created_at DESC`).all(req.user.company_id,businessId,month);
  const total=db.prepare(`SELECT amount,calculation_mode AS calculationMode,status,payment_status AS paymentStatus,paid_at AS paidAt,note FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month=?`).get(req.user.company_id,businessId,month)||{amount:0,calculationMode:'manual',note:null};
  if(total.calculationMode==='manual'){
    const manual=db.prepare(`SELECT a.id,a.staff_id AS employeeId,a.payroll_month AS payrollMonth,a.gross_amount AS grossAmount,a.deduction_amount AS deductionAmount,a.loan_repayment_amount AS loanRepaymentAmount,(a.deduction_amount+a.loan_repayment_amount) AS deductions,a.net_amount AS netAmount FROM payroll_manual_staff_adjustments a WHERE a.company_id=? AND a.business_id=? AND a.payroll_month=? ORDER BY a.created_at`).all(req.user.company_id,businessId,month);
    res.json({month,businessId,employees,entries:manual,monthlyTotal:total});
    return;
  }
  res.json({month,businessId,employees,entries,monthlyTotal:total});
});

router.get('/api/payroll/staff', requireAuth, (req,res)=>{
  if(!requireAnyPerm(req,res,['staff.view','payroll.view','payroll.deductions','payroll.create','payroll.edit'])) return; const ids=assignedBusinessIds(req),ph=ids.map(()=>'?').join(',');
  if(!ids.length)return res.json({staff:[]});
  const staff=db.prepare(`SELECT e.id,e.company_id AS companyId,e.business_id AS businessId,e.employee_code AS employeeCode,e.employee_name AS employeeName,e.role_title AS roleTitle,e.department,e.user_id AS userId,${isLimited(req)?'NULL':'e.base_salary'} AS baseSalary,e.status,e.status_reason AS statusReason,e.archive_date AS archiveDate,e.return_date AS returnDate,e.is_active AS isActive,b.name AS businessName FROM payroll_employees e JOIN businesses b ON b.id=e.business_id WHERE e.company_id=? AND e.business_id IN (${ph}) ORDER BY e.employee_name`).all(req.user.company_id,...ids);
  res.json({staff});
});

router.post('/api/payroll/staff', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'staff.manage'))return; const {businessId,employeeName,roleTitle,department,baseSalary,roleId,departmentId,linkedUserId}=req.body||{};
  if(!businessId||!canUseBusiness(req,businessId)||!String(employeeName||'').trim())return res.status(400).json({error:'Business and staff name are required.'});
  if(departmentId && !db.prepare('SELECT id FROM organization_departments WHERE id=? AND company_id=? AND is_active=1').get(departmentId,req.user.company_id))return res.status(400).json({error:'Selected department is invalid.'});
  if(roleId && !db.prepare('SELECT id FROM organization_job_roles WHERE id=? AND company_id=? AND is_active=1').get(roleId,req.user.company_id))return res.status(400).json({error:'Selected job role is invalid.'});
  const selectedDepartment = departmentId ? db.prepare('SELECT id,name FROM organization_departments WHERE id=? AND company_id=? AND is_active=1').get(departmentId,req.user.company_id) : null;
  const selectedRole = roleId ? db.prepare('SELECT id,name,department_id AS departmentId FROM organization_job_roles WHERE id=? AND company_id=? AND is_active=1').get(roleId,req.user.company_id) : null;
  let linkedUser = null;
  if (linkedUserId) { linkedUser = db.prepare('SELECT id FROM users WHERE id=? AND company_id=? AND is_active=1').get(String(linkedUserId), req.user.company_id); if (!linkedUser) return res.status(400).json({error:'Selected user account is invalid or inactive.'}); }
  if (linkedUser && db.prepare('SELECT id FROM payroll_employees WHERE user_id=? AND company_id=?').get(linkedUser.id, req.user.company_id)) return res.status(409).json({error:'That user account is already linked to a staff record.'});
  const stamp=nowIso();
  const staffId=id('emp');
  const generatedCode=nextGeneratedCode(req.user.company_id);
  db.prepare(`INSERT INTO payroll_employees(id,company_id,business_id,employee_code,employee_name,role_title,department,user_id,base_salary,status,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(staffId,req.user.company_id,businessId,generatedCode,String(employeeName).trim(),selectedRole?.name||roleTitle||null,selectedDepartment?.name||department||null,linkedUser?.id||null,canSalaries(req)?Number(baseSalary||0):0,'active',1,req.user.user_id,stamp,stamp);
  audit(req,{action:'staff.created',entityType:'staff',entityId:staffId,businessId,details:{employeeName:String(employeeName).trim(),employeeCode:generatedCode,roleTitle:selectedRole?.name||roleTitle||null,department:selectedDepartment?.name||department||null,linkedUserId:linkedUser?.id||null,salaryVisible:canSalaries(req),baseSalary:canSalaries(req)?Number(baseSalary||0):null}});
  res.status(201).json({id:staffId,employeeCode:generatedCode,message:'Staff record created.'});
});

router.patch('/api/payroll/staff/:id', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'staff.manage'))return; const {employeeName,employeeCode,roleTitle,department,baseSalary,businessId,linkedUserId}=req.body||{};
  if(!String(employeeName||'').trim()||!businessId||!canUseBusiness(req,businessId)||(canSalaries(req)&&(!Number.isFinite(Number(baseSalary))||Number(baseSalary)<0)))return res.status(400).json({error:'Name, business and valid base salary are required.'});
  const existingCode = db.prepare('SELECT employee_code AS employeeCode,business_id AS businessId FROM payroll_employees WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!existingCode)return res.status(404).json({error:'Staff record not found.'});
  if(!canUseBusiness(req,existingCode.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  let linkedUser = null;
  if (linkedUserId) { linkedUser = db.prepare('SELECT id FROM users WHERE id=? AND company_id=? AND is_active=1').get(String(linkedUserId), req.user.company_id); if (!linkedUser) return res.status(400).json({error:'Selected user account is invalid or inactive.'}); }
  const requestedCode = employeeCode===undefined ? existingCode.employeeCode : employeeCode;
  const resolvedCode = resolveEmployeeCode(req.user.company_id, requestedCode, req.params.id);
  if(resolvedCode.error) return res.status(400).json({error:resolvedCode.error});
  const result=db.prepare('UPDATE payroll_employees SET business_id=?,employee_name=?,employee_code=?,role_title=?,department=?,user_id=?,base_salary=COALESCE(?,base_salary),updated_at=? WHERE id=? AND company_id=?').run(businessId,String(employeeName).trim(),resolvedCode.code,roleTitle||null,department||null,linkedUser?.id||null,canSalaries(req)?Number(baseSalary):null,nowIso(),req.params.id,req.user.company_id);
  if(!result.changes)return res.status(404).json({error:'Staff record not found.'});
  audit(req,{action:'staff.updated',entityType:'staff',entityId:req.params.id,businessId,details:{employeeName:String(employeeName).trim(),employeeCode:resolvedCode.code,roleTitle:roleTitle||null,department:department||null,linkedUserId:linkedUser?.id||null,salaryVisible:canSalaries(req),baseSalary:canSalaries(req)?Number(baseSalary):null}});
  res.json({message:'Staff record updated.'});
});

router.post('/api/payroll/staff/salary-increase', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'staff.manage')||!requirePerm(req,res,'payroll.salaries'))return;
  const staffIds=Array.isArray(req.body?.staffIds)?[...new Set(req.body.staffIds.map(x=>String(x)).filter(Boolean))]:[];
  const amount=Number(req.body?.amount);
  if(!staffIds.length||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Select at least one staff member and enter a valid positive increase amount.'});
  const placeholders=staffIds.map(()=>'?').join(',');
  const ids=assignedBusinessIds(req);
  if(!ids.length)return res.status(403).json({error:'You are not assigned to any business.'});
  const businessPlaceholders=ids.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT id,employee_name AS employeeName,base_salary AS baseSalary,business_id AS businessId FROM payroll_employees WHERE company_id=? AND business_id IN (${businessPlaceholders}) AND id IN (${placeholders})`).all(req.user.company_id,...ids,...staffIds);
  if(rows.length!==staffIds.length)return res.status(404).json({error:'One or more selected staff records could not be found.'});
  const stamp=nowIso();
  const tx=db.transaction(()=>{
    const update=db.prepare('UPDATE payroll_employees SET base_salary=base_salary+?,updated_at=? WHERE id=? AND company_id=?');
    rows.forEach(row=>{
      update.run(amount,stamp,row.id,req.user.company_id);
      audit(req,{action:'staff.salary_increased',entityType:'staff',entityId:row.id,businessId:row.businessId,details:{employeeName:row.employeeName,previousSalary:Number(row.baseSalary||0),increaseAmount:amount,newSalary:Number(row.baseSalary||0)+amount}});
    });
  });
  tx();
  res.json({message:'Salary increases applied.',count:rows.length,amount});
});

router.delete('/api/payroll/staff/:id', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'staff.manage'))return;
  const staff=db.prepare('SELECT id,business_id AS businessId,employee_name AS employeeName FROM payroll_employees WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!staff)return res.status(404).json({error:'Staff record not found.'});
  if(!canUseBusiness(req,staff.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  const stamp=nowIso();
  db.prepare("UPDATE payroll_employees SET status='terminated',status_reason=?,archive_date=COALESCE(archive_date,?),is_active=0,updated_at=? WHERE id=? AND company_id=?").run('Archived/deleted from active staff management',stamp.slice(0,10),stamp,req.params.id,req.user.company_id);
  audit(req,{action:'staff.archived',entityType:'staff',entityId:req.params.id,businessId:staff.businessId,details:{historyPreserved:true}});
  res.json({message:'Staff removed from active staff management. Historical records were preserved.'});
});

router.patch('/api/payroll/staff/:id/status', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'staff.manage'))return;
  const existingStaff=db.prepare('SELECT id,business_id AS businessId FROM payroll_employees WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!existingStaff)return res.status(404).json({error:'Staff record not found.'});
  if(!canUseBusiness(req,existingStaff.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  const {status,statusReason,returnDate}=req.body||{};
  if(!['active','temporarily_archived','terminated'].includes(status))return res.status(400).json({error:'Invalid staff status.'});
  const stamp=nowIso(); const result=db.prepare('UPDATE payroll_employees SET status=?,status_reason=?,archive_date=?,return_date=?,is_active=?,updated_at=? WHERE id=? AND company_id=?').run(status,statusReason||null,status==='temporarily_archived'?stamp.slice(0,10):null,returnDate||null,status==='active'?1:0,stamp,req.params.id,req.user.company_id);
  if(!result.changes)return res.status(404).json({error:'Staff record not found.'});
  audit(req,{action:'staff.status.updated',entityType:'staff',entityId:req.params.id,businessId:existingStaff.businessId,details:{status,statusReason:statusReason||null,returnDate:returnDate||null}});
  res.json({message:'Staff status updated.'});
});

router.post('/api/payroll/monthly-total', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.create'))return;
  const {businessId,payrollMonth,amount,note,staffAdjustments=[]}=req.body||{};
  if(!businessId||!canUseBusiness(req,businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(!validMonthStrict(payrollMonth))return res.status(400).json({error:'A valid payroll month is required.'});
  const numericAmount=Number(amount);if(!Number.isFinite(numericAmount)||numericAmount<0)return res.status(400).json({error:'Payroll amount must be zero or greater.'});
  if(!Array.isArray(staffAdjustments))return res.status(400).json({error:'Staff payroll selections must be an array.'});
  const staffRows=db.prepare('SELECT id FROM payroll_employees WHERE company_id=? AND business_id=? AND status=\'active\' AND is_active=1').all(req.user.company_id,businessId);
  const allowedStaff=new Set(staffRows.map(x=>String(x.id)));
  let staffGrossTotal=0;
  for(const item of staffAdjustments){
    if(!allowedStaff.has(String(item.staffId)))return res.status(400).json({error:'One or more selected staff members are invalid for this business.'});
    const gross=Number(item.grossAmount||0), deduction=Number(item.deductionAmount||0), loan=Number(item.loanRepaymentAmount||0);
    if(!Number.isFinite(gross)||gross<0||!Number.isFinite(deduction)||deduction<0||!Number.isFinite(loan)||loan<0)return res.status(400).json({error:'Each staff payroll amount must be a valid non-negative number.'});
    if(deduction+loan>gross)return res.status(400).json({error:'Staff deductions and loan repayment cannot exceed gross pay.'});
    staffGrossTotal+=gross;
  }
  if(staffAdjustments.length && Math.abs(staffGrossTotal-numericAmount)>0.005)return res.status(400).json({error:'The sum of staff gross amounts must equal the monthly payroll total.'});
  const existing=db.prepare('SELECT id,calculation_mode AS calculationMode,payment_status AS paymentStatus FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month=?').get(req.user.company_id,businessId,payrollMonth);
  if(existing && existing.paymentStatus==='paid') return res.status(409).json({error:'Paid payroll is locked.'});
  if(existing && !hasPermission(req,'payroll.edit')) return res.status(403).json({error:'You do not have permission to edit existing payroll records.'});
  if(existing && existing.calculationMode==='employees')return res.status(409).json({error:'Employee-level payroll is locked for this month.'});
  const stamp=nowIso(),pid=existing?.id||id('pay');
  const tx=db.transaction(()=>{
    if(existing) db.prepare('UPDATE payroll_monthly_totals SET amount=?,calculation_mode=\'manual\',note=?,updated_at=? WHERE id=?').run(numericAmount,note?String(note).trim():null,stamp,pid);
    else db.prepare('INSERT INTO payroll_monthly_totals(id,company_id,business_id,payroll_month,amount,calculation_mode,status,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(pid,req.user.company_id,businessId,payrollMonth,numericAmount,'manual','saved',note||null,req.user.user_id,stamp,stamp);
    db.prepare('DELETE FROM payroll_manual_staff_adjustments WHERE company_id=? AND business_id=? AND payroll_month=?').run(req.user.company_id,businessId,payrollMonth);
    db.prepare("DELETE FROM payroll_loan_repayments WHERE company_id=? AND business_id=? AND payroll_month=? AND status='posted'").run(req.user.company_id,businessId,payrollMonth);
    for(const item of staffAdjustments){
      const staffId=String(item.staffId), deductionsApplied=item.deductionApplied?1:0, loanApplied=item.loanApplied?1:0;
      const grossAmount=Number(item.grossAmount||0), deductionAmount=Number(item.deductionAmount||0), loanRepaymentAmount=Number(item.loanRepaymentAmount||0), netAmount=grossAmount-deductionAmount-loanRepaymentAmount;
      db.prepare('INSERT INTO payroll_manual_staff_adjustments(id,company_id,business_id,staff_id,payroll_month,deduction_applied,loan_applied,gross_amount,deduction_amount,loan_repayment_amount,net_amount,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id('madj'),req.user.company_id,businessId,staffId,payrollMonth,deductionsApplied,loanApplied,grossAmount,deductionAmount,loanRepaymentAmount,netAmount,req.user.user_id,stamp,stamp);
      const loans=db.prepare("SELECT l.id,l.principal_amount AS principalAmount,l.monthly_amount AS monthlyAmount,l.end_month AS endMonth FROM payroll_staff_loans l WHERE l.company_id=? AND l.staff_id=? AND l.status='active' AND l.start_month<=? AND (l.end_month IS NULL OR l.end_month>=?) AND NOT EXISTS (SELECT 1 FROM payroll_loan_skips s WHERE s.loan_id=l.id AND s.skip_month=?)").all(req.user.company_id,staffId,payrollMonth,payrollMonth,payrollMonth);
      for(const loan of loans){
        if(loanApplied){
          db.prepare('DELETE FROM payroll_loan_skips WHERE loan_id=? AND skip_month=?').run(loan.id,payrollMonth);
          const amountToPost=Math.min(Number(loan.monthlyAmount||0),loanBalance(loan));
          if(amountToPost>0) db.prepare('INSERT OR IGNORE INTO payroll_loan_repayments(id,company_id,loan_id,staff_id,business_id,payroll_month,amount,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('lrep'),req.user.company_id,loan.id,staffId,businessId,payrollMonth,amountToPost,'posted',req.user.user_id,stamp);
          if(loanBalance(loan)<=0) db.prepare("UPDATE payroll_staff_loans SET status='completed',updated_at=? WHERE id=? AND company_id=?").run(stamp,loan.id,req.user.company_id);
        } else {
          const skipId=id('lskip');
          const result=db.prepare('INSERT OR IGNORE INTO payroll_loan_skips(id,company_id,loan_id,staff_id,business_id,skip_month,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(skipId,req.user.company_id,loan.id,staffId,businessId,payrollMonth,'Loan not deducted in externally calculated payroll',req.user.user_id,stamp);
          if(result.changes && loan.endMonth) db.prepare('UPDATE payroll_staff_loans SET end_month=?,updated_at=? WHERE id=? AND company_id=?').run(shiftMonth(loan.endMonth,1),stamp,loan.id,req.user.company_id);
        }
      }
    }
    if(existing) reconcilePayrollPayments(req.user.company_id,pid,stamp);
    audit(req,{action:existing?'payroll.monthly_total.updated':'payroll.monthly_total.created',entityType:'payroll_monthly_total',entityId:pid,businessId,details:{payrollMonth,amount:numericAmount,calculationMode:'manual',staffAdjustmentCount:staffAdjustments.length,note:note?String(note).trim():null}});
  });
  try{
    tx();
    res.status(existing?200:201).json({id:pid,message:'Payroll total recorded with staff deduction and loan selections.'});
  }catch(e){res.status(400).json({error:e.message});}
});

router.post('/api/payroll/entries', requireAuth, requireIdempotency, (req,res)=>{
  if(isAccountant(req)) return res.status(403).json({error:'Accountants can record monthly payroll totals only. Employee-level payroll is managed by authorized management users.'});
  if(!requirePerm(req,res,'payroll.create'))return; const {businessId,payrollMonth,employeeId,employeeName,employeeCode,roleTitle,department,grossAmount,note}=req.body||{};
  if(!businessId||!canUseBusiness(req,businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(!/^\d{4}-\d{2}$/.test(String(payrollMonth||'')))return res.status(400).json({error:'A valid payroll month is required.'});
  const gross=Number(grossAmount);if(!employeeName||!Number.isFinite(gross)||gross<0)return res.status(400).json({error:'Enter an employee name and valid gross amount.'});
  const stamp=nowIso();let employee=employeeId?db.prepare('SELECT id FROM payroll_employees WHERE id=? AND company_id=? AND business_id=?').get(employeeId,req.user.company_id,businessId):null;
  if(!employee)employee=db.prepare('SELECT id FROM payroll_employees WHERE company_id=? AND business_id=? AND lower(employee_name)=lower(?)').get(req.user.company_id,businessId,String(employeeName).trim());
  let newEmployee=null;
  if(!employee){
    const resolvedCode=resolveEmployeeCode(req.user.company_id, employeeCode, null);
    if(resolvedCode.error) return res.status(400).json({error:resolvedCode.error});
    newEmployee={id:id('emp'),employeeCode:resolvedCode.code};
    employee={id:newEmployee.id};
  }
  const existingPayroll=db.prepare('SELECT id,calculation_mode AS calculationMode,payment_status AS paymentStatus FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month=?').get(req.user.company_id,businessId,payrollMonth);
  if(existingPayroll&&existingPayroll.calculationMode==='manual')return res.status(409).json({error:'Monthly payroll already exists. The Owner must not mix monthly and employee-level payroll for the same month.'});
  const existing=db.prepare('SELECT id FROM payroll_entries WHERE employee_id=? AND payroll_month=?').get(employee.id,payrollMonth);
  const tx=db.transaction(()=>{
    if(newEmployee){
      db.prepare('INSERT INTO payroll_employees(id,company_id,business_id,employee_code,employee_name,role_title,department,base_salary,status,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)').run(newEmployee.id,req.user.company_id,businessId,newEmployee.employeeCode,String(employeeName).trim(),roleTitle||null,department||null,gross,'active',1,req.user.user_id,stamp,stamp);
      audit(req,{action:'staff.created',entityType:'staff',entityId:newEmployee.id,businessId,details:{employeeName:String(employeeName).trim(),employeeCode:newEmployee.employeeCode,roleTitle:roleTitle||null,department:department||null,source:'payroll.entry'}});
    }
    if(existing)db.prepare('UPDATE payroll_entries SET gross_amount=?,deductions=0,net_amount=?,note=?,updated_at=? WHERE id=?').run(gross,gross,note||null,stamp,existing.id);
    else db.prepare('INSERT INTO payroll_entries(id,company_id,business_id,employee_id,payroll_month,gross_amount,deductions,net_amount,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id('pentry'),req.user.company_id,businessId,employee.id,payrollMonth,gross,0,gross,note||null,req.user.user_id,stamp,stamp);
    db.prepare(`INSERT INTO payroll_monthly_totals(id,company_id,business_id,payroll_month,amount,calculation_mode,status,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,business_id,payroll_month) DO UPDATE SET calculation_mode='employees',updated_at=excluded.updated_at`).run(id('pay'),req.user.company_id,businessId,payrollMonth,0,'employees','saved',null,req.user.user_id,stamp,stamp);
    audit(req,{action:existing?'payroll.entry.updated':'payroll.entry.created',entityType:'payroll_entry',entityId:existing?.id||employee.id,businessId,details:{employeeId:employee.id,payrollMonth,grossAmount:gross,createdEmployee:Boolean(newEmployee)}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Employee payroll could not be recorded.'});}
  res.status(201).json({message:'Employee payroll recorded.'});
});

router.post('/api/payroll/generate', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.create'))return;
  const {businessId,payrollMonth}=req.body||{};
  if(!businessId||!canUseBusiness(req,businessId)||!/^\d{4}-\d{2}$/.test(String(payrollMonth||'')))return res.status(400).json({error:'Business and valid payroll month are required.'});
  const existing=db.prepare('SELECT id,status,calculation_mode AS calculationMode FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month=?').get(req.user.company_id,businessId,payrollMonth);
  if(existing&&existing.status==='saved')return res.status(409).json({error:'A saved payroll already exists for this month. Open it to edit or delete it.'});
  const employees=db.prepare('SELECT id,base_salary AS baseSalary FROM payroll_employees WHERE company_id=? AND business_id=? AND status=\'active\' AND is_active=1').all(req.user.company_id,businessId);
  const stamp=nowIso(); let count=0; let payrollId=existing?.id||id('pay');
  const tx=db.transaction(()=>{
    if(existing) db.prepare('DELETE FROM payroll_entries WHERE company_id=? AND business_id=? AND payroll_month=?').run(req.user.company_id,businessId,payrollMonth);
    for(const employee of employees){
      const direct=Number(db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM payroll_staff_deductions WHERE company_id=? AND staff_id=? AND start_month<=? AND (end_month IS NULL OR end_month>=?)').get(req.user.company_id,employee.id,payrollMonth,payrollMonth).total||0);
      const loans=Number(scheduledLoanRepayment(req.user.company_id,employee.id,payrollMonth)||0);
      const gross=Number(employee.baseSalary||0), deductions=Math.min(gross,direct+loans), directApplied=Math.min(direct,deductions), loanApplied=Math.min(loans,Math.max(0,deductions-directApplied)), net=Math.max(0,gross-deductions);
      db.prepare('INSERT INTO payroll_entries(id,company_id,business_id,employee_id,payroll_month,gross_amount,deductions,deduction_amount,loan_repayment_amount,net_amount,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id('pentry'),req.user.company_id,businessId,employee.id,payrollMonth,gross,deductions,directApplied,loanApplied,net,'Generated draft from active staff and scheduled deductions',req.user.user_id,stamp,stamp);
      count++;
    }
    if(existing) db.prepare("UPDATE payroll_monthly_totals SET amount=0,calculation_mode='employees',status='draft',note=?,updated_at=? WHERE id=?").run('Generated draft from active staff',stamp,payrollId);
    else db.prepare("INSERT INTO payroll_monthly_totals(id,company_id,business_id,payroll_month,amount,calculation_mode,status,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(payrollId,req.user.company_id,businessId,payrollMonth,0,'employees','draft','Generated draft from active staff',req.user.user_id,stamp,stamp);
    audit(req,{action:'payroll.generated',entityType:'payroll_monthly_total',entityId:payrollId,businessId,details:{payrollMonth,count,status:'draft'}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Payroll draft could not be generated.'});}
  res.status(201).json({id:payrollId,count,status:'draft',message:'Payroll draft generated. Review and save it.'});
});

router.post('/api/payroll/:id/save', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.finalize'))return;
  const row=db.prepare('SELECT id,company_id AS companyId,business_id AS businessId,payroll_month AS payrollMonth,status,payment_status AS paymentStatus FROM payroll_monthly_totals WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!row)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,row.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(row.paymentStatus==='paid')return res.status(409).json({error:'Payroll is already paid and locked.'});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE payroll_monthly_totals SET status='saved',updated_at=? WHERE id=?").run(nowIso(),row.id);
    audit(req,{action:'payroll.saved',entityType:'payroll_monthly_total',entityId:row.id,businessId:row.businessId,details:{status:'saved'}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Payroll could not be saved.'});}
  res.json({message:'Payroll saved.',status:'saved'});
});


router.get('/api/payroll/:id/payments', requireAuth, (req,res)=>{
  if(!requireAccess(req,res))return;
  const payroll=payrollForPayments(req.user.company_id,req.params.id);
  if(!payroll)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,payroll.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  const expected=expectedPayrollAmount(req.user.company_id,payroll);
  const payments=db.prepare('SELECT id,amount,payment_date AS paymentDate,note,status,voided_at AS voidedAt,void_reason AS voidReason,created_at AS createdAt FROM payroll_payments WHERE company_id=? AND payroll_id=? ORDER BY payment_date DESC,created_at DESC').all(req.user.company_id,payroll.id);
  const paid=r2(payments.filter(p=>p.status==='posted').reduce((n,p)=>n+Number(p.amount||0),0));
  res.json({payrollId:payroll.id,payrollStatus:payroll.status,paymentStatus:payroll.paymentStatus,expected,paid,outstanding:r2(Math.max(0,expected-paid)),overpayment:r2(Math.max(0,paid-expected)),payments});
});

router.post('/api/payroll/:id/payments', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.create'))return;
  const payroll=payrollForPayments(req.user.company_id,req.params.id);
  if(!payroll)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,payroll.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(payroll.status!=='saved')return res.status(409).json({error:'Save the payroll before recording a payment.'});
  if(payroll.paymentStatus==='paid')return res.status(409).json({error:'This payroll is fully paid and locked. Void a payment first if one was recorded in error.'});
  const rawAmount=Number(req.body?.amount);
  const amount=r2(rawAmount);
  if(!Number.isFinite(rawAmount)||amount<=0)return res.status(400).json({error:'Payment amount must be at least 0.01.'});
  const paymentDate=String(req.body?.paymentDate||new Date().toISOString().slice(0,10));
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)&&!Number.isNaN(Date.parse(paymentDate))&&new Date(`${paymentDate}T00:00:00Z`).toISOString().slice(0,10)===paymentDate;
  if(!validDate)return res.status(400).json({error:'Enter a valid payment date.'});
  const stamp=nowIso(),paymentId=id('pmt');
  let outcome;
  const tx=db.transaction(()=>{
    const expected=expectedPayrollAmount(req.user.company_id,payroll);
    const paidBefore=paidPayrollAmount(req.user.company_id,payroll.id);
    const balance=r2(expected-paidBefore);
    if(amount>balance+MONEY_TOLERANCE&&req.body?.confirmOverpayment!==true){
      const err=new Error(`This payment is ${r2(amount-Math.max(0,balance)).toFixed(2)} more than the outstanding balance (${Math.max(0,balance).toFixed(2)}). Confirm the overpayment to record it.`);
      err.code='OVERPAYMENT';err.status=409;err.meta={expected,paid:paidBefore,balance:Math.max(0,balance)};throw err;
    }
    db.prepare("INSERT INTO payroll_payments(id,company_id,payroll_id,amount,payment_date,note,status,recorded_by,created_at) VALUES(?,?,?,?,?,?,'posted',?,?)").run(paymentId,req.user.company_id,payroll.id,amount,paymentDate,String(req.body?.note||'').trim()||null,req.user.user_id,stamp);
    const paid=r2(paidBefore+amount);
    const fullyPaid=expected>0&&paid>=expected-MONEY_TOLERANCE;
    if(fullyPaid)markPaid(req.user.company_id,payroll.id,stamp);
    audit(req,{action:'payroll.payment.recorded',entityType:'payroll_payment',entityId:paymentId,businessId:payroll.businessId,details:{payrollId:payroll.id,amount,paymentDate,expected,paid,fullyPaid,overpayment:Boolean(amount>balance+MONEY_TOLERANCE)}});
    outcome={expected,paid,fullyPaid};
  });
  try{tx();}catch(e){
    if(e.code==='OVERPAYMENT')return res.status(409).json({error:e.message,code:e.code,...e.meta});
    return res.status(400).json({error:e.message||'Payment could not be recorded.'});
  }
  res.status(201).json({message:outcome.fullyPaid?'Payment recorded. Payroll is now fully paid and locked.':'Payroll payment recorded.',paymentId,...outcome});
});

// A recorded payment is never deleted. A mistake is voided with a reason (kept in the ledger and audit log);
// voiding re-opens a payroll that was locked as paid if it is no longer fully paid.
router.post('/api/payroll/:id/payments/:paymentId/void', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.finalize'))return;
  const payroll=payrollForPayments(req.user.company_id,req.params.id);
  if(!payroll)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,payroll.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  const payment=db.prepare('SELECT id,amount,payment_date AS paymentDate,status FROM payroll_payments WHERE id=? AND payroll_id=? AND company_id=?').get(req.params.paymentId,payroll.id,req.user.company_id);
  if(!payment)return res.status(404).json({error:'Payment not found.'});
  if(payment.status!=='posted')return res.status(409).json({error:'This payment has already been voided.'});
  const reason=String(req.body?.reason||'').trim();
  if(reason.length<3)return res.status(400).json({error:'Enter a reason for voiding this payment.'});
  const stamp=nowIso();let reopened=false;
  const tx=db.transaction(()=>{
    db.prepare("UPDATE payroll_payments SET status='voided',voided_at=?,voided_by=?,void_reason=? WHERE id=? AND company_id=?").run(stamp,req.user.user_id,reason,payment.id,req.user.company_id);
    const expected=expectedPayrollAmount(req.user.company_id,payroll);
    const paid=paidPayrollAmount(req.user.company_id,payroll.id);
    if(payroll.paymentStatus==='paid'&&!(expected>0&&paid>=expected-MONEY_TOLERANCE)){
      db.prepare("UPDATE payroll_monthly_totals SET payment_status='unpaid',paid_at=NULL,updated_at=? WHERE id=? AND company_id=?").run(stamp,payroll.id,req.user.company_id);
      reopened=true;
    }
    audit(req,{action:'payroll.payment.voided',entityType:'payroll_payment',entityId:payment.id,businessId:payroll.businessId,details:{payrollId:payroll.id,amount:Number(payment.amount||0),paymentDate:payment.paymentDate,reason,expected,paidAfter:paid,payrollReopened:reopened}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Payment could not be voided.'});}
  res.json({message:reopened?'Payment voided. The payroll is open again.':'Payment voided.',payrollReopened:reopened});
});

router.post('/api/payroll/:id/paid', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.finalize'))return;
  const row=payrollForPayments(req.user.company_id,req.params.id);
  if(!row)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,row.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(row.paymentStatus==='paid')return res.status(409).json({error:'Payroll is already marked as paid.'});
  if(row.status!=='saved')return res.status(400).json({error:'Save the payroll before marking it as paid.'});
  const stamp=nowIso();let reconciled=0;
  const tx=db.transaction(()=>{
    const expected=expectedPayrollAmount(req.user.company_id,row);
    if(expected<=0){const err=new Error('Nothing to pay: this payroll total is zero.');err.status=400;throw err;}
    const paid=paidPayrollAmount(req.user.company_id,row.id);
    const remaining=r2(Math.max(0,expected-paid));
    if(remaining>MONEY_TOLERANCE){
      db.prepare("INSERT INTO payroll_payments(id,company_id,payroll_id,amount,payment_date,note,status,recorded_by,created_at) VALUES(?,?,?,?,?,?,'posted',?,?)").run(id('pmt'),req.user.company_id,row.id,remaining,stamp.slice(0,10),'Recorded by Mark Paid action',req.user.user_id,stamp);
      reconciled=remaining;
    }
    markPaid(req.user.company_id,row.id,stamp);
    audit(req,{action:'payroll.marked_paid',entityType:'payroll_monthly_total',entityId:row.id,businessId:row.businessId,details:{paymentStatus:'paid',reconciledAmount:reconciled,expected,paidBefore:paid}});
  });
  try{tx();}catch(e){return res.status(e.status||400).json({error:e.message||'Payroll could not be marked as paid.'});}
  res.json({message:'Payroll marked as paid and locked.',paymentStatus:'paid',reconciledAmount:reconciled});
});

router.patch('/api/payroll/:id', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.edit'))return;
  const row=db.prepare('SELECT id,business_id AS businessId,payroll_month AS payrollMonth,status,payment_status AS paymentStatus,calculation_mode AS calculationMode FROM payroll_monthly_totals WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!row)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,row.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(row.paymentStatus==='paid')return res.status(409).json({error:'Paid payroll is locked and cannot be edited.'});
  if(row.status==='saved' && req.body?.status==='draft')return res.status(400).json({error:'Saved payroll cannot be reopened as a draft.'});
  const entries=Array.isArray(req.body?.entries)?req.body.entries:[];
  // An empty or missing list must never be treated as "set everything to zero".
  if(!entries.length)return res.status(400).json({error:'No payroll entries were supplied. Nothing was changed.'});
  const stamp=nowIso();
  const tx=db.transaction(()=>{
    for(const entry of entries){
      const gross=Number(entry.grossAmount), directAmount=Number(entry.deductionAmount||0), loanAmount=Number(entry.loanRepaymentAmount||0);
      if(entry.grossAmount===undefined||entry.grossAmount===null||entry.grossAmount===''||!Number.isFinite(gross)||gross<0||!Number.isFinite(directAmount)||directAmount<0||!Number.isFinite(loanAmount)||loanAmount<0) throw new Error('Each payroll entry needs a valid gross amount, deduction and loan repayment.');
      // Totals are always derived on the server from the parts, never trusted from the client.
      const deductions=r2(directAmount+loanAmount);
      if(entry.deductions!==undefined&&entry.deductions!==null&&Math.abs(r2(entry.deductions)-deductions)>MONEY_TOLERANCE) throw new Error('Payroll deductions must equal direct deductions plus loan repayment.');
      if(deductions>r2(gross)+MONEY_TOLERANCE) throw new Error('Deductions cannot exceed gross pay.');
      const current=db.prepare('SELECT id,employee_id AS employeeId FROM payroll_entries WHERE id=? AND company_id=? AND business_id=? AND payroll_month=?').get(entry.id,req.user.company_id,row.businessId,row.payrollMonth);
      if(!current) throw new Error('One or more payroll entries are invalid.');
      db.prepare('UPDATE payroll_entries SET gross_amount=?,deductions=?,deduction_amount=?,loan_repayment_amount=?,net_amount=?,note=?,updated_at=? WHERE id=? AND company_id=? AND business_id=? AND payroll_month=?').run(r2(gross),deductions,r2(directAmount),r2(loanAmount),r2(gross-deductions),entry.note||null,stamp,entry.id,req.user.company_id,row.businessId,row.payrollMonth);
      // Only this employee's posted repayments for the month are replaced; other staff are untouched.
      db.prepare("DELETE FROM payroll_loan_repayments WHERE company_id=? AND business_id=? AND payroll_month=? AND staff_id=? AND status='posted'").run(req.user.company_id,row.businessId,row.payrollMonth,current.employeeId);
      let remainingForLoans=Math.max(0,loanAmount);
      for(const loan of activeLoansForMonth(req.user.company_id,current.employeeId,row.payrollMonth)){
        const amount=r2(Math.min(Number(loan.monthlyAmount||0),loanBalance(loan),remainingForLoans));
        if(amount<=0) continue;
        db.prepare("INSERT INTO payroll_loan_repayments(id,company_id,loan_id,staff_id,business_id,payroll_month,amount,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(loan_id,payroll_month) DO UPDATE SET amount=excluded.amount,status='posted'").run(id('lrep'),req.user.company_id,loan.id,current.employeeId,row.businessId,row.payrollMonth,amount,'posted',req.user.user_id,stamp);
        remainingForLoans=r2(remainingForLoans-amount);
        if(loanBalance(loan)<=0) db.prepare("UPDATE payroll_staff_loans SET status='completed',updated_at=? WHERE id=? AND company_id=?").run(stamp,loan.id,req.user.company_id);
      }
    }
    reconcilePayrollPayments(req.user.company_id,row.id,stamp);
    audit(req,{action:'payroll.updated',entityType:'payroll_monthly_total',entityId:row.id,businessId:row.businessId,details:{payrollMonth:row.payrollMonth,entryCount:entries.length,calculationMode:row.calculationMode}});
  });
  try{
    tx();
    res.json({message:'Payroll updated.'});
  }catch(e){res.status(400).json({error:e.message});}
});

router.delete('/api/payroll/:id', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.edit'))return;
  const row=db.prepare('SELECT id,business_id AS businessId,payroll_month AS payrollMonth,payment_status AS paymentStatus FROM payroll_monthly_totals WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!row)return res.status(404).json({error:'Payroll not found.'});
  if(!canUseBusiness(req,row.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(row.paymentStatus==='paid')return res.status(409).json({error:'Paid payroll is locked and cannot be deleted.'});
  // Payment records are financial history: a payroll that has any (even voided) is kept, never cascaded away.
  const paymentRecords=Number(db.prepare('SELECT COUNT(*) AS n FROM payroll_payments WHERE company_id=? AND payroll_id=?').get(req.user.company_id,row.id).n||0);
  if(paymentRecords>0)return res.status(409).json({error:'This payroll has payment records and cannot be deleted, so the payment history is preserved. Void any payment recorded in error instead.'});
  const tx=db.transaction(()=>{
    db.prepare('DELETE FROM payroll_loan_repayments WHERE company_id=? AND business_id=? AND payroll_month=?').run(req.user.company_id,row.businessId,row.payrollMonth);
    db.prepare('DELETE FROM payroll_entries WHERE company_id=? AND business_id=? AND payroll_month=?').run(req.user.company_id,row.businessId,row.payrollMonth);
    db.prepare('DELETE FROM payroll_manual_staff_adjustments WHERE company_id=? AND business_id=? AND payroll_month=?').run(req.user.company_id,row.businessId,row.payrollMonth);
    db.prepare('DELETE FROM payroll_monthly_totals WHERE id=? AND company_id=?').run(row.id,req.user.company_id);
    audit(req,{action:'payroll.deleted',entityType:'payroll_monthly_total',entityId:row.id,businessId:row.businessId,details:{payrollMonth:row.payrollMonth,historyPreserved:false,paymentRecords:0}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Payroll could not be deleted.'});}
  res.json({message:'Payroll deleted.'});
});

router.post('/api/payroll/deductions', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.deductions'))return; const {staffId,amount,category,startMonth,endMonth,note}=req.body||{}; const staff=db.prepare('SELECT id,business_id AS businessId FROM payroll_employees WHERE id=? AND company_id=?').get(staffId,req.user.company_id);
  if(!staff||!canUseBusiness(req,staff.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(!Number.isFinite(Number(amount))||Number(amount)<0||!String(category||'').trim()||!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(String(startMonth||''))|| (endMonth && !/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(String(endMonth))) || (endMonth && String(endMonth)<String(startMonth)))return res.status(400).json({error:'Staff, amount, category and valid deduction period are required. End month cannot be earlier than start month.'});
  const stamp=nowIso();const did=id('ded');
  const tx=db.transaction(()=>{
    db.prepare('INSERT INTO payroll_staff_deductions(id,company_id,staff_id,amount,category,start_month,end_month,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(did,req.user.company_id,staffId,Number(amount),String(category).trim(),startMonth,endMonth||null,note||null,req.user.user_id,stamp,stamp);
    audit(req,{action:'staff.deduction.created',entityType:'staff_deduction',entityId:did,businessId:staff.businessId,details:{employeeName:staff.employeeName,amount:Number(amount),category:String(category).trim(),startMonth,endMonth:endMonth||null,note:note||null}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Staff deduction could not be recorded.'});}
  res.status(201).json({id:did,message:'Staff deduction recorded.'});
});

router.get('/api/payroll/deductions', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.deductions'))return; const month=validMonth(req.query.month),ids=assignedBusinessIds(req),ph=ids.map(()=>'?').join(','); if(!ids.length)return res.json({deductions:[]});
  const rows=db.prepare(`SELECT d.id,d.staff_id AS staffId,e.employee_name AS employeeName,e.employee_code AS employeeCode,e.business_id AS businessId,b.name AS businessName,d.amount,d.category,d.start_month AS startMonth,d.end_month AS endMonth,d.note FROM payroll_staff_deductions d JOIN payroll_employees e ON e.id=d.staff_id JOIN businesses b ON b.id=e.business_id WHERE d.company_id=? AND e.business_id IN (${ph}) AND d.start_month<=? AND (d.end_month IS NULL OR d.end_month>=?) ORDER BY b.name,e.employee_name`).all(req.user.company_id,...ids,month,month);res.json({deductions:rows});
});

router.delete('/api/payroll/deductions/:id', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.deductions'))return;
  const row=db.prepare(`SELECT d.id,e.business_id AS businessId,e.employee_name AS employeeName,d.amount,d.category FROM payroll_staff_deductions d JOIN payroll_employees e ON e.id=d.staff_id WHERE d.id=? AND d.company_id=?`).get(req.params.id,req.user.company_id);
  if(!row)return res.status(404).json({error:'Deduction not found.'});
  if(!canUseBusiness(req,row.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  const tx=db.transaction(()=>{
    db.prepare('DELETE FROM payroll_staff_deductions WHERE id=? AND company_id=?').run(row.id,req.user.company_id);
    audit(req,{action:'staff.deduction.deleted',entityType:'staff_deduction',entityId:row.id,businessId:row.businessId,details:{employeeName:row.employeeName,amount:Number(row.amount||0),category:row.category}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Staff deduction could not be deleted.'});}
  res.json({message:'Staff deduction deleted.'});
});

router.post('/api/payroll/loans', requireAuth, requireIdempotency, (req,res)=>{
  if(!requirePerm(req,res,'payroll.loans'))return; const {staffId,principalAmount,monthlyAmount,startMonth,endMonth,note}=req.body||{};const staff=db.prepare('SELECT id,business_id AS businessId FROM payroll_employees WHERE id=? AND company_id=?').get(staffId,req.user.company_id);
  if(!staff||!canUseBusiness(req,staff.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(!Number.isFinite(Number(principalAmount))||Number(principalAmount)<=0||!Number.isFinite(Number(monthlyAmount))||Number(monthlyAmount)<=0||!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(String(startMonth||'')) || (endMonth && !/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(String(endMonth))) || (endMonth && String(endMonth)<String(startMonth)))return res.status(400).json({error:'Staff, loan amount, monthly repayment and valid loan period are required. End month cannot be earlier than start month.'});
  const stamp=nowIso(),lid=id('loan');
  const tx=db.transaction(()=>{
    db.prepare('INSERT INTO payroll_staff_loans(id,company_id,staff_id,principal_amount,monthly_amount,start_month,end_month,status,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(lid,req.user.company_id,staffId,Number(principalAmount),Number(monthlyAmount),startMonth,endMonth||null,'active',note||null,req.user.user_id,stamp,stamp);
    audit(req,{action:'payroll.loan.created',entityType:'staff_loan',entityId:lid,businessId:staff.businessId,details:{staffId,principalAmount:Number(principalAmount),monthlyAmount:Number(monthlyAmount),startMonth,endMonth:endMonth||null,note:note||null}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Staff loan could not be recorded.'});}
  res.status(201).json({id:lid,message:'Staff loan recorded.'});
});

router.get('/api/payroll/manual-checklist', requireAuth, (req,res)=>{
  if(!requireAccess(req,res))return;
  if(!canSalaries(req))return res.status(403).json({error:'Per-employee payroll details need the View salaries permission.'});
  const {businessId,month}=req.query||{};
  if(!businessId||!canUseBusiness(req,businessId)||!validMonthStrict(month))return res.status(400).json({error:'Business and valid month are required.'});
  const rows=db.prepare(`SELECT e.id,e.employee_name AS employeeName,e.employee_code AS employeeCode,e.base_salary AS baseSalary,
    COALESCE((SELECT SUM(d.amount) FROM payroll_staff_deductions d WHERE d.staff_id=e.id AND d.company_id=? AND d.start_month<=? AND (d.end_month IS NULL OR d.end_month>=?)),0) AS activeDeductionAmount,
    EXISTS(SELECT 1 FROM payroll_staff_deductions d WHERE d.staff_id=e.id AND d.company_id=? AND d.start_month<=? AND (d.end_month IS NULL OR d.end_month>=?)) AS hasActiveDeduction,
    COALESCE((SELECT SUM(MIN(l.monthly_amount, MAX(0,l.principal_amount-COALESCE((SELECT SUM(r.amount) FROM payroll_loan_repayments r WHERE r.loan_id=l.id AND r.status='posted'),0)))) FROM payroll_staff_loans l WHERE l.staff_id=e.id AND l.company_id=? AND l.status='active' AND l.start_month<=? AND (l.end_month IS NULL OR l.end_month>=?) AND NOT EXISTS(SELECT 1 FROM payroll_loan_skips s WHERE s.loan_id=l.id AND s.skip_month=?)),0) AS scheduledLoanAmount,
    EXISTS(SELECT 1 FROM payroll_staff_loans l WHERE l.staff_id=e.id AND l.company_id=? AND l.status='active' AND l.start_month<=? AND (l.end_month IS NULL OR l.end_month>=?) AND NOT EXISTS(SELECT 1 FROM payroll_loan_skips s WHERE s.loan_id=l.id AND s.skip_month=?)) AS hasActiveLoan
    FROM payroll_employees e WHERE e.company_id=? AND e.business_id=? AND e.status='active' AND e.is_active=1 ORDER BY e.employee_name`).all(req.user.company_id,month,month,req.user.company_id,month,month,req.user.company_id,month,month,month,req.user.company_id,month,month,month,req.user.company_id,businessId);
  res.json({month,businessId,staff:rows});
});

router.post('/api/payroll/loans/:id/skip', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.loans'))return;
  const {skipMonth,reason}=req.body||{};
  if(!validMonthStrict(skipMonth))return res.status(400).json({error:'A valid skip month is required.'});
  const loan=db.prepare('SELECT l.id,l.company_id AS companyId,l.staff_id AS staffId,e.business_id AS businessId,l.principal_amount AS principalAmount,l.monthly_amount AS monthlyAmount,l.start_month AS startMonth,l.end_month AS endMonth,l.status FROM payroll_staff_loans l JOIN payroll_employees e ON e.id=l.staff_id WHERE l.id=? AND l.company_id=?').get(req.params.id,req.user.company_id);
  if(!loan)return res.status(404).json({error:'Loan not found.'});
  if(!canUseBusiness(req,loan.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(loan.status!=='active')return res.status(400).json({error:'Only active loans can be skipped.'});
  if(skipMonth<loan.startMonth || (loan.endMonth && skipMonth>loan.endMonth))return res.status(400).json({error:'The skip month must fall within the current loan period.'});
  const existingRepayment=db.prepare("SELECT id FROM payroll_loan_repayments WHERE loan_id=? AND payroll_month=? AND status='posted'").get(loan.id,skipMonth);
  if(existingRepayment)return res.status(409).json({error:'A repayment has already been recorded for this loan and month. Reverse the repayment before skipping the month.'});
  const stamp=nowIso();
  const tx=db.transaction(()=>{
    const result=db.prepare('INSERT OR IGNORE INTO payroll_loan_skips(id,company_id,loan_id,staff_id,business_id,skip_month,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id('lskip'),req.user.company_id,loan.id,loan.staffId,loan.businessId,skipMonth,reason||'Skipped by management',req.user.user_id,stamp);
    if(result.changes && loan.endMonth) db.prepare('UPDATE payroll_staff_loans SET end_month=?,updated_at=? WHERE id=? AND company_id=?').run(shiftMonth(loan.endMonth,1),stamp,loan.id,req.user.company_id);
    // Keep an existing employee-based monthly payroll consistent with the skip.
    // Only adjust an unpaid payroll; paid payrolls are immutable.
    if(result.changes){
      const payroll=db.prepare(`SELECT p.id,p.status,p.payment_status AS paymentStatus FROM payroll_monthly_totals p WHERE p.company_id=? AND p.business_id=? AND p.payroll_month=? AND p.calculation_mode='employees'`).get(req.user.company_id,loan.businessId,skipMonth);
      if(payroll && payroll.paymentStatus!=='paid'){
        const entry=db.prepare('SELECT id,gross_amount AS grossAmount,deductions,deduction_amount AS deductionAmount,loan_repayment_amount AS loanRepaymentAmount FROM payroll_entries WHERE company_id=? AND business_id=? AND employee_id=? AND payroll_month=?').get(req.user.company_id,loan.businessId,loan.staffId,skipMonth);
        if(entry){
          const due=Math.min(Number(loan.monthlyAmount||0),loanBalance(loan));
          const newLoan=Math.max(0,Number(entry.loanRepaymentAmount||0)-due);
          const newDeductions=Math.max(0,Number(entry.deductions||0)-Math.min(due,Number(entry.loanRepaymentAmount||0)));
          const newNet=Math.max(0,Number(entry.grossAmount||0)-newDeductions);
          db.prepare('UPDATE payroll_entries SET loan_repayment_amount=?,deductions=?,net_amount=?,updated_at=? WHERE id=? AND company_id=?').run(newLoan,newDeductions,newNet,stamp,entry.id,req.user.company_id);
          reconcilePayrollPayments(req.user.company_id,payroll.id,stamp);
        }
      }
    }
    audit(req,{action:'payroll.loan_month.skipped',entityType:'loan_skip',entityId:`${loan.id}:${skipMonth}`,businessId:loan.businessId,details:{loanId:loan.id,staffId:loan.staffId,skipMonth,reason:reason||'Skipped by management',loanPeriodExtended:Boolean(loan.endMonth)}});
  });
  try{
    tx();
    res.json({message:'Loan month skipped and loan period extended where applicable.'});
  }catch(e){res.status(400).json({error:e.message});}
});

router.post('/api/payroll/loan-repayments/:id/void', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.loans'))return;
  const repayment=db.prepare(`SELECT r.id,r.loan_id AS loanId,r.business_id AS businessId,r.status,r.amount
    FROM payroll_loan_repayments r JOIN payroll_staff_loans l ON l.id=r.loan_id
    WHERE r.id=? AND r.company_id=?`).get(req.params.id,req.user.company_id);
  if(!repayment)return res.status(404).json({error:'Loan repayment not found.'});
  if(!canUseBusiness(req,repayment.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  if(repayment.status!=='posted')return res.status(409).json({error:'Only posted repayments can be voided.'});
  const stamp=nowIso();
  const tx=db.transaction(()=>{
    db.prepare("UPDATE payroll_loan_repayments SET status='voided' WHERE id=? AND company_id=?").run(repayment.id,req.user.company_id);
    db.prepare("UPDATE payroll_staff_loans SET status='active',updated_at=? WHERE id=? AND company_id=? AND status='completed'").run(stamp,repayment.loanId,req.user.company_id);
    audit(req,{action:'payroll.loan_repayment.voided',entityType:'loan_repayment',entityId:repayment.id,businessId:repayment.businessId,details:{loanId:repayment.loanId,amount:Number(repayment.amount||0)}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Loan repayment could not be voided.'});}
  res.json({message:'Loan repayment voided.'});
});

router.get('/api/payroll/loans/:id/skips', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.loans'))return;
  const loan=db.prepare('SELECT l.id,e.business_id AS businessId FROM payroll_staff_loans l JOIN payroll_employees e ON e.id=l.staff_id WHERE l.id=? AND l.company_id=?').get(req.params.id,req.user.company_id);
  if(!loan)return res.status(404).json({error:'Loan not found.'});
  if(!canUseBusiness(req,loan.businessId))return res.status(403).json({error:'You are not assigned to this business.'});
  res.json({skips:db.prepare('SELECT id,skip_month AS skipMonth,reason,created_at AS createdAt FROM payroll_loan_skips WHERE loan_id=? ORDER BY skip_month').all(loan.id)});
});

router.get('/api/payroll/loans', requireAuth, (req,res)=>{
  if(!requirePerm(req,res,'payroll.loans'))return;
  const ids=assignedBusinessIds(req);
  if(!ids.length)return res.json({loans:[]});
  const ph=ids.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT l.*,e.employee_name AS employeeName,b.name AS businessName,
    COALESCE((SELECT SUM(r.amount) FROM payroll_loan_repayments r WHERE r.loan_id=l.id AND r.status='posted'),0) AS totalRepaid
    FROM payroll_staff_loans l JOIN payroll_employees e ON e.id=l.staff_id JOIN businesses b ON b.id=e.business_id
    WHERE l.company_id=? AND e.business_id IN (${ph}) ORDER BY e.employee_name`).all(req.user.company_id,...ids)
    .map(row=>({...row,remainingBalance:Math.max(0,Number(row.principal_amount||0)-Number(row.totalRepaid||0))}));
  res.json({loans:rows});
});
module.exports=router;
