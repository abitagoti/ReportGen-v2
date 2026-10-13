const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
// Isolate this test run from the real persistent database: this MUST be set
// before server/config (and therefore server/database/database) is required
// anywhere in this process, or tests will read/write the live app database.
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-test-'));
const XLSX=require('xlsx');
const {inspect,importFile}=require('../server/sales/importService');
const {db}=require('../server/database/database');
function fixture(){const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([['Invoice','SoldBy','Item','Product','Group','Date','Qty','Cost','Amount','Gross','Returns','Profit'],['INV-1','A','SKU1','Pizza','Food',new Date('2026-08-01'),2,1000,2500,2500,0,1500],['INV-2','B','SKU2','Burger','Food',new Date('2026-08-02'),1,700,1200,1300,100,500]]);XLSX.utils.book_append_sheet(wb,ws,'Sales');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
test('inspects workbook and suggests PizzaHub-style mappings',async()=>{const r=await inspect(fixture(),'sample.xlsx');assert.equal(r.rowCount,2);assert.equal(r.suggestedMapping.transactionDate,'Date');assert.equal(r.suggestedMapping.salesAmount,'Amount');assert.equal(r.suggestedMapping.returnsAmount,'Returns');});
test('imports mapped rows and calculates source totals',async()=>{const companyId='test-company',businessId='test-business',userId=null;db.prepare("INSERT OR IGNORE INTO companies(id,name,currency,created_at,updated_at) VALUES(?,?,?,?,?)").run(companyId,'Test Co','NGN','2026-01-01','2026-01-01');db.prepare("INSERT OR IGNORE INTO businesses(id,company_id,name,type,currency,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(businessId,companyId,'Test Business','business','NGN',1,'2026-01-01','2026-01-01');const mapping={transactionId:'Invoice',salesperson:'SoldBy',productId:'Item',productName:'Product',category:'Group',transactionDate:'Date',quantity:'Qty',salesAmount:'Amount',grossAmount:'Gross',returnsAmount:'Returns',costAmount:'Cost',profitAmount:'Profit'};const r=await importFile({buffer:fixture(),fileName:'sample.xlsx',businessId,companyId,userId,periodStart:'2026-08-01',periodEnd:'2026-08-31',mapping});assert.equal(r.rowCount,2);assert.equal(r.validRows,2);assert.equal(r.salesTotal,3700);assert.equal(r.grossTotal,3800);assert.equal(r.returnsTotal,100);assert.equal(r.profitTotal,2000);const count=db.prepare('SELECT COUNT(*) c FROM sales_transactions WHERE import_id=?').get(r.importId).c;assert.equal(count,2);});
