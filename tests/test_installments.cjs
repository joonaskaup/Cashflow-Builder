const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=__dirname+'/../app/helper/';
function context(){const c=vm.createContext({Schedule:require(root+'schedule.js'),crypto:require('node:crypto').webcrypto,structuredClone});vm.runInContext(fs.readFileSync(root+'installments.js','utf8'),c);const actions=fs.readFileSync(root+'actions.js','utf8');vm.runInContext(actions.slice(actions.indexOf('function spreadMonthShares'),actions.indexOf('function togglePaymentMonth')),c);return c;}
function seed(){return [{id:'i1',name:'Director · Installment 1',installmentGroup:'g',installmentGroupName:'Director',installmentNumber:1,kind:'milestone',start:'',end:'',weights:{}}];}
test('click placement retains identity, numbers and multiple markers per month',()=>{
 const c=context(),d=seed();const one=c.placeInstallment(d,'g','2027-02');assert.equal(one.id,'i1');assert.equal(one.start,'2027-02-28');
 const two=c.placeInstallment(d,'g','2027-06');const three=c.placeInstallment(d,'g','2027-06');assert.notEqual(two.id,three.id);assert.equal(three.installmentNumber,3);
 two.inputError='bad';two.inputStart='bad';const moved=c.placeInstallment(d,'g','2028-02',two.id);
 assert.equal(moved.id,two.id);assert.equal(moved.installmentNumber,2);assert.equal(moved.start,'2028-02-29');assert.equal(moved.inputStart,undefined);assert.equal(d.length,3);
 assert.throws(()=>c.placeInstallment(d,'missing','2027-06'));assert.throws(()=>c.placeInstallment(d,'g','2027-06','missing'));
});
test('new group action divides 100% and snapshots stable milestone references',()=>{
 const c=context(),d=seed();for(const m of ['2027-02','2027-06','2027-11'])c.placeInstallment(d,'g',m);
 c.effectiveDates=()=>d;const a=c.installmentActions()[0];assert.equal(a.name,'Director');assert.equal(a.parts.length,3);
 assert.equal(a.parts.reduce((s,p)=>s+Math.round(Number(p.percent)*100),0),10000);
 const refs=a.parts.map(p=>p.ref);c.placeInstallment(d,'g','2027-12',d[1].id);assert.deepEqual(a.parts.map(p=>p.ref),refs);
 c.placeInstallment(d,'g','2028-01');assert.equal(a.parts.length,3);assert.equal(c.installmentActions()[0].parts.length,4);
});
test('empty groups are not assignable; twelve-payment limit is explicit',()=>{
 const c=context(),d=seed();c.effectiveDates=()=>d;assert.equal(c.installmentActions().length,0);
 for(let i=0;i<12;i++)c.placeInstallment(d,'g','2027-06');assert.throws(()=>c.placeInstallment(d,'g','2027-07'),/12 payments/);
});
function menuContext(){const c=context();Object.assign(c,{effectiveDates:()=>[],actionList:()=>[],actionChoices:()=>[],selected:new Set(),activeCosts:()=>[],euro:n=>'€'+n,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),unfinishedAction:()=>null,planClipboard:null});return c;}
test('installment chooser keeps empty rows visible and enables dated rows only for selected costs',()=>{
 const c=menuContext(),d=seed();c.effectiveDates=()=>d;vm.runInContext("timingCategory='installments'",c);
 let html=c.timingMenuHTML();assert.match(html,/Director/);assert.match(html,/Place each installment/);assert.doesNotMatch(html,/data-timing-choice="group-g"/);
 c.placeInstallment(d,'g','2027-08');html=c.timingMenuHTML();assert.match(html,/data-timing-choice="group-g" disabled/);
 c.selected.add('cost');html=c.timingMenuHTML();assert.match(html,/Set percentages for 1 selected cost/);assert.doesNotMatch(html,/data-timing-choice="group-g" disabled/);
 d[0].inputError='invalid';assert.match(c.timingMenuHTML(),/Place each installment/);
});
test('all timing routes have distinct labels and selecting a route does not assign costs',()=>{
 const c=menuContext();const html=c.timingMenuHTML();for(const title of ['Months / Historical','Production periods','Installments','Saved patterns'])assert.ok(html.includes(title));
 const host={scrollIntoView:()=>{},querySelectorAll:()=>[]};let view;c.$=()=>host;c.showView=id=>view=id;
 c.useInstallmentGroup('g');assert.equal(view,'plan');assert.equal(vm.runInContext('timingCategory',c),'installments');assert.equal(c.selected.size,0);
});
test('single milestones are available and retain exact references; saved patterns stay independent',()=>{
 const c=menuContext(),d={id:'delivery',name:'Delivery',kind:'milestone',start:'2027-10-20',precision:'day'};c.effectiveDates=()=>[d];c.selected.add('c');vm.runInContext("timingCategory='installments'",c);
 assert.match(c.timingMenuHTML(),/data-timing-choice="milestone-delivery"/);const a=c.timingChoice('milestone-delivery');assert.equal(a.parts[0].ref,'delivery');assert.equal(a.parts[0].percent,'100');
 c.actionList=()=>[{id:'group-old',name:'Generated duplicate'},{id:'my-pattern',name:'My saved pattern'}];vm.runInContext("timingCategory='saved'",c);const html=c.timingMenuHTML();assert.match(html,/My saved pattern/);assert.doesNotMatch(html,/Generated duplicate/);
 const built=fs.readFileSync(root+'actions.js','utf8');assert.ok(built.includes("actions:[...actionList(),clean]"));assert.ok(!built.includes("actions:[...installmentActions()"));
});
test('choosing an installment opens a review for exactly the current selection',()=>{
 const c=menuContext(),d=seed();c.placeInstallment(d,'g','2027-08');c.effectiveDates=()=>d;c.selected=new Set(['one','two']);
 c.actionChoices=()=>c.installmentActions();const choice={dataset:{timingChoice:'group-g'}};
 const host={querySelectorAll:q=>q==='[data-timing-choice]'?[choice]:[]},custom={};c.$=id=>id==='plan-actions'?host:custom;
 let review;c.openAction=(a,ids,individual)=>review={a,ids,individual};c.bindTimingMenu();choice.onclick();
 assert.deepEqual(Array.from(review.ids),['one','two']);assert.equal(review.a.name,'Director');assert.equal(review.individual,false);
 c.selected.clear();review=null;choice.onclick();assert.equal(review,null);
});
