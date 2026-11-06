const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../app');
function context(){
 const nodes={},stored={},basis=['quantity','percent','amount'].map(v=>({dataset:{actionBasis:v}}));
 const choice={dataset:{timingChoice:'quick-percentage'}};
 const node=id=>nodes[id]??={innerHTML:'',classList:{toggle(){}},addEventListener(){},showModal(){},close(){},querySelectorAll(q){return id==='plan-actions'&&q==='[data-timing-choice]'?[choice]:q==='[data-action-basis]'?basis:[];}};
 const dates=[{id:'pre',name:'Preparation',kind:'period',start:'2026-04-01',end:'2026-10-19'},
  {id:'shoot',name:'Shooting',kind:'period',start:'2026-10-20',end:'2026-11-23',paidDays:24,weights:{'2026-10':9,'2026-11':15}},
  {id:'post',name:'Postproduction',kind:'period',start:'2026-11-24',end:'2027-07-31'}];
 const c=vm.createContext({console,Set,Map,selected:new Set(['crew']),copy:v=>JSON.parse(JSON.stringify(v)),
  project:{state:{config:{budget:'fictional'}},model:{costs:[{id:'crew',amount:1140182,sourceDuration:40,sourceDurationUnit:'days'}]},actionLibrary:{actions:[]}},
  sessionStorage:{setItem:(k,v)=>stored[k]=v,getItem:k=>stored[k],removeItem:k=>delete stored[k]},
  effectiveDates:()=>dates,$:node,esc:v=>String(v??''),Timing:{dateLabel:v=>v},
  option:(v,t,s)=>'<option value="'+v+'"'+(v===s?' selected':'')+'>'+t+'</option>',
  planEntry:()=>({salary:true}),emptyLine:(kind,ref)=>({kind,ref,value:0,months:0,days:0}),
  stagePlan:(ids,entries)=>c.staged={ids,entries}});
 for(const file of ['installments.js','actions.js'])vm.runInContext(fs.readFileSync(root+'/helper/'+file,'utf8'),c);
 c.actionScopeHTML=()=>'';c.actionPhaseStyle=()=>'';c.bindMonthPicker=()=>{};c.bindInstallmentForm=()=>{};
 c.previewActionForm=()=>{};
 return {c,nodes,basis,choice,stored,dates};
}
const read=c=>JSON.parse(vm.runInContext('JSON.stringify(actionEdit)',c));
function calculate(c,dates){
 const entry=c.actionEntry(read(c),'crew');
 const script="import sys,json;sys.path.insert(0,sys.argv[1]);from helper import engine;d=json.load(sys.stdin);print(json.dumps(engine.payments_for(d['cost'],d['rule'],d['dates'])))";
 return JSON.parse(require('node:child_process').execFileSync(root+'/runtime/python/bin/python3',['-I','-c',script,root],{
  input:JSON.stringify({cost:c.project.model.costs[0],rule:entry,dates}),encoding:'utf8'}));
}
test('top-menu percentage split switches to real quantity choices and calculates 16 prep + 24 shoot days',()=>{
 const {c,basis,choice,nodes,dates}=context();c.bindTimingMenu();choice.onclick();
 assert.equal(read(c).splitBy,'percent');basis[0].onclick();
 const a=read(c);assert.deepEqual(a.parts.map(p=>p.quantity),['remainder','timetable','fixed']);
 assert.equal(a.parts[0].window,'end');assert.equal(a.parts[2].days,'0');
 assert.match(nodes['action-dialog'].innerHTML,/<option value="remainder" selected>/);
 assert.match(nodes['action-dialog'].innerHTML,/>Calculated<\/span>/);
 const result=calculate(c,dates);assert.deepEqual(result.issues,[]);assert.equal(result.unallocated,0);
 assert.deepEqual(result.actionResult.parts.map(p=>p.quantity),[16,24]);
 assert.equal(result.payments.reduce((s,p)=>s+p.amount,0),1140182);
 // The older quantity route must produce the same cashflow.
 c.openAction({name:'Other route',type:'split',parts:[{name:'Preparation',ref:'pre',quantity:'remainder',window:'end'},{name:'Shooting',ref:'shoot',quantity:'timetable',window:'whole'}]},['crew'],true);
 assert.deepEqual(calculate(c,dates).payments,result.payments);
});
test('reopening the old broken draft fills the missing remainder without rewriting its source',()=>{
 const {c,dates,stored}=context(),draft={name:'Old draft',type:'split',splitBy:'quantity',parts:[{name:'Preparation',ref:'pre',moneyKind:'fixed',window:'end'},{name:'Shooting',ref:'shoot',quantity:'timetable',window:'whole'}]};
 const original=JSON.stringify(draft);c.openAction(draft,['crew'],true);
 assert.equal(read(c).parts[0].quantity,'remainder');assert.equal(JSON.stringify(draft),original);
 assert.equal(JSON.parse(stored['cashflow-action-form']).action.parts[0].quantity,'remainder');
 assert.deepEqual(calculate(c,dates).issues,[]);
});
test('switching units preserves explicit choices and separate percentages and euros',()=>{
 const {c}=context(),a={splitBy:'quantity',parts:[{quantity:'fixed',days:'5',months:'0.25',window:'end'},{quantity:'remainder',window:'whole'}]};
 c.setActionSplitBy(a,'percent');a.parts[0].percent='20';c.setActionSplitBy(a,'amount');a.parts[0].amount='4400';
 c.setActionSplitBy(a,'quantity');c.setActionSplitBy(a,'percent');
 assert.equal(a.parts[0].days,'5');assert.equal(a.parts[0].months,'0.25');assert.equal(a.parts[0].percent,'20');assert.equal(a.parts[0].amount,'4400');assert.equal(a.parts[1].quantity,'remainder');
});
test('unknown nonzero work quantities stay blank and explicit duplicate remainders are still rejected',()=>{
 const {c,dates}=context(),a={type:'split',splitBy:'percent',parts:[{ref:'pre',moneyKind:'remainder'},{ref:'post',moneyKind:'fixed',percent:'25'}]};
 c.setActionSplitBy(a,'quantity');assert.equal(a.parts[0].quantity,'remainder');assert.equal(a.parts[1].quantity,'fixed');assert.equal(a.parts[1].days,'');
 c.openAction({name:'Invalid',type:'split',splitBy:'quantity',parts:[{ref:'pre',quantity:'remainder'},{ref:'shoot',quantity:'remainder'}]},['crew'],false);
 assert.deepEqual(calculate(c,dates).issues,['Choose exactly one part for the remaining budget quantity']);
});
