/* Action recipes are copied into independent cost arrangements. Dates stay linked. */
let actionChoice='during-shoot', actionEdit=null, actionTargets=[],actionPreviewTicket=0,actionTimer=null,actionFormSaved='';
const actionFor=id=>planEntry(id)?.lines?.find(l=>l.basis==='timing-action')?.action;
function actionEntry(a,id){return {name:a.name,autoName:false,mode:'period',salary:!!planEntry(id).salary,lines:[{...emptyLine('balance',a.type==='historical'?'hist':a.ref||'shoot'),basis:'timing-action',action:copy(a)}]};}
function actionList(){return project.actionLibrary?.actions||[];}
function actionChoices(){return [{id:'quick-months',name:'Choose payment months',type:'months',paymentMonths:[]},...installmentActions(),...actionList(),...effectiveDates().filter(d=>d.kind==='period'&&d.id!=='hist').map(d=>({id:'quick-period-'+d.id,name:'Throughout '+d.name,type:'period',ref:d.id,window:'whole'})),{id:'quick-percentage',name:'Split by percentages',type:'split',splitBy:'percent',parts:[{name:'Preparation',ref:'pre',moneyKind:'fixed',percent:'',moneyPlacement:'whole'},{name:'Shooting',ref:'shoot',moneyKind:'remainder',moneyPlacement:'whole'},{name:'Wrap',ref:'post',moneyKind:'fixed',percent:'0',moneyPlacement:'start'}]}].filter((a,i,items)=>items.findIndex(x=>x.id===a.id)===i);}
let actionReview=null;
function actionReadyIds(model,ids){return ids.filter(id=>{const c=model?.costs.find(c=>c.id===id);return c&&!c.allocationIssues?.length&&!c.unallocated;});}

function unfinishedAction(){try{const v=JSON.parse(sessionStorage.getItem('cashflow-action-form'));return v?.budget===project.state.config.budget?v:null;}catch(_){return null;}}
function actionToolbar(){return timingMenuHTML();}
function bindActionToolbar(){
 bindTimingMenu();
 $('plan-clear').onclick=()=>setSelection([]);
 $('action-resume')?.addEventListener('click',()=>{const v=unfinishedAction();openAction(v.action,v.targets.filter(id=>project.model.costs.some(c=>c.id===id)),v.action._individual);});
 $('action-mark-salary').onclick=()=>markPlanSalary(!activeCosts().every(c=>planEntry(c.id).salary));
 $('action-copy').onclick=()=>{const c=activeCosts()[0];planClipboard={name:c.name,entry:PlanState.independent(planEntry(c.id))};renderPlan();notice('Timing copied. Select costs, then Paste timing.');};
 $('action-paste').onclick=()=>stagePlan([...selected],Object.fromEntries([...selected].map(id=>[id,copy(planClipboard.entry)])),'Timing copied independently to selected costs.');
}
function assignAction(a,ids){
 if(!a||!ids.length)return;
 if(a.type==='split'&&(a.splitBy||'quantity')==='quantity'&&(a.parts||[]).some(p=>p.quantity==='fixed'&&ids.some(id=>{const u=project.model.costs.find(c=>c.id===id)?.sourceDurationUnit;return ['days','months'].includes(u)&&(p[u]==null||p[u]==='');}))){openAction(a,ids,false);return;}
 stagePlan(ids,Object.fromEntries(ids.map(id=>[id,actionEntry(a,id)])),'Action assigned in the preview. Each cost keeps its own amount. Review the results, then Save changes.');
}
function actionResults(costs,model,waiting=false,controls=true){
 return '<div class="action-results">'+costs.map(c=>{
 const shown=model?.costs.find(x=>x.id===c.id)||c, result=shown.actionResult,errors=shown.allocationIssues||[];
 const monthly=paymentsByMonth(shown),a=actionFor(c.id);
 return '<article class="action-cost"><div class="action-cost-title"><strong>'+esc(c.name)+' · '+euro(c.amount)+'</strong><span>'+esc(sourceHint(c))+' · rows '+c.first+'–'+c.last+'</span></div>'+sourceDetailHTML(c)+(waiting?'<p>Calculating…</p>':errors.length?'<p class="plan-problem">'+esc(errors.join('; '))+'</p>':result?'<table><thead><tr><th>Part</th><th>Quantity / share</th><th>Dates</th><th class="money">Amount</th></tr></thead><tbody>'+result.parts.map(p=>'<tr style="'+actionPhaseStyle(p.ref)+'"><td>'+esc(p.name)+'</td><td>'+ actionQuantityLabel(p,result)+'</td><td>'+ (p.ref==='hist'?'One historical total':p.start?esc(Timing.dateLabel(p.start)+' – '+Timing.dateLabel(p.end)):(result.splitBy?'No payment':'One total'))+'</td><td class="money">'+euro(p.amount)+'</td></tr>').join('')+'</tbody></table><p><strong>Payments: </strong>'+Object.entries(monthly).sort().map(([m,v])=>formatMonth(m)+' '+euro(v)).join(' · ')+'</p>'+result.notes.map(n=>'<p class="muted">'+esc(n)+'</p>').join(''):'<p>'+esc(shown.description)+'</p>')+(!waiting&&model?outsideWarning(shown,model):'')+(controls?'<div class="actions"><button data-action-only="'+c.id+'">Edit only '+esc(c.name)+'</button>'+(a?'<button data-action-adjust="'+c.id+'">Adjust this cost’s action</button>':'')+(pendingCostIds().has(c.id)?'<button data-action-revert="'+c.id+'">Keep previous timing</button>':'')+'</div>':'')+'</article>';
 }).join('')+'</div>';
}
function bindActionResults(host){
 host.querySelectorAll('[data-action-only]').forEach(b=>b.onclick=()=>setSelection([b.dataset.actionOnly]));
 host.querySelectorAll('[data-action-adjust]').forEach(b=>b.onclick=()=>openAction(actionFor(b.dataset.actionAdjust),[b.dataset.actionAdjust],true));
 host.querySelectorAll('[data-action-revert]').forEach(b=>b.onclick=()=>{
 const id=b.dataset.actionRevert;let next=PlanState.focus([...paymentDrafts].filter(([k])=>paymentDirty.has(k)),id,r=>project.state.costs.filter(c=>c.rule===r).map(c=>c.id));
 if(!next.some(([k])=>k===id))return notice('This cost belongs to a deliberate shared edit. Review that edit before discarding it.',true);
 paymentDrafts=new Map(next.filter(([k])=>k!==id));paymentDirty=new Set(paymentDrafts.keys());draft=null;draftKey='';previewModel=null;previewTicket++;saveDraftStore();render();queuePreview();
 });
}
function renderActionSelection(host,costs,model,waiting){
 host.innerHTML='<div class="plan-selection"><h3>'+costs.length+' cost'+(costs.length===1?'':'s')+' · assigned actions</h3><p>'+ (costs.some(c=>pendingCostIds().has(c.id))?'Includes unsaved timing.':'Saved timing.')+' Each row can be changed independently.</p>'+actionResults(costs,model,waiting)+'<button data-action-detail>Edit as detailed payments</button></div>';
 bindActionResults(host);host.querySelector('[data-action-detail]').onclick=()=>{const entries={};for(const c of costs){const current=planEntry(c.id),resolved=model.costs.find(x=>x.id===c.id)?.actionResult?.resolvedLines;if(!resolved)return notice('Finish this action’s quantities before opening detailed payments.',true);const lines=copy(resolved);if(lines.length===1&&lines[0].kind==='units'){lines[0].kind='balance';lines[0].value=0;}entries[c.id]={...PlanState.independent(current),lines,mode:modeFor(lines)};}stagePlan(costs.map(c=>c.id),entries,'Converted this selection to detailed payments. Undo restores the reusable action.');showView('costs');};
}
let actionLibrarySaved='';
function actionPhaseStyle(ref){const i=effectiveDates().filter(d=>d.kind==='period'&&d.id!=='hist').findIndex(d=>d.id===ref);return i<0?'':'--part-color:'+phaseColours[i%phaseColours.length]+';background-color:var(--part-color)';}
function actionCopyForLibrary(a,items,newId){const clean=copy(a);delete clean._individual;clean.id=newId;const base=clean.name.trim();let name=base,i=2;while(items.some(x=>x.name===name))name=base+' ('+(i++)+')';clean.name=name;return clean;}
function actionScopeHTML(){const costs=actionTargets.map(id=>project.model.costs.find(c=>c.id===id)).filter(Boolean);return '<div class="action-scope"><strong>Editing only '+(costs.length===1?esc(costs[0].name)+' · rows '+costs[0].first+'–'+costs[0].last:costs.length+' selected costs')+'</strong><span>Assign applies only to the costs listed on the right. Matching names do not link costs. The saved reusable pattern stays unchanged.</span></div>';}
// Shares are kept in hundredths of a percent so every edit totals exactly 100%.
function spreadMonthShares(rows,total=10000){
 if(!rows.length)return;
 const weights=rows.map(p=>Math.max(0,Number(String(p.percent).replace(',','.'))||0));
 const sum=weights.reduce((a,b)=>a+b,0),raw=weights.map(w=>total*(sum?w/sum:1/rows.length));
 const values=raw.map(Math.floor),order=rows.map((_,i)=>i).sort((i,j)=>(raw[j]-values[j])-(raw[i]-values[i])||rows[i].month.localeCompare(rows[j].month));
 for(let i=0,left=total-values.reduce((a,b)=>a+b,0);i<left;i++)values[order[i]]++;
 rows.forEach((p,i)=>p.percent=String(values[i]/100));
}
function togglePaymentMonth(a,month){
 a.monthEqual??=true;a.paymentMonths??=[];const i=a.paymentMonths.findIndex(p=>p.month===month);
 if(i>=0)a.paymentMonths.splice(i,1);else a.paymentMonths.push({month,percent:100/Math.max(1,a.paymentMonths.length)});
 a.paymentMonths.sort((a,b)=>a.month===b.month?0:a.month==='historical'?-1:b.month==='historical'?1:a.month.localeCompare(b.month));if(a.monthEqual)a.paymentMonths.forEach(p=>p.percent='1');spreadMonthShares(a.paymentMonths);
}
function changeMonthShare(a,month,text){
 a.monthEqual=false;const row=a.paymentMonths.find(p=>p.month===month);row.percent=text;
 const s=text.trim().replace(/%$/,'').trim().replace(',','.');
 if(!/^\d+(\.\d{0,2})?$/.test(s)||Number(s)>100)return;
 const others=a.paymentMonths.filter(p=>p!==row);
 if(others.length)spreadMonthShares(others,10000-Math.round(Number(s)*100));
}
let paymentMonthYear=null;
function monthPickerForm(a){
 const periods=effectiveDates().filter(d=>d.kind==='period'&&d.id!=='hist'&&d.start&&d.end);
 paymentMonthYear??=Number(a.paymentMonths?.find(p=>p.month!=='historical')?.month.slice(0,4)||periods[0]?.start.slice(0,4)||project.state.config.firstMonth?.slice(0,4)||new Date().getFullYear());
 const rows=a.paymentMonths||[];
 return '<div class="month-picker"><p>Choose Historical, payment months, or both for the <strong>whole cost</strong>. Edit percentages to split an early payment from later payments.</p><button data-payment-month="historical" aria-pressed="'+rows.some(p=>p.month==='historical')+'"><strong>'+(rows.some(p=>p.month==='historical')?'✓ ':'')+'Historical</strong><small>Already paid · '+formatMonth('historical')+'</small></button><p class="muted">Historical stays in one total, without an individual payment date. Use a future month for development costs still to be paid.</p><div class="month-year"><button id="month-prev" aria-label="Previous year">‹</button><strong>'+paymentMonthYear+'</strong><button id="month-next" aria-label="Next year">›</button></div><div class="payment-month-grid">'+Array.from({length:12},(_,i)=>{
 const m=paymentMonthYear+'-'+String(i+1).padStart(2,'0'),on=rows.some(p=>p.month===m),phase=periods.filter(d=>d.start.slice(0,7)<=m&&d.end.slice(0,7)>=m);
 return '<button data-payment-month="'+m+'" aria-pressed="'+on+'" style="'+actionPhaseStyle(phase[0]?.id)+'"><strong>'+(on?'✓ ':'')+formatMonth(m)+'</strong><small>'+esc(phase.map(d=>d.name).join(' / ')||'—')+'</small></button>';
 }).join('')+'</div><p class="month-fixed-note">Fixed payment months — these stay put when production dates change. This replaces the whole cost’s timing when assigned.</p><div class="actions"><strong>'+rows.length+' payment destination'+(rows.length===1?'':'s')+' selected</strong><button id="months-equal" '+(!rows.length?'disabled':'')+'>Split equally</button></div>'+(rows.length?'<table class="month-shares"><thead><tr><th>Historical / payment month</th><th>Share (%)</th><th class="money">'+(actionTargets.length===1?'Amount':'Selected costs total')+'</th></tr></thead><tbody>'+rows.map(p=>'<tr><td>'+formatMonth(p.month)+'</td><td><input aria-label="'+formatMonth(p.month)+' percentage" data-month-share="'+p.month+'" inputmode="decimal" value="'+esc(p.percent)+'" '+(rows.length===1?'readonly':'')+'></td><td class="money" data-month-amount="'+p.month+'">…</td></tr>').join('')+'</tbody></table>':'<p>Choose Historical or a month above to begin.</p>')+'</div>';
}
function chooseWholeMonths(){
 const a=actionEdit;if(a.type!=='months')a.previousArrangement=a.type;
 a.type='months';a.paymentMonths??=[];persistActionForm();drawActionForm();previewActionForm();
}
function bindMonthPicker(host,a){
 host.querySelectorAll('[data-payment-month]').forEach(b=>b.onclick=()=>{togglePaymentMonth(a,b.dataset.paymentMonth);persistActionForm();drawActionForm();previewActionForm();});
 host.querySelectorAll('[data-month-share]').forEach(input=>input.oninput=()=>{changeMonthShare(a,input.dataset.monthShare,input.value);host.querySelectorAll('[data-month-share]').forEach(other=>{if(other!==input)other.value=a.paymentMonths.find(p=>p.month===other.dataset.monthShare).percent;});persistActionForm();previewActionForm();});
 $('months-equal')?.addEventListener('click',()=>{a.monthEqual=true;a.paymentMonths.forEach(p=>p.percent='1');spreadMonthShares(a.paymentMonths);persistActionForm();drawActionForm();previewActionForm();});
 for(const [id,delta] of [['month-prev',-1],['month-next',1]])$(id)?.addEventListener('click',()=>{paymentMonthYear+=delta;drawActionForm();previewActionForm();});
 $('choose-whole-months')?.addEventListener('click',chooseWholeMonths);
}

function actionPeriods(value){return effectiveDates().filter(d=>d.kind==='period'&&d.id!=='hist').map(d=>option(d.id,d.name+' · '+(d.start&&d.end?Timing.dateLabel(d.start)+'–'+Timing.dateLabel(d.end):'dates needed'),value)).join('');}
function placements(v){return option('whole','Within the whole period',v)+option('end','At the end of the period',v)+option('start','At the start of the period',v);}
function persistActionForm(){try{if(JSON.stringify(actionEdit)===actionFormSaved){sessionStorage.removeItem('cashflow-action-form');return;}sessionStorage.setItem('cashflow-action-form',JSON.stringify({budget:project.state.config.budget,action:actionEdit,targets:actionTargets}));}catch(_){} }
function openAction(a,ids,individual){
 actionLibrarySaved='';paymentMonthYear=null;actionEdit=copy(a);actionEdit._individual=individual;actionTargets=[...ids];actionFormSaved=!individual&&actionList().some(x=>x.id===a.id&&JSON.stringify(x)===JSON.stringify(a))?JSON.stringify(actionEdit):'';persistActionForm();
 let dialog=$('action-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='action-dialog';document.body.append(dialog);dialog.addEventListener('cancel',()=>persistActionForm());}
 drawActionForm();dialog.showModal();previewActionForm();
}
function initializeActionQuantities(a){
 const parts=a.parts||[],missing=parts.filter(p=>p.quantity==null||p.quantity==='');
 if(!missing.length)return;
 // Keep every explicit choice, including invalid duplicates for validation.
 // Preparation receives the remainder in the usual preparation/shooting split.
 const remainder=parts.some(p=>p.quantity==='remainder')?null:
  missing.find(p=>p.ref==='pre')||missing.find(p=>p.moneyKind==='remainder')||missing[0];
 for(const p of missing){
  p.quantity=p===remainder?'remainder':p.ref==='shoot'?'timetable':'fixed';
  p.window??=p.ref==='pre'?'end':p.ref==='post'?'start':'whole';
  if(p.quantity==='fixed'){
   const raw=p[a.splitBy==='amount'?'amount':'percent'];
   const zero=p.moneyKind!=='remainder'&&raw!=null&&String(raw).trim()!==''&&Number(String(raw).replace(',','.'))===0;
   p.days??=zero?'0':'';p.months??=zero?'0':'';
  }
 }
}
function setActionSplitBy(a,value){
 if(value==='quantity')initializeActionQuantities(a);
 a.splitBy=value;
 if(value!=='quantity'&&!(a.parts||[]).some(p=>p.moneyKind)){
  const remainder=(a.parts||[]).findIndex(p=>p.quantity==='remainder');
  (a.parts||[]).forEach((p,i)=>{p.moneyKind=i===(remainder<0?a.parts.length-1:remainder)?'remainder':'fixed';p.moneyPlacement='whole';});
 }
}
function actionQuantityLabel(p,r){
 if(p.quantity==null)return '—';
 return (r.splitBy==='amount'?euro(p.amount):Number(p.quantity.toFixed(3))+' '+esc(p.quantity===1?(r.unit||'units').replace(/s$/,''):r.unit||'units'))+(p.remainder?' · remaining':'');
}
function actionSplitForm(a,units){
 const monetary=(a.splitBy||'quantity')!=='quantity',basis=a.splitBy,unknown=actionTargets.filter(id=>{const c=project.model.costs.find(x=>x.id===id);return !['days','months'].includes(c?.sourceDurationUnit)||!(Number(c?.sourceDuration)>0);});
 const showDays=!actionTargets.length||units.has('days'),showMonths=!actionTargets.length||units.has('months');
 let h='<fieldset class="split-choices"><legend>How do you want to split this cost?</legend><div class="choice-row">'+[['quantity','Days / months'],['percent','Percentages'],['amount','Euros']].map(([v,label])=>'<button type="button" data-action-basis="'+v+'" aria-pressed="'+((a.splitBy||'quantity')===v)+'">'+label+'</button>').join('')+'</div></fieldset>';
 if(!monetary&&unknown.length)h+='<p class="plan-problem">'+unknown.length+' selected cost(s) have no recognised budget days or months. Choose Percentages or Euros to split their budget amounts.</p>';
 if(!monetary&&unknown.length===actionTargets.length&&actionTargets.length)return h;
 h+='<p>'+(monetary?'Divide each cost’s budget amount. Enter all parts, or let one receive the remaining balance. Payment timing does not imply a work duration.':'Enter the work quantities you know. One part receives the remaining budget days/months. Zero means no work in that part.')+'</p><table class="action-parts"><thead><tr><th>Work / period</th><th>'+ (monetary?'Share':'Quantity')+'</th>'+(monetary?'<th>'+ (basis==='percent'?'Percentage (%)':'Amount (€)')+'</th>':(showDays?'<th>Day budgets</th>':'')+(showMonths?'<th>Month budgets</th>':''))+'<th>'+(monetary?'When paid':'Placement')+'</th><th></th></tr></thead><tbody>';
 h+=(a.parts||[]).map((p,i)=>{
  const attr=' data-action-part="'+i+'" ';
  let row='<tr class="phase-part" style="'+actionPhaseStyle(p.ref)+'"><td><input aria-label="Part '+(i+1)+' name"'+attr+'data-key="name" value="'+esc(p.name)+'"><select aria-label="Part '+(i+1)+' period"'+attr+'data-key="ref">'+actionPeriods(p.ref)+'</select></td>';
  if(monetary){
   row+='<td data-label="Share"><select aria-label="Part '+(i+1)+' share"'+attr+'data-key="moneyKind">'+option('fixed',basis==='percent'?'Enter percentage':'Enter euros',p.moneyKind||'fixed')+option('remainder','Remaining balance',p.moneyKind)+'</select></td><td data-label="'+(basis==='percent'?'Percentage (%)':'Amount (€)')+'">'+(p.moneyKind==='remainder'?'<span data-action-remainder="'+i+'">Calculated below</span>':'<input aria-label="Part '+(i+1)+' '+(basis==='percent'?'percentage':'euros')+'"'+attr+'data-key="'+basis+'" inputmode="decimal" value="'+esc(p[basis]??'')+'" placeholder="'+(basis==='percent'?'e.g. 20':'e.g. 4400')+'">')+'</td><td data-label="When paid"><select aria-label="Part '+(i+1)+' payment timing"'+attr+'data-key="moneyPlacement">'+option('whole','Spread during the period',p.moneyPlacement||'whole')+option('start','Pay on period start',p.moneyPlacement)+option('end','Pay on period end',p.moneyPlacement)+'</select></td>';
  }else{
   row+='<td data-label="Quantity from"><select aria-label="Part '+(i+1)+' quantity"'+attr+'data-key="quantity">'+option('','Choose quantity…',p.quantity??'')+option('remainder','Remaining budget quantity',p.quantity)+option('timetable','From production timetable',p.quantity)+option('fixed','Enter quantity',p.quantity)+'</select></td>'+['days','months'].filter(u=>u==='days'?showDays:showMonths).map(u=>'<td data-label="'+(u==='days'?'Day budgets':'Month budgets')+'">'+(p.quantity==='fixed'?'<input aria-label="Part '+(i+1)+' '+u+'"'+attr+'data-key="'+u+'" inputmode="decimal" value="'+esc(p[u]??'')+'">':'<span class="muted">'+(p.quantity==='remainder'?'Calculated':'Linked')+'</span>')+'</td>').join('')+'<td data-label="Placement"><select aria-label="Part '+(i+1)+' placement"'+attr+'data-key="window">'+placements(p.window)+'</select></td>';
  }
  return row+'<td><button data-action-remove="'+i+'" aria-label="Remove part '+(i+1)+'">×</button></td></tr>';
 }).join('');
 return h+'</tbody></table><button id="action-add">Add work part</button><p class="muted">'+(monetary?(basis==='percent'?'Percentages follow each cost’s budget when amounts change.':'Euro entries remain fixed; the remaining balance adjusts for each cost.')+' During-period amounts are spread proportionally by calendar days and paid at month end. Start/end dates remain linked to the timetable.':'Day and month quantities are separate. Timetable months use calendar-month shares; paid days use the shared count. Payment is at each month end.')+'</p>';
}
function drawActionForm(){
 if(actionEdit.type==='split'&&(actionEdit.splitBy||'quantity')==='quantity'){initializeActionQuantities(actionEdit);persistActionForm();}
 const a=actionEdit,host=$('action-dialog'),units=new Set(actionTargets.map(id=>project.model.costs.find(c=>c.id===id)?.sourceDurationUnit));
 const showDays=!actionTargets.length||units.has('days'),showMonths=!actionTargets.length||units.has('months');
 let html='<div class="action-heading"><h2>'+(a._individual?'Adjust this cost':'Plan selected costs')+'</h2><div class="actions"><button id="action-abandon">Discard action edit</button><button id="action-close" aria-label="Close action editor">Close · keep draft</button></div></div><p>'+(a._individual?'This changes only the selected cost. Your reusable action stays unchanged.':'Review a first-draft pattern for the selected costs. Each keeps its own budget. Save the pattern for reuse if useful.')+'</p>'+actionScopeHTML()+'<div class="bulk-workspace"><div class="bulk-controls"><h3>Your timing choices</h3><div class="actions"><label>Timing label <input data-action-field="name" value="'+esc(a.name)+'"></label><label>Arrangement <select data-action-field="type">'+option('months','Choose payment months',a.type)+option('period','Work within one period',a.type)+option('split','Split work between periods',a.type)+option('span','Payments across periods',a.type)+option('historical','Historical total',a.type)+'</select></label></div>';
 if(a.type==='months')html+=monthPickerForm(a);
 else html+='<button id="choose-whole-months">Choose payment months for the whole cost</button>';
 if(a.type==='period')html+='<div class="actions"><label>Period <select data-action-field="ref">'+actionPeriods(a.ref)+'</select></label><label>Placement <select data-action-field="window">'+placements(a.window||'whole')+'</select></label></div><p>Uses each cost’s full budget amount and its own quantity. Whole-period placement spreads the cost within that period; it does not require working every production day.</p>';
 if(a.type==='split')html+=a.installmentGroup?installmentForm(a):actionSplitForm(a,units);
 if(a.type==='span')html+='<div class="actions"><label>From <select data-action-field="ref">'+actionPeriods(a.ref)+'</select></label><label>Through <select data-action-field="endRef">'+actionPeriods(a.endRef)+'</select></label><label>Allocation <select data-action-field="basis">'+option('equal-month','Equal monthly payments',a.basis)+option('calendar-days','Proportional calendar days',a.basis)+option('salary-months','Full / partial calendar months',a.basis)+option('balanced-months','Balanced first / last month',a.basis)+'</select></label>'+(a.basis==='balanced-months'?'<label>Full-rate months (blank = budget months)<input data-action-field="length" inputmode="decimal" value="'+esc(a.length||'')+'"></label>':'')+'</div><p>Paid at each month end. '+(a.basis==='balanced-months'?'The duration sets the last payment month; the “Through” period is not used.':'Both ends follow the production dates.')+'</p>';
 if(a.type==='historical')html+='<p>One historical total. No individual payment dates required.</p>';

 html+='</div><div class="bulk-review"><h3>Calculated result</h3><div id="action-live-results" aria-live="polite"></div></div></div><div class="actions action-form-buttons"><button id="action-apply-form" class="primary" disabled>Checking selected costs…</button><button id="action-apply-ready" hidden>Assign ready costs only</button><button id="action-save-template">Save as a new reusable pattern</button></div><p id="action-form-status" role="status"></p>';
 host.innerHTML=html;host.classList.toggle("month-mode",a.type==="months");bindMonthPicker(host,a);bindInstallmentForm(host,a);
 $('action-abandon').onclick=()=>{sessionStorage.removeItem('cashflow-action-form');host.close();renderPlan();};
 $('action-close').onclick=()=>{persistActionForm();host.close();renderPlan();};
 host.querySelectorAll('[data-action-basis]').forEach(button=>button.onclick=()=>{setActionSplitBy(a,button.dataset.actionBasis);persistActionForm();drawActionForm();previewActionForm();});
 host.querySelectorAll('[data-action-field]').forEach(input=>input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{
  const key=input.dataset.actionField;if(key==='splitBy')setActionSplitBy(a,input.value);else a[key]=input.value;
  if(key==='type'){
   if(a.type==='months')a.paymentMonths??=[];
   if(a.type==='split'&&!a.parts)a.parts=[{name:'Preparation',ref:'pre',quantity:'remainder',window:'end'},{name:'Shooting',ref:'shoot',quantity:'timetable',window:'whole'}];
   a.ref??='pre';a.endRef??='post';a.basis??='equal-month';a.window??='whole';
  }
  persistActionForm();if(['type','basis','splitBy'].includes(key))drawActionForm();previewActionForm();
 }));
 host.querySelectorAll('[data-action-part]').forEach(input=>input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{a.parts[Number(input.dataset.actionPart)][input.dataset.key]=input.value;persistActionForm();if(['quantity','moneyKind','ref'].includes(input.dataset.key))drawActionForm();previewActionForm();}));
 host.querySelectorAll('[data-action-remove]').forEach(b=>b.onclick=()=>{a.parts.splice(Number(b.dataset.actionRemove),1);persistActionForm();drawActionForm();previewActionForm();});
 $('action-add')?.addEventListener('click',()=>{a.parts.push({name:'Wrap',ref:'post',quantity:'fixed',days:'0',months:'0',window:'start',moneyKind:'fixed',percent:'0',amount:'0',moneyPlacement:'whole'});persistActionForm();drawActionForm();previewActionForm();});
 $('action-apply-form').onclick=()=>applyReviewedAction(false);
 $('action-apply-ready').onclick=()=>applyReviewedAction(true);
 $('action-save-template').addEventListener('click',async()=>{
  if(!a.name.trim())return $('action-form-status').textContent='Give the new pattern a label.';
  const signature=JSON.stringify(a),button=$('action-save-template');button.disabled=true;
  try{
   const clean=actionCopyForLibrary(a,actionList(),crypto.randomUUID());
   project.actionLibrary=await api('actions',{version:project.actionLibrary.version,actions:[...actionList(),clean]});
   actionChoice=clean.id;actionLibrarySaved=signature;
   $('action-form-status').textContent='New pattern “'+clean.name+'” saved for future use. Existing patterns and assigned costs are unchanged. Assign separately to use these choices here.';
   button.textContent='New pattern saved';renderPlan();
  }catch(e){button.disabled=false;$('action-form-status').textContent=e.message;}
 });
}
function applyReviewedAction(readyOnly){
 if(!actionReview||actionReview.signature!==JSON.stringify([actionEdit,actionTargets,effectiveDates()]))return notice('Wait for the current preview before assigning.',true);
 const ids=readyOnly?actionReview.ready:actionTargets;
 if(!ids.length||!readyOnly&&actionReview.ready.length!==ids.length)return;
 if(!actionEdit.name.trim())return $('action-form-status').textContent='Give the action a name.';
 const clean=copy(actionEdit);delete clean._individual;
 const left=actionTargets.filter(id=>!ids.includes(id));
 assignAction(clean,ids);
 if(left.length){actionTargets=left;persistActionForm();drawActionForm();previewActionForm();$('action-form-status').textContent=ids.length+' ready cost'+(ids.length===1?'':'s')+' assigned. The remaining '+left.length+' cost'+(left.length===1?' is':'s are')+' unchanged by this action.';}
 else{$('action-dialog').close();sessionStorage.removeItem('cashflow-action-form');renderPlan();}
}
function bulkReviewHTML(costs,model,ready){
 const total=costs.reduce((s,c)=>s+c.amount,0),sums={};
 for(const c of model?.costs||[])if(ready.includes(c.id))for(const [m,v] of Object.entries(paymentsByMonth(c)))sums[m]=(sums[m]||0)+v;
 const current=previewModel||project.model;
 return '<h3>'+costs.length+' selected · '+euro(total)+'</h3><p><strong>'+(model?ready.length+' ready · '+(costs.length-ready.length)+' to check':'Calculating proposed timing…')+'</strong></p><p class="muted">Only these costs are affected. Other saved and pending timing stays as it is.</p>'+(model?'<div class="bulk-months"><strong>Proposed payments · ready costs</strong><p>'+Object.entries(sums).sort().map(([m,v])=>formatMonth(m)+' <b>'+euro(v)+'</b>').join(' · ')+'</p></div>':'')+costs.map(c=>{
 const shown=model?.costs.find(x=>x.id===c.id),ok=ready.includes(c.id),old=current.costs.find(x=>x.id===c.id),parts=shown?.actionResult?.parts;
 return '<article class="bulk-cost"><div class="action-cost-title"><strong>'+esc(c.name)+' · '+euro(c.amount)+'</strong><button data-action-exclude="'+c.id+'" aria-label="Leave '+esc(c.name)+' rows '+c.first+' unchanged">Leave unchanged</button></div><p class="muted">'+esc(sourceHint(c))+' · rows '+c.first+'–'+c.last+'</p>'+sourceDetailHTML(c)+'<p class="muted">Current: '+esc(old?.unallocated?'Needs timing':planSummary(old))+'</p>'+(shown?(ok?'<p class="ready-label">Ready to assign</p>':'<p class="plan-problem">'+esc((shown.allocationIssues||[]).join('; ')||'Amount remains unallocated')+'</p>')+(parts?'<table><thead><tr><th>Part / dates</th><th>Share</th><th class="money">Amount</th></tr></thead><tbody>'+parts.map(p=>'<tr style="'+actionPhaseStyle(p.ref)+'"><td>'+esc(p.name)+'<small>'+(p.ref==='hist'?'One historical total':p.start?esc(Timing.dateLabel(p.start)+'–'+Timing.dateLabel(p.end)):'')+'</small></td><td>'+actionQuantityLabel(p,shown.actionResult)+'</td><td class="money">'+euro(p.amount)+'</td></tr>').join('')+'</tbody></table>':'')+'<details><summary>Monthly amounts and assumptions</summary>'+actionResults([c],model,false,false)+'</details>':'<p>Calculating…</p>')+'</article>';
 }).join('');
}
function bindBulkExclusions(host){host.querySelectorAll('[data-action-exclude]').forEach(b=>b.onclick=()=>{actionTargets=actionTargets.filter(id=>id!==b.dataset.actionExclude);persistActionForm();drawActionForm();previewActionForm();});}
function previewActionForm(){
 const ticket=++actionPreviewTicket;clearTimeout(actionTimer);actionReview=null;
 const reuseButton=$('action-save-template');reuseButton.disabled=actionLibrarySaved===JSON.stringify(actionEdit);reuseButton.textContent=reuseButton.disabled?'New pattern saved':'Save as a new reusable pattern';
 const host=$('action-live-results'),costs=actionTargets.map(id=>project.model.costs.find(c=>c.id===id)).filter(Boolean);
 $('action-apply-form').disabled=true;$('action-apply-form').textContent=costs.length?'Calculating…':'Select costs to assign';$('action-apply-ready').hidden=true;
 if(!actionTargets.length){host.innerHTML='<p>Select costs to see their calculated amounts here.</p>';return;}
 // Keep budget context visible while typing; only the result is recalculated.
 if(!host.children.length){host.innerHTML=bulkReviewHTML(costs,null,[]);bindBulkExclusions(host);}else host.setAttribute('aria-busy','true');
 $('action-dialog').querySelectorAll('[data-month-amount]').forEach(el=>el.textContent='…');
 const snapshot=copy(actionEdit),targets=[...actionTargets],signature=JSON.stringify([actionEdit,actionTargets,effectiveDates()]);
 actionTimer=setTimeout(async()=>{
  try{
   const entries=Object.fromEntries(targets.map(id=>[id,actionEntry(snapshot,id)]));
   const pending=PlanState.replace([...paymentDrafts].filter(([k])=>paymentDirty.has(k)),targets,entries,r=>project.state.costs.filter(c=>c.rule===r).map(c=>c.id));
   const model=await api('preview',{arrangements:pending.flatMap(([k,e])=>draftEntries(e,k)),...(dateDirty?{dates:dateDraft}:{})});
   if(ticket!==actionPreviewTicket)return;
   const ready=actionReadyIds(model,targets);actionReview={signature,ready};
   $('action-apply-form').disabled=ready.length!==targets.length;$('action-apply-form').textContent='Assign to '+targets.length+' cost'+(targets.length===1?'':'s');
   $('action-apply-ready').hidden=!ready.length||ready.length===targets.length;$('action-apply-ready').textContent='Assign '+ready.length+' ready cost'+(ready.length===1?'':'s')+' only';
   $('action-dialog').querySelectorAll('[data-action-remainder]').forEach(el=>{const r=model.costs.find(c=>c.id===targets[0])?.actionResult,p=r?.parts[Number(el.dataset.actionRemainder)];el.textContent=costs.length!==1?'Per cost →':p?actionQuantityLabel(p,r).replace(' · remaining',''):'Complete the other values';});
   $('action-dialog').querySelectorAll('[data-month-amount]').forEach(el=>{el.textContent=ready.length===targets.length?euro(model.costs.filter(c=>targets.includes(c.id)).reduce((sum,c)=>sum+(paymentsByMonth(c)[el.dataset.monthAmount]||0),0)):'—';});
   const scroll=host.parentElement.scrollTop;host.innerHTML=bulkReviewHTML(costs,model,ready);host.removeAttribute('aria-busy');host.parentElement.scrollTop=scroll;bindBulkExclusions(host);
  }catch(e){if(ticket===actionPreviewTicket){host.removeAttribute('aria-busy');host.innerHTML='<p class="plan-problem">'+esc(e.message)+'</p>';$('action-apply-form').textContent='Resolve preview before assigning';}}
 },180);
}
