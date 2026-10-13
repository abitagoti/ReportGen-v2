const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const path = require('node:path');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');

const FIELDS = {
  transactionId: { label:'Transaction ID', required:false, aliases:['invoice','invoice no','invoice number','receipt','receipt no','transaction id','reference','ref'] },
  salesperson: { label:'Salesperson', required:false, aliases:['soldby','sold by','salesperson','sales person','cashier','seller','staff'] },
  productId: { label:'Product ID', required:false, aliases:['item','item id','item code','product id','product code','sku','code'] },
  productName: { label:'Product Name', required:false, aliases:['product','product name','item name','description','name'] },
  category: { label:'Category', required:false, aliases:['group','category','department','product group'] },
  transactionDate: { label:'Transaction Date', required:true, aliases:['date','sale date','sales date','transaction date','date sold'] },
  quantity: { label:'Quantity', required:false, aliases:['qty','quantity','units','unit qty','count'] },
  salesAmount: { label:'Sales Amount', required:true, aliases:['amount','sales','sales amount','net sales','total sales','selling amount','revenue'] },
  grossAmount: { label:'Gross Amount', required:false, aliases:['gross','gross amount','gross sales'] },
  returnsAmount: { label:'Returns Amount', required:false, aliases:['returns','return','returns amount','return amount'] },
  costAmount: { label:'Cost Amount', required:false, aliases:['cost','cost amount','cost of goods','cogs'] },
  profitAmount: { label:'Profit Amount', required:false, aliases:['profit','profit amount','gross profit','net profit'] }
};
const mappingSchema = z.record(z.string(), z.string().nullable().optional());
const norm = v => String(v ?? '').trim().toLowerCase().replace(/[\s_\-./]+/g,'');
const num = v => { if(v===null||v===undefined||v==='') return null; if(typeof v==='number'&&Number.isFinite(v)) return v; const n=Number(String(v).replace(/[₦,$,\s]/g,'')); return Number.isFinite(n)?n:null; };
function date(v){
  if(v instanceof Date&&!Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  if(typeof v==='number'){
    const parts=XLSX.SSF.parse_date_code(v);
    if(parts?.y&&parts?.m&&parts?.d) return `${parts.y}-${String(parts.m).padStart(2,'0')}-${String(parts.d).padStart(2,'0')}`;
  }
  const s=String(v??'').trim(); if(!s) return null;
  // Sales software exports commonly use DD/MM/YYYY with an optional time.
  // Parse this explicitly before native Date parsing, which may interpret
  // DD/MM/YYYY values incorrectly or reject dates such as 31/08/2026 21:03:07.
  const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+.*)?$/);
  if(m){
    const day=Number(m[1]), month=Number(m[2]), year=Number(m[3]);
    const candidate=new Date(Date.UTC(year,month-1,day));
    if(candidate.getUTCFullYear()===year&&candidate.getUTCMonth()===month-1&&candidate.getUTCDate()===day){
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return null;
  }
  const d=new Date(s); return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function decodeHtmlText(value){
  return String(value??'')
    .replace(/<br\s*\/?>(?=.)/gi,' ')
    .replace(/<[^>]*>/g,'')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'\"').replace(/&#39;/gi,"'")
    .trim();
}
function htmlTableWorkbook(buffer,fileName){
  const html=buffer.toString('utf8');
  const tableMatch=html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if(!tableMatch) return null;
  const rows=[];
  const rowMatches=[...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for(const rowMatch of rowMatches){
    const cells=[...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map(m=>decodeHtmlText(m[1]));
    if(cells.length) rows.push(cells);
  }
  if(!rows.length) return null;
  const headers=rows[0].map(v=>String(v??'').trim());
  const data=rows.slice(1).filter(r=>r.some(v=>v!==null&&v!==undefined&&v!==''))
    .map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??null])));
  return {rows:data,headers,sheetName:'Sheet1',sheets:['Sheet1'],fileName};
}
function sheetJsWorkbook(buffer,fileName,requestedSheetName){
  // Some legacy ".xls" exports are actually HTML tables. Parse those as raw
  // strings first so SheetJS cannot reinterpret DD/MM/YYYY as MM/DD/YYYY.
  const first=buffer.toString('utf8',0,512).replace(/^\uFEFF/,'').trimStart();
  if(/^<(?:!doctype\s+html|html|style|div|table)\b/i.test(first)){
    const htmlResult=htmlTableWorkbook(buffer,fileName);
    if(htmlResult) return htmlResult;
  }
  const parsed=XLSX.read(buffer,{type:'buffer',cellDates:false,cellNF:false,cellText:false});
  if(requestedSheetName&&!parsed.SheetNames.includes(requestedSheetName)) throw new Error('The selected worksheet was not found in this workbook.');
  const sheetName=requestedSheetName||parsed.SheetNames[0];
  if(!sheetName) throw new Error('Workbook has no worksheets.');
  const sheet=parsed.Sheets[sheetName];
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true});
  const headers=(matrix[0]||[]).map(v=>String(v??'').trim());
  const rows=matrix.slice(1)
    .filter(r=>r.some(v=>v!==null&&v!==undefined&&v!==''))
    .map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??null])));
  return {rows,headers,sheetName,sheets:parsed.SheetNames,fileName};
}

async function workbook(buffer,fileName,requestedSheetName){
  if(!Buffer.isBuffer(buffer)) throw new Error('Invalid upload data.');
  if(buffer.length > 100 * 1024 * 1024) throw new Error('Uploaded file exceeds the 100 MB import limit.');
  const ext=path.extname(fileName).toLowerCase();
  // SheetJS handles the legacy binary Excel format (.xls), which ExcelJS does not support.
  if(ext==='.xls') return sheetJsWorkbook(buffer,fileName,requestedSheetName);

  const wb=new ExcelJS.Workbook();
  if(ext==='.csv') await wb.csv.loadBuffer(buffer);
  else if(ext==='.xlsx') await wb.xlsx.load(buffer);
  else throw new Error('Unsupported file format. Upload CSV, XLS, or XLSX.');
  const sheet=requestedSheetName?wb.getWorksheet(requestedSheetName):wb.worksheets[0];
  if(!sheet) throw new Error('Workbook has no worksheets.');
  const matrix=[];
  sheet.eachRow({includeEmpty:true}, row=>{ matrix.push(row.values.slice(1)); });
  const headers=(matrix[0]||[]).map(v=>String(v??''));
  const rows=matrix.slice(1).filter(r=>r.some(v=>v!==null&&v!==undefined&&v!=='' )).map(values=>Object.fromEntries(headers.map((h,i)=>[h, values[i] instanceof Date ? values[i] : (values[i]?.result ?? values[i] ?? null)])));
  return {rows,headers,sheetName:sheet.name,sheets:wb.worksheets.map(w=>w.name),fileName};
}

const MAX_WORKBOOK_ROWS = 1500000;
const MAX_WORKBOOK_COLUMNS = 200;
function enforceWorkbookBounds(parsed){
  if(parsed.headers.length > MAX_WORKBOOK_COLUMNS) throw new Error(`Workbook has too many columns. The maximum supported is ${MAX_WORKBOOK_COLUMNS}.`);
  if(parsed.rows.length > MAX_WORKBOOK_ROWS) throw new Error(`Workbook has too many data rows. The maximum supported is ${MAX_WORKBOOK_ROWS.toLocaleString()}.`);
  return parsed;
}
function suggest(headers){ const n=new Map(headers.map(h=>[norm(h),h])); const out={}; for(const [f,d] of Object.entries(FIELDS)){ const a=d.aliases.map(norm).find(x=>n.has(x)); out[f]=a?n.get(a):null; } return out; }
async function inspect(buffer,fileName,sheetName){ const p=enforceWorkbookBounds(await workbook(buffer,fileName,sheetName)); return {fileName,fileType:path.extname(fileName).slice(1).toLowerCase(),sheets:p.sheets,selectedSheet:p.sheetName,rowCount:p.rows.length,columns:p.headers,suggestedMapping:suggest(p.headers),sampleRows:p.rows.slice(0,5)}; }
function mapErrors(mapping,headers){ const e=[]; for(const [f,d] of Object.entries(FIELDS)){ if(d.required&&!mapping[f]) e.push({field:f,code:'MISSING_REQUIRED_MAPPING',message:`${d.label} must be mapped.`}); if(mapping[f]&&!headers.includes(mapping[f])) e.push({field:f,code:'MAPPED_COLUMN_NOT_FOUND',message:`${d.label} maps to a missing column.`}); } return e; }
async function importFile({buffer,fileName,businessId,companyId,userId,periodStart,periodEnd,mapping,templateId,mode='reject',sheetName}){
  if(periodStart>periodEnd) throw new Error('Reporting period start cannot be after end.');
  const p=enforceWorkbookBounds(await workbook(buffer,fileName,sheetName)); const parsed=mappingSchema.safeParse(mapping); if(!parsed.success) throw new Error('Invalid column mapping.');
  const map=parsed.data, me=mapErrors(map,p.headers); if(me.length){const e=new Error('Column mapping is incomplete or invalid.');e.details=me;throw e;}
  const business=db.prepare('SELECT id,name FROM businesses WHERE id=? AND company_id=? AND is_active=1').get(businessId,companyId); if(!business) throw new Error('Business not found or inactive.');
  const existing=db.prepare("SELECT id,file_name AS fileName,status,row_count AS rowCount,period_start AS periodStart,period_end AS periodEnd FROM sales_imports WHERE company_id=? AND business_id=? AND period_start<=? AND period_end>=? AND status IN ('completed','completed_with_warnings','processing') ORDER BY created_at DESC").all(companyId,businessId,periodEnd,periodStart);
  if(existing.length&&mode==='reject'){const e=new Error('A sales import already exists for this business and reporting period. Choose add or replace explicitly.');e.code='PERIOD_ALREADY_IMPORTED';e.existing=existing;throw e;}
  if(existing.length&&mode==='replace'&&existing.some(x=>periodStart>x.periodStart||periodEnd<x.periodEnd)){const e=new Error('The selected replacement dates cover only part of an existing import. Expand the selected dates to cover each overlapping import in full, or choose Add to existing period. No existing sales data was changed.');e.code='PARTIAL_REPLACE_UNSAFE';e.existing=existing;throw e;}
  const issues=[], valid=[];
  p.rows.forEach((r,i)=>{const sourceRow=i+2, d=date(r[map.transactionDate]), sales=num(r[map.salesAmount]); const warnings=[]; if(!d) issues.push({sourceRow,severity:'error',code:'INVALID_DATE',message:'Transaction date is missing or invalid.'}); if(sales===null) issues.push({sourceRow,severity:'error',code:'INVALID_SALES_AMOUNT',message:'Sales amount is missing or invalid.'}); const outside=d&&(d<periodStart||d>periodEnd); if(outside) warnings.push({sourceRow,severity:'warning',code:'OUTSIDE_REPORTING_PERIOD',message:`Transaction date ${d} is outside the selected reporting period.`}); if(num(r[map.quantity])<0) warnings.push({sourceRow,severity:'warning',code:'NEGATIVE_QUANTITY',message:'Quantity is negative.'}); if(sales<0) warnings.push({sourceRow,severity:'warning',code:'NEGATIVE_SALES',message:'Sales amount is negative.'}); issues.push(...warnings); if(!d||sales===null||outside)return; valid.push({transactionId:r[map.transactionId]==null?null:String(r[map.transactionId]),transactionDate:d,productId:r[map.productId]==null?null:String(r[map.productId]),productName:r[map.productName]==null?null:String(r[map.productName]),category:r[map.category]==null?null:String(r[map.category]),quantity:num(r[map.quantity]),salesAmount:sales,grossAmount:num(r[map.grossAmount]),returnsAmount:num(r[map.returnsAmount]),costAmount:num(r[map.costAmount]),profitAmount:num(r[map.profitAmount]),salesperson:r[map.salesperson]==null?null:String(r[map.salesperson]),sourceRow});});
  const errors=issues.filter(x=>x.severity==='error'), warnings=issues.filter(x=>x.severity==='warning');
  const rejectedRows=p.rows.length-valid.length;
  if(!valid.length) {const e=new Error('No valid sales rows were found.');e.details=issues.slice(0,100);throw e;}
  const totals=valid.reduce((a,r)=>({sales:a.sales+(r.salesAmount||0),gross:a.gross+(r.grossAmount||0),returns:a.returns+(r.returnsAmount||0),profit:a.profit+(r.profitAmount||0)}),{sales:0,gross:0,returns:0,profit:0});
  const importId=id('imp'), now=nowIso();
  db.transaction(()=>{
    if(mode==='replace'&&existing.length){const ids=existing.map(x=>x.id), q=ids.map(()=>'?').join(',');db.prepare(`DELETE FROM sales_import_issues WHERE import_id IN (${q})`).run(...ids);db.prepare(`DELETE FROM sales_transactions WHERE import_id IN (${q})`).run(...ids);db.prepare(`UPDATE sales_imports SET status='replaced',completed_at=? WHERE id IN (${q})`).run(now,...ids);}
    db.prepare(`INSERT INTO sales_imports(id,company_id,business_id,file_name,file_type,template_id,period_start,period_end,row_count,valid_rows,rejected_rows,transaction_count,sales_total,gross_total,returns_total,profit_total,status,warning_count,error_count,created_by,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(importId,companyId,businessId,fileName,path.extname(fileName).slice(1).toLowerCase(),templateId||null,periodStart,periodEnd,p.rows.length,valid.length,rejectedRows,valid.length,totals.sales,totals.gross,totals.returns,totals.profit,rejectedRows||warnings.length?'completed_with_warnings':'completed',warnings.length,errors.length,userId,now,now);
    const ins=db.prepare(`INSERT INTO sales_transactions(id,company_id,business_id,import_id,transaction_id,transaction_date,product_id,product_name,category,quantity,sales_amount,gross_amount,returns_amount,cost_amount,profit_amount,salesperson,source_file,source_sheet,source_row,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for(const r of valid) ins.run(id('sale'),companyId,businessId,importId,r.transactionId,r.transactionDate,r.productId,r.productName,r.category,r.quantity,r.salesAmount,r.grossAmount,r.returnsAmount,r.costAmount,r.profitAmount,r.salesperson,fileName,p.sheetName,r.sourceRow,now);
    const issueIns=db.prepare(`INSERT INTO sales_import_issues(id,import_id,source_row,severity,code,field,message,created_at) VALUES(?,?,?,?,?,?,?,?)`);
    for(const issue of issues.slice(0,100)) issueIns.run(id('issue'),importId,issue.sourceRow ?? null,issue.severity,issue.code,issue.field ?? null,issue.message,now);
  })();
  return {importId,businessId,businessName:business.name,fileName,sheetName:p.sheetName,periodStart,periodEnd,rowCount:p.rows.length,validRows:valid.length,rejectedRows,warningCount:warnings.length,errorCount:errors.length,salesTotal:totals.sales,grossTotal:totals.gross,returnsTotal:totals.returns,profitTotal:totals.profit,status:rejectedRows||warnings.length?'completed_with_warnings':'completed',issues:issues.slice(0,100)};
}
module.exports={FIELDS,inspect,importFile};
