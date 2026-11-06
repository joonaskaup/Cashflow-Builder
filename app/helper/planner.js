/* Direct planning surface; calculations and persistence remain in the existing engine. */
let planHistory=[],planCheckpoint=null,planRevision=null,planRestoring=false,planClipboard=null,planSaveError='';
function planSnapshot(){return {payments:[...paymentDrafts].filter(([k])=>paymentDirty.has(k)).map(([k,e])=>[k,copy(e)]),dates:dateDirty?copy(dateDraft):null};}
function rememberPlan(){
 if(!project||planRestoring)return;
 const now=planSnapshot();
 if(planRevision!==project.state.revision){planRevision=project.state.revision;planHistory=[];planCheckpoint=now;return;}
 if(planCheckpoint&&JSON.stringify(now)!==JSON.stringify(planCheckpoint)){planHistory.push(planCheckpoint);if(planHistory.length>50)planHistory.shift();}
 planCheckpoint=now;
}
function undoPlan(){
 if(!planHistory.length||busy)return;
 planSaveError='';
 const before=planHistory.pop();planRestoring=true;
 paymentDrafts=new Map(copy(before.payments));paymentDirty=new Set(paymentDrafts.keys());dateDirty=!!before.dates;dateDraft=copy(before.dates||project.state.dates);
 draft=null;draftKey='';previewModel=null;previewError='';previewTicket++;planCheckpoint=copy(before);
 render();saveDraftStore();planRestoring=false;queuePreview();notice('Last unsaved change undone.');
}
let planCheckingSave=false;
function pendingCostIds(){const ids=new Set();for(const [k,e] of paymentDrafts)if(paymentDirty.has(k))for(const id of affectedIds(e,k))ids.add(id);return ids;}
function updatePlanSave(){
 if(!project||!$('plan-save'))return;
 const ids=pendingCostIds(),n=ids.size;
 const bad=planBlockers();
 const text=n||dateDirty?`Unsaved: ${n} cost${n===1?'':'s'}${dateDirty?' + shared dates':''}`:'All plan changes saved';
 $('plan-save-status').textContent=busy?'Saving both workbooks…':text;
 $('plan-save-detail').textContent=planSaveError?'Save failed: '+planSaveError:previewError?'Preview unavailable: '+previewError:bad.length?`${n} pending cost(s); ${bad.length} need a fix. Other edits are kept. ${bad[0].name} (rows ${bad[0].first}–${bad[0].last}): ${(bad[0].allocationIssues||[])[0]||'Choose timing for the remaining amount.'}`:hasPending()&&!previewModel?'Calculating all pending changes…':dateDirty?'Save includes shared dates and every pending cost. All costs linked to those dates will update.':hasPending()?'Preview includes every pending edit. Excel updates when you save.':'Excel contains the saved plan. Financing remains in Excel.';
 $('plan-save').textContent=bad.length?`Review ${bad.length} cost${bad.length===1?'':'s'} before saving`:previewError?'Review preview problem':'Save changes'+(n?' — '+n+' cost'+(n===1?'':'s'):'')+(dateDirty?' + dates':'');
 $('plan-save').disabled=busy||planCheckingSave||!hasPending();
 $('plan-undo').disabled=busy||!planHistory.length;
 const readyKeys=bad.length?readyPlanKeys():[],readyCount=new Set(readyKeys.flatMap(k=>[...affectedIds(paymentDrafts.get(k),k)])).size;
 $('plan-save-ready').hidden=!bad.length;$('plan-save-ready').disabled=busy||planCheckingSave;$('plan-save-ready').textContent='Fix '+bad.length+' remaining cost'+(bad.length===1?'':'s');
 if(bad.length){
  $('plan-save').textContent=readyCount?'Save '+readyCount+' ready cost'+(readyCount===1?'':'s'):'Save changes';
  $('plan-save').disabled=busy||planCheckingSave||!readyCount;
  $('plan-save-detail').textContent=(planSaveError?'Save failed: '+planSaveError+'. ':'')+(readyCount?readyCount+' ready to save. ':'')+bad.length+' incomplete cost'+(bad.length===1?' is':'s are')+' kept for later: '+bad.map(c=>c.name+' (rows '+c.first+'–'+c.last+')').join('; ')+(dateDirty?' Shared date changes must be saved together; resolve these first.':'');
 }
 if(!busy&&!hasPending()&&PlanState.outsideCosts(project.model).length)$('plan-save-detail').textContent='Saved. '+euro(project.model.outside)+' is outside the Excel cashflow; use Review cost above.';
 if(planCheckingSave){$('plan-save').textContent='Checking latest edits…';$('plan-save').disabled=true;}

 if($('payment-scope'))$('payment-scope').textContent='Use Save changes below to save all pending costs'+(dateDirty?' and shared dates':'')+'. Navigation keeps your work.';
}

function planBlockers(){const ids=new Set([...paymentDrafts].filter(([k])=>paymentDirty.has(k)).flatMap(([k,e])=>draftEntries(e,k)).filter(e=>!e.salaryOnly).flatMap(e=>e.costs));return PlanState.blockers(previewModel,ids,project.model,dateDirty);}
function readyPlanKeys(){
 if(dateDirty||!previewModel||previewError||pendingConflict())return [];
 const bad=new Set(planBlockers().map(c=>c.id));
 return [...paymentDrafts].filter(([key,e])=>paymentDirty.has(key)&&![...affectedIds(e,key)].some(id=>bad.has(id))&&!draftEntries(e,key).some(a=>!a.salaryOnly&&a.lines.some(l=>l.ref!=='hist'&&l.estimateNote&&!l.estimateConfirmed))).map(([key])=>key);
}
function reviewPlanProblem(){
 const bad=planBlockers();
 if(bad.length){const c=bad[0];$('plan-search').value='';$('plan-unplanned').checked=false;$('plan-salaries').value='all';showView('plan');planFocus(c.id);$('plan-selection').scrollIntoView({block:'nearest'});const field=$('plan-selection').querySelector('[aria-invalid="true"]')||$('plan-selection').querySelector('input,select');field?.focus();return true;}
 if(previewError){showView(dateDirty?'dates':'costs');notice(previewError,true);return true;}
 return false;
}
async function savePlan(readyOnly=false){
 readyOnly=readyOnly===true;
 if(busy||planCheckingSave||!hasPending())return;
 if(!previewModel){
  planCheckingSave=true;updatePlanSave();
  try{if(!await flushPlanPreview())return;}catch(e){previewError=e.message;notice('Could not check the current edits: '+e.message,true);return;}finally{planCheckingSave=false;updatePlanSave();}
 }
 if(!readyOnly&&planBlockers().length&&readyPlanKeys().length)readyOnly=true;
 if(!readyOnly&&reviewPlanProblem())return;
 const conflict=pendingConflict();if(conflict)return notice(conflict,true);
 const keys=readyOnly?readyPlanKeys():[...paymentDirty];
 if(readyOnly&&!keys.length)return;
 const arrangements=[...paymentDrafts].filter(([k])=>keys.includes(k)).flatMap(([k,e])=>draftEntries(e,k));
 if(arrangements.some(a=>!a.salaryOnly&&a.lines.some(l=>l.ref!=='hist'&&l.estimateNote&&!l.estimateConfirmed)))return notice('Confirm or replace estimated work lengths in the detailed editor before saving.',true);
 const outside=PlanState.outsideSaveCosts(previewModel,project.model,new Set(keys.flatMap(k=>[...affectedIds(paymentDrafts.get(k),k)])),dateDirty);
 if(outside.length&&!await confirmOutsideSave(outside,previewModel))return;
 const body={arrangements};if(dateDirty){body.dates=copy(dateDraft);try{parseWeights(body.dates);}catch(e){return notice(e.message,true);}}
 planSaveError='';busy=true;document.body.classList.add('busy');document.querySelector('main').inert=true;document.querySelector('nav').inert=true;$('pending-edits').inert=true;updatePlanSave();
 try{
  project=await api(arrangements.length?'rules':'dates',body);selected.clear();for(const k of keys){paymentDrafts.delete(k);paymentDirty.delete(k);}dateDirty=false;dateDraft=[];draft=null;draftKey='';previewModel=null;previewError='';previewTicket++;
  rememberPlan();render();saveDraftStore();notice(hasPending()?'Ready costs saved. Incomplete edits are still kept here; fix them when ready.':'All pending timing and date changes saved. Both workbooks now contain this plan.');if(hasPending())queuePreview();
 }catch(e){planSaveError=e.message;notice(e.message,true);}
 finally{busy=false;document.body.classList.remove('busy');document.querySelector('main').inert=false;document.querySelector('nav').inert=false;$('pending-edits').inert=false;updatePlanSave();}
}
function planEntry(id){
 for(const [k,e] of paymentDrafts){if(!paymentDirty.has(k))continue;
  if(e.parts&&e.parts[id]?.touched)return copy(e.parts[id]);
  if(!e.parts&&affectedIds(e,k).has(id))return copy(e);
 }
 return initialDraft(project.model.costs.find(c=>c.id===id));
}
function stagePlan(ids,entries,message,forceEditor=true){
 if(busy||!ids.length)return;
 planSaveError='';
 try{
  const next=PlanState.replace([...paymentDrafts].filter(([k])=>paymentDirty.has(k)),ids,entries,rid=>project.state.costs.filter(c=>!c.removed&&c.rule===rid).map(c=>c.id));
  paymentDrafts=new Map(next);paymentDirty=new Set(paymentDrafts.keys());draft=null;draftKey='';previewModel=null;previewError='';previewTicket++;
  const prepActive=document.activeElement?.dataset?.prepQuantity;
  const dayActive=document.activeElement,dayCaret=$('editor').contains(dayActive)&&dayActive?.dataset?.dayKey?{key:dayActive.dataset.dayKey}:null;
  const active=document.activeElement,editingSpread=$('editor').contains(active)&&active?.dataset?.spreadKey,caret=editingSpread?[active.selectionStart,active.selectionEnd,active.dataset.spreadKey,active.dataset.spreadCost||'']:null;
  saveDraftStore();renderPlan(forceEditor);renderCosts();if($('costs').classList.contains('active'))renderEditor();
  if(caret){const field=[...$('editor').querySelectorAll('[data-spread-key]')].find(el=>el.dataset.spreadKey===caret[2]&&(el.dataset.spreadCost||'')===caret[3]);if(field){field.focus({preventScroll:true});if(field.setSelectionRange&&caret[0]!==null)field.setSelectionRange(caret[0],caret[1]);}}
  if(prepActive){$('editor').querySelector('[data-prep-quantity="'+prepActive+'"]')?.focus({preventScroll:true});}
  if(dayCaret){const field=$('editor').querySelector('[data-day-key="'+dayCaret.key+'"]');field?.focus({preventScroll:true});}
  queuePreview();if(message)notice(message);
 }catch(e){notice(e.message,true);}
}
function assignPlanPeriod(ref){
 const ids=activeCosts().map(c=>c.id),entries={};
 for(const id of ids){const c=project.model.costs.find(c=>c.id===id),salary=!!planEntry(id).salary;entries[id]={name:'Work during '+effectiveDates().find(d=>d.id===ref).name,autoName:true,mode:'period',salary,lines:[salary&&ref!=='hist'?PlanState.salaryLine(c,ref,Timing):emptyLine('balance',ref)]};}
 stagePlan(ids,entries,ref==='hist'?'Added to Historical as one total. Review, then Save changes.':'Period assigned in the preview: proportional calendar days, paid during the work period. Undo restores the previous timing.');
}
function spreadButtons(costs){
 const dates=effectiveDates(),ready=costs.length&&dates.some(d=>d.id==='pre'&&d.start)&&dates.some(d=>d.id==='post'&&d.end);
 return prepShootButton(costs)+splitDaysButton(costs)+'<strong>Spread across months</strong><button data-spread-new="equal" '+(!ready?'disabled':'')+'>All production · equal monthly</button><button data-spread-new="balanced" '+(!costs.length?'disabled':'')+'>Balanced first/last months</button>';
}
function bindSpreadButtons(host,ids){
 bindPrepShootButtons(host,ids);
 bindSplitDaysButtons(host,ids);
 host.querySelectorAll('[data-spread-new]').forEach(b=>b.onclick=()=>{
  const entries={};for(const id of ids){const c=project.model.costs.find(c=>c.id===id),line=Timing.spreadLine(c,b.dataset.spreadNew==='balanced');entries[id]={autoName:true,mode:'period',salary:!!planEntry(id).salary,lines:[line]};entries[id].name=Timing.name(entries[id],effectiveDates());}
  stagePlan(ids,entries,'Monthly plan added to the preview. Review the payment months and shares, then Save.');
 });
}
function spreadEditor(entry,cost=null){
 const l=entry.lines[0],balanced=l.basis==='balanced-months',periods=effectiveDates().filter(d=>d.kind==='period'&&d.id!=='hist'),span=workSpan(l),shares=balanced?Timing.balancedShares(l.balancedMonths):null;
 const scope=cost?' data-spread-cost="'+cost.id+'"':'';
 let html='<div class="spread-editor"><strong>'+(balanced?'One monthly rate · balanced first and last payments':'Equal payments across production')+'</strong><div class="actions"><label>Start in <select aria-label="Monthly plan starts in" data-spread-key="ref"'+scope+'>'+option('','Choose period…',l.ref)+periods.map(d=>option(d.id,d.name+' · '+(d.start?formatMonth(d.start.slice(0,7)):'dates needed'),l.ref)).join('')+'</select></label>';
 if(balanced)html+='<label>Months at the full rate <input type="text" inputmode="decimal" aria-label="Months at the full rate" data-spread-key="balancedMonths"'+scope+' value="'+esc(l.balancedMonths??'')+'" aria-invalid="'+!shares+'"></label>';
 else html+='<label>Through <select aria-label="Monthly plan ends with" data-spread-key="endRef"'+scope+'>'+option('','Choose end period…',l.endRef)+periods.map(d=>option(d.id,d.name+' · '+(d.end?formatMonth(d.end.slice(0,7)):'dates needed'),l.endRef)).join('')+'</select></label>';
 html+='</div><p class="spread-explanation">';
 if(balanced){html+=(shares?shares.map(n=>Number(n.toFixed(6))).join(' + ')+' = '+Number(String(l.balancedMonths).replace(',','.'))+' full-rate months across '+shares.length+' calendar payment month'+(shares.length===1?'':'s')+'. ':'Enter a monthly length, for example 5.6. ')+(cost&&shares?'Full-month rate: '+euro(cost.amount/Number(String(l.balancedMonths).replace(',','.')))+'. ':'')+'Starts in the first calendar month of the chosen period. These are payment shares, not inferred daily work dates.';}
 else html+='Same amount in every calendar month from the first period’s start through the last period’s end, including partial boundary months. Both ends follow production date changes.';
 html+=(span?' Payments: '+formatMonth(span.start.slice(0,7))+'–'+formatMonth(span.end.slice(0,7))+', at month end.':'')+'</p>';
 if(balanced)html+='<p class="muted">The budget’s month quantity is a starting suggestion; you can change it. The end month follows this payment pattern and may differ from postproduction’s end. To cover every production month, use All production · equal monthly.</p>';
 return html+'</div>';
}
function bindSpreadEditor(host,ids){
 host.querySelectorAll('[data-spread-key]').forEach(input=>input.addEventListener(input.dataset.spreadKey==='balancedMonths'?'input':'change',()=>{
  const targets=input.dataset.spreadCost?[input.dataset.spreadCost]:ids,entries={};
  for(const id of targets){const e=PlanState.independent(planEntry(id));delete e.salaryOnly;e.lines[0][input.dataset.spreadKey]=input.value.replace(',','.');e.autoName=true;e.name=Timing.name(e,effectiveDates());entries[id]=e;}
  if(input.dataset.spreadKey==='balancedMonths')input.setAttribute('aria-invalid',String(!Timing.balancedShares(input.value)));
  stagePlan(targets,entries,'',input.dataset.spreadKey!=='balancedMonths');
 }));
}
function salaryShortcutButtons(costs){
 const available=new Set(effectiveDates().filter(d=>d.kind==='period'&&d.start&&d.end).map(d=>d.id));
 return splitDaysButton(costs)+'<strong>Salary timing</strong>'+[['pre','end','End of preparation'],['shoot','whole','Shooting'],['post','start','Wrap · start of postproduction']].map(([ref,placement,title])=>'<button data-salary-shortcut="'+ref+'" data-placement="'+placement+'" '+(!costs.length||!available.has(ref)?'disabled':'')+'>'+title+'</button>').join('')+'<small>Marks selected costs as salaries; paid at month end. First/last parts use each budget length. Day-based costs use a Mon–Fri estimate (no holiday calendar).</small>';
}
function bindSalaryShortcuts(host,ids){
 bindSplitDaysButtons(host,ids);
 host.querySelectorAll('[data-salary-shortcut]').forEach(b=>b.onclick=()=>{
  const entries={};for(const id of ids){const c=project.model.costs.find(c=>c.id===id),line=PlanState.salaryShortcut(c,b.dataset.salaryShortcut,b.dataset.placement,Timing);entries[id]={autoName:true,mode:'period',salary:true,lines:[line]};entries[id].name=Timing.name(entries[id],effectiveDates());}
  stagePlan(ids,entries,'Salary timing updated in the preview. Check the dates and amounts, then Save. Undo restores the previous arrangement.');
 });
}
function editPlanEntry(id,change,forceEditor=true){const entry=PlanState.independent(planEntry(id));delete entry.salaryOnly;change(entry);entry.autoName=true;entry.name=Timing.name(entry,effectiveDates());stagePlan([id],{[id]:entry},'',forceEditor);}

function markPlanSalary(enabled){
 const costs=activeCosts(),entries={};
 for(const c of costs){const e=PlanState.independent(planEntry(c.id));e.salaryOnly=!!e.salaryOnly||!pendingCostIds().has(c.id);e.salary=enabled;entries[c.id]=e;}
 stagePlan(costs.map(c=>c.id),entries,enabled?'Marked as salaries. Existing payment choices are retained. Choose a period to apply month-end salary planning.':'Salary flag removed; timing retained.');
}
const phaseColours=['#e3edf7','#e7f0e3','#f5e9da','#ede5f2','#e0f0ef','#f2e4e8'];
function phaseStyle(month,periods){return periods.map((d,i)=>{const span=PlanState.overlap(d.start,d.end,month);return span?'linear-gradient(to right, transparent '+span.left+'%, '+phaseColours[i%phaseColours.length]+' '+span.left+'%, '+phaseColours[i%phaseColours.length]+' '+(span.left+span.width)+'%, transparent '+(span.left+span.width)+'%)':'';}).filter(Boolean).join(',');}
function planSummary(c){
 const a=c.allocations||[];
 if(c.payments.length&&c.payments.every(p=>p.date==='historical'))return 'Historical · one total';
 if(a.length)return a.map(x=>x.basis==='balanced-months'?'Balanced monthly payments · '+formatMonth(x.start.slice(0,7))+'–'+formatMonth(x.end.slice(0,7)):x.name+(x.months||x.days?' · '+(x.months||0)+'m '+(x.days||0)+'d delay':'')).join('; ');
 return c.payments.length?c.payments.length+' scheduled payments':'Needs timing';
}
function planCosts(){
 const q=$('plan-search').value.toLocaleLowerCase(),filter=$('plan-salaries').value,model=previewModel||project.model;
 return model.costs.filter(c=>(filter==='all'||filter==='salary'&&planEntry(c.id).salary||filter==='suggested'&&(selected.has(c.id)||PlanState.salaryCandidate(c)&&!planEntry(c.id).salary))&&!c.removed&&!c.archived&&c.amount&&(!$('plan-unplanned').checked||c.unallocated||selected.has(c.id))&&(!q||(c.name+' '+c.section_name+' '+sourceHint(c)+' '+(c.sourceDescription||'')).toLocaleLowerCase().includes(q)));
}
function planFocus(id){selected=new Set([id]);draft=null;draftKey='';saveDraftStore();renderPlan();}
function renderPlan(forceEditor=false){
 if(!project||!$('plan'))return;
 const scroller=$('plan-rows').closest('.plan-scroll'),scrollTop=scroller.scrollTop,scrollLeft=scroller.scrollLeft;
 const focused=document.activeElement,focusKey=focused?.dataset?.planCheck?'planCheck':focused?.dataset?.planCost?'planCost':null,focusId=focusKey?focused.dataset[focusKey]:null;

 $('plan-rows').classList.toggle('selection-active',selected.size>0);
 const model=previewModel||project.model,waiting=hasPending()&&!previewModel,ids=pendingCostIds(),costs=planCosts(),periods=effectiveDates().filter(d=>d.kind==='period');
 const months=[...new Set(['historical',...model.months,...PlanState.months(effectiveDates(),model)])].sort((a,b)=>a==='historical'?-1:b==='historical'?1:a.localeCompare(b));const picked=activeCosts(),shaded=periods.filter(d=>d.id!=='hist'&&d.start&&d.end);
 $('salary-shortcuts').innerHTML='';
 $('spread-shortcuts').innerHTML='';
 $('plan-phase-legend').innerHTML=shaded.map((d,i)=>'<span><i style="background:'+phaseColours[i%phaseColours.length]+'"></i>'+esc(d.name)+' · '+esc(Timing.dateLabel(d.start)+'–'+Timing.dateLabel(d.end))+'</span>').join('');
 $('plan-count').textContent=`${costs.length} shown · ${selected.size} selected`+([...selected].some(id=>!costs.some(c=>c.id===id))?' (includes costs outside this filter)':'');
 $('plan-actions').innerHTML=actionToolbar();bindActionToolbar();
 $('plan-head').innerHTML='<tr><th class="cost-cell"><label><input id="plan-select-all" type="checkbox" aria-label="Select all visible plan costs" '+(costs.length&&costs.every(c=>selected.has(c.id))?'checked':'')+'> Cost / budget</label></th>'+months.map(m=>'<th class="month-cell" style="background-image:'+phaseStyle(m,shaded)+'">'+formatMonth(m)+'<small>'+esc(m==='historical'?'Historical':shaded.filter(d=>PlanState.overlap(d.start,d.end,m)).map(d=>d.name).join(' / '))+'</small></th>').join('')+'</tr>';
 let section=null,html='';
 for(const c of costs){
  if(c.section!==section){section=c.section;const group=costs.filter(x=>x.section===section);html+='<tr class="group"><td class="cost-cell"><label><input type="checkbox" data-plan-section="'+esc(section)+'" aria-label="Select section '+esc(c.section_name)+'" '+(group.every(x=>selected.has(x.id))?'checked':'')+'> '+esc(c.section_name)+'</label>'+'</td><td colspan="'+months.length+'"></td></tr>';}
  const byMonth=paymentsByMonth(c),pending=ids.has(c.id)||dateDirty;
  html+='<tr class="'+(selected.has(c.id)?'selected':'')+'"><td class="cost-cell"><input data-plan-check="'+c.id+'" type="checkbox" aria-label="Select '+esc(c.name)+' rows '+c.first+'" '+(selected.has(c.id)?'checked':'')+'> <button class="cost-label" data-plan-cost="'+c.id+'">'+esc(c.name)+'</button><small class="cost-meta">'+(planEntry(c.id).salary?'<strong>Salary</strong> · ':PlanState.salaryCandidate(c)?'Suggested salary · ':'')+esc(sourceHint(c))+' · '+euro(c.amount)+' · rows '+c.first+'–'+c.last+'<br>'+(pending?'<strong>Unsaved</strong> · ':'')+(waiting&&pending?'Calculating…':c.unallocated?euro(c.unallocated)+' needs timing':esc(planSummary(c)))+'</small>'+timelineLabel(c.id)+'<button class="timeline-row-menu" data-timeline-menu="'+c.id+'" aria-label="Payment options for '+esc(c.name)+'">⋯</button>'+(!waiting?outsideBadge(c,model):'')+'</td>';
  html+=months.map(m=>{const spans=(c.allocations||[]).map(a=>PlanState.overlap(a.start,a.end,m)).filter(Boolean);return '<td class="month-cell" style="background-image:'+phaseStyle(m,shaded)+'">'+((!waiting&&spans.length?'<div class="work-track" aria-label="Work in '+formatMonth(m)+'">'+spans.map(s=>'<span style="left:'+s.left+'%;width:'+s.width+'%"></span>').join('')+'</div>':'')+timelineMonthCell(c,m,waiting?'…':byMonth[m]?euro(byMonth[m]):'＋'))+'</td>';}).join('')+'</tr>';
 }
 $('plan-rows').innerHTML=html||'<tr><td class="cost-cell">No costs match this filter.</td><td colspan="'+months.length+'"></td></tr>';
 const totals={};for(const p of model.payments){const m=monthOf(p.date);totals[m]=(totals[m]||0)+p.amount;}
 $('plan-totals').innerHTML='<tr><td class="cost-cell">Whole plan · all costs</td>'+months.map(m=>'<td class="month-cell">'+(waiting?'…':euro(totals[m]||0))+'</td>').join('')+'</tr>';
 $('plan-caption').textContent=(waiting?(previewError?'Preview unavailable: '+previewError:'Calculating all pending edits…'):'Click + to include a month; click an amount or right-click for options. Shift-click spans a range. Bars show work; amounts show payments. '+(hasPending()?'Includes all unsaved changes.':'Saved plan.'))+' Totals include all costs, including those hidden by the search. '+(model.outside?euro(model.outside)+' falls outside the original Excel month range; see Monthly preview.':'');
 $('plan-select-all').onchange=ev=>{for(const c of costs)ev.target.checked?selected.add(c.id):selected.delete(c.id);draft=null;draftKey='';saveDraftStore();renderPlan();};
 $('plan-rows').querySelectorAll('[data-plan-section]').forEach(b=>b.onchange=()=>{for(const c of costs.filter(x=>String(x.section)===b.dataset.planSection))b.checked?selected.add(c.id):selected.delete(c.id);draft=null;draftKey='';saveDraftStore();renderPlan();});
 $('plan-rows').querySelectorAll('[data-plan-check]').forEach(b=>b.onchange=()=>{b.checked?selected.add(b.dataset.planCheck):selected.delete(b.dataset.planCheck);draft=null;draftKey='';saveDraftStore();renderPlan();});
 $('plan-rows').querySelectorAll('[data-plan-cost]').forEach(b=>b.onclick=()=>planFocus(b.dataset.planCost));
 bindTimeline();
 renderPlanSelection(model,waiting,forceEditor===true);renderOutsideSummary(model,waiting);updateOutsideInline(model,waiting);bindOutsideButtons($('plan-rows'));updatePlanSave();
 scroller.scrollTop=scrollTop;scroller.scrollLeft=scrollLeft;
 if(focusKey){const attribute=focusKey==='planCheck'?'data-plan-check':'data-plan-cost';[...$('plan-rows').querySelectorAll('['+attribute+']')].find(el=>el.dataset[focusKey]===focusId)?.focus({preventScroll:true});}

}
function salaryLengthNote(l){const n=Number(l.windowLength);return l.windowUnit==='months'&&n>0&&!Number.isInteger(n)?`${l.lengthSource==='budget'?'From budget':'Work length'}: ${n} months = ${Math.floor(n)} calendar months + ${Math.round((n-Math.floor(n))*30+1e-9)} days (30-day fraction).`:Timing.lengthNote(l);}
function salaryIntro(c,e,shown){
 const n=Number(c.sourceDuration),unit=c.sourceDurationUnit,rate=n>0?c.amount/n:null;
 return '<div class="salary-intro"><strong>Salary · paid at month end</strong><p>Budget '+euro(c.amount)+(PlanState.salaryCandidate(c)?', including fringes':'')+'. '+(rate?euro(rate)+' per '+(unit==='days'?'paid day':'month')+' in the budget. ':'')+'Grouped costs follow the same timing.</p>'+(e.lines.some(l=>l.months||l.days||l.payAt==='work-end')?'<p>Existing payment exception retained. <button class="text-button" id="salary-month-end">Pay at each month end</button></p>':'')+'</div>';
}
function salaryPart(c,e,l,i,span,shown){
 let html='<div class="salary-controls"><label>Salary calculation <select aria-label="Part '+(i+1)+' salary calculation" data-salary-basis="'+i+'">'+option('salary-months','Monthly salary',l.basis)+option('weekday-estimate','Mon–Fri estimate',l.basis)+option('paid-days','Daily salary · enter paid days',l.basis)+option('calendar-days','Calendar-day estimate',l.basis)+option('equal-month','Equal monthly payments',l.basis)+'</select></label>';
 if(l.window==='whole'&&c.sourceDurationUnit==='months'&&e.lines.length===1)html+=' <button class="text-button" data-salary-duration="'+i+'">Use budget duration: '+esc(c.sourceDuration)+' months at '+(c.sourceSegment==='pre'?'end':'start')+'</button>';
 if(l.basis==='paid-days'){
  const local=l.paidDaysSource==='cost',raw=local?(l.paidDays||{}):(effectiveDates().find(d=>d.id===l.ref)?.weights||{}),entered=Object.values(raw).reduce((s,v)=>s+Number(v||0),0),expected=c.sourceDurationUnit==='days'?Number(c.sourceDuration):null;
  html+='<p>Enter paid days in each work month, including zero. Dates define the work window; they do not turn budget days into consecutive days.</p>';
  if(!local)html+='<p>Using shared paid-day totals. <button class="text-button" data-salary-local="'+i+'">Enter days for this salary</button></p>';
  if(span)html+='<div class="actions">'+span.months.map(m=>'<label>'+formatMonth(m)+' <input type="number" min="0" step="any" aria-label="Part '+(i+1)+' paid days '+formatMonth(m)+'" '+(local?'':'disabled')+' aria-invalid="'+(local&&raw[m]===undefined)+'" data-salary-days="'+i+'" data-month="'+m+'" value="'+esc(raw[m]??'')+'"></label>').join('')+'</div>';
  html+='<p data-salary-count>'+entered+' paid days entered'+(expected!==null&&e.lines.length===1?' / '+expected+' in the budget'+(Math.abs(expected-entered)>0.000001?' · '+(expected-entered)+' days remaining':' · matches budget'):'')+'.</p>';
 }else if(l.basis==='salary-months'&&span){
  const weights=span.months.map(m=>{const x=PlanState.overlap(span.start,span.end,m);return x?x.width/100:0;}),units=weights.reduce((a,b)=>a+b,0);

  if(c.sourceDurationUnit==='months'&&Number(c.sourceDuration)>0&&e.lines.length===1){const estimate=Math.round(c.amount*units/Number(c.sourceDuration)),diff=estimate-c.amount;
   html+='<details class="salary-math"><summary>Calculation'+(diff?' · rate estimate differs by '+(diff>0?'+':'−')+euro(Math.abs(diff)):' · matches budget')+'</summary><p>'+units.toFixed(4)+' calendar-month shares from these dates (worked calendar days / days in each month). At the budget cost rate: '+euro(estimate)+'. '+(diff?'Difference from budget: '+(diff>0?'+':'−')+euro(Math.abs(diff))+'. Cashflow still allocates exactly '+euro(c.amount)+'. Adjust the work dates or the source budget if the agreement requires that rate exactly.':'Matches the budget.')+'</p></details>';
  }
 }
 return html+'</div>';
}
function bindSalaryControls(host,c,e){
 $('salary-month-end')?.addEventListener('click',()=>editPlanEntry(c.id,entry=>entry.lines.forEach(l=>Timing.setPayment(l,'monthly'))));
 host.querySelectorAll('[data-salary-basis]').forEach(input=>input.onchange=()=>editPlanEntry(c.id,entry=>{const l=entry.lines[Number(input.dataset.salaryBasis)];l.basis=input.value;if(l.basis==='paid-days'){l.paidDaysSource='cost';l.paidDays??={};}Timing.setPayment(l,'monthly');}));
 host.querySelectorAll('[data-salary-duration]').forEach(b=>b.onclick=()=>editPlanEntry(c.id,entry=>{const l=entry.lines[Number(b.dataset.salaryDuration)];l.window=c.sourceSegment==='pre'?'end':'start';Timing.seedBudgetLength(l,[c],true);}));
 host.querySelectorAll('[data-salary-local]').forEach(b=>b.onclick=()=>editPlanEntry(c.id,entry=>{const l=entry.lines[Number(b.dataset.salaryLocal)];l.paidDaysSource='cost';l.paidDays={...effectiveDates().find(d=>d.id===l.ref)?.weights};}));
 host.querySelectorAll('[data-salary-days]').forEach(input=>input.oninput=()=>{input.setAttribute('aria-invalid',String(input.value===''));editPlanEntry(c.id,entry=>{const l=entry.lines[Number(input.dataset.salaryDays)];l.paidDays??={};if(input.value==='')delete l.paidDays[input.dataset.month];else l.paidDays[input.dataset.month]=Number(input.value);},false);});
}

function preservePlanInput(host,scope,force,active=document.activeElement){return !force&&host.dataset.selection===scope&&host.contains(active)&&!!active?.matches('input,select');}
function renderPlanSelection(model,waiting,force=false){
 const costs=activeCosts(),host=$('plan-selection');
 const scope=costs.map(c=>c.id).sort().join('|');
 const keepFocus=preservePlanInput(host,scope,force);
 host.dataset.selection=scope;
 if(!costs.length){host.innerHTML='<div class="plan-empty">Select costs, choose a timing action above, then Assign. Review each result and Save. Create your own action once to reuse it across the budget.</div>';return;}
 if(costs.every(c=>PlanState.cleared(planEntry(c.id),Timing))){host.innerHTML=clearedTimingHTML(costs);return;}
 if(costs.some(c=>actionFor(c.id))){renderActionSelection(host,costs,model,waiting);return;}
 if(costs.every(c=>isPrepShoot(planEntry(c.id)))){renderPrepShootSelection(host,costs,model,waiting,keepFocus);return;}
 if(costs.every(c=>isDaySplit(planEntry(c.id)))){renderSplitDaysSelection(host,costs,model,waiting,keepFocus);return;}
 if(costs.length>1){host.innerHTML='<div class="plan-selection"><strong>'+costs.length+' costs selected · '+euro(costs.reduce((s,c)=>s+c.amount,0))+'</strong><p>Choose a timing action above and Assign. Each cost retains its own amount and quantity. You can adjust each result independently before saving.</p><button id="plan-detail">Open detailed editor</button></div>';$('plan-detail').onclick=()=>{setSelection([...selected]);showView('costs');};return;}
 const c=costs[0],e=planEntry(c.id),shown=model.costs.find(x=>x.id===c.id),periods=effectiveDates().filter(d=>d.kind==='period');
 const openPayments=new Set(host.dataset.cost===c.id?[...host.querySelectorAll('details[data-plan-payment][open]')].map(el=>el.dataset.planPayment):[]);host.dataset.cost=c.id;
 const historical=e.lines.length===1&&e.lines[0].ref==='hist';
 const spread=e.lines.length===1&&(e.lines[0].endRef||e.lines[0].basis==='balanced-months');
 const workable=['period','segments'].includes(e.mode)&&e.lines.every(l=>['balance','fixed'].includes(l.kind));
 const problems=waiting?[]:shown.allocationIssues||[];
 const one=e.mode==='one'&&e.lines.length===1;
 let html='<div class="plan-selection"><div class="line-head"><h3>'+esc(c.name)+' · '+(planEntry(c.id).salary?'<strong>Salary</strong> · ':PlanState.salaryCandidate(c)?'Suggested salary · ':'')+esc(sourceHint(c))+' · '+euro(c.amount)+'</h3><button id="plan-detail">Detailed editor</button></div>';
 html+=sourceDetailHTML(c)+'<p class="individual-status">'+(waiting?'Checking this edit…':pendingCostIds().has(c.id)?(problems.length||shown.unallocated?'This cost needs attention before saving.':PlanState.outsidePayments(shown,model).length?'Review payments outside the Excel cashflow before saving.':'This cost is ready to save. Other incomplete costs can be kept for later.'):'Saved timing.')+'</p>';
 if(problems.length)html+='<div class="plan-problem">This cost needs a timing correction: '+esc(problems.join('; '))+'</div>';
 if(!historical&&(e.salary||PlanState.salaryCandidate(c)||spread))html+='<div class="salary-shortcuts" id="salary-shortcuts-local">'+(spread?spreadButtons([c]):salaryShortcutButtons([c]))+'</div>';
 if(!e.lines.some(l=>l.ref||l.fixed||l.workStart))html+='<p>Choose a period above. The whole amount will follow its dates. Or <button class="text-button" id="plan-one">pay once on a date</button>.</p>';
 if(e.salary&&!spread&&!historical)html+=salaryIntro(c,e,shown);
 if(historical)html+=historicalCard();
 else if(spread)html+=spreadEditor(e,c);
 else if(workable&&e.lines.some(l=>l.ref||l.workStart)){
  html+=e.lines.map((l,i)=>{if(l.ref==='hist')return '<div class="plan-part"><strong>Historical · one total</strong><p>'+euro(shown.lineAmounts?.[i]||0)+' already paid.</p></div>';const span=workSpan(l),ref=periods.find(d=>d.id===l.ref),lnAmount=shown.lineAmounts?.[i];return '<div class="plan-part"><div class="actions"><strong class="part-label">'+(e.lines.length>1?'Part '+(i+1):'Work')+'</strong><select aria-label="Part '+(i+1)+' period" data-plan-line="'+i+'" data-key="ref">'+option('','Choose period…',l.ref)+periods.map(d=>option(d.id,d.name,l.ref)).join('')+'</select><select aria-label="Part '+(i+1)+' work span" data-plan-line="'+i+'" data-key="window">'+[['whole','Whole period'],['start','First part'],['end','Last part'],['after','After period'],['dates','Specific dates']].map(([v,t])=>option(v,t,l.window||'whole')).join('')+'</select>'+(['start','end','after'].includes(l.window)?'<label>Length <input aria-label="Part '+(i+1)+' work length" type="number" min="0.001" step="any" aria-invalid="'+(!(Number(l.windowLength)>0))+'" data-plan-line="'+i+'" data-key="windowLength" value="'+esc(l.windowLength??'')+'"></label><select aria-label="Part '+(i+1)+' length unit" data-plan-line="'+i+'" data-key="windowUnit">'+option('months','Calendar months',l.windowUnit)+option('days','Calendar days',l.windowUnit)+option('workdays','Mon–Fri workdays (estimate)',l.windowUnit)+'</select>':'')+'<label>From <input type="date" aria-label="Part '+(i+1)+' work starts" data-plan-line="'+i+'" data-key="workStart" value="'+esc(span?.start||'')+'"></label><label>to <input type="date" aria-label="Part '+(i+1)+' work ends" data-plan-line="'+i+'" data-key="workEnd" value="'+esc(span?.end||'')+'"></label>'+(e.salary&&e.lines.length===1?'':l.kind==='fixed'?'<label>Amount € <input type="number" step="0.01" data-plan-line="'+i+'" data-key="value" aria-label="Part '+(i+1)+' amount" value="'+esc(l.value)+'"></label>':'<span data-plan-remainder="'+i+'">'+(e.lines.length>1?'Remaining: ':'Full budget: ')+(waiting?'…':euro(shown.lineAmounts?.[i]??c.amount))+'</span>')+(i>0?'<button data-plan-remove="'+i+'" aria-label="Remove part '+(i+1)+'">Remove</button>':'')+'</div><p class="part-note">'+(l.window==='dates'?'Fixed work dates. <button class="text-button" data-plan-follow="'+i+'">Follow '+esc(ref?.name||'period')+' dates again</button>':'Follows '+esc(ref?.name||'the selected period')+' dates.')+(e.salary?'':' '+esc(({ 'weekday-estimate':'Mon–Fri estimate','salary-months':'Monthly salary shares','calendar-days':'Proportional calendar-day estimate','paid-days':'Actual paid days','equal-month':'Equal monthly amounts'})[l.basis]||l.basis)+'. '+(l.months||l.days?esc(Timing.delayLabel(l))+' Calculated from '+(l.payAt==='work-end'?'work end.':'each work month’s end.'):l.payAt==='work-end'?'Paid at work end.':'Paid during work, at month end.')+(!e.salary&&!['calendar-days','salary-months'].includes(l.basis)||l.months||l.days||l.payAt==='work-end'?' <button class="text-button" data-plan-default="'+i+'">Pay proportionally during work</button>':''))+'</p>'+(['start','end','after'].includes(l.window)?'<p class="part-note"><span class="length-explanation">'+esc(e.salary?salaryLengthNote(l):Timing.lengthNote(l))+'</span>'+(e.lines.length===1&&l.lengthSource!=='budget'?' <button class="text-button" data-plan-budget="'+i+'">Use budget duration</button>':'')+'</p>':'')+(e.salary?salaryPart(c,e,l,i,span,shown):'')+'<details data-plan-payment="'+i+'" '+(openPayments.has(String(i))||l.customPayment||Timing.paymentChoice(l)!=='monthly'?'open':'')+'><summary>Paid at a different time…</summary><select aria-label="Part '+(i+1)+' payment timing" data-plan-line="'+i+'" data-key="payment">'+paymentOptions(l.customPayment?'custom':Timing.paymentChoice(l))+'</select>'+(l.customPayment||Timing.paymentChoice(l)==='custom'?'<label> Months <input type="number" step="1" aria-label="Part '+(i+1)+' payment months" data-plan-line="'+i+'" data-key="months" value="'+esc(l.months||0)+'"></label><label> Days <input type="number" step="1" aria-label="Part '+(i+1)+' payment days" data-plan-line="'+i+'" data-key="days" value="'+esc(l.days||0)+'"></label>':'')+'</details></div>';}).join('');
  html+='<button id="plan-add-part">Add another work part</button>'+(e.lines.length>1?'<span class="muted"> Enter amounts; the last part receives the remainder.</span>':'')+'';
 }else if(one){const l=e.lines[0];html+='<div class="actions"><label>Pay the full amount on <input type="date" id="plan-pay-date" value="'+esc(l.fixed||effectiveDates().find(d=>d.id===l.ref)?.start||'')+'"></label></div><p class="part-note">One payment of '+euro(c.amount)+'. '+(l.months||l.days?'Existing delay: '+esc(Timing.delayLabel(l)):'')+'</p>';}
 else if(c.rule||pendingCostIds().has(c.id))html+='<p>'+esc(shown.description)+'. Use Detailed editor for the existing installments, paid-day entries or percentage splits. Clicking a period above replaces this timing in the preview; Undo restores it.</p>';
 const amounts=paymentsByMonth(shown);
 html+='<div class="plan-result" aria-live="polite">'+(waiting?(previewError?'Preview unavailable: '+esc(previewError):'Calculating monthly amounts…'):'<strong>Payments: </strong>'+Object.entries(amounts).sort().map(([m,v])=>formatMonth(m)+' <strong>'+euro(v)+'</strong>').join(' · ')+(shown.unallocated?' · '+euro(shown.unallocated)+' remains unallocated':'')+(shown.issues.length?'<br><span class="plan-problem">'+esc(shown.issues.join('; '))+'</span>':''))+'</div>';
 html+='<div class="plan-result">'+(!waiting?(shown.allocations||[]).map(a=>esc(a.name+': '+a.rows.map(r=>formatMonth(r.month)+' '+Number(r.weight.toFixed(4))+' '+(a.basis==='calendar-days'?'calendar days':a.basis==='paid-days'?'paid days':a.basis==='weekday-estimate'?'estimated weekdays':'monthly share')).join(', ')+'.')).join('<br>'):'')+'</div>';
 const family=familyFor(c);if(family.length>1)html+='<div class="actions"><span class="muted">Related budget parts:</span>'+family.map(f=>'<button data-plan-family="'+f.id+'" '+(f.id===c.id?'disabled':'')+'>'+esc(sourceHint(f))+'</button>').join('')+'</div>';
 if(keepFocus){const temp=document.createElement('div');temp.innerHTML=html+'</div>';for(const selector of ['.individual-status','.length-explanation','.plan-result','[data-plan-remainder]','[data-salary-count]','.spread-explanation']){const updated=temp.querySelectorAll(selector);host.querySelectorAll(selector).forEach((el,i)=>{if(updated[i])el.innerHTML=updated[i].innerHTML;});}host.querySelectorAll('input[type=date][data-plan-line]').forEach(input=>{if(input!==document.activeElement){const updated=temp.querySelector('input[data-plan-line="'+input.dataset.planLine+'"][data-key="'+input.dataset.key+'"]');if(updated)input.value=updated.value;}});return;}
 host.innerHTML=html+'</div>';
 $('plan-detail').onclick=()=>{setSelection([c.id]);showView('costs');};
 bindSalaryControls(host,c,e);if($('salary-shortcuts-local'))bindSalaryShortcuts($('salary-shortcuts-local'),[c.id]);bindHistoricalLabels(host);bindSpreadEditor(host,[c.id]);if($('salary-shortcuts-local'))bindSpreadButtons($('salary-shortcuts-local'),[c.id]);
 $('plan-one')?.addEventListener('click',()=>stagePlan([c.id],{[c.id]:{name:'One payment',autoName:true,mode:'one',lines:[emptyLine()]}}));
 $('plan-pay-date')?.addEventListener('change',ev=>editPlanEntry(c.id,entry=>{entry.lines[0].fixed=ev.target.value;entry.lines[0].ref='';entry.lines[0].months=0;entry.lines[0].days=0;}));
 host.querySelectorAll('[data-plan-family]').forEach(b=>b.onclick=()=>planFocus(b.dataset.planFamily));
 host.querySelectorAll('[data-plan-line]').forEach(input=>input.addEventListener(['value','windowLength'].includes(input.dataset.key)?'input':'change',()=>editPlanEntry(c.id,entry=>{
  const l=entry.lines[Number(input.dataset.planLine)],key=input.dataset.key;
  if(key==='ref'){l.ref=input.value;if(entry.salary&&entry.lines.length===1){entry.lines[Number(input.dataset.planLine)]=PlanState.salaryLine(c,input.value,Timing);}else{l.window='whole';delete l.workStart;delete l.workEnd;}}
  else if(key==='window'){l.window=input.value;if(entry.lines.length===1)Timing.seedBudgetLength(l,[c]);else if(['start','end','after'].includes(l.window)&&!l.lengthSource){l.windowLength='';l.lengthSource='needed';}Timing.seedDates(l,effectiveDates());}
  else if(key==='payment'){l.customPayment=input.value==='custom';Timing.setPayment(l,input.value);}
  else if(['windowLength','months','days','value'].includes(key)){l[key]=input.value===''?'':Number(input.value);if(key==='windowLength'){l.lengthSource='custom';input.setAttribute('aria-invalid',String(!(Number(input.value)>0)));}}
  else if(key==='windowUnit'){l.windowUnit=input.value;l.lengthSource='custom';}
  else{const span=workSpan(l);l.workStart=span?.start||'';l.workEnd=span?.end||'';l[key]=input.value;l.window='dates';delete l.estimateNote;delete l.estimateConfirmed;}
 },!['value','windowLength'].includes(input.dataset.key))));
 host.querySelectorAll('[data-plan-budget]').forEach(b=>b.onclick=()=>editPlanEntry(c.id,entry=>Timing.seedBudgetLength(entry.lines[Number(b.dataset.planBudget)],[c],true)));
 host.querySelectorAll('[data-plan-follow]').forEach(b=>b.onclick=()=>editPlanEntry(c.id,entry=>{entry.lines[Number(b.dataset.planFollow)].window='whole';}));
 host.querySelectorAll('[data-plan-default]').forEach(b=>b.onclick=()=>editPlanEntry(c.id,entry=>{const l=entry.lines[Number(b.dataset.planDefault)];l.basis='calendar-days';Timing.setPayment(l,'monthly');}));
 $('plan-add-part')?.addEventListener('click',()=>editPlanEntry(c.id,entry=>{const last=entry.lines.at(-1);if(last.kind==='balance'){last.kind='fixed';last.value=0;}entry.lines.push(emptyLine('balance'));entry.mode='segments';}));
 host.querySelectorAll('[data-plan-remove]').forEach(b=>b.onclick=()=>editPlanEntry(c.id,entry=>{entry.lines.splice(Number(b.dataset.planRemove),1);if(!entry.lines.some(l=>l.kind==='balance')){entry.lines.at(-1).kind='balance';entry.lines.at(-1).value=0;}entry.mode=entry.lines.length>1?'segments':'period';}));
}
document.addEventListener('DOMContentLoaded',()=>{
 $('plan-salaries').onchange=()=>{selected.clear();draft=null;draftKey='';saveDraftStore();renderPlan();};
 $('plan-dates').onclick=()=>showView('dates');$('plan-search').oninput=renderPlan;$('plan-unplanned').onchange=renderPlan;$('plan-save').onclick=()=>savePlan();$('plan-save-ready').onclick=reviewPlanProblem;$('plan-undo').onclick=undoPlan;
});

// Warn about the Excel display window without changing payment dates or Historical assignments.
function coverageText(model){return `Budget ${euro(model.total)} · In cashflow ${euro(model.allocated)} · Still needs timing ${euro(model.unallocated)} · Outside cashflow ${euro(model.outside)}`;}
function outsideRange(model){const months=model.months.filter(m=>m!=='historical');return months.length?months.map(m=>new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T00:00:00Z'))).filter((_,i)=>i===0||i===months.length-1).join('–'):'no monthly columns';}
function outsideWarning(cost,model){
 const payments=PlanState.outsidePayments(cost,model);if(!payments.length)return '';
 return '<div class="outside-warning"><strong>Outside Excel cashflow</strong><br>'+payments.map(p=>esc(Timing.dateLabel(p.date))+' · '+euro(p.amount)).join('; ')+'.<br>Cashflow months: '+esc(outsideRange(model))+'. These payments will not appear in the Excel total. Check the year and payment date.</div>';
}
function outsideBadge(cost,model){const p=PlanState.outsidePayments(cost,model);return p.length?'<button class="outside-badge" data-outside-cost="'+esc(cost.id)+'">Outside cashflow · '+euro(p.reduce((s,x)=>s+x.amount,0))+'</button>':'';}
function outsideReviewHTML(costs,model){return '<div class="outside-warning"><strong>'+costs.length+' cost'+(costs.length===1?'':'s')+' ('+euro(costs.reduce((s,c)=>s+PlanState.outsidePayments(c,model).reduce((a,p)=>a+p.amount,0),0))+') outside the Excel cashflow.</strong><br>Displayed months: '+esc(outsideRange(model))+'. These payments are excluded from the Excel total.<br>'+costs.map(c=>'<button data-outside-cost="'+esc(c.id)+'">Review '+esc(c.name)+'</button>').join('')+'</div>';}
function bindOutsideButtons(host){host?.querySelectorAll('[data-outside-cost]').forEach(b=>b.onclick=()=>reviewOutsideCost(b.dataset.outsideCost));}
function reviewOutsideCost(id){
 $('plan-search').value='';$('plan-unplanned').checked=false;$('plan-salaries').value='all';
 showView('plan');planFocus(id);const host=$('plan-selection');host.scrollIntoView({block:'nearest'});
 const input=host.querySelector('#plan-pay-date,input[type=date]');input?.focus({preventScroll:true});
}
function renderOutsideSummary(model,waiting=false){
 const costs=PlanState.outsideCosts(model),host=$('outside-summary');
 $('summary').textContent=`${model.costs.filter(c=>!c.removed).length} extracted costs · `+coverageText(model)+(waiting?' · Checking pending edits…':hasPending()?' · Includes unsaved edits':'');
 const excluded=project.state.source.excluded;if(excluded?.count)$('summary').textContent+=` · ${excluded.count} source costs outside this cashflow (${euro(excluded.amount)})`;
 if(model.coverage)$('summary').textContent+=` · Budget difference ${euro(model.coverage)}`;
 host.innerHTML=costs.length?'<div class="outside-warning"><strong>'+costs.length+' cost'+(costs.length===1?'':'s')+' ('+euro(model.outside)+') outside the Excel cashflow</strong> · '+(waiting?'Checking pending edits…':hasPending()?'Unsaved preview':'Saved plan')+'<br>These payments are excluded from the Excel total. <button id="review-outside">Review '+(costs.length===1?'cost':'costs')+'</button></div>':'';
 $('review-outside')?.addEventListener('click',()=>costs.length===1?reviewOutsideCost(costs[0].id):showOutsideDialog(costs,model,false));
}
function updateOutsideInline(model,waiting=false){
 for(const host of [$('plan-selection'),$('editor')]){
  if(!host)continue;
  // Keep warnings next to date controls without replacing a field being typed in.
  host.querySelectorAll('.outside-inline').forEach(el=>el.remove());
  if(waiting)continue;
  const costs=model.costs.filter(c=>selected.has(c.id));
  const groups=new Map();
  for(const input of host.querySelectorAll('input[type=date]')){
   const index=input.id==='plan-pay-date'?0:Number(input.dataset.planLine??input.dataset.line??input.dataset.quickLine??0);
   const group=input.closest('.plan-part,.rule-line,.quick-card')||input.parentElement.parentElement;
   if(!groups.has(group))groups.set(group,new Set());groups.get(group).add(index+1);
  }
  for(const [group,lines] of groups){
   const warning=costs.map(c=>outsideWarning({...c,payments:(c.payments||[]).filter(p=>lines.has(p.line))},model)).join('');
   if(warning){const node=document.createElement('div');node.className='outside-inline';node.innerHTML=warning;group.append(node);}
  }
 }
}
function showOutsideDialog(costs,model,saving){
 let dialog=$('outside-review');if(!dialog){dialog=document.createElement('dialog');dialog.id='outside-review';document.body.append(dialog);}
 dialog.innerHTML='<h2>'+(saving?'Review payments outside the cashflow':'Payments outside the cashflow')+'</h2><p>The Excel sheet covers '+esc(outsideRange(model))+'. The payments below will not appear in its total. You can correct their dates or deliberately keep them outside.</p><table><thead><tr><th>Cost</th><th>Payment date</th><th>Excluded amount</th><th></th></tr></thead><tbody>'+costs.flatMap(c=>PlanState.outsidePayments(c,model).map(p=>'<tr><td>'+esc(c.name)+'<br><small>Source rows '+c.first+'–'+c.last+'</small></td><td>'+esc(Timing.dateLabel(p.date))+'</td><td class="money">'+euro(p.amount)+'</td><td><button data-outside-review="'+esc(c.id)+'">Correct date</button></td></tr>')).join('')+'</tbody></table><div class="actions"><button id="outside-cancel">'+(saving?'Back to editing':'Close')+'</button>'+(saving?'<button class="primary" id="outside-keep">Keep outside and save</button>':'')+'</div>';
 return new Promise(resolve=>{
  let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();resolve(value);};
  dialog.oncancel=event=>{event.preventDefault();finish(false);};
  dialog.onclose=()=>{if(!settled){settled=true;resolve(false);}};
  $('outside-cancel').onclick=()=>finish(false);$('outside-keep')?.addEventListener('click',()=>finish(true));
  dialog.querySelectorAll('[data-outside-review]').forEach(b=>b.onclick=()=>{const id=b.dataset.outsideReview;finish(false);reviewOutsideCost(id);});
  dialog.showModal();
 });
}
async function confirmOutsideSave(costs,model){
 // Freeze only the save check; the modal keeps underlying fields from changing.
 const ticket=previewTicket;planCheckingSave=true;updatePlanSave();
 try{return await showOutsideDialog(costs,model,true)&&ticket===previewTicket;}
 finally{planCheckingSave=false;updatePlanSave();}
}
