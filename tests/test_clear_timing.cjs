const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const root=__dirname+'/../app/helper/';
function setup(){
 const c=vm.createContext({console,structuredClone,crypto:require('node:crypto').webcrypto});
 for(const file of ['timing.js','plan-state.js','timeline-edit.js'])vm.runInContext(fs.readFileSync(root+file,'utf8'),c);
 const actions=fs.readFileSync(root+'actions.js','utf8');
 vm.runInContext(actions.slice(actions.indexOf('function spreadMonthShares'),actions.indexOf('let paymentMonthYear')),c);
 const app=fs.readFileSync(root+'app.js','utf8');
 vm.runInContext(app.slice(app.indexOf('function draftEntries('),app.indexOf('function affectedIds(')),c);
 c.copy=structuredClone;c.effectiveDates=()=>[];c.notice=()=>{};
 c.entries={a:{name:'Old months',salary:true,lines:[{basis:'timing-action',action:{name:'Months',type:'months',paymentMonths:[{month:'2027-09',percent:'100'}]}}]}};
 c.planEntry=id=>c.entries[id];c.actionEntry=(a,id)=>({name:a.name,salary:c.entries[id].salary,lines:[{basis:'timing-action',action:a}]});
 c.stagePlan=(ids,entries)=>{c.staged=entries;Object.assign(c.entries,entries);};
 return c;
}
const run=(c,s)=>vm.runInContext(s,c);
test('removing the last month creates an explicit clear; a new month replaces it',()=>{
 const c=setup();run(c,"timelineStage(['a'],a=>TimelineMonths.remove(a,'2027-09'))");
 assert.equal(c.staged.a.clearTiming,true);assert.equal(c.staged.a.salary,true);
 const body=run(c,"draftEntries(planEntry('a'),'a')[0]");assert.equal(body.clearTiming,true);assert.equal(body.lines.length,0);assert.equal(body.sharedId,null);
 run(c,"timelineStage(['a'],a=>TimelineMonths.add(a,['2027-10']))");
 const retimed=run(c,"draftEntries(planEntry('a'),'a')[0]");assert.equal(retimed.clearTiming,false);assert.equal(retimed.lines[0].action.paymentMonths[0].month,'2027-10');
});
test('removing one of several months remains a valid allocation',()=>{
 const c=setup();run(c,"timelineStage(['a'],a=>TimelineMonths.add(a,['2027-10']));timelineStage(['a'],a=>TimelineMonths.remove(a,'2027-09'))");
 const body=run(c,"draftEntries(planEntry('a'),'a')[0]");assert.equal(body.clearTiming,false);assert.equal(Number(body.lines[0].action.paymentMonths[0].percent),100);
});
test('explicit bulk clear unlinks only its scope and drafts survive navigation serialization',()=>{
 const c=setup();c.entries.b={...structuredClone(c.entries.a),sharedId:'shared',updateShared:true};c.entries.z=structuredClone(c.entries.b);
 const other=JSON.stringify(c.entries.z);run(c,"clearTimelineTiming(['a','b'])");
 assert.equal(c.staged.b.sharedId,null);assert.equal(c.staged.b.updateShared,false);assert.equal(JSON.stringify(c.entries.z),other);
 c.entries.a=JSON.parse(JSON.stringify(c.entries.a));assert.equal(run(c,"draftEntries(planEntry('a'),'a')[0].clearTiming"),true);
 run(c,"entries.a.lines[0].fixed='2027-11-30'");assert.equal(run(c,"draftEntries(planEntry('a'),'a')[0].clearTiming"),false);
});
test('save blockers exempt only the explicit clear preview, even alongside date edits',()=>{
 const c=setup();c.model={costs:[{id:'a',timingCleared:true,rule:null,unallocated:100,allocationIssues:[]},{id:'b',unallocated:100,allocationIssues:['Date missing']}]};
 c.saved={costs:[{id:'a',unallocated:0,allocationIssues:[]},{id:'b',unallocated:0,allocationIssues:[]}]};
 assert.deepEqual(Array.from(run(c,"PlanState.blockers(model,new Set(['a','b']),saved,true)"),x=>x.id),['b']);
 c.model.costs[0].allocationIssues=['Invalid'];assert.equal(run(c,"PlanState.blockers(model,new Set(['a']),saved).length"),1);
});
test('Save changes sends the clear operation and clears selection after success',async()=>{
 const c=setup();run(c,"clearTimelineTiming(['a'])");c.document={addEventListener(){}};
 vm.runInContext(fs.readFileSync(root+'planner.js','utf8'),c);
 c.paymentDrafts=new Map([['a',c.entries.a]]);c.paymentDirty=new Set(['a']);c.selected=new Set(['a']);
 c.project={state:{revision:1,costs:[{id:'a',rule:'old'}]},model:{months:['2027-09'],costs:[{id:'a',amount:100,rule:'old',payments:[{date:'2027-09-30',amount:100}],unallocated:0,allocationIssues:[]}]}};
 c.previewModel={months:['2027-09'],costs:[{id:'a',rule:null,timingCleared:true,amount:100,payments:[],unallocated:100,allocationIssues:[]}]};
 c.busy=false;c.dateDirty=false;c.previewError='';c.previewTicket=0;c.dateDraft=[];c.pendingConflict=()=>null;
 c.hasPending=()=>c.paymentDirty.size>0;c.affectedIds=(e,k)=>new Set([k]);
 c.document={body:{classList:{add(){},remove(){}}},querySelector:()=>({inert:false})};c.$=()=>({inert:false});
 c.updatePlanSave=()=>{};c.render=()=>{};c.saveDraftStore=()=>{};c.notice=()=>{};
 c.api=async(action,body)=>{assert.equal(action,'rules');assert.equal(body.arrangements[0].clearTiming,true);assert.equal(body.arrangements[0].lines.length,0);return {state:{revision:2},model:c.previewModel};};
 await run(c,'savePlan()');assert.equal(c.paymentDirty.size,0);assert.equal(c.selected.size,0);assert.equal(c.project.state.revision,2);
});
