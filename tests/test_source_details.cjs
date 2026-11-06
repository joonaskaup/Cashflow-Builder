const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function context(){
 const ctx={console,Intl,Set,Map,document:{createElement:()=>({}),getElementById:()=>null,body:{}},project:{capabilities:['source-details-v2','producer-fees-only','salary-title-notes','salary-note-payments'],model:{costs:[]},state:{source:{groups:[]}}},busy:false,
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  formatMonth:m=>m==='historical'?'Historical':m.slice(5)+'/'+m.slice(2,4),euro:n=>'€'+n/100,hasPending:()=>false,
  notice:(text,error)=>{ctx.message=text;ctx.error=error;},api:async()=>{throw Error('Unexpected request');}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../app/helper/source-details.js'),'utf8'),ctx);return ctx;
}
test('budget inputs include units multiplier and original H amount without recalculation',()=>{
 const c=context(),html=c.sourceDetailHTML({name:'Fee',sourceHeading:'Producer fees',sourceDetails:[{row:8,description:'<script>fee</script>',quantity:1,unit:'kk',multiplier:2,rate:4500,amount:5000,amountCell:'H8'}]});
 for(const s of ['Producer fees','months (kk)','Multiplier','€4,500.00','€5,000.00','H8'])assert.ok(html.includes(s),s);
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('€9,000'));
});
test('salary and fringe rows remain visible with blank inputs and rate precision',()=>{
 const c=context(),html=c.sourceDetailHTML({name:'Salary',groupedSalaryCosts:true,sourceDetails:[{description:'Salary',quantity:28,unit:'pv',rate:252.1234,amount:7059.46,amountCell:'H11'},{description:'Employer costs',quantity:null,unit:'',rate:null,multiplier:null,amount:1000,amountCell:'H12'}]});
 assert.ok(html.includes('salary and related costs'));assert.ok(html.includes('28'));assert.ok(html.includes('days (pv)'));assert.ok(html.includes('€252.1234'));assert.ok(html.includes('Employer costs'));assert.ok(html.includes('—'));
});
test('pending work blocks refresh instead of replacing draft identities',async()=>{
 const c=context();c.hasPending=()=>true;let called=false;c.api=async()=>{called=true;};await c.previewBudgetRefresh();assert.equal(called,false);assert.ok(c.message.includes('still kept'));assert.equal(c.busy,false);
});
test('refresh without splits uses preview token; failure leaves project unchanged',async()=>{
 const c=context();c.api=async name=>{assert.equal(name,'refresh-preview');return {splits:[],token:'reviewed'};};c.mutate=async(action,body)=>{c.commit={action,body};};
 await c.previewBudgetRefresh();assert.equal(c.commit.action,'refresh');assert.equal(c.commit.body.refreshToken,'reviewed');
 const old=c.project;c.api=async()=>{throw Error('Workbook unavailable');};await c.previewBudgetRefresh();assert.equal(c.project,old);assert.equal(c.message,'Budget refresh did not complete: Workbook unavailable');assert.equal(c.busy,false);
});
test('source rate mapping and monthly summaries retain Historical',()=>{
 const c=context();c.project.state.source.groups=[{sourceDetails:[{rateColumn:'F',multiplierColumn:''}]}];assert.equal(c.sourceDefaultColumn('rate','G'),'F');assert.equal(c.sourceDefaultColumn('multiplier','F'),'');
 const s=c.sourcePaymentSummary([{payments:[{date:'historical',bucket:'historical',amount:100},{date:'2027-07-15',amount:200}]}]);assert.ok(s.includes('Historical €1'));assert.ok(s.includes('07/27 €2'));
});
test('old running host gets a restart message without attempting refresh',async()=>{
 const c=context(),old=c.project;delete c.project.capabilities;
 let called=false;c.api=async()=>{called=true;};await c.previewBudgetRefresh();
 assert.equal(called,false);assert.equal(c.project,old);assert.ok(c.message.includes('running app needs restarting'));assert.equal(c.error,true);
});
test('old extraction keeps the budget description visible until refresh',()=>{
 const c=context(),html=c.sourceDetailHTML({name:'Producer fees',sourceDescription:'Lead producer and partner'});
 assert.ok(html.includes('Lead producer and partner'));assert.ok(html.includes('Budget details'));assert.ok(html.includes('Refresh budget'));
});
test('built page does not depend on the newly introduced script route',()=>{
 const base=require('node:path').dirname(require.resolve('../app/helper/source-details.js'));
 const app=fs.readFileSync(base+'/app.js','utf8'),html=fs.readFileSync(base+'/index.html','utf8');
 assert.ok(app.includes('function sourceDetailHTML'));assert.ok(app.includes('function previewBudgetRefresh'));
 assert.ok(!html.includes('src="/source-details.js"'));new vm.Script(app);
});
test('zero fringe placeholders do not suggest an independent fee is salary',()=>{
 const plan=require('../app/helper/plan-state.js');
 assert.equal(plan.salaryCandidate({groupedSalaryCosts:false,components:['holiday pay']}),false);
 assert.equal(plan.salaryCandidate({groupedSalaryCosts:true,components:[]}),true);
 assert.equal(plan.salaryCandidate({components:['holiday pay']}),true);
});
test('salary note stays visible as context and reunion needs explicit apply',async()=>{
 const c=context();const cost={id:'a',name:'Järjestäjä',amount:246769,sourceNotes:['(kuvaukset Suomessa)'],sourceDetails:[{row:175,description:'TBC',quantity:5,unit:'pv',amount:1788.25,amountCell:'H175'}],payments:[{date:'2027-09-30',amount:246769}]};
 cost.sourceMergeFixedPayments=true;cost.sourceMergeNote='Existing payments retained as fixed euro installments. They no longer follow production timetable changes.';
 const html=c.sourceDetailHTML(cost);assert.ok(html.includes('(kuvaukset Suomessa)'));assert.ok(html.includes('days (pv)'));
 const buttons={};let dialog;
 c.document.createElement=()=>dialog={className:'',innerHTML:'',showModal(){this.shown=true;},querySelector:id=>buttons[id]??=( {} ),addEventListener(){}};
 c.document.body.append=()=>{};
 let calls=0;c.api=async()=>{calls++;return {token:'review',splits:[],merges:[{parents:[{id:'a',name:'Järjestäjä',amount:178825,first:175,last:175},{id:'b',name:'(kuvaukset Suomessa)',amount:67944,first:176,last:177}],cost}],before:{total:246769,costs:[]},after:{total:246769}};};
 await c.previewBudgetRefresh();assert.equal(calls,1);assert.equal(dialog.shown,true);
 assert.ok(dialog.innerHTML.includes('Correct salary grouping'));assert.ok(dialog.innerHTML.includes('Apply grouping correction'));assert.ok(!dialog.innerHTML.includes('Separate producer fees'));
 assert.ok(dialog.innerHTML.includes('Keep existing payments:'));assert.ok(dialog.innerHTML.includes('no longer follow production timetable changes'));
 assert.equal(typeof buttons['#source-refresh-apply'].onclick,'function');
});

test('previous salary-note host is rejected until restarted',async()=>{
 const c=context();c.project.capabilities=['source-details-v2','producer-fees-only','salary-title-notes'];
 await c.previewBudgetRefresh();assert.ok(c.message.includes('running app needs restarting'));assert.equal(c.error,true);
});
