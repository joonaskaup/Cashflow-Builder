'use strict';
function sourceDefaultColumn(key,fallback){return (project.state.source?.groups||[]).find(c=>c.sourceDetails?.length)?.sourceDetails[0][key+'Column']??fallback;}
function sourceRefreshStatus(announce=true){
 const outdated=!project.capabilities?.includes('salary-note-payments');
 const missing=project.model.costs.some(c=>!c.removed&&c.kind==='cost'&&!c.sourceDetails?.length);
 const message=outdated?'The page has been updated, but the running app needs restarting. Save your work, use Stop app in Projects, restart your existing app, and reopen this project from Projects.':missing?'The saved extraction predates budget details. Refresh budget to preview the updated rows.':'';
 const node=document.getElementById('source-refresh-status');if(node)node.textContent=message;
 if(message&&announce)notice(message,outdated);
 return !outdated;
}
function sourceDetailHTML(cost){
 const rows=cost.sourceDetails||[];
 if(!rows.length)return '<details class="source-calculation" open><summary>Budget details</summary><p class="budget-description">'+esc(cost.sourceDescription||(cost.components||[]).filter(Boolean).join(' · ')||cost.name)+'</p><small>Quantity and rate details are not in this saved extraction yet. Use Refresh budget after restarting the updated app.</small></details>';
 const number=value=>typeof value==='number'?new Intl.NumberFormat('en-GB',{maximumFractionDigits:6}).format(value):value==null||value===''?'—':String(value);
 const money=value=>typeof value==='number'?new Intl.NumberFormat('en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:4}).format(value):number(value);
 const units={kk:'months (kk)',pv:'days (pv)',pvä:'days (pvä)',kpl:'pieces (kpl)',pc:'pieces (pc)',pcs:'pieces (pcs)'};
 return '<details class="source-calculation" open><summary>Budget details'+(cost.groupedSalaryCosts?' · salary and related costs':'')+'</summary>'+
  (cost.sourceHeading?'<p class="muted">'+esc(cost.sourceHeading)+'</p>':'')+
  (cost.sourceNotes?.length?'<p class="budget-description">'+cost.sourceNotes.map(esc).join(' · ')+'</p>':'')+
  '<div class="source-calculation-scroll"><table><thead><tr><th>Description</th><th>Quantity</th><th>Unit</th><th>Multiplier</th><th>Rate</th><th>Row amount</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.description||cost.sourceHeading||cost.name)+'<small>'+esc(r.amountCell)+'</small></td><td>'+esc(number(r.quantity))+'</td><td>'+esc(units[(r.unit||'').toLowerCase()]||r.unit||'—')+'</td><td>'+esc(number(r.multiplier))+'</td><td>'+esc(money(r.rate))+'</td><td>'+esc(money(r.amount))+'</td></tr>').join('')+'</tbody></table></div>'+
  '<small>Original budget inputs. The row amount is read from the budget; blank fields stay blank. Work quantity does not set payment dates.</small>'+(cost.groupingReason?'<small>'+esc(cost.groupingReason)+'</small>':'')+(cost.sourceSplitNote?'<small>'+esc(cost.sourceSplitNote)+'</small>':'')+(cost.sourceMergeNote?'<small>'+esc(cost.sourceMergeNote)+'</small>':'')+'</details>';
}
function sourcePaymentSummary(costs){
 const monthly={};for(const c of costs)for(const p of c.payments||[]){const key=p.bucket||p.date.slice(0,7);monthly[key]=(monthly[key]||0)+p.amount;}
 return Object.entries(monthly).sort().map(([m,a])=>formatMonth(m)+' '+euro(a)).join(' · ')||'Needs timing';
}
async function previewBudgetRefresh(){
 if(busy)return;
 if(!sourceRefreshStatus())return;
 if(hasPending()){notice('Save or discard pending payment and date edits before refreshing the budget. Your edits are still kept.',true);return;}
 busy=true;notice('Checking the source budget and existing timing…');
 let response;
 try{response=await api('refresh-preview');}
 catch(e){notice('Budget refresh did not complete: '+e.message,true);return;}
 finally{busy=false;}
 if(!response.splits.length&&!response.merges?.length){await mutate('refresh',{refreshToken:response.token},'Budget refreshed. Existing timing retained; budget details updated.');sourceRefreshStatus(false);return;}
 const dialog=document.createElement('dialog');dialog.className='cashflow-range-dialog source-refresh-dialog';
 const groups=response.splits,merges=response.merges||[];
 dialog.innerHTML='<h2>'+(merges.length?'Correct salary grouping':'Separate producer fees')+'</h2>'+
 (merges.length?'<p>A note beneath a job title was mistaken for a separate job. Reunite the salary and its related costs below. Existing payments and the total budget are retained.</p>':'')+
 (groups.length?'<p>'+groups.length+' producer-fee group(s) will be separated. Only rows under Tuottajan korvaus are split.</p><p>Existing percentage rules and date links are copied independently to each fee. Fixed euro payments are divided by each fee’s share of the group. The old grouped records and arrangements are retained for reference.</p>':'')+
 '<p><strong>Total budget:</strong> '+euro(response.before.total)+' → '+euro(response.after.total)+'</p>'+
 merges.map(g=>'<section class="source-split-review"><h3>'+esc(g.cost.name)+' · '+euro(g.cost.amount)+'</h3><p>Reunites: '+g.parents.map(c=>esc(c.name)+' · '+euro(c.amount)+' (rows '+c.first+'–'+c.last+')').join(' + ')+'</p>'+(g.cost.sourceMergeFixedPayments?'<p class="notice"><strong>Keep existing payments:</strong> '+esc(g.cost.sourceMergeNote)+'</p>':'')+'<p>Previous payments: '+sourcePaymentSummary(response.before.costs.filter(c=>g.parents.some(p=>p.id===c.id)))+'</p><p>Payments after correction: '+sourcePaymentSummary([g.cost])+'</p>'+sourceDetailHTML(g.cost)+'</section>').join('')+
 groups.map(g=>'<section class="source-split-review"><h3>'+esc(g.parent.name)+' · '+euro(g.parent.amount)+'</h3><p>Previous: '+sourcePaymentSummary(response.before.costs.filter(c=>c.id===g.parent.id))+'</p><p>Proposed combined payments: '+sourcePaymentSummary(g.children)+'</p>'+g.children.map(c=>'<article><strong>'+esc(c.name)+' · '+euro(c.amount)+'</strong>'+sourceDetailHTML(c)+'<p>Payments: '+sourcePaymentSummary([c])+'</p>'+(c.allocationIssues?.length?'<p class="issue">Needs timing attention after refresh: '+esc(c.allocationIssues.join('; '))+'</p>':'')+'</article>').join('')+'</section>').join('')+
 '<p>The working Excel cashflow will be updated when you apply.</p><p id="source-refresh-error" class="issue" role="alert"></p><div class="actions"><button id="source-refresh-cancel">Keep current extraction</button><button id="source-refresh-apply" class="primary">'+(merges.length?'Apply grouping correction':'Apply refresh and separate producer fees')+'</button></div>';
 document.body.append(dialog);dialog.showModal();
 const apply=dialog.querySelector('#source-refresh-apply'),cancel=dialog.querySelector('#source-refresh-cancel');let saving=false;
 cancel.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
 apply.onclick=async()=>{
  if(busy||saving)return;saving=true;busy=true;apply.disabled=true;cancel.disabled=true;
  try{
   project=await api('refresh',{refreshToken:response.token});
   selected.clear();draft=null;draftKey='';paymentDrafts.clear();paymentDirty.clear();previewModel=null;previewError='';previewTicket++;
   render();sourceRefreshStatus(false);saveDraftStore();dialog.close();notice('Budget refreshed. The reviewed grouping changes are saved.');
  }catch(e){dialog.querySelector('#source-refresh-error').textContent=e.message;}
  finally{busy=false;saving=false;apply.disabled=false;cancel.disabled=false;}
 };
}

let project=null,selected=new Set(),draft=null,dateDraft=[],mappingDraft=[],busy=false;
let draftKey='',paymentDrafts=new Map(),paymentDirty=new Set(),dateDirty=false,sourceDirty=false,sourceDraft=null;
let previewModel=null,previewTicket=0,previewTimer=null,selectedMonth=null,previewError='';
const DRAFT_STORE='erittely-cashflow-unsaved-v2';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=v=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'EUR'}).format(v/100);
const copy=v=>JSON.parse(JSON.stringify(v));
const label=(v,t)=>`<label>${esc(t)}</label>${v}`;
const field=(id,name,value,type='text',extra='')=>`<div class="field"><label for="${id}">${esc(name)}</label><input id="${id}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const selectionKey=()=>[...selected].sort().join('|');
const activeCosts=()=>project.model.costs.filter(c=>selected.has(c.id)&&!c.removed);
const historicalLabel=()=>{const d=effectiveDates().find(d=>d.id==='hist');return d?.label||(d?.start&&d?.end?formatMonth(d.start.slice(0,7))+'-'+formatMonth(d.end.slice(0,7)):'Historical');};
const formatMonth=m=>{if(m==='historical')return esc(historicalLabel());const [y,n]=m.split('-');return `${n}/${y.slice(2)}`;};
const monthOf=d=>d==='historical'?d:d.slice(0,7);
function historicalCard(){return '<div class="historical-card"><strong>Historical · one total</strong><p>Already-paid costs are grouped in one column. No individual dates or monthly split.</p><label>Historical column label (optional)<input data-historical-label aria-label="Historical column label" placeholder="03/23-02/25" value="'+esc(effectiveDates().find(d=>d.id==='hist')?.label||'')+'"></label><small>Shared by every historical cost. Use MM/YY-MM/YY. Save changes applies the label and pending costs together.</small></div>';}
function bindHistoricalLabels(host){host.querySelectorAll('[data-historical-label]').forEach(input=>input.oninput=()=>{if(!dateDirty)dateDraft=copy(project.state.dates);const d=dateDraft.find(d=>d.id==='hist');d.label=input.value.trim();markDateDirty();drawDates();});}

const hasPending=()=>dateDirty||paymentDirty.size>0;
const effectiveDates=()=>dateDirty?dateDraft:project.state.dates;
function saveDraftStore(){
 if(!project)return;
 try{sessionStorage.setItem(DRAFT_STORE,JSON.stringify({budget:project.state.config.budget,revision:project.state.revision,selected:[...selected],payments:[...paymentDrafts].filter(([k])=>paymentDirty.has(k)),dates:dateDirty?dateDraft:null,source:sourceDirty?sourceDraft:null}));}catch(_){}
 updateUnsavedState();rememberPlan();updatePlanSave();
}
function restoreDraftStore(){
 try{const saved=JSON.parse(sessionStorage.getItem(DRAFT_STORE)||'null');if(!saved||saved.budget!==project.state.config.budget)return;
  const ids=new Set(project.model.costs.filter(c=>!c.removed).map(c=>c.id));
  selected=new Set((saved.selected||[]).filter(id=>ids.has(id)));
  paymentDrafts=new Map((saved.payments||[]).filter(([key])=>key.split('|').every(id=>ids.has(id))));
  paymentDirty=new Set(paymentDrafts.keys());
  if(saved.dates){dateDraft=saved.dates;dateDirty=true;}
  if(saved.source){sourceDraft=saved.source;sourceDirty=true;}
  if(saved.revision!==project.state.revision&&(paymentDirty.size||dateDirty||sourceDirty))notice('Unsaved work was restored after the saved project changed. Review it before saving.');
 }catch(_){}
}
function updateUnsavedState(){
 const count=paymentDirty.size+(dateDirty?1:0)+(sourceDirty?1:0);
 $('unsaved-state').textContent=count?`${count} unsaved edit${count===1?'':'s'} kept while you navigate. Use Save changes when ready.`:'';
 const rows=[...paymentDrafts].filter(([k])=>paymentDirty.has(k));
 $('pending-edits').innerHTML=count?'<details><summary>Review or discard '+count+' pending edit'+(count===1?'':'s')+'</summary>'+rows.map(([key,value],i)=>'<div class="actions pending-row"><span>'+esc(value.name)+' · '+key.split('|').length+' cost(s)</span><button data-revisit="'+i+'">Revisit</button><button data-discard="'+i+'">Discard</button></div>').join('')+(dateDirty?'<div class="actions pending-row">Shared dates <button id="revisit-dates">Revisit</button><button id="discard-dates">Discard</button></div>':'')+(sourceDirty?'<div class="actions pending-row">Source setup <button id="revisit-source">Revisit</button><button id="discard-source">Discard</button></div>':'')+'</details>':'';
 $('pending-edits').querySelectorAll('[data-revisit]').forEach(b=>b.onclick=()=>{setSelection(rows[Number(b.dataset.revisit)][0].split('|'));showView('costs');});
 $('pending-edits').querySelectorAll('[data-discard]').forEach(b=>b.onclick=()=>{const key=rows[Number(b.dataset.discard)][0];paymentDrafts.delete(key);paymentDirty.delete(key);if(key===draftKey){draft=null;draftKey='';}previewModel=null;previewError='';render();saveDraftStore();queuePreview();});
 for(const type of ['dates','source']){
  $('revisit-'+type)?.addEventListener('click',()=>showView(type==='dates'?'dates':'source'));
  $('discard-'+type)?.addEventListener('click',()=>{if(type==='dates'){dateDirty=false;dateDraft=[];}else{sourceDirty=false;sourceDraft=null;}previewModel=null;previewError='';render();saveDraftStore();queuePreview();});
 }
}
function showView(id){document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===id));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));if(id==='costs')renderEditor();if(id==='plan')renderPlan();if(id==='months'){renderMonthly();if(hasPending())queuePreview();}}
function setSelection(ids){
 if(draft&&draftKey&&paymentDirty.has(draftKey))paymentDrafts.set(draftKey,copy(draft));
 selected=new Set(ids);draft=null;draftKey='';previewModel=null;previewTicket++;
 renderCosts();renderEditor();renderPlan();saveDraftStore();if(hasPending())queuePreview();
}
function markPaymentDirty(){if(!draftKey)return;paymentDirty.add(draftKey);paymentDrafts.set(draftKey,copy(draft));previewModel=null;previewError='';if($('payment-preview'))$('payment-preview').innerHTML='<strong>Calculating unsaved payments…</strong>';saveDraftStore();updateSaveScope();queuePaymentPreview();}
function markDateDirty(){dateDirty=true;previewModel=null;previewError='';$('date-impact').textContent='Calculating the effect of these unsaved dates…';saveDraftStore();queueDatePreview();}
function notice(text,error=false){$('notice').textContent=text;$('notice').className='notification'+(text?' show':'')+(error?' error':'');}
async function api(action,body={}){
 const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Cashflow-Token':window.CASHFLOW_TOKEN},body:JSON.stringify({...body,revision:project?.state.revision})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Update failed');return data;
}
async function mutate(action,body,message){
 if(busy)return;busy=true;document.body.classList.add('busy');$('save-state').textContent='Calculating and saving workbooks…';
 try{
  const previous=[...selected],previousDraft=draft?copy(draft):null;project=await api(action,body);
  if(['rule','rules','apply'].includes(action)){const key=selectionKey();paymentDrafts.delete(key);paymentDirty.delete(key);}
  if(action==='dates'||action==='rules'&&body.dates){dateDirty=false;dateDraft=[];}
  if(action==='settings'){sourceDirty=false;sourceDraft=null;}
  selected=new Set(previous.filter(id=>project.model.costs.some(c=>c.id===id)));
  draft=null;draftKey='';
  if(action==='rules'&&previousDraft?.parts){draftKey=selectionKey();draft={name:previousDraft.name,editingPart:previousDraft.editingPart,parts:Object.fromEntries(activeCosts().map(c=>[c.id,{...initialDraft(c),touched:false}]))};}
  previewModel=null;previewError='';previewTicket++;render();saveDraftStore();notice(message);if(hasPending())queuePreview();
 }
 catch(e){notice(e.message,true);$('save-state').textContent='Changes have not been saved.';}
 finally{busy=false;document.body.classList.remove('busy');}
}
function visibleCosts(){
 if(!project)return[];
 const search=$('search').value.toLocaleLowerCase();
 return project.model.costs.filter(c=>!c.archived&&($('unused').checked||c.amount!==0||c.removed||c.review)&&(!$('unscheduled').checked||c.amount&&c.unallocated)&&(!$('issues-only').checked||c.issues.length)&&(!search||(c.name+' '+c.section_name+' '+c.description+' '+(c.sourceDescription||'')).toLocaleLowerCase().includes(search)));
}
function renderCosts(){
 $('cost-rows').classList.toggle('selection-active',selected.size>0);
 const visible=visibleCosts();let section=null;let html='';
 const pendingIds=new Set();for(const [key,d] of paymentDrafts){if(paymentDirty.has(key))for(const id of affectedIds(d,key))pendingIds.add(id);}
 const planned=new Map((previewModel?.costs||[]).map(c=>[c.id,c]));
 for(const c of visible){
  const pending=pendingIds.has(c.id),shown=planned.get(c.id)||c;
  const key=c.removed?'removed':c.section_name;
  const extraIssues=c.issues.filter(issue=>issue!==c.description);
  if(key!==section){section=key;const family=visible.filter(x=>(x.removed?'removed':x.section_name)===key&&!x.archived&&!x.removed);const all=family.length&&family.every(x=>selected.has(x.id));
   html+=`<tr class="group"><td>${family.length?`<input type="checkbox" data-section="${esc(key)}" aria-label="Select ${family.length} visible costs in ${esc(c.section_name)}" ${all?'checked':''}>`:''}</td><td colspan="4">${esc(c.removed?'Removed from source — review':c.section_name)} <span class="muted">${family.length?`(${family.length} visible costs)`:''}</span></td></tr>`;
  }
  html+=`<tr class="cost-row ${selected.has(c.id)?'selected':''}" data-cost="${c.id}"><td>${!c.removed?`<input type="checkbox" data-check="${c.id}" aria-label="Select ${esc(c.name)}" ${selected.has(c.id)?'checked':''}>`:''}</td><td>${esc(c.name)}${sourceHint(c)?`<small>${esc(sourceHint(c))}</small>`:''}${c.kind!=='cost'?'<small>Forecast allowance</small>':''}${c.removed?'<small>Excluded from current budget</small>':''}</td><td class="money">${euro(c.amount)}</td><td>${esc(pending&&!previewModel?'Pending timing — '+(previewError?'preview unavailable':'calculating…'):shown.description)}${pending?'<small><strong>Unsaved timing</strong></small>':''}${!hasPending()||previewModel?outsideBadge(shown,previewModel||project.model):''}${!pending&&extraIssues.length?`<small class="issue">${esc(extraIssues.join('; '))}</small>`:''}</td><td class="reference">${c.first===c.last?c.first:`${c.first}–${c.last}`}</td></tr>`;
 }
 $('cost-rows').innerHTML=html||'<tr><td colspan="5">No costs match this view.</td></tr>';
 bindOutsideButtons($('cost-rows'));
 const hiddenSelected=[...selected].filter(id=>!visible.some(c=>c.id===id)).length;
 $('visible-count').textContent=`${visible.length} shown · ${selected.size} selected`+(hiddenSelected?` (${hiddenSelected} outside this filter)`:'');
 $('select-visible').checked=visible.filter(c=>!c.removed).length>0&&visible.filter(c=>!c.removed).every(c=>selected.has(c.id));
 $('cost-rows').querySelectorAll('[data-cost]').forEach(row=>row.onclick=e=>{if(e.target.closest('input,button'))return;setSelection([row.dataset.cost]);});
 $('cost-rows').querySelectorAll('[data-check]').forEach(input=>input.onchange=()=>{const ids=new Set(selected);input.checked?ids.add(input.dataset.check):ids.delete(input.dataset.check);setSelection(ids);});
 $('cost-rows').querySelectorAll('[data-section]').forEach(input=>input.onchange=()=>{const ids=new Set(selected);for(const c of visibleCosts().filter(c=>!c.removed&&c.section_name===input.dataset.section))input.checked?ids.add(c.id):ids.delete(c.id);setSelection(ids);});
}
function option(value,name,selectedValue){return `<option value="${esc(value)}" ${value===selectedValue?'selected':''}>${esc(name)}</option>`;}
function sourceHint(c){
 const phase={pre:'Preparation',shoot:'Shooting',wrap:'Wrap',post:'Postproduction',mixed:'Several phases'}[c.sourceSegment];
 const quantity=Number(c.sourceDuration);
 const unit=quantity===1?c.sourceDurationUnit?.replace(/s$/,''):c.sourceDurationUnit;
 const length=c.sourceDuration?`${quantity.toLocaleString('en-GB',{maximumFractionDigits:3})} ${unit}`:'';
 return [phase,length,...(c.sourceNotes||[])].filter(Boolean).join(' · ');
}
function reuseLabel(r){const summary=Timing.name({...r,mode:r.mode||modeFor(r.lines)},effectiveDates());return summary+(summary===r.name?'':' · '+r.name);}
function modeFor(lines){if(lines.some(l=>l.kind==='units'))return'segments';if(lines.length!==1)return'installments';const d=effectiveDates().find(x=>x.id===lines[0].ref);return d?.kind==='period'?'period':'one';}
function emptyLine(kind='balance',ref=''){return Timing.blank(kind,ref);}
function draftEntries(value=draft,key=draftKey){
 if(!value)return[];
 const pairs=value.parts?Object.entries(value.parts).filter(([,e])=>e.touched):[[key,value]];
 return pairs.map(([ids,e])=>({costs:ids.split('|'),name:e.autoName?Timing.name(e,effectiveDates()):e.name,mode:e.mode,salary:e.salary,salaryOnly:!!e.salaryOnly,clearTiming:PlanState.cleared(e,Timing),lines:PlanState.cleared(e,Timing)?[]:copy(e.lines),sharedId:e.sharedId,updateShared:!!e.updateShared,linkOnly:!!e.linkOnly}));
}
function affectedIds(value,key){
 const ids=new Set();for(const e of draftEntries(value,key)){e.costs.forEach(id=>ids.add(id));if(e.updateShared&&e.sharedId)project.state.costs.filter(c=>!c.removed&&c.rule===e.sharedId).forEach(c=>ids.add(c.id));}return ids;
}
function editTiming(){return draft.parts?draft.parts[draft.editingPart]:draft;}
function editCosts(){return draft.parts?activeCosts().filter(c=>c.id===draft.editingPart):activeCosts();}
function touchEntry(entry){delete entry.clearTiming;delete entry.salaryOnly;entry.touched=true;if(entry.autoName)entry.name=Timing.name(entry,effectiveDates());markPaymentDirty();}
function unlockEntry(entry){Timing.unlink(entry);}
function initialDraft(cost){
 const r=project.state.rules[cost?.rule];
 if(r){const users=project.state.costs.filter(c=>!c.removed&&c.rule===r.id).length;return {...copy(r),salary:!!cost.salary,sharedId:r.id,updateShared:users===1,mode:r.mode||modeFor(r.lines),autoName:false};}
 return {name:'Payment timing',salary:!!cost?.salary,autoName:true,sharedId:null,updateShared:false,mode:'period',lines:[emptyLine()]};
}
function proposalFor(cost){const entry=Timing.proposal(cost,effectiveDates());entry.autoName=true;entry.name=Timing.name(entry,effectiveDates());return entry;}
function phaseMismatch(cost,entry){
 if(!cost?.sourceSegment||cost.sourceSegment==='mixed')return false;
 const expected=Timing.proposal(cost,effectiveDates()).lines[0].ref;
 return !!expected&&entry.lines.some(l=>effectiveDates().find(d=>d.id===l.ref)?.kind==='period'&&l.ref!==expected);
}
function useBudgetTiming(cost){
 if(draft.parts){const salary=draft.parts[cost.id].salary;draft.parts[cost.id]={...proposalFor(cost),salary};touchEntry(draft.parts[cost.id]);}
 else{const salary=draft.salary;draft={...proposalFor(cost),salary};markPaymentDirty();}renderEditor();
}
function chooseMode(mode){
 const e=editTiming();if(e.mode===mode)return;unlockEntry(e);
 e.variants??={};e.variants[e.mode]={lines:copy(e.lines)};
 e.mode=mode;e.updateShared=false;
 e.detailOpen=['segments','installments'].includes(mode);
 if(e.variants[mode])e.lines=copy(e.variants[mode].lines);
 else if(mode==='one')e.lines=[emptyLine()];
 else if(mode==='period')e.lines=[emptyLine()];
 else if(mode==='segments')e.lines=[emptyLine('units'),emptyLine('units')];
 else{const first=emptyLine('percent');first.value=50;e.lines=[first,emptyLine()];}
 e.autoName=true;touchEntry(e);renderEditor();
}
function familyFor(first,model=project.model){
 const stem=c=>(c.sourceDescription||'').replace(/(?:,|—|–|-)\s*(prep|preparation|shoot|shooting|wrap|post|postproduction)\s*$/i,'').trim().toLocaleLowerCase();
 return model.costs.filter(c=>!c.removed&&c.name===first.name&&c.section===first.section&&stem(c)===stem(first)&&c.sourceSegment&&c.sourceSegment!=='mixed');
}
function planFamily(first){
 const family=familyFor(first),ids=family.map(c=>c.id);
 const overlapping=[...paymentDrafts].find(([key,d])=>paymentDirty.has(key)&&[...affectedIds(d,key)].some(id=>ids.includes(id)));
 if(overlapping&&overlapping[0]!==selectionKey()){setSelection(overlapping[0].split('|'));notice('Your pending timing is open. Save or discard it before planning these parts together.');return;}
 if(overlapping&&overlapping[0]===selectionKey()){notice('Save or discard the current pending timing before expanding to related parts.');return;}
 setSelection(ids);draft={name:first.name+' — related work parts',editingPart:ids[0],parts:Object.fromEntries(family.map(c=>[c.id,{...initialDraft(c),touched:false}]))};
 paymentDrafts.set(draftKey,copy(draft));renderEditor();
}
function quickCard(entry,part='',cost=null){
 if(isPrepShoot(entry))return prepShootEditor(cost?[cost]:activeCosts());
 if(isDaySplit(entry))return '<div data-day-cost="'+esc(cost?.id||'')+'">'+splitDaysEditor(cost?[cost]:activeCosts(),cost?[entry]:activeCosts().map(()=>entry))+'</div>';
 if(entry.lines.length===1&&entry.lines[0].ref==='hist')return historicalCard();
 if(entry.lines.length===1&&(entry.lines[0].endRef||entry.lines[0].basis==='balanced-months'))return spreadEditor(entry,cost||(!part&&activeCosts().length===1?activeCosts()[0]:null));
 const ln=entry.lines[0],period=entry.mode==='period'&&entry.lines.length===1;
 const one=entry.mode==='one'&&entry.lines.length===1;
 const attr=key=>`data-quick="${key}" data-part="${part}"`;
 const periods=effectiveDates().filter(d=>d.kind==='period'),milestones=effectiveDates().filter(d=>d.kind==='milestone');
 const disable=entry.linkOnly?' disabled':'';
 let html='<div class="quick-card">';
 if(cost)html+='<div class="line-head"><strong>'+esc(sourceHint(cost)||cost.name)+'</strong><span>'+euro(cost.amount)+'</span></div>';
 if(cost&&phaseMismatch(cost,entry))html+='<p class="issue">This timing differs from the budget phase. Review whether that is intentional.</p>';
 if(period){
  const ref=periods.find(d=>d.id===ln.ref),span=workSpan(ln);
  html+='<div class="field"><label>1. When is the work?</label><select aria-label="'+esc(cost?sourceHint(cost)+' work period':'Work period')+'" '+attr('ref')+disable+'>'+option('','Choose a work period…',ln.ref)+periods.map(d=>option(d.id,Timing.periodLabel(d),ln.ref)).join('')+'</select></div>';
  html+='<div class="field"><label>Part of the period</label><select aria-label="'+esc(cost?sourceHint(cost)+' work span':'Work span')+'" '+attr('window')+disable+'>'+option('whole','Whole period — follows timetable',ln.window||'whole')+option('dates','Specific dates — fixed',ln.window)+option('start','First part of period',ln.window)+option('end','Last part of period',ln.window)+option('after','After period ends',ln.window)+'</select></div>';
  if(ln.window==='dates')html+='<div class="two">'+field('quick-start-'+part,'Work starts',ln.workStart||'','date',attr('workStart')+disable)+field('quick-end-'+part,'Work ends',ln.workEnd||'','date',attr('workEnd')+disable)+'</div>';
  else if(ln.window&&ln.window!=='whole')html+='<div class="two">'+field('quick-length-'+part,'Work length',ln.windowLength??'','number','min="0.001" step="any" '+attr('windowLength')+disable)+'<div class="field"><label>Length unit</label><select '+attr('windowUnit')+disable+'>'+option('months','Calendar months',ln.windowUnit||'months')+option('days','Consecutive calendar days',ln.windowUnit)+option('workdays','Mon–Fri workdays (estimate)',ln.windowUnit)+'</select></div></div>';
  if(['start','end','after'].includes(ln.window))html+='<p class="draft-note">'+esc(Timing.lengthNote(ln))+'</p>'+(ln.lengthSource!=='budget'?'<button class="text-button" data-budget-length="'+part+'"'+disable+'>Use budget duration</button>':'');
  html+='<p class="draft-note">'+(span?esc(Timing.dateLabel(span.start)+' to '+Timing.dateLabel(span.end)+(ln.window==='dates'?' · Fixed dates; timetable changes will not move them.':' · Linked to '+(ref?.name||'period')+'.')):'Choose a period with dates, or enter specific work dates.')+'</p>';
  if(ref&&(!ref.start||!ref.end)&&ln.window!=='dates')html+='<p class="issue">'+esc(ref.name)+' needs start and end dates. <button type="button" data-go-dates>Set period dates</button></p>';
  const choice=entry.customPayment?'custom':Timing.paymentChoice(ln);
  html+='<p class="draft-note">'+(choice==='monthly'?'Paid during this work period, at each month end.':ln.payAt==='work-end'&&!ln.months&&!ln.days?'Paid at work end.':esc(Timing.delayLabel(ln)))+'</p>';
  html+='<details '+(choice!=='monthly'?'open':'')+'><summary>Paid at a different time…</summary><div class="field"><label>Payment timing</label><select aria-label="'+esc(cost?sourceHint(cost)+' payment timing':'Payment timing')+'" '+attr('payment')+disable+'>'+paymentOptions(choice)+'</select></div>';
  if(choice==='custom')html+='<div class="two">'+field('quick-months-'+part,'Months after work',ln.months||0,'number','step="1" '+attr('months')+disable)+field('quick-days-'+part,'Additional days',ln.days||0,'number','step="1" '+attr('days')+disable)+'</div><div class="field"><label>Pay from</label><select '+attr('payAt')+disable+'>'+option('month-end','Each month end',ln.payAt||'month-end')+option('work-end','End of work',ln.payAt)+'</select></div>';
  html+='</details>';
  html+='<details '+(ln.basis!=='calendar-days'?'open':'')+'><summary>'+(ln.basis==='calendar-days'?'Divide proportionally over work dates':ln.basis==='paid-days'?'Divide by actual paid workdays':ln.basis==='salary-months'?'Monthly salary shares':'Equal monthly payments')+'</summary><div class="field"><label>Divide the amount</label><select aria-label="'+esc(cost?sourceHint(cost)+' allocation':'Allocation')+'" '+attr('basis')+disable+'>'+option('weekday-estimate','Mon–Fri estimate',ln.basis)+option('salary-months','Monthly salary shares',ln.basis)+option('calendar-days','Proportionally over work dates',ln.basis)+option('paid-days','By actual paid workdays',ln.basis)+option('equal-month','Equal amount each month',ln.basis)+'</select></div></details>';
  if(ln.basis!=='calendar-days'||Timing.paymentChoice(ln)!=='monthly'||entry.customPayment||entry.linkOnly)html+='<button data-period-default="'+part+'">Pay proportionally during the work period</button>';
  if(ln.basis==='calendar-days')html+='<p class="draft-note">Uses calendar days within each month. Actual paid workdays can be entered when needed.</p>';
  if(ln.basis==='paid-days')html+='<button data-detail-part="'+part+'">Enter or review paid workdays</button>';

  if(ln.estimateNote)html+='<p class="issue">'+esc(ln.estimateNote)+'</p><label class="draft-note"><input type="checkbox" '+attr('estimateConfirmed')+(ln.estimateConfirmed?' checked':'')+disable+'> I confirm this estimated length and placement</label>';
 }else if(one){
  html+='<div class="field"><label>Payment date or milestone</label><select aria-label="Payment milestone" '+attr('ref')+disable+'>'+option('','Specific payment date',ln.ref)+milestones.map(d=>option(d.id,Timing.periodLabel(d),ln.ref)).join('')+'</select></div>';
  if(!ln.ref)html+=field('quick-fixed-'+part,'Payment date',ln.fixed||'','date',attr('fixed')+disable);
  else if(!milestones.find(d=>d.id===ln.ref)?.start)html+='<p class="issue">This milestone needs a date. <button data-go-dates>Set milestone date</button></p>';
  if(ln.months||ln.days)html+='<p class="draft-note">Existing delay: '+esc(ln.months||0)+' months, '+esc(ln.days||0)+' days. <button data-detail-part="'+part+'">Adjust delay</button></p>';
 }else html+='<p>'+esc(Timing.name(entry,effectiveDates()))+'</p>'+(entry.mode==='segments'?'<button data-period-default="'+part+'">Pay proportionally during the work period</button>':'')+'<button data-detail-part="'+part+'">Edit '+(entry.mode==='segments'?'work periods':'installments')+'</button>';
 if(cost)html+='<div id="part-result-'+part+'" class="part-result"></div>';
 if(cost?.sourceSegment&&cost.sourceSegment!=='mixed')html+='<button data-propose="'+part+'">Review budget suggestion for this part</button>';
 if(entry.linkOnly)html+='<p class="draft-note">Linked to saved timing. Changes to that shared arrangement will affect this cost.</p><button data-unlink="'+part+'">Make a copy to adjust</button>';
 return html+'</div>';
}
function discardCurrentTiming(){
 paymentDrafts.delete(draftKey);paymentDirty.delete(draftKey);draft=null;draftKey='';
 previewModel=null;previewError='';previewTicket++;render();saveDraftStore();if(hasPending())queuePreview();
 notice('Returned this selection to its saved timing. Other pending edits are retained.');
}
function paymentOptions(choice){
 return option('monthly','During the work period',choice)+option('next-month','Following month',choice)+option('work-end','At work end',choice)+option('custom','Custom payment timing…',choice);
}
function renderEditor(){
 const costs=project.model.costs.filter(c=>selected.has(c.id)),editor=$('editor');
 if(!costs.length){editor.className='editor empty';editor.innerHTML='Select costs → choose work period → choose payment timing → check amounts → Save.';renderRelated(null);return;}
 editor.className='editor';const first=costs[0],key=selectionKey();
 if(costs.every(c=>PlanState.cleared(planEntry(c.id),Timing))){editor.innerHTML=clearedTimingHTML(costs);renderRelated(first);return;}
 if(costs.length===1){
  const pending=[...paymentDrafts].filter(([k])=>paymentDirty.has(k)),next=PlanState.focus(pending,first.id,rid=>project.state.costs.filter(c=>!c.removed&&c.rule===rid).map(c=>c.id));
  if(next!==pending){paymentDrafts=new Map(next);paymentDirty=new Set(paymentDrafts.keys());draft=null;draftKey='';saveDraftStore();}
 }

 if(draftKey!==key){
  draftKey=key;draft=paymentDrafts.has(key)?copy(paymentDrafts.get(key)):initialDraft(first);
  if(!paymentDrafts.has(key)&&costs.length>1&&new Set(costs.map(c=>c.rule)).size>1)draft={name:'Payment timing',autoName:true,sharedId:null,updateShared:false,mode:'period',lines:[emptyLine()],newBulk:true};
 }
 if(costs.some(c=>actionFor(c.id))&&!window.actionDetailed){renderActionSelection(editor,costs,previewModel||project.model,hasPending()&&!previewModel);renderRelated(first);return;}
 if(costs.every(c=>isPrepShoot(planEntry(c.id)))){editor.innerHTML=prepShootEditor(costs);bindPrepShootEditor(editor);renderRelated(first);return;}
 const e=editTiming();if(!e.mode)e.mode=modeFor(e.lines);
 const pendingElsewhere=[...paymentDrafts].find(([k,v])=>k!==key&&paymentDirty.has(k)&&[...affectedIds(v,k)].some(id=>selected.has(id)));
 if(pendingElsewhere&&costs.length>1&&!pendingElsewhere[1].updateShared){
  editor.innerHTML='<h2>'+costs.length+' selected costs</h2><p>Each cost’s pending timing is kept. Choose a pattern for this selection, or edit one cost below.</p><div id="editor-spread-shortcuts">'+spreadButtons(costs)+'</div>'+costs.map(c=>'<p><button data-edit-only="'+c.id+'">Edit only '+esc(c.name)+'</button> · '+esc(sourceHint(c))+'</p>').join('')+'<div id="payment-preview" class="preview"></div>';
  bindSpreadButtons($('editor-spread-shortcuts'),costs.map(c=>c.id));editor.querySelectorAll('[data-edit-only]').forEach(b=>b.onclick=()=>setSelection([b.dataset.editOnly]));renderRelated(first);
  if(previewModel)showPayments(previewModel,[...selected],true);else queuePreview();return;
 }
 if(pendingElsewhere){
  editor.innerHTML='<h2>'+esc(costs.length===1?first.name:costs.length+' selected costs')+'</h2><p>These costs already have unsaved timing in another selection. Revisit that edit to change it without losing your work.</p><button id="revisit-selection">Revisit pending timing for '+pendingElsewhere[0].split('|').length+' costs</button><div id="payment-preview" class="preview"></div>';
  $('revisit-selection').onclick=()=>setSelection(pendingElsewhere[0].split('|'));renderRelated(first);
  if(previewModel)showPayments(previewModel,[...selected],true);else{$('payment-preview').textContent='Calculating all pending edits…';queuePreview();}return;
 }
 const total=activeCosts().reduce((s,c)=>s+c.amount,0),sharedUsers=e.sharedId?project.state.costs.filter(c=>!c.removed&&c.rule===e.sharedId):[];
 const affected=affectedIds(draft,draftKey),scope=e.updateShared&&sharedUsers.length>1?`Saving updates ${affected.size} costs, including others using this shared arrangement.`:draft.parts?`Save only the ${affected.size} changed parts. Each retains its own amount and arrangement.`:`Save timing for ${costs.length===1?'this cost':`these ${costs.length} costs`}.`;
 let html='<h2>'+esc(costs.length===1?first.name:draft.parts?first.name+' — related parts':costs.length+' selected costs')+'</h2><p>'+euro(total)+' from the existing budget</p><p id="editor-status" class="draft-note">'+(paymentDirty.has(key)?'Unsaved timing — preview only.':costs.some(c=>c.rule)?'Saved timing.':'New timing — choose a work period. Payments follow the work proportionally.')+'</p>';
 if(first.removed){editor.innerHTML=html+'<p>'+esc(first.review)+'</p><button id="review-cost">Mark removal reviewed</button>';$('review-cost').onclick=()=>mutate('review',{cost:first.id},'Removal reviewed.');return;}
 html+='<div class="salary-shortcuts" id="editor-spread-shortcuts">'+spreadButtons(costs)+'</div>';
 html+=costs.length===1?sourceDetailHTML(first):'';
 html+='<details class="selection-summary"><summary>Costs affected ('+costs.length+')</summary>'+costs.map(c=>'<p>'+esc(c.name)+' · '+esc(sourceHint(c))+' · '+euro(c.amount)+' · rows '+c.first+'–'+c.last+'</p>').join('')+'</details>';
 if(draft.newBulk&&!paymentDirty.has(key))html+='<p class="draft-note">These costs have different saved timing. It is retained until you choose and save a common arrangement.</p>';
 if(!draft.parts&&costs.length===1&&sourceHint(first))html+='<p class="draft-note">Budget: '+esc(sourceHint(first))+' · '+esc(first.sourceDescription||'')+'</p>'+(first.sourceSegment==='mixed'?'<button id="split-budget">Divide this work between periods</button>':'<button id="budget-timing">Review budget suggestion</button>');
 if(!draft.parts&&costs.length===1&&phaseMismatch(first,e))html+='<p class="issue">This timing differs from the budget phase. Review whether that is intentional.</p>';
 if(!draft.parts&&familyFor(first).length>1&&costs.every(c=>familyFor(first).some(f=>f.id===c.id)))html+='<button id="plan-family">Plan related budget parts together</button>';
 if(!draft.parts)html+='<div class="field"><label for="editor-type">Timing arrangement</label><select id="editor-type" '+(e.linkOnly?'disabled':'')+'>'+[['period','Work during a period'],['one','One payment date'],['segments','Divide work between periods'],['installments','Contractual installments']].map(([v,t])=>option(v,t,e.mode)).join('')+'</select></div>';
 html+='<details id="reuse-details"><summary>Use timing from…</summary><div class="field"><label for="reuse-choice">Saved arrangement or another cost</label><select id="reuse-choice">'+option('','Choose timing to review…','')+'<optgroup label="Saved arrangements">'+Object.values(project.state.rules).map(r=>option('rule:'+r.id,reuseLabel(r),'')).join('')+'</optgroup><optgroup label="Costs with saved timing">'+project.model.costs.filter(c=>c.rule&&!c.removed).map(c=>option('cost:'+c.id,[c.name,sourceHint(c),'rows '+c.first+'–'+c.last].filter(Boolean).join(' · '),'')).join('')+'</optgroup></select></div><p class="draft-note">Copies timing into the selected costs. Review the amounts below, then Save. Budget amounts are retained; fixed installment amounts remain fixed.</p></details>';
 if(draft.reuseSourceId||e.reuseSourceId){const rid=draft.reuseSourceId||e.reuseSourceId,r=project.state.rules[rid],allLinked=(draft.parts?Object.values(draft.parts):[e]).every(x=>x.linkOnly);html+='<div class="scope"><strong>'+(allLinked?'Linked to ':'Copied from ')+esc(draft.reuseSourceLabel||e.reuseSourceLabel||r?.name||'saved arrangement')+'</strong><p class="draft-note">'+(allLinked?'Using the saved arrangement exactly.':'The controls below show your current copy, including any changes.')+'</p><label><input id="link-reuse" type="checkbox" '+(allLinked?'checked':'')+'> Keep selected costs linked to this saved arrangement</label><p class="draft-note">Unchecked: independent copy. Checked: '+project.state.costs.filter(c=>!c.removed&&c.rule===rid).length+' existing users and the selected costs will share timing. Updating that shared arrangement later affects all its users.</p></div>';}
 if(draft.parts){
  html+='<p class="draft-note">Saved parts are retained until edited. Review a budget suggestion or adjust each part below.</p><div class="field"><label>Optional payment timing for all these parts</label><select id="family-payment">'+option('','Keep each part’s payment timing','')+option('default','Proportional during work','')+option('monthly','During work; keep allocation','')+option('next-month','Following month','')+option('work-end','At the end of each work part','')+'</select></div>';
  html+=costs.map(c=>quickCard(draft.parts[c.id],c.id,c)).join('');
 }else html+=quickCard(e);
 html+='<details id="advanced-editor" '+(e.detailOpen?'open':'')+'><summary>'+(draft.parts?'Detailed options for '+esc(sourceHint(editCosts()[0])):'Detailed work periods, installments and calculation')+'</summary>';
 if(draft.parts)html+='<div class="field"><label>Budget part to edit</label><select id="detail-part">'+costs.map(c=>option(c.id,sourceHint(c),draft.editingPart)).join('')+'</select></div>';
 if(draft.parts)html+='<div class="choice-row">'+[['period','Work over a period'],['one','One payment date'],['segments','Multiple work periods'],['installments','Contractual installments']].map(([v,t])=>'<button data-mode="'+v+'" aria-pressed="'+(e.mode===v)+'" '+(e.linkOnly?'disabled':'')+'>'+t+'</button>').join('')+'</div>';
 html+='<p class="draft-note">'+(e.mode==='segments'?'Enter work units in the same unit (for example 2, 1 and 0.5 months), shares, or amounts. The remaining budget is divided automatically. Work quantities do not establish consecutive work dates.':e.mode==='installments'?'Set contractual shares or amounts. Use Remaining balance for the last installment.':'Work allocation is calculated first; payment timing determines the cashflow month.')+'</p><div id="payment-lines"></div>';
 if(['installments','segments'].includes(e.mode))html+='<button id="add-line" '+(e.linkOnly?'disabled':'')+'>Add '+(e.mode==='segments'?'work period':'installment')+'</button>';
 if(costs.length===1&&Object.keys(first.phases||{}).length)html+='<button id="source-phases" '+(e.linkOnly?'disabled':'')+'>Review source phase split</button>';
 html+=field('rule-name','Optional name for later reuse',e.name,'text',e.linkOnly?'disabled':'');
 if(e.sharedId&&!e.linkOnly&&sharedUsers.length>1)html+='<div class="scope"><label><input id="update-shared" type="checkbox" '+(e.updateShared?'checked':'')+'> Also update all '+sharedUsers.length+' costs using this saved arrangement</label><details><summary>Show affected costs</summary>'+sharedUsers.map(c=>'<p>'+esc(c.name)+' · rows '+c.first+'–'+c.last+'</p>').join('')+'</details></div>';
 html+='</details><div id="payment-preview" class="preview" aria-live="polite"></div><div class="scope" id="payment-scope">'+esc(scope)+(dateDirty?'<p>Saving also saves the pending shared dates shown in Dates and periods, updating all timing linked to them.</p>':'')+'</div><div class="actions save-actions"><button id="save-rule" class="primary" '+(!paymentDirty.has(key)||hasPending()&&!previewModel?'disabled':'')+'>'+esc(dateDirty?'Save timing and shared dates':draft.parts?'Save timing for '+affected.size+' changed parts':costs.length===1?'Save timing for this cost':'Save timing for these '+costs.length+' costs')+'</button><button id="discard-current" '+(!paymentDirty.has(key)?'disabled':'')+'>Discard this selection’s unsaved timing</button></div>';
 if(first.review)html+='<div class="inline-note"><strong>'+esc(first.review)+'</strong><button id="accept-new">Treat as a new cost</button><select id="old-cost">'+option('','Match to retained source cost…','')+project.model.costs.filter(c=>c.removed&&!c.archived).map(c=>option(c.id,c.name+' · old rows '+c.first+'–'+c.last,'')).join('')+'</select><button id="relink-cost">Retain that cost’s timing</button></div>';
 editor.innerHTML=html;renderLines();bindQuickControls();bindSpreadButtons($('editor-spread-shortcuts'),costs.map(c=>c.id));bindSpreadEditor(editor,costs.map(c=>c.id));bindSplitDaysEditor(editor,costs.map(c=>c.id));bindPrepShootEditor(editor);
 $('advanced-editor').ontoggle=()=>{e.detailOpen=$('advanced-editor').open;if(paymentDirty.has(draftKey)){paymentDrafts.set(draftKey,copy(draft));saveDraftStore();}};
 editor.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>chooseMode(b.dataset.mode));
 $('editor-type')?.addEventListener('change',ev=>chooseMode(ev.target.value));
 $('split-budget')?.addEventListener('click',()=>{e.detailOpen=true;chooseMode('segments');});
 $('plan-family')?.addEventListener('click',()=>planFamily(first));
 $('budget-timing')?.addEventListener('click',()=>useBudgetTiming(first));
 $('detail-part')?.addEventListener('change',ev=>{draft.editingPart=ev.target.value;draft.parts[draft.editingPart].detailOpen=true;renderEditor();});
 $('add-line')?.addEventListener('click',()=>{e.lines.push(emptyLine(e.mode==='segments'?'units':'percent'));touchEntry(e);renderEditor();});
 $('rule-name').oninput=()=>{unlockEntry(e);e.autoName=false;e.name=$('rule-name').value;touchEntry(e);};
 $('update-shared')?.addEventListener('change',ev=>{e.updateShared=ev.target.checked;touchEntry(e);setTimeout(renderEditor,0);});
 $('reuse-choice').onchange=()=>{
  const value=$('reuse-choice').value;if(!value)return;const [type,id]=value.split(':'),cost=project.model.costs.find(c=>c.id===id),r=project.state.rules[type==='rule'?id:cost?.rule];if(!r)return;
  const sourceLabel=type==='cost'?[cost.name,sourceHint(cost),'rows '+cost.first+'–'+cost.last].filter(Boolean).join(' · '):r.name;
  if(draft.parts){for(const c of costs)draft.parts[c.id]={...Timing.reuse(r,effectiveDates()),salary:draft.parts[c.id].salary,touched:true,reuseSourceLabel:sourceLabel};draft.reuseSourceId=r.id;draft.reuseSourceLabel=sourceLabel;}else draft={...Timing.reuse(r,effectiveDates()),salary:e.salary,reuseSourceLabel:sourceLabel};
  markPaymentDirty();renderEditor();notice('Timing copied into the preview. Review the selected costs and Save to apply it.');
 };
 $('link-reuse')?.addEventListener('change',ev=>{const linked=ev.target.checked,rid=draft.reuseSourceId||e.reuseSourceId,r=project.state.rules[rid];const entries=draft.parts?Object.values(draft.parts):[draft];for(const entry of entries){delete entry.salaryOnly;Timing.setLinked(entry,r,linked,effectiveDates());}markPaymentDirty();setTimeout(renderEditor,0);});
 $('family-payment')?.addEventListener('change',ev=>{if(!ev.target.value)return;for(const entry of Object.values(draft.parts)){delete entry.salaryOnly;if(!['period','segments'].includes(entry.mode))continue;if(ev.target.value==='default')Timing.usePeriodDefault(entry);else{unlockEntry(entry);entry.lines.forEach(l=>Timing.setPayment(l,ev.target.value));delete entry.customPayment;delete entry.customPaymentLines;}entry.touched=true;}markPaymentDirty();renderEditor();});
 $('source-phases')?.addEventListener('click',()=>{Object.assign(e,{name:first.name+' source phase split',autoName:false,sharedId:null,updateShared:false,mode:'installments',lines:Object.entries(first.phases).map(([ref,value])=>({...emptyLine('percent',ref),value,basis:'calendar-days'}))});touchEntry(e);renderEditor();});
 $('save-rule').onclick=saveTiming;
 $('discard-current').onclick=discardCurrentTiming;
 $('accept-new')?.addEventListener('click',()=>mutate('review',{cost:first.id},'Source identity reviewed.'));
 $('relink-cost')?.addEventListener('click',()=>{const old=$('old-cost').value;if(old)mutate('relink',{new:first.id,old},'Source matched; previous timing retained.');});
 renderRelated(first);
 if(hasPending()&&!previewModel)$('payment-preview').innerHTML='<strong>Calculating all pending edits…</strong>';else showPayments(previewModel||project.model,costs.map(c=>c.id),hasPending());
 if(hasPending())queuePreview();
}
function bindQuickControls(){
 bindHistoricalLabels($('editor'));
 $('editor').querySelectorAll('[data-quick]').forEach(input=>{
  const update=()=>{const e=input.dataset.part?draft.parts[input.dataset.part]:draft,key=input.dataset.quick;unlockEntry(e);const ln=e.lines[0];
   if(key==='payment'){e.customPayment=input.value==='custom';Timing.setPayment(ln,input.value);}
   else if(key==='basis'){ln.basis=input.value;if(input.value==='paid-days'){e.detailOpen=true;if(draft.parts)draft.editingPart=input.dataset.part;}}
   else{ln[key]=key==='estimateConfirmed'?input.checked:['windowLength','months','days'].includes(key)?Number(input.value):input.value;if(['ref','window'].includes(key))Timing.seedDates(ln,effectiveDates());}
   if(key==='window')Timing.seedBudgetLength(ln,input.dataset.part?activeCosts().filter(c=>c.id===input.dataset.part):editCosts());
   if(['windowLength','windowUnit'].includes(key))ln.lengthSource='custom';
   if(ln.estimateNote&&['windowLength','windowUnit','window','workStart','workEnd','ref'].includes(key)){delete ln.estimateNote;delete ln.estimateConfirmed;}
   e.autoName=true;touchEntry(e);if(key==='estimateConfirmed')setTimeout(renderEditor,0);else if(!['windowLength','months','days'].includes(key))renderEditor();else{updateSaveScope();const note=$('editor').querySelector('[data-delay-note="'+input.dataset.part+'"]');if(note)note.textContent=Timing.delayLabel(ln);}
  };
  input.addEventListener(['windowLength','months','days'].includes(input.dataset.quick)?'input':'change',update);
  if(input.dataset.quick==='windowLength')input.addEventListener('change',renderEditor);
 });
 $('editor').querySelectorAll('[data-budget-length]').forEach(b=>b.onclick=()=>{const e=b.dataset.budgetLength?draft.parts[b.dataset.budgetLength]:draft;Timing.seedBudgetLength(e.lines[0],b.dataset.budgetLength?activeCosts().filter(c=>c.id===b.dataset.budgetLength):editCosts(),true);touchEntry(e);renderEditor();});
 $('editor').querySelectorAll('[data-period-default]').forEach(b=>b.onclick=()=>{const e=b.dataset.periodDefault?draft.parts[b.dataset.periodDefault]:draft;Timing.usePeriodDefault(e);touchEntry(e);renderEditor();});
 $('editor').querySelectorAll('[data-detail-part]').forEach(b=>b.onclick=()=>{if(draft.parts)draft.editingPart=b.dataset.detailPart;editTiming().detailOpen=true;renderEditor();});
 $('editor').querySelectorAll('[data-propose]').forEach(b=>b.onclick=()=>useBudgetTiming(project.model.costs.find(c=>c.id===b.dataset.propose)));
 $('editor').querySelectorAll('[data-unlink]').forEach(b=>b.onclick=()=>{const e=b.dataset.unlink?draft.parts[b.dataset.unlink]:draft;unlockEntry(e);touchEntry(e);renderEditor();});
 $('editor').querySelectorAll('[data-go-dates]').forEach(b=>b.onclick=()=>showView('dates'));
}
function updateSaveScope(){
 if($('editor-status'))$('editor-status').textContent=paymentDirty.has(draftKey)?'Unsaved timing — preview only.':activeCosts().some(c=>c.rule)?'Saved timing.':'New timing — choose a work period.';
 if($('discard-current'))$('discard-current').disabled=!paymentDirty.has(draftKey);
 const button=$('save-rule');if(!button)return;button.disabled=!paymentDirty.has(draftKey)||!previewModel;
 if(draft.parts){const n=affectedIds(draft,draftKey).size;button.textContent='Save timing for '+n+' changed parts';$('payment-scope').firstChild.textContent='Save only the '+n+' changed parts. Each retains its own amount and arrangement.';}
 updatePlanSave();
}
async function saveTiming(){return savePlan();}

function estimatedBalance(){
 const timing=editTiming();
 return editCosts().reduce((sum,c)=>{
  let used=0;
  for(const ln of timing.lines){
   if(ln.kind==='percent')used+=Math.round(c.amount*Number(ln.value||0)/100);
   if(ln.kind==='fixed')used+=Math.round(Number(ln.value||0)*100);
  }
  return sum+c.amount-used;
 },0);
}
function updateBalanceLabels(){
 document.querySelectorAll('[data-balance]').forEach(el=>{el.textContent=euro(estimatedBalance());});
}
function workSpan(ln){const span=Timing.workSpan(ln,effectiveDates());return span?{...span,months:periodMonths({kind:'period',...span})}:null;}

function renderLines(){
 const timing=editTiming();
 const parent=$('payment-lines');if(!parent)return;
 if(isDaySplit(timing)){parent.innerHTML='<p>Use Split paid days above. Preparation automatically receives the remaining budget days.</p>';return;}
 if(timing.lines.length===1&&(timing.lines[0].endRef||timing.lines[0].basis==='balanced-months')){parent.innerHTML='<p>Edit this monthly plan with the controls above. Its shares and linked dates are kept together.</p>';return;}
 parent.innerHTML=timing.lines.map((ln,i)=>{
  const simple=['one','period'].includes(timing.mode)&&timing.lines.length===1;
  const ref=effectiveDates().find(d=>d.id===ln.ref);
  const period=ref?.kind==='period'||['period','segments'].includes(timing.mode);
  const dates=effectiveDates().filter(d=>['period','segments'].includes(timing.mode)?d.kind==='period':timing.mode==='one'?d.kind==='milestone':true);
  let html='<div class="rule-line"><div class="line-head"><strong>'+(timing.mode==='segments'?'Work period '+(i+1):timing.mode==='installments'?'Installment '+(i+1):'Payment')+'</strong>';
  if(['installments','segments'].includes(timing.mode)&&timing.lines.length>1)html+='<button data-remove="'+i+'" aria-label="Remove '+(timing.mode==='segments'?'work period ':'installment ')+(i+1)+'">Remove</button>';
  html+='</div><div class="line-grid">';
  if(['installments','segments'].includes(timing.mode)||ln.kind!=='balance'){
   html+='<div class="field"><label>Amount type</label><select aria-label="Payment '+(i+1)+' amount type" data-line="'+i+'" data-key="kind">'+(timing.mode==='segments'||ln.kind==='units'?option('units','Work units (relative share)',ln.kind):'')+option('percent','Percentage',ln.kind)+option('fixed','Fixed euro amount',ln.kind)+option('balance','Remaining balance',ln.kind)+'</select></div>';
   if(ln.kind!=='balance')html+='<div class="field"><label>'+(ln.kind==='percent'?'Share (%)':ln.kind==='units'?'Work units (same unit for all segments)':'Amount (€)')+'</label><input aria-label="Payment '+(i+1)+' amount or percentage" type="number" step="any" data-line="'+i+'" data-key="value" value="'+esc(ln.value)+'"></div>';
  }
  html+='<div class="field wide"><label>Calculated amount</label><div class="calculated"><span id="line-amount-'+i+'">Calculating…</span></div></div>';
  if(!simple)html+='<div class="field wide"><label>'+(period?'When work occurs':'When payment occurs')+'</label><select aria-label="Payment '+(i+1)+' date or period" data-line="'+i+'" data-key="ref">'+option('',['period','segments'].includes(timing.mode)?'Choose a work period…':'Fixed date…',ln.ref)+dates.map(d=>option(d.id,Timing.periodLabel(d),ln.ref)).join('')+'</select></div>';
  if(!simple&&!ln.ref&&!['period','segments'].includes(timing.mode))html+='<div class="field wide"><label>Payment date</label><input aria-label="Payment '+(i+1)+' fixed date" type="date" data-line="'+i+'" data-key="fixed" value="'+esc(ln.fixed)+'"></div>';
  if(ln.ref==='hist')return html+'<p>Historical · one total. No individual dates required.</p></div></div>';
  if(period){
   if(!simple){
   html+='<div class="field wide"><label>Which part of this period?</label><select aria-label="Payment '+(i+1)+' work span" data-line="'+i+'" data-key="window">'+option('whole','Whole period',ln.window||'whole')+option('start','First part, from period start',ln.window)+option('end','Last part, ending with period',ln.window)+option('after','After period ends',ln.window)+option('dates','Specific work dates (fixed)',ln.window)+'</select></div>';
   if(ln.window==='dates')html+=field('work-start-'+i,'Work starts',ln.workStart||'','date',`data-line="${i}" data-key="workStart" aria-label="Payment ${i+1} work start"`)+field('work-end-'+i,'Work ends',ln.workEnd||'','date',`data-line="${i}" data-key="workEnd" aria-label="Payment ${i+1} work end"`);
   else if(ln.window&&ln.window!=='whole')html+='<div class="field"><label>Work length</label><input aria-label="Payment '+(i+1)+' work length" type="number" min="0.001" step="any" data-line="'+i+'" data-key="windowLength" value="'+esc(ln.windowLength??'')+'"></div><div class="field"><label>Length unit</label><select aria-label="Payment '+(i+1)+' work length unit" data-line="'+i+'" data-key="windowUnit">'+option('months','Calendar months',ln.windowUnit||'months')+option('days','Consecutive calendar days',ln.windowUnit)+option('workdays','Mon–Fri workdays (estimate)',ln.windowUnit)+'</select></div>';
   if(ln.estimateNote)html+='<div class="field wide"><p class="issue">'+esc(ln.estimateNote)+'</p><label><input type="checkbox" data-line="'+i+'" data-key="estimateConfirmed" '+(ln.estimateConfirmed?'checked':'')+'> I confirm this estimated length and placement</label></div>';
   }
   const span=workSpan(ln);
   html+='<div id="work-span-'+i+'" class="field wide draft-note">'+(span?'Work dates: '+span.start+' to '+span.end+(ln.window==='dates'?'. These fixed dates do not follow production date changes.':'. Follows the named period.'):'Choose valid work dates to calculate the allocation.')+'</div>';
   if(!simple)html+='<div class="field wide"><label>Allocate work cost by</label><select aria-label="Payment '+(i+1)+' period allocation" data-line="'+i+'" data-key="basis">'+option('weekday-estimate','Mon–Fri estimate',ln.basis)+option('salary-months','Monthly salary shares',ln.basis)+option('calendar-days','Calendar days — proportional estimate',ln.basis)+option('paid-days','Actual paid workdays',ln.basis)+option('equal-month','Equal monthly amounts — intentional',ln.basis)+'</select></div>';
   if(ln.basis==='paid-days'){
    html+='<div class="field wide"><label>Paid-day information</label><select aria-label="Payment '+(i+1)+' paid day source" data-line="'+i+'" data-key="paidDaysSource">'+option('period','Shared production-plan totals',ln.paidDaysSource||'period')+option('cost','Enter paid days for this cost',ln.paidDaysSource)+'</select><p class="draft-note">Use actual workdays. Budget days are quantities, not consecutive calendar dates. For cost-specific entries, fill every month, including zeros. If unknown, choose the calendar-day estimate above.</p></div>';
    if(ln.paidDaysSource==='cost'&&span)html+=span.months.map(m=>'<div class="field"><label>'+formatMonth(m)+' paid days</label><input type="number" min="0" step="any" aria-label="Payment '+(i+1)+' paid days '+formatMonth(m)+'" data-paid-line="'+i+'" data-paid-month="'+m+'" value="'+esc(ln.paidDays?.[m]??'')+'"></div>').join('');
    else if(ln.paidDaysSource!=='cost')html+='<div class="field wide draft-note">'+esc(JSON.stringify(ref?.weights||{}))+' · Shared totals are edited in Dates and periods.</div>';
   }
   if(!simple)html+='<div class="field wide"><label>Payment timing</label><select aria-label="Payment '+(i+1)+' payment timing" data-line="'+i+'" data-key="payment">'+paymentOptions(timing.customPaymentLines?.[i]?'custom':Timing.paymentChoice(ln))+'</select><p data-line-delay-note="'+i+'">'+esc(Timing.delayLabel(ln))+'</p></div>';
  }
  html+='</div>';
  if(!simple||!period)html+='<details '+(ln.months||ln.days||timing.customPaymentLines?.[i]?'open':'')+'><summary id="delay-summary-'+i+'">Payment delay'+(ln.months||ln.days?' ('+(ln.months||0)+' months, '+(ln.days||0)+' days)':'')+'</summary><div class="two"><div class="field"><label>Whole months</label><input aria-label="Payment '+(i+1)+' month delay" type="number" step="1" data-line="'+i+'" data-key="months" value="'+esc(ln.months)+'"></div><div class="field"><label>Additional days</label><input aria-label="Payment '+(i+1)+' day delay" type="number" step="1" data-line="'+i+'" data-key="days" value="'+esc(ln.days)+'"></div></div></details>';
  html+='</div>';
  return html;
 }).join('');
 parent.querySelectorAll('[data-remove]').forEach(b=>{if(timing.linkOnly)b.disabled=true;b.onclick=()=>{timing.lines.splice(Number(b.dataset.remove),1);touchEntry(timing);renderEditor();};});
 parent.querySelectorAll('[data-key]').forEach(input=>{
  const update=()=>{
   const ln=timing.lines[Number(input.dataset.line)],key=input.dataset.key;
   if(key==='payment'){Timing.setPayment(ln,input.value);timing.customPaymentLines??={};timing.customPaymentLines[input.dataset.line]=input.value==='custom';}
   else ln[key]=key==='estimateConfirmed'?input.checked:['value','months','days','windowLength'].includes(key)?Number(input.value):input.value;
   if(['ref','window'].includes(key))Timing.seedDates(ln,effectiveDates());
   if(key==='kind'&&ln.kind==='balance')ln.value=0;
   if(key==='window'){if(timing.lines.length===1)Timing.seedBudgetLength(ln,editCosts());else if(!ln.lengthSource){ln.windowLength='';ln.lengthSource='needed';}}
   if(['windowLength','windowUnit'].includes(key))ln.lengthSource='custom';
   if(ln.estimateNote&&['windowLength','windowUnit','window','ref','workStart','workEnd'].includes(key)){delete ln.estimateNote;delete ln.estimateConfirmed;}
   unlockEntry(timing);touchEntry(timing);
   const i=Number(input.dataset.line);
   const delayNote=parent.querySelector('[data-line-delay-note="'+i+'"]');if(delayNote)delayNote.textContent=Timing.delayLabel(ln);
   if($('delay-summary-'+i))$('delay-summary-'+i).textContent='Payment delay'+(ln.months||ln.days?' ('+(ln.months||0)+' months, '+(ln.days||0)+' days)':'');
   const span=workSpan(ln);if($('work-span-'+i))$('work-span-'+i).textContent=span?'Work dates: '+span.start+' to '+span.end+(ln.window==='dates'?'. These fixed dates do not follow production date changes.':'. Follows the named period.'):'Choose valid work dates to calculate the allocation.';
   if(['kind','ref','window','basis','paidDaysSource','windowUnit','workStart','workEnd','payAt','payment'].includes(key))renderEditor();
   else{updateBalanceLabels();const select=parent.querySelector('[data-line="'+i+'"][data-key="payment"]');if(select)select.value=timing.customPaymentLines?.[i]?'custom':Timing.paymentChoice(ln);}
  };
  if(timing.linkOnly)input.disabled=true;
  input.addEventListener(['value','fixed','months','days','windowLength'].includes(input.dataset.key)?'input':'change',update);
  if(input.dataset.key==='windowLength')input.addEventListener('change',renderEditor);
 });
 parent.querySelectorAll('[data-paid-line]').forEach(input=>{if(timing.linkOnly)input.disabled=true;input.oninput=()=>{const ln=timing.lines[Number(input.dataset.paidLine)];ln.paidDays??={};if(input.value==='')delete ln.paidDays[input.dataset.paidMonth];else ln.paidDays[input.dataset.paidMonth]=Number(input.value);touchEntry(timing);};});
 if(!hasPending())updateLineAmounts(project.model);else queuePreview();
}
function updateLineAmounts(model){const timing=editTiming();for(let i=0;i<(timing?.lines.length||0);i++){const values=model.costs.filter(c=>editCosts().some(x=>x.id===c.id)).map(c=>c.lineAmounts?.[i]??(!c.rule&&timing.lines.length===1&&timing.lines[i].kind==='balance'?c.amount:undefined));if($('line-amount-'+i))$('line-amount-'+i).textContent=values.every(v=>v!==undefined)?euro(values.reduce((a,v)=>a+v,0)):'Choose valid amounts';}}
function showPayments(model,ids,unsaved=false){
 refreshPrepShootResults($('editor'),model,false);
 $('editor').querySelectorAll('.day-split-results').forEach(host=>{const id=host.closest('[data-day-cost]')?.dataset.dayCost,costs=activeCosts().filter(c=>!id||c.id===id);if(costs.every(c=>isDaySplit(planEntry(c.id))))host.innerHTML=splitDaysResults(costs,costs.map(c=>planEntry(c.id)),model,false);});
 const costs=model.costs.filter(c=>ids.includes(c.id));const grouped={};
 for(const c of costs)for(const p of c.payments)grouped[p.date]=(grouped[p.date]||0)+p.amount;
 const unallocated=costs.reduce((s,c)=>s+c.unallocated,0);let html='<strong>Calculated payments for selection</strong>'+(unsaved?'<p class="draft-note">Preview of unsaved timing. Save to update the workbooks.</p>':'');
 if(unsaved&&dateDirty&&paymentDirty.has(selectionKey()))html+='<p class="draft-note">Saving this selection also saves the pending shared dates. Other pending payment edits stay unsaved.</p>';
 const issues=costs.flatMap(c=>c.issues.map(i=>`${c.name}: ${i}`));if(issues.length)html+=`<p class="issue">${esc([...new Set(issues)].join('; '))}</p>`;
 const allocations=costs.flatMap(c=>(c.allocations||[]).map(a=>({...a,costName:c.name})));
 html+=allocations.slice(0,3).map(a=>'<p class="draft-note">'+esc(a.name+': '+a.rows.map(r=>formatMonth(r.month)+' '+r.weight+' '+(a.basis==='calendar-days'?'calendar days':a.basis==='paid-days'?'paid workdays':a.basis==='weekday-estimate'?'estimated weekdays':'monthly share')).join(', ')+'. '+(a.basis==='calendar-days'?'Proportional estimate. ':a.basis==='equal-month'?'Equal monthly amounts chosen. ':'')+(a.payAt==='work-end'?'Paid at work end':'Paid at each month end')+(a.months||a.days?`, then shifted ${a.months||0} months and ${a.days||0} days`:'')+'.')+'</p>').join('');
 html+=`<table><thead><tr><th>Payment date</th><th class="money">Amount</th></tr></thead><tbody>${Object.entries(grouped).sort().map(([d,v])=>`<tr><td>${(d==='historical'?formatMonth(d):esc(d.split('-').reverse().join('/')))}</td><td class="money">${euro(v)}</td></tr>`).join('')||'<tr><td colspan="2">No dated payments yet.</td></tr>'}</tbody></table>`;
 if(unallocated)html+=`<p>${euro(unallocated)} still unallocated.</p>`;
 if(allocations.length)html+='<details><summary>How work becomes payments</summary>'+allocations.map(a=>{
  const basis=a.basis==='salary-months'?'monthly salary shares (calendar fractions)':a.basis==='calendar-days'?'calendar days (estimate)':a.basis==='paid-days'?'actual paid workdays':'equal monthly amounts (intentional)';
  const counts=a.rows.map(r=>`${formatMonth(r.month)}: ${r.weight} ${['equal-month','salary-months'].includes(a.basis)?'monthly share':a.basis==='paid-days'?'paid days':'calendar days'}`).join('; ');
  return '<p><strong>'+esc(a.costName+' — '+a.name)+'</strong><br>'+esc(a.start+' to '+a.end+'. Allocated by '+basis+'. '+counts+'.')+'</p><table><thead><tr><th>Work month</th><th class="money">Work cost</th><th>Paid on</th></tr></thead><tbody>'+a.rows.map(r=>'<tr><td>'+formatMonth(r.month)+'</td><td class="money">'+euro(r.amount)+'</td><td>'+r.paymentDate.split('-').reverse().join('/')+'</td></tr>').join('')+'</tbody></table>';
 }).join('')+'</details>';
 $('payment-preview').innerHTML=html;
 for(const c of costs){const host=$('part-result-'+c.id);if(!host)continue;const totals=paymentsByMonth(c);host.innerHTML='<strong>'+esc(unsaved&&affectedIds(draft,draftKey).has(c.id)?'Unsaved payments':'Saved payments')+'</strong><p>'+Object.entries(totals).sort().map(([m,v])=>formatMonth(m)+': '+euro(v)).join(' · ')+'</p>'+(c.unallocated?'<p>'+euro(c.unallocated)+' still unallocated</p>':'')+(c.issues.length?'<p class="issue">'+esc(c.issues.join('; '))+'</p>':'');}
 const edited=draftEntries();if($('save-rule')&&paymentDirty.has(draftKey)){
  const affected=affectedIds(draft,draftKey),invalid=model.costs.some(c=>affected.has(c.id)&&(c.unallocated||c.issues.some(i=>i!==c.review&&!i.includes('outside displayed months'))));
  $('save-rule').disabled=invalid||edited.some(e=>e.lines.some(l=>l.ref!=='hist'&&l.estimateNote&&!l.estimateConfirmed))||!edited.length;
 }
 updateLineAmounts(model);updateOutsideInline(model,false);
}
function renderRelated(first){
 const host=$('related-costs');if(!first){host.innerHTML='';return;}
 if(hasPending()&&!previewModel){host.innerHTML='<p class="draft-note">Calculating related budget parts with all pending edits…</p>';return;}
 const model=previewModel||project.model;
 const family=familyFor(first,model);
 if(family.length<2){host.innerHTML='';return;}
 const months=[...new Set(family.flatMap(c=>c.payments.map(p=>monthOf(p.date))))].sort();
 host.innerHTML='<h3>'+esc(first.name)+' — related budget parts</h3><p class="draft-note">Each part retains its own budget and timing. Edit each part here. '+(hasPending()?'Includes all pending edits.':'Saved arrangements.')+'</p><table><thead><tr><th>Budget part / work dates</th><th class="money">Budget</th><th>Timing</th></tr></thead><tbody>'+family.map(c=>'<tr><td><button data-related="'+c.id+'">'+esc(sourceHint(c))+'</button><small>'+esc((c.allocations||[]).map(a=>a.start+' to '+a.end).join('; ')||'Work dates not set')+'</small></td><td class="money">'+euro(c.amount)+'</td><td>'+esc(c.description)+(c.unallocated?'<small>'+euro(c.unallocated)+' unallocated</small>':'')+'</td></tr>').join('')+'</tbody></table>'+(months.length?'<table><thead><tr><th>Cashflow month</th>'+family.map(c=>'<th class="money">'+esc({pre:'Preparation',shoot:'Shooting',wrap:'Wrap',post:'Postproduction'}[c.sourceSegment])+'</th>').join('')+'<th class="money">Combined</th></tr></thead><tbody>'+months.map(m=>{const values=family.map(c=>c.payments.filter(p=>monthOf(p.date)===m).reduce((s,p)=>s+p.amount,0));return '<tr><td>'+formatMonth(m)+'</td>'+values.map(v=>'<td class="money">'+euro(v)+'</td>').join('')+'<td class="money">'+euro(values.reduce((a,v)=>a+v,0))+'</td></tr>';}).join('')+'</tbody></table>':'');
 host.querySelectorAll('[data-related]').forEach(b=>b.onclick=()=>setSelection([b.dataset.related]));
}
function queuePaymentPreview(){queuePreview();}
function queueDatePreview(){queuePreview();}
function pendingConflict(){
 const seen=new Set();
 for(const [key,d] of paymentDrafts){if(!paymentDirty.has(key))continue;const ids=affectedIds(d,key);if([...ids].some(id=>seen.has(id)))return 'Pending arrangements overlap. Revisit or discard one before previewing or saving.';for(const id of ids)seen.add(id);}
 return '';
}
async function flushPlanPreview(){
 clearTimeout(previewTimer);const ticket=++previewTicket;
 const body={arrangements:[...paymentDrafts].filter(([k])=>paymentDirty.has(k)).flatMap(([k,e])=>draftEntries(e,k))};
 if(dateDirty){body.dates=copy(dateDraft);parseWeights(body.dates);}
 const model=await api('preview',body);
 if(ticket!==previewTicket){notice('Your edit changed during the check. It is kept; press Save again when ready.');return false;}
 previewModel=model;previewError='';renderPlan();return true;
}
function queuePreview(){
 if(previewTimer)clearTimeout(previewTimer);
 const ticket=++previewTicket;
 previewTimer=setTimeout(async()=>{
  if(!project||busy)return;
  const body={};
  try{
   if(dateDirty){body.dates=copy(dateDraft);parseWeights(body.dates);}
   body.arrangements=[...paymentDrafts].filter(([k])=>paymentDirty.has(k)).flatMap(([key,d])=>draftEntries(d,key));
   if(!body.dates&&!body.arrangements.length){previewModel=null;previewError='';renderMonthly();renderPlan();updatePlanSave();return;}
   const model=await api('preview',body);
   const beforeDates=body.dates?await api('preview',{arrangements:body.arrangements}):null;
   if(ticket!==previewTicket)return;
   previewModel=model;previewError='';renderCosts();renderPlan();updatePlanSave();
   refreshPrepShootResults($('editor'),model,false);
   if(activeCosts().some(c=>actionFor(c.id))&&!window.actionDetailed)renderActionSelection($('editor'),activeCosts(),model,false);
   if($('payment-preview'))showPayments(model,[...selected],true);
   renderRelated(activeCosts()[0]);
   if(body.dates)showDateImpact(model,beforeDates);
   renderMonthly();
  }catch(e){if(ticket!==previewTicket)return;previewModel=null;previewError=e.message;if($('payment-preview'))$('payment-preview').innerHTML='<strong>Preview unavailable</strong><p class="issue">'+esc(e.message)+'</p>';if(body.dates)$('date-impact').textContent='Preview unavailable: '+e.message;renderMonthly();renderPlan();updatePlanSave();}
 },250);
}
function monthlyTotal(model,index){return Object.values(model.categories).reduce((sum,values)=>sum+(values[index]||0),0);}
function renderMonthly(){
 if(!project)return;
 const model=previewModel||project.model;
 const current=new Set(model.months);
 if(!selectedMonth||!current.has(selectedMonth))selectedMonth=model.months.find((_,i)=>monthlyTotal(model,i)!==0)||model.months[0];
 const pending=hasPending();
 $('preview-coverage').textContent=pending&&!previewModel?'':coverageText(model);
 $('monthly-note').textContent=previewError?'Preview unavailable: '+previewError:pending&&!previewModel?'Calculating all pending edits…':previewModel&&pending?'Preview includes all '+paymentDirty.size+' pending payment arrangements'+(dateDirty?' and unsaved dates':'')+'. Use Save changes to update Excel. Financing stays in Excel.':'Planned costs from saved payment arrangements. Financing stays in the original Excel cashflow.';
 if(pending&&!previewModel){$('month-rows').innerHTML='';$('month-details').innerHTML='';$('outside-months').classList.add('hidden');$('range-warning').classList.add('hidden');return;}
 const outside=PlanState.outsideCosts(model).flatMap(c=>PlanState.outsidePayments(c,model));
 $('range-warning').innerHTML=outside.length?outsideReviewHTML(PlanState.outsideCosts(model),model):'';
 $('range-warning').classList.toggle('hidden',!outside.length);bindOutsideButtons($('range-warning'));
 const outsideTotals={};for(const p of outside){const m=monthOf(p.date);outsideTotals[m]=(outsideTotals[m]||0)+p.amount;}
 $('outside-months').innerHTML=outside.length?'<strong>Scheduled outside the Excel display</strong><table><thead><tr><th>Month</th><th class="money">Planned costs</th></tr></thead><tbody>'+Object.entries(outsideTotals).sort().map(([m,value])=>'<tr><td>'+formatMonth(m)+'</td><td class="money">'+euro(value)+'</td></tr>').join('')+'</tbody></table>':'';
 $('outside-months').classList.toggle('hidden',!outside.length);
 $('month-rows').innerHTML=model.months.map((m,i)=>{
  const value=monthlyTotal(model,i),difference=value-(project.model.months.includes(m)?monthlyTotal(project.model,project.model.months.indexOf(m)):0);
  return '<tr data-month="'+esc(m)+'" '+(m===selectedMonth?'aria-selected="true"':'')+'><td>'+formatMonth(m)+'</td><td class="money">'+euro(value)+'</td><td class="money">'+(difference?(difference>0?'+':'−')+euro(Math.abs(difference)):'—')+'</td></tr>';
 }).join('');
 $('month-rows').querySelectorAll('[data-month]').forEach(row=>row.onclick=()=>{selectedMonth=row.dataset.month;renderMonthly();});
 const i=model.months.indexOf(selectedMonth);
 const labels={};
 for(const c of model.costs)if(!c.removed&&!labels[c.section])labels[c.section]=c.section_name;
 const groups=Object.entries(model.categories).map(([section,values])=>({section,name:labels[section]||'Other costs',amount:values[i]||0})).filter(x=>x.amount).sort((a,b)=>a.section-b.section);
 const costs=model.costs.map(c=>({c,amount:c.payments.filter(p=>monthOf(p.date)===selectedMonth).reduce((a,p)=>a+p.amount,0)})).filter(x=>x.amount);
 $('month-details').innerHTML='<strong>'+formatMonth(selectedMonth)+' · '+euro(monthlyTotal(model,i))+'</strong><table><thead><tr><th>Budget section</th><th class="money">Planned costs</th></tr></thead><tbody>'+groups.map(x=>'<tr><td>'+esc(x.name)+'</td><td class="money">'+euro(x.amount)+'</td></tr>').join('')+'</tbody></table><details><summary>Contributing costs ('+costs.length+')</summary><table><tbody>'+costs.map(({c,amount})=>'<tr><td><button data-month-cost="'+c.id+'">'+esc(c.name)+'</button><small>'+esc(sourceHint(c))+'</small></td><td class="money">'+euro(amount)+'</td></tr>').join('')+'</tbody></table></details>';
 $('month-details').querySelectorAll('[data-month-cost]').forEach(b=>b.onclick=()=>{setSelection([b.dataset.monthCost]);showView('costs');});
}
function dateUsage(id){
 let count=0,amount=0;
 for(const c of project.model.costs){
  if(c.removed||!c.amount)continue;
  if(c.actionResult){const parts=c.actionResult.parts.filter(p=>p.ref===id);if(parts.length){count++;amount+=parts.reduce((n,p)=>n+p.amount,0);}else if(c.actionResult.resolvedLines?.some(l=>l.endRef===id)){count++;amount+=c.amount;}continue;}
  if((c.prepShoot||c.daySplit)&&['pre','shoot','post'].includes(id)){
   const part=(c.prepShoot||c.daySplit).parts.find(p=>p.name===({pre:'Preparation',shoot:'Shooting',post:'Wrap'}[id]));
   if(part?.days){count++;amount+=part.amount;}continue;
  }
  const lines=project.state.rules[c.rule]?.lines||[];
  const indices=new Set(lines.map((ln,i)=>ln.ref===id?i+1:-1).filter(i=>i>=0));
  if(!indices.size)continue;
  count++;
  amount+=c.payments.filter(p=>indices.has(p.line)).reduce((sum,p)=>sum+p.amount,0);
 }
 return {count,amount};
}
function paymentsByMonth(cost){
 const totals={};
 for(const p of cost?.payments||[])totals[monthOf(p.date)]=(totals[monthOf(p.date)]||0)+p.amount;
 return totals;
}
function showDateImpact(model,beforeModel=project.model){
 const before=new Map(beforeModel.costs.map(c=>[c.id,c]));
 const changes=[];
 for(const c of model.costs){
  if(c.removed)continue;
  const old=paymentsByMonth(before.get(c.id)),now=paymentsByMonth(c);
  const entries=[...new Set([...Object.keys(old),...Object.keys(now)])].sort().map(m=>[m,(now[m]||0)-(old[m]||0)]).filter(([,v])=>v);
  if(entries.length)changes.push({name:c.name,entries});
 }
 if(!changes.length){$('date-impact').textContent='No monthly amount changes from these dates. A payment may still move within the same month.';return;}
 const totals=m=>{const r={};for(const p of m.payments)r[monthOf(p.date)]=(r[monthOf(p.date)]||0)+p.amount;return r;};const old=totals(beforeModel),now=totals(model);
 $('date-impact').innerHTML='<strong>'+changes.length+' cost'+(changes.length===1?'':'s')+' affected by these unsaved dates</strong><table><thead><tr><th>Month</th><th class="money">Before date change</th><th class="money">After date change</th></tr></thead><tbody>'+[...new Set([...Object.keys(old),...Object.keys(now)])].sort().filter(m=>(old[m]||0)!==(now[m]||0)).map(m=>'<tr><td>'+formatMonth(m)+'</td><td class="money">'+euro(old[m]||0)+'</td><td class="money">'+euro(now[m]||0)+'</td></tr>').join('')+'</tbody></table><details><summary>Affected costs</summary><ul>'+changes.map(c=>'<li>'+esc(c.name)+': '+c.entries.map(([m,v])=>formatMonth(m)+' '+(v>0?'+':'−')+euro(Math.abs(v))).join('; ')+'</li>').join('')+'</ul></details>';
}
function renderDates(){
 if(!dateDirty)dateDraft=copy(project.state.dates);
 drawDates();
 if(!dateDirty)$('date-impact').textContent='Change a date to see which monthly payments it moves.';
 else queueDatePreview();
}
function periodMonths(d){
 const result=new Set(Object.keys(d.weights||{}));
 if(d.kind!=='period'||!d.start||!d.end)return [...result].sort();
 const start=new Date(d.start.slice(0,7)+'-01T00:00:00Z');
 const end=new Date(d.end.slice(0,7)+'-01T00:00:00Z');
 if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))return [...result].sort();
 let cursor=start;
 for(let i=0;i<120&&cursor<=end;i++){
  result.add(cursor.toISOString().slice(0,7));
  cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1));
 }
 return [...result].sort();
}
function parseWeights(definitions=dateDraft){
 Schedule.validate(definitions);
 for(const d of definitions)for(const [month,value] of Object.entries(d.weights||{})){
  if(!/^\d{4}-\d{2}$/.test(month)||!Number.isFinite(Number(value))||Number(value)<0)throw Error('Paid days need a valid nonnegative total for each month.');
 }
 return definitions;
}
function renderSource(){
 const config=sourceDirty&&sourceDraft?sourceDraft:project.state.config;mappingDraft=copy(config.mapping.phaseColumns||[]);
 $('saved-range-month').textContent=formatMonth(project.state.config.firstMonth.slice(0,7));
 const fields=[['budget','Project working budget workbook',config.budget],['cashflowSheet','Original cashflow worksheet',config.cashflowSheet],['sheet','Source budget worksheet',config.mapping.sheet],['label','Cost-name column',config.mapping.label],['amount','Component-amount column',config.mapping.amount],['section','Section-code column',config.mapping.section],['description','Component-description column',config.mapping.description],['duration','Work-length column (optional)',config.mapping.duration??'D'],['durationUnit','Work-length unit column (optional)',config.mapping.durationUnit??'E'],['multiplier','Multiplier column (optional)',config.mapping.multiplier??sourceDefaultColumn('multiplier','F')],['rate','Unit rate column (optional)',config.mapping.rate??sourceDefaultColumn('rate','G')],['total','Total / allowance amount column',config.mapping.total],['grandLabel','Grand-total label',config.mapping.grandLabel],['excludedSections','Source sections outside this cashflow total',config.excludedSections||''],['adminLabel','Administration label',config.mapping.adminLabel],['reserveLabel','Contingency label',config.mapping.reserveLabel]];
 $('source-fields').innerHTML=fields.map(([id,n,v,t])=>field('source-'+id,n,v,t||'text')).join('');drawMappings();
 $('source-fields').querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{
  if(!sourceDraft)sourceDraft=copy(project.state.config);
  const key=input.id.slice('source-'.length);
  if(key==='budget'||key==='cashflowSheet'||key==='excludedSections')sourceDraft[key]=input.value;
  else if(key==='firstMonth')sourceDraft.firstMonth=input.value+'-01';
  else sourceDraft.mapping[key]=input.value;
  sourceDirty=true;saveDraftStore();
 }));
}
function drawMappings(){
 $('phase-mappings').innerHTML=mappingDraft.map((m,i)=>`<div class="actions" style="margin:10px 0"><input data-mapping="${i}" data-key="column" aria-label="Phase source column ${i+1}" placeholder="Column, e.g. M" value="${esc(m.column)}"><select data-mapping="${i}" data-key="phase" aria-label="Mapped phase ${i+1}">${project.state.dates.filter(d=>d.kind==='period').map(d=>option(d.id,d.name,m.phase)).join('')}</select><button data-remove-mapping="${i}">Remove</button></div>`).join('');
 $('phase-mappings').querySelectorAll('[data-mapping]').forEach(input=>input.onchange=()=>{mappingDraft[Number(input.dataset.mapping)][input.dataset.key]=input.value;markSourceDirty();});
 $('phase-mappings').querySelectorAll('[data-remove-mapping]').forEach(b=>b.onclick=()=>{mappingDraft.splice(Number(b.dataset.removeMapping),1);markSourceDirty();drawMappings();});
}
function markSourceDirty(){if(!sourceDraft)sourceDraft=copy(project.state.config);sourceDraft.mapping.phaseColumns=copy(mappingDraft);sourceDirty=true;saveDraftStore();}
function render(){
 if(window.renderLocalStart)window.renderLocalStart(project);
 const m=project.model;
 $('summary').textContent=`${m.costs.filter(c=>!c.removed).length} extracted costs · Budget ${euro(m.total)} · In displayed months ${euro(m.allocated)}${m.unallocated?` · Unallocated ${euro(m.unallocated)}`:''}${m.outside?` · Outside display ${euro(m.outside)}`:''}${m.coverage?` · Budget difference ${euro(m.coverage)}`:''}`;
 const excluded=project.state.source.excluded;
 if(excluded?.count)$('summary').textContent+=` · ${excluded.count} source costs outside this cashflow (${euro(excluded.amount)})`;
 $('save-state').textContent='Saved '+new Date(project.state.updated).toLocaleString()+'. Source: '+project.state.config.budget.split('/').at(-1)+(project.sourceChanged?' — saved budget changed; refresh needed.':'');
 const needing=project.model.costs.filter(c=>!c.removed&&c.amount&&c.unallocated).length;
 const note=project.state.note||'';
 const funded=m.costs.filter(c=>!c.removed&&c.amount).length;
 $('work-needed').textContent=(note?note+' ':'')+`Saved: ${funded-needing} of ${funded} budgeted costs fully scheduled. `+(m.outside?`${euro(m.outside)} is outside the displayed months. `:'')+(needing?needing+' costs still need timing or dates. Use “Needs attention” to find them.':'');
 renderCosts();renderEditor();renderDates();renderSource();renderMonthly();updateUnsavedState();renderPlan();updatePlanSave();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('guide-dates').onclick=()=>showView('dates');
$('clear-selection').onclick=()=>setSelection([]);
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{try{await api('open',{file:b.dataset.open});notice('Opened in Excel. Close it before saving changes through the helper.');}catch(e){notice(e.message,true);}});
['search','unused','issues-only','unscheduled'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',renderCosts));
 $('select-visible').onchange=()=>{const ids=new Set(selected);for(const c of visibleCosts().filter(c=>!c.removed))$('select-visible').checked?ids.add(c.id):ids.delete(c.id);setSelection(ids);};
 $('refresh').onclick=()=>previewBudgetRefresh();
for(const kind of ['period','milestone'])$('add-'+kind).onclick=()=>{dateDraft.push({id:crypto.randomUUID(),name:`New ${kind} ${dateDraft.length+1}`,kind,start:'',end:'',weights:{}});markDateDirty();drawDates();};
 $('save-dates').onclick=savePlan;
 $('add-mapping').onclick=()=>{mappingDraft.push({column:'',phase:project.state.dates.find(d=>d.kind==='period')?.id||''});markSourceDirty();drawMappings();};
 $('save-source').onclick=()=>{const c=copy(project.state.config);for(const key of ['budget','cashflowSheet','excludedSections'])c[key]=$('source-'+key).value;c.firstMonth=project.state.config.firstMonth;for(const key of ['sheet','label','amount','section','description','duration','durationUnit','multiplier','rate','total','grandLabel','adminLabel','reserveLabel'])c.mapping[key]=$('source-'+key).value;c.mapping.phaseColumns=mappingDraft;mutate('settings',{config:c},'Source setup saved; budget refreshed.');};
fetch('/api/state',{headers:{'X-Cashflow-Token':window.CASHFLOW_TOKEN}}).then(r=>r.json()).then(p=>{project=p;restoreDraftStore();rememberPlan();render();const sourceReady=sourceRefreshStatus();if(hasPending())queuePreview();if(sourceReady&&p.sourceChanged)notice('The saved budget changed. Use Refresh budget to import its latest amounts.');}).catch(e=>notice(e.message,true));
