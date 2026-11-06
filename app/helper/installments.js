/* Each diamond is an ordinary milestone with a stable ID; groups are display metadata. */
let installmentSelected=null,installmentMove=null,installmentEarlier=0,installmentLater=0;
function installmentGroups(dates){const groups=new Map();for(const d of dates)if(d.installmentGroup){if(!groups.has(d.installmentGroup))groups.set(d.installmentGroup,[]);groups.get(d.installmentGroup).push(d);}return [...groups].map(([id,items])=>({id,name:items[0].installmentGroupName,items:items.sort((a,b)=>a.installmentNumber-b.installmentNumber)}));}
function placeInstallment(dates,groupId,month,movingId=null){
 const group=installmentGroups(dates).find(g=>g.id===groupId);
 if(!group)throw Error('Choose an existing installment row.');
 const point=Schedule.parse(month,'start','milestone').date;let item;
 if(movingId){item=dates.find(d=>d.id===movingId);if(item?.installmentGroup!==groupId)throw Error('Choose a month on the selected installment’s row.');}
 else {item=group.items.find(d=>!d.start);if(!item){
  if(group.items.length>=12)throw Error('An installment group supports up to 12 payments.');
  const n=Math.max(...group.items.map(d=>d.installmentNumber))+1;
  item={id:crypto.randomUUID(),name:group.name+' · Installment '+n,kind:'milestone',end:'',weights:{},installmentGroup:groupId,installmentGroupName:group.name,installmentNumber:n};dates.push(item);
 }}
 item.start=point;item.precision='month';delete item.inputError;delete item.inputStart;delete item.inputEnd;return item;
}
function installmentActions(){return installmentGroups(effectiveDates()).filter(g=>g.items.some(d=>d.start)).map(g=>{
 const rows=g.items.filter(d=>d.start).map(d=>({month:String(d.installmentNumber).padStart(4,'0'),percent:1,ref:d.id,name:d.name}));spreadMonthShares(rows);
 return {id:'group-'+g.id,name:g.name,type:'split',splitBy:'percent',installmentGroup:g.id,parts:rows.map(r=>({name:r.name,ref:r.ref,moneyKind:'fixed',percent:r.percent,moneyPlacement:'whole'}))};
});}
function installmentForm(a){return '<p>Each installment follows its marker on the timetable. Edit the shares below; each selected cost keeps its own budget. Adding another marker later does not alter already assigned splits.</p><table><thead><tr><th>Installment</th><th>Payment date</th><th>Share (%)</th></tr></thead><tbody>'+a.parts.map((p,i)=>{const d=effectiveDates().find(d=>d.id===p.ref);return '<tr><td>'+esc(d?.name||p.name)+'</td><td>'+esc(d?Schedule.display(d.start,d.precision):'Milestone missing')+'</td><td><input data-installment-share="'+i+'" aria-label="Installment '+(i+1)+' share" inputmode="decimal" value="'+esc(p.percent)+'"></td></tr>';}).join('')+'</tbody></table><small>Total must be 100%. Dates are shared; these percentages apply only to the selected costs.</small>';}
function bindInstallmentForm(host,a){if(a.installmentGroup&&a.type==='split'){const label=host.querySelector('[data-action-field="type"]')?.parentElement;if(label){const note=document.createElement('p');note.className='installment-scope';note.textContent='Installment payments · dates follow the timetable; edit this selection’s percentages below.';label.replaceWith(note);}host.querySelector('#choose-whole-months')?.remove();}host.querySelectorAll('[data-installment-share]').forEach(input=>input.oninput=()=>{a.parts[+input.dataset.installmentShare].percent=input.value;persistActionForm();previewActionForm();});}
function installmentUsed(id){return project.model.costs.some(c=>!c.removed&&JSON.stringify(planEntry(c.id)?.lines||[]).includes(JSON.stringify(id)))||actionList().some(a=>JSON.stringify(a).includes(JSON.stringify(id)));}
function setupInstallments(){
 if($('installment-create'))return;
 const box=document.createElement('div');box.id='installment-create';box.className='schedule-intro';
 box.innerHTML='<strong>Add an installment row</strong><div class="actions"><label>Agreement / group name <input id="installment-group-name" placeholder="Director’s installments or Rights payments"></label><button id="installment-add-group">Add row</button></div><small>Name the agreement, then click months on its row to place numbered payments. Month markers use month end; click a marker to refine its date.</small>';
 $('schedule-timeline').before(box);const editor=document.createElement('div');editor.id='installment-editor';$('schedule-timeline').after(editor);
 $('installment-add-group').onclick=()=>{
  const name=$('installment-group-name').value.trim();if(!name)return notice('Enter a name for the installment row.',true);
  if(installmentGroups(dateDraft).some(g=>g.name.toLowerCase()===name.toLowerCase()))return notice('That installment row already exists.',true);
  const id=crypto.randomUUID();dateDraft.push({id:crypto.randomUUID(),name:name+' · Installment 1',kind:'milestone',start:'',end:'',weights:{},precision:'month',installmentGroup:id,installmentGroupName:name,installmentNumber:1});
  $('installment-group-name').value='';markDateDirty();drawDates();
 };
}
function drawInstallmentTimeline(){
 const host=$('schedule-timeline');if(!host)return;
 const valid=dateDraft.filter(d=>d.id!=='hist'&&/^\d{4}-\d{2}-\d{2}$/.test(d.start)&&(!d.end||d.end>=d.start));
 const groups=installmentGroups(dateDraft),base=project.state.config.firstMonth.slice(0,7);
 const anchor=[base,...valid.map(d=>d.start.slice(0,7))].sort()[0];const leading=new Date(anchor+'-01T00:00:00Z');leading.setUTCMonth(leading.getUTCMonth()-installmentEarlier);const first=leading.toISOString().slice(0,7);
 const minimum=new Date(first+'-01T00:00:00Z');minimum.setUTCMonth(minimum.getUTCMonth()+11);
 const trailing=new Date([minimum.toISOString().slice(0,7),...valid.map(d=>(d.end||d.start).slice(0,7))].sort().at(-1)+'-01T00:00:00Z');trailing.setUTCMonth(trailing.getUTCMonth()+installmentLater);const last=trailing.toISOString().slice(0,7);
 const months=[];let cursor=new Date(first+'-01T00:00:00Z');
 for(let i=0;i<60&&cursor.toISOString().slice(0,7)<=last;i++){months.push(cursor.toISOString().slice(0,7));cursor.setUTCMonth(cursor.getUTCMonth()+1);}
 const regular=valid.filter(d=>!d.installmentGroup).map(d=>'<tr><th>'+esc(d.name)+'</th>'+months.map(m=>{const active=m>=d.start.slice(0,7)&&m<=(d.end||d.start).slice(0,7);return '<td'+(active?' style="background:'+scheduleColor(d)+'"':'')+'>'+(active?(d.kind==='milestone'?'◆':'━'):'')+'</td>';}).join('')+'</tr>').join('');
 const groupRows=groups.map(g=>'<tr class="installment-timeline"><th>'+esc(g.name)+'<button class="installment-use" data-use-installments="'+esc(g.id)+'">Use for costs →</button></th>'+months.map(m=>'<td>'+g.items.filter(d=>d.start?.slice(0,7)===m).map(d=>'<button data-marker="'+d.id+'" aria-label="'+esc(d.name)+'" aria-pressed="'+(installmentSelected===d.id)+'">◆ '+d.installmentNumber+'</button>').join('')+'<button class="installment-place" data-group="'+g.id+'" data-month="'+m+'" aria-label="'+esc((installmentMove?'Move installment':'Add installment')+' in '+g.name+' '+formatMonth(m))+'">+</button></td>').join('')+'</tr>').join('');
 host.innerHTML='<div class="actions"><button id="installment-earlier">Earlier months</button><button id="installment-later">Later months</button></div><div class="schedule-chart"><table><caption>Production timetable · '+(dateDirty?'includes unsaved edits':'saved dates')+'</caption><thead><tr><th>Period / installment group</th>'+months.map(m=>'<th>'+formatMonth(m)+'</th>').join('')+'</tr></thead><tbody>'+regular+groupRows+'</tbody></table></div><small>'+(installmentMove?'Choose a month on the same row to move the selected installment.':'Click + to add an installment. Click a numbered diamond to move it or enter an exact date.')+' '+(months.at(-1)<last?'Showing the first 60 months.':'')+'</small>';
 $('installment-earlier').onclick=()=>{installmentEarlier+=6;drawInstallmentTimeline();};$('installment-later').onclick=()=>{installmentLater+=6;drawInstallmentTimeline();};
 host.querySelectorAll('[data-marker]').forEach(b=>b.onclick=()=>{installmentSelected=b.dataset.marker;installmentMove=null;drawInstallmentTimeline();});
 host.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{
  try{const item=placeInstallment(dateDraft,b.dataset.group,b.dataset.month,installmentMove);installmentSelected=item.id;installmentMove=null;markDateDirty();drawInstallmentTimeline();}
  catch(e){notice(e.message,true);}
 });
 host.querySelectorAll('[data-use-installments]').forEach(b=>b.onclick=()=>useInstallmentGroup(b.dataset.useInstallments));
 drawInstallmentEditor();
}
function drawInstallmentEditor(){
 const host=$('installment-editor');if(!host)return;
 const d=dateDraft.find(x=>x.id===installmentSelected);
 if(!d){host.innerHTML='';return;}
 host.innerHTML='<div class="schedule-intro"><strong>'+esc(d.name)+'</strong><p>'+esc(scheduleSpan(d))+' Linked payments follow this marker.</p><div class="actions"><label>Month or exact date <input id="installment-date" aria-label="Selected installment date" value="'+esc(d.inputStart??Schedule.display(d.start,d.precision))+'" placeholder="08/2027 or 15/08/2027"></label><button id="installment-move">'+(installmentMove?'Cancel move':'Move on timeline')+'</button><button id="installment-remove">Remove installment</button></div><small id="installment-date-error">'+esc(d.inputError||'Month-only payments use month end. Installment numbers stay unchanged when moved.')+'</small></div>';
 $('installment-date').oninput=e=>{
  const raw=e.target.value;d.inputStart=raw;
  try{const p=Schedule.parse(raw,'start','milestone');d.start=p.date;d.precision=p.precision;delete d.inputError;delete d.inputStart;$('installment-date-error').textContent='Ready to save · '+Schedule.display(d.start,'day');}
  catch(err){d.inputError=err.message;$('installment-date-error').textContent=err.message;}
  markDateDirty();
 };
 $('installment-date').onchange=()=>drawInstallmentTimeline();
 $('installment-move').onclick=()=>{installmentMove=installmentMove?null:d.id;drawInstallmentTimeline();};
 $('installment-remove').onclick=()=>{if(installmentUsed(d.id))return notice('This installment is used by a cost or reusable pattern. Change that payment arrangement before removing it.',true);dateDraft=dateDraft.filter(x=>x.id!==d.id);installmentSelected=null;installmentMove=null;markDateDirty();drawDates();};
}

// A small set of visual routes, with the existing calculators behind them.
let timingCategory='months',timingRequestedGroup=null;
function timingGroupCards(){
 return installmentGroups(effectiveDates()).map(g=>({...g,ready:g.items.every(d=>d.start&&!d.inputError),summary:g.items.map(d=>'◆ '+d.installmentNumber+' · '+(d.start?Schedule.display(d.start,d.precision):'choose month')).join('  /  ')}));
}
function timingButton(id,title,detail,disabled=false){return '<button data-timing-choice="'+esc(id)+'" '+(disabled?'disabled':'')+'><strong>'+esc(title)+'</strong><span>'+esc(detail)+'</span></button>';}
function timingMenuHTML(){
 const n=selected.size,groups=timingGroupCards(),items=actionChoices();
 let panel='';
 if(timingCategory==='months')panel=timingButton('quick-months','Choose months / Historical','Click payment months; split equally or enter percentages.',!n)+timingButton('direct-historical','All Historical','Already paid: keep the full cost in one total.',!n);
 if(timingCategory==='periods'){
  panel=items.filter(a=>a.id.startsWith('quick-period-')).map(a=>{const d=effectiveDates().find(d=>d.id===a.ref);return timingButton(a.id,d.name,Schedule.display(d.start,d.precision)+' – '+Schedule.display(d.end,d.precision)+' · proportional',!n);}).join('');
  panel+=timingButton('quick-percentage','Split between periods','Percentages, euros, or each cost’s days / months.',!n)+timingButton('direct-span','Across several periods','Equal monthly payments or proportional amounts.',!n);
 }
 if(timingCategory==='installments')panel=groups.map(g=>'<article class="timing-group'+(timingRequestedGroup===g.id?' timing-requested':'')+'"><strong>'+esc(g.name)+'</strong><p>'+esc(g.summary)+'</p>'+(g.ready?'<button data-timing-choice="group-'+esc(g.id)+'" '+(!n?'disabled':'')+'>Set percentages for '+n+' selected cost'+(n===1?'':'s')+'</button>':'<span class="schedule-error">Place each installment on a month first.</span>')+'<button data-timing-dates="'+esc(g.id)+'">'+(g.ready?'Edit markers':'Place on timetable')+'</button></article>').join('')||'<p>No installment rows yet. Name an agreement in the month planner, then click its payment months.</p><button data-timing-dates="">Open month planner</button>';
 if(timingCategory==='installments'){const milestones=effectiveDates().filter(d=>d.kind==='milestone'&&!d.installmentGroup&&d.id!=='hist');panel+=milestones.map(d=>timingButton('milestone-'+d.id,d.name,d.start?Schedule.display(d.start,d.precision)+' · one payment':'Set its date in the month planner',!n||!d.start||!!d.inputError)).join('');}
 if(timingCategory==='saved')panel=actionList().filter(a=>!a.id.startsWith('group-')).map(a=>timingButton(a.id,a.name,'Review a separate copy for the selected costs.',!n)).join('')||'<p>No saved patterns yet. Save a pattern from any timing editor to reuse it here.</p>';
 return '<div class="timing-selection"><strong>1. Select costs · '+n+' selected · '+euro(activeCosts().reduce((s,c)=>s+c.amount,0))+'</strong><button id="plan-clear" '+(!n?'disabled':'')+'>Clear selection</button></div><strong>2. Choose how to pay</strong><div class="timing-tabs" role="group" aria-label="Payment timing choices">'+[['months','Months / Historical'],['periods','Production periods'],['installments','Installments'+(groups.length?' · '+groups.length:'')],['saved','Saved patterns']].map(([id,label])=>'<button data-timing-category="'+id+'" aria-pressed="'+(timingCategory===id)+'">'+label+'</button>').join('')+'</div><div class="timing-options timing-'+timingCategory+'">'+(!n?'<p class="timing-select-hint">Tick costs in the list below to enable assignment. Your existing timing stays in place until you assign.</p>':'')+panel+'</div><small>3. Review amounts and assign to the selected costs → Save changes below. Shared dates stay linked; percentages belong to each cost.</small>'+(unfinishedAction()?'<button id="action-resume">Resume unfinished timing</button>':'')+'<details><summary>More tools</summary><button id="action-new">Custom arrangement</button><button id="action-mark-salary" '+(!n?'disabled':'')+'>Mark / unmark salaries</button><button id="action-copy" '+(n!==1?'disabled':'')+'>Copy timing</button><button id="action-paste" '+(!n||!planClipboard?'disabled':'')+'>Paste timing</button></details>';
}
function timingChoice(id){
 if(id.startsWith('milestone-')){const d=effectiveDates().find(d=>d.id===id.slice(10));if(d)return {id:crypto.randomUUID(),name:d.name,type:'split',splitBy:'percent',installmentGroup:'single-'+d.id,parts:[{name:d.name,ref:d.id,moneyKind:'fixed',percent:'100',moneyPlacement:'whole'}]};}
 if(id==='direct-historical')return {id:crypto.randomUUID(),name:'Historical',type:'historical'};
 if(id==='direct-span'){const p=effectiveDates().filter(d=>d.kind==='period'&&d.id!=='hist');return {id:crypto.randomUUID(),name:'Across production periods',type:'span',ref:p[0]?.id,endRef:p.at(-1)?.id,basis:'equal-month'};}
 return actionChoices().find(a=>a.id===id);
}
function bindTimingMenu(){
 const host=$('plan-actions');
 host.querySelectorAll('[data-timing-category]').forEach(b=>b.onclick=()=>{timingCategory=b.dataset.timingCategory;host.innerHTML=timingMenuHTML();bindActionToolbar();});
 host.querySelectorAll('[data-timing-choice]').forEach(b=>b.onclick=()=>{const a=timingChoice(b.dataset.timingChoice);if(a&&selected.size)openAction(a,[...selected],false);});
 host.querySelectorAll('[data-timing-dates]').forEach(b=>b.onclick=()=>{const g=installmentGroups(effectiveDates()).find(g=>g.id===b.dataset.timingDates);installmentSelected=g?.items[0]?.id||null;showView('dates');drawDates();$('schedule-timeline').scrollIntoView({block:'start'});});
 $('action-new').onclick=()=>openAction({id:crypto.randomUUID(),name:'My timing',type:'months',paymentMonths:[]},[...selected],false);
}
function useInstallmentGroup(groupId){
 timingRequestedGroup=groupId;timingCategory='installments';showView('plan');
 $('plan-actions').scrollIntoView({block:'start'});
}
