const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const auditRoutes=fs.readFileSync(path.join(root,'server/audit/auditRoutes.js'),'utf8');
const auditPage=fs.readFileSync(path.join(root,'public/js/pages/audit.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/js/components/ui.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8');
const schema=fs.readFileSync(path.join(root,'server/database/schema.sql'),'utf8');
const database=fs.readFileSync(path.join(root,'server/database/database.js'),'utf8');
for(const [name,text,checks] of [
 ['auditRoutes',auditRoutes,["requirePermission('audit.view')","/api/audit/meta","search","ORDER BY a.created_at DESC, a.id DESC"]],
 ['auditPage',auditPage,['auditFilters','businessId','userId','from','to','auditPrev','auditNext','details']],
 ['ui',ui,['data-page="audit"','can(\'audit.view\')']],
 ['app',app,["audit:'audit.view'","state.page==='audit'","bindAudit"]],
 ['schema',schema,['trg_audit_logs_no_update','trg_audit_logs_no_delete']],
 ['database',database,['trg_audit_logs_no_update','trg_audit_logs_no_delete']]
]) for(const c of checks)if(!text.includes(c))throw new Error(`${name} missing ${c}`);
console.log('AUDIT_UI_INTEGRITY_TEST_PASS');
