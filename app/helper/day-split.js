/* Budget quantities define shares; production dates define monthly placement. */
function isDaySplit(e){return e?.lines?.length===1&&e.lines[0].basis==='day-split';}
function splitDaysButton(costs){return costs.length&&costs.every(c=>c.sourceDurationUnit==='days'&&Number(c.sourceDuration)>0)?'<button data-split-days>Split days</button>':'';}
function productionShootingDays(){const d=effectiveDates().find(d=>d.id==='shoot');if(d?.paidDaysTotal!==undefined&&d.paidDaysTotal!==''&&d.paidDaysTotal!==null)return Number(d.paidDaysTotal);const values=Object.values(d?.weights||{});return values.length?values.reduce((a,b)=>a+Number(b),0):null;}
function budgetDaySplit(cost){
 // Only propose explicit, complete day counts. Job titles and rates are not quantities.
 if(cost.sourceDurationUnit!=='days'||!cost.sourceDescription)return null;
 const result={prep:0,shoot:0,wrap:0};
 for(const part of cost.sourceDescription.split('|')){
  if(/\b(about|approx|approximately|up to|or)\b|[~≈]|\d\s*[-–]\s*\d/i.test(part))return null;
  const text=part.split(/[—–]/).pop(),phases=[['prep',/\b(prep|preparation|valmistelu)\b/i],['shoot',/\b(shoot|shooting|kuvaus)\b/i],['wrap',/\bwrap\b/i]].filter(([,re])=>re.test(text));
  const counts=[...text.matchAll(/(\d+(?:[.,]\d+)?)\s+(?:[a-zA-ZäöåÄÖÅ-]+\s+){0,3}(?:days?|päivää|pv)\b/gi)];
  if(phases.length!==1||counts.length!==1)return null;
  const n=Number(counts[0][1].replace(',','.'));if(!Number.isFinite(n)||n<0)return null;
  result[phases[0][0]]+=n;
 }
 return Math.abs(result.prep+result.shoot+result.wrap-Number(cost.sourceDuration))<0.000001?result:null;
}
function splitDayCounts(cost,line,productionTotal){
 const read=x=>x===''||x===undefined||x===null?null:Number(x),wrap=read(line.wrapDays),remainder=line.remainder||'preparation';
 let prep,shoot;
 if(remainder==='shooting'){prep=read(line.prepDays);shoot=prep!==null&&wrap!==null?Number(cost.sourceDuration)-prep-wrap:null;}
 else{shoot=line.shootingLinked!==false?productionTotal:read(line.shootingDays);prep=shoot!==null&&wrap!==null?Number(cost.sourceDuration)-shoot-wrap:null;}
 return {prep,shoot,wrap,remainder};
}
function bindSplitDaysButtons(host,ids){
 host?.querySelectorAll('[data-split-days]').forEach(b=>b.onclick=()=>{
  const entries={};for(const id of ids){const existing=planEntry(id),cost=project.model.costs.find(c=>c.id===id),short=productionShootingDays()>Number(cost.sourceDuration);
   entries[id]=isDaySplit(existing)?PlanState.independent(existing):{name:'Split paid days',autoName:true,mode:'period',salary:!!existing.salary,lines:[{...emptyLine('balance','shoot'),basis:'day-split',remainder:short?'shooting':'preparation',prepDays:'',shootingLinked:!short,shootingDays:'',wrapDays:0}]};}
  stagePlan(ids,entries,'Enter the days you know, or choose a budget suggestion. Check the calculated split, then Save changes.');
 });
}
function dayBudgetDescription(cost){return cost.sourceDescription?'<p class="muted" style="white-space:pre-wrap;overflow-wrap:anywhere"><strong>Budget description · rows '+cost.first+'–'+cost.last+'</strong><br>'+esc(cost.sourceDescription)+'</p>':'';}
function splitDaysResults(costs,entries,model,waiting){
 return costs.map((c,i)=>{
  const counts=splitDayCounts(c,entries[i].lines[0],productionShootingDays()),{shoot,wrap,prep,remainder}=counts;
  const shown=model.costs.find(x=>x.id===c.id),parts=shown?.daySplit?.parts||[],allocation=shown?.allocations||[];
  let html='<div class="day-cost"><strong>'+esc(c.name)+' · '+c.sourceDuration+' budget days · '+euro(c.amount)+'</strong>'+(costs.length>1?dayBudgetDescription(c):'')+'<table><thead><tr><th>Work</th><th>Paid days</th><th>Placement</th><th class="money">Amount</th></tr></thead><tbody>';
  for(const [name,n,placement,remaining] of [['Preparation',prep,'End of preparation',remainder==='preparation'],['Shooting',shoot,'During shooting',remainder==='shooting'],['Wrap',wrap,'Start of postproduction',false]]){
   const part=parts.find(p=>p.name===name),span=allocation.find(a=>a.name===name);
   html+='<tr><td>'+name+'</td><td>'+esc(n===null?'—':Number(n.toFixed(6)))+(remaining?' · remaining':'')+'</td><td>'+placement+(span&&!waiting?'<small>'+esc(Timing.dateLabel(span.start)+'–'+Timing.dateLabel(span.end))+'</small>':'')+'</td><td class="money">'+(waiting||!part?'—':euro(part.amount))+'</td></tr>';
  }
  html+='</tbody></table>';
  if(!waiting&&shown?.allocationIssues?.length)html+='<p class="issue">'+esc(shown.allocationIssues.join('; '))+'</p>';
  if(waiting)html+='<p>Calculating payments…</p>';
  else html+='<p><strong>Payments:</strong> '+(Object.entries(paymentsByMonth(shown)).sort().map(([m,v])=>formatMonth(m)+' '+euro(v)).join(' · ')||'Complete the day split above.')+'</p>';
  return html+'</div>';
 }).join('');
}
function splitDaysEditor(costs,entries,model=previewModel||project.model,waiting=hasPending()&&!previewModel){
 const common=key=>entries.every(e=>e.lines[0][key]===entries[0].lines[0][key])?entries[0].lines[0][key]:'';
 const prepMode=entries.every(e=>e.lines[0].remainder==='shooting'),mixedMode=entries.some(e=>e.lines[0].remainder==='shooting')&&!prepMode;
 const linked=!prepMode&&entries.every(e=>e.lines[0].shootingLinked!==false),mixed=entries.some(e=>e.lines[0].shootingLinked!==false)&&!linked&&!prepMode;
 const d=effectiveDates().find(x=>x.id==='shoot'),total=productionShootingDays(),hasActual=!!Object.keys(d?.weights||{}).length,suggestions=costs.map(budgetDaySplit),allSuggested=suggestions.every(Boolean);
 const input=(label,key,value)=>'<label>'+label+' <input type="number" min="0" step="any" data-day-key="'+key+'" aria-label="'+label+'" value="'+esc(value??'')+'" placeholder="Enter days; 0 if none"></label>';
 let html='<div class="day-split"><h3>Split paid days</h3>'+(costs.length===1?dayBudgetDescription(costs[0]):'');
 html+='<div class="choice-row"><button data-day-action="all-shoot">'+(costs.length===1?'All '+costs[0].sourceDuration+' days during shooting':'All budget days during shooting')+'</button>';
 if(allSuggested)html+='<button data-day-action="budget">'+(costs.length===1?'Use budget split · '+suggestions[0].prep+' prep / '+suggestions[0].shoot+' shoot / '+suggestions[0].wrap+' wrap':'Use each cost’s budget split')+'</button>';
 html+='</div>'+(allSuggested?'<p class="muted">Budget suggestion places prep at the end of preparation, and wrap at the start of postproduction. Review the dates below.</p>':'');
 html+='<div class="day-controls"><div class="choice-row"><button data-day-mode="preparation" aria-pressed="'+(!prepMode&&!mixedMode)+'">Enter shooting days</button><button data-day-mode="shooting" aria-pressed="'+prepMode+'">Enter preparation days</button></div>';
 if(mixedMode)html+='<p>Selected costs calculate different remainders. Choose which days to enter to give them the same approach.</p>';
 if(prepMode)html+=input('Preparation days','prepDays',common('prepDays'));
 else{
  html+='<label><input type="checkbox" data-day-key="shootingLinked" '+(linked?'checked':'')+'> Works the whole shoot'+(total!==null?' · '+total+' production shooting days':' · use production shooting days')+'</label>';
  if(mixed)html+='<p>Selected costs have different link choices. Changing this checkbox applies to all selected costs.</p>';
  if(!linked)html+=input('Shooting days for selected costs','shootingDays',common('shootingDays'));
 }
 html+=input('Wrap days','wrapDays',common('wrapDays'))+'<p>'+(prepMode?'Shooting':'Preparation')+' receives the remaining budget days automatically. Paid at each month end; grouped salary costs follow the same split.</p></div>';
 html+='<details '+(total===null&&linked?'open':'')+'><summary>Production timetable'+(total!==null?' · '+total+' shooting days':' · set shooting days')+' (shared)</summary><label>Production shooting days <input type="number" min="0" max="1200" step="any" aria-label="Production shooting days" data-shoot-total value="'+esc(d?.paidDaysTotal??'')+'" placeholder="'+(total!==null?total+' from monthly counts':'Enter once, e.g. 24')+'"></label><p>Changing this total affects every cost linked to the whole shoot. Use the cost’s own day fields above for a shorter job.</p></details>';
 html+='<div class="day-split-results">'+splitDaysResults(costs,entries,model,waiting)+'</div><p class="muted">'+(linked&&hasActual?'Shooting uses the shared actual paid-day counts by month.':'Shooting monthly amounts use a Mon–Fri estimate across the shooting period.')+' Preparation uses the last Mon–Fri days of preparation; wrap uses the first Mon–Fri days of postproduction. Public holidays are not excluded.</p><button class="text-button" data-day-dates>Enter actual shooting-day counts by month</button><p class="muted">Save changes below saves all pending costs and shared timetable edits.</p></div>';
 return html;
}
function bindSplitDaysEditor(host,ids){
 const targetsFor=el=>{const id=el.closest('[data-day-cost]')?.dataset.dayCost;return id?[id]:ids;};
 const change=(el,edit,force=true)=>{const targets=targetsFor(el),entries={};for(const id of targets){const e=PlanState.independent(planEntry(id));delete e.salaryOnly;edit(e.lines[0],project.model.costs.find(c=>c.id===id));e.autoName=true;e.name=Timing.name(e,effectiveDates());entries[id]=e;}stagePlan(targets,entries,'',force);};
 host.querySelectorAll('[data-shoot-total]').forEach(input=>input.oninput=()=>{
  if(!dateDirty)dateDraft=copy(project.state.dates);
  const d=dateDraft.find(d=>d.id==='shoot');if(!d)return notice('Add a Shooting period in Dates and periods.',true);
  d.paidDaysTotal=input.value;markDateDirty();drawDates();renderPlan(false);
 });
 host.querySelectorAll('[data-day-mode]').forEach(b=>b.onclick=()=>change(b,(l,c)=>{const counts=splitDayCounts(c,l,productionShootingDays());l.remainder=b.dataset.dayMode;if(l.remainder==='shooting'){l.prepDays=counts.prep!==null&&counts.prep>=0?counts.prep:'';l.shootingLinked=false;}else{l.shootingDays=counts.shoot!==null&&counts.shoot>=0?counts.shoot:'';l.shootingLinked=false;}}));
 host.querySelectorAll('[data-day-action]').forEach(b=>b.onclick=()=>change(b,(l,c)=>{const suggestion=b.dataset.dayAction==='budget'?budgetDaySplit(c):{prep:0,wrap:0};if(!suggestion)return;l.remainder='shooting';l.shootingLinked=false;l.prepDays=suggestion.prep;l.wrapDays=suggestion.wrap;}));
 host.querySelectorAll('[data-day-key]').forEach(input=>input.addEventListener(input.type==='checkbox'?'change':'input',()=>change(input,l=>{const key=input.dataset.dayKey;if(key==='shootingLinked'){l[key]=input.checked;if(!input.checked&&l.shootingDays==='')l.shootingDays=productionShootingDays()??'';}else l[key]=input.value;},input.type==='checkbox')));
 host.querySelectorAll('[data-day-dates]').forEach(b=>b.onclick=()=>showView('dates'));
}
function renderSplitDaysSelection(host,costs,model,waiting,keepFocus){
 const entries=costs.map(c=>planEntry(c.id));
 if(keepFocus){const result=host.querySelector('.day-split-results');if(result)result.innerHTML=splitDaysResults(costs,entries,model,waiting);return;}
 host.innerHTML='<div class="plan-selection">'+splitDaysEditor(costs,entries,model,waiting)+'</div>';
 bindSplitDaysEditor(host,costs.map(c=>c.id));
}

function isPrepShoot(entry){return entry?.lines?.length===1&&entry.lines[0].basis==='prep-shoot';}
function prepShootButton(costs){return costs.length&&costs.every(c=>['days','months'].includes(c.sourceDurationUnit)&&Number(c.sourceDuration)>0)?'<button data-prep-shoot>Preparation + shooting · no wrap</button>':'';}
function bindPrepShootButtons(host,ids){host?.querySelectorAll('[data-prep-shoot]').forEach(b=>b.onclick=()=>{
 const entries=Object.fromEntries(ids.map(id=>[id,{name:'Preparation + shooting · no wrap',autoName:true,mode:'period',salary:!!planEntry(id).salary,lines:[{...emptyLine('balance','shoot'),basis:'prep-shoot',shootingLinked:true,shootingQuantity:''}]}]));
 stagePlan(ids,entries,'Review each cost: shooting uses its own budget unit, preparation receives the remainder, and wrap is zero.');
});}
function prepShootResults(costs,model,waiting){return costs.map(c=>{
 const shown=model.costs.find(x=>x.id===c.id),calc=shown?.prepShoot,alloc=shown?.allocations||[];
 let html='<div class="day-cost"><strong>'+esc(c.name)+' · '+Number(Number(c.sourceDuration).toFixed(3))+' '+esc(c.sourceDurationUnit)+' · '+euro(c.amount)+'</strong>';
 html+='<table><thead><tr><th>Work</th><th>Budget quantity</th><th>Work dates</th><th>Amount</th></tr></thead><tbody>';
 for(const name of ['Preparation','Shooting']){const part=calc?.parts.find(p=>p.name===name),span=alloc.find(a=>a.name===name);html+='<tr><td>'+name+(name==='Preparation'?' · remaining':'')+'</td><td>'+(!waiting&&part?Number(part.days.toFixed(c.sourceDurationUnit==='months'?3:6))+' '+esc(c.sourceDurationUnit):'—')+'</td><td>'+(!waiting&&span?esc(Timing.dateLabel(span.start)+'–'+Timing.dateLabel(span.end)):'—')+'</td><td>'+(!waiting&&part?euro(part.amount):'—')+'</td></tr>';}
 html+='</tbody></table><p>Wrap: 0. '+(waiting?'Calculating…':'Payments: '+Object.entries(paymentsByMonth(shown)).sort().map(([m,v])=>formatMonth(m)+' '+euro(v)).join(' · '))+'</p>';
 const prepStart=alloc.find(a=>a.name==='Preparation')?.start,periodStart=effectiveDates().find(d=>d.id==='pre')?.start;
 if(!waiting&&prepStart&&periodStart&&prepStart<periodStart)html+='<p class="muted">This preparation length starts before the shared preparation period ('+esc(Timing.dateLabel(periodStart))+'). Check the displayed dates.</p>';
 if(!waiting&&shown?.allocationIssues?.length)html+='<p class="issue">'+esc(shown.allocationIssues.join('; '))+'</p>';
 return html+'</div>';
}).join('');}
function prepShootEditor(costs,model=previewModel||project.model,waiting=hasPending()&&!previewModel){
 let html='<div class="prep-shoot-editor" data-prep-ids="'+costs.map(c=>c.id).join('|')+'"><h3>Preparation + shooting · no wrap</h3><p>Each cost keeps its own budget quantity and amount. Preparation is the budget length minus shooting.</p>';
 if(costs.some(c=>c.sourceDurationUnit==='months'))html+='<p class="muted">Month-based costs: shooting length is estimated from calendar months — each full month is 1, plus days in partial months divided by that month’s days. Preparation is counted back from its period end using whole months plus 30 days per fractional month. Review the resulting dates.</p>';
 if(costs.some(c=>c.sourceDurationUnit==='days'))html+='<p class="muted">Day-based costs use the production shooting-day count. Preparation uses the last Mon–Fri days of preparation. Shooting uses actual monthly paid-day counts when available, otherwise a Mon–Fri estimate; public holidays are not excluded.</p>';
 for(const c of costs){const l=planEntry(c.id).lines[0];html+='<div class="day-cost"><strong>'+esc(c.name)+' · rows '+c.first+'–'+c.last+'</strong>'+(costs.length===1?dayBudgetDescription(c):'')+'<label><input type="checkbox" data-prep-link="'+c.id+'" '+(l.shootingLinked!==false?'checked':'')+'> Follow shooting timetable ('+esc(c.sourceDurationUnit)+')</label>'+(l.shootingLinked===false?'<label>Shooting '+esc(c.sourceDurationUnit)+' <input type="number" min="0" step="any" data-prep-quantity="'+c.id+'" aria-label="'+esc(c.name)+' shooting '+esc(c.sourceDurationUnit)+'" value="'+esc(l.shootingQuantity??'')+'"></label>':'')+(costs.length>1?'<button data-prep-focus="'+c.id+'">Edit only '+esc(c.name)+'</button>':'')+'</div>';}
 html+='<div class="prep-shoot-results">'+prepShootResults(costs,model,waiting)+'</div>';
 if(costs.length===1&&costs[0].sourceDurationUnit==='days')html+='<button data-split-days>Split days</button>';
 return html+'<p class="muted">Paid at each month end. Save changes saves all pending costs; selecting one cost does not discard the others.</p></div>';
}
function refreshPrepShootResults(host,model,waiting){host?.querySelectorAll('.prep-shoot-editor').forEach(box=>{const ids=box.dataset.prepIds.split('|'),costs=project.model.costs.filter(c=>ids.includes(c.id));box.querySelector('.prep-shoot-results').innerHTML=prepShootResults(costs,model,waiting);});}
function bindPrepShootEditor(host){
 host.querySelectorAll('[data-prep-focus]').forEach(b=>b.onclick=()=>setSelection([b.dataset.prepFocus]));
 host.querySelectorAll('[data-prep-link],[data-prep-quantity]').forEach(input=>input.addEventListener(input.type==='checkbox'?'change':'input',()=>{
  const id=input.dataset.prepLink||input.dataset.prepQuantity,e=PlanState.independent(planEntry(id)),l=e.lines[0];
  if(input.type==='checkbox'){l.shootingLinked=input.checked;if(!input.checked&&l.shootingQuantity==='')l.shootingQuantity=(previewModel||project.model).costs.find(c=>c.id===id)?.prepShoot?.shooting??'';}else l.shootingQuantity=input.value;
  stagePlan([id],{[id]:e},'',input.type==='checkbox');
 }));
 host.querySelectorAll('.prep-shoot-editor').forEach(box=>bindSplitDaysButtons(box,box.dataset.prepIds.split('|')));
}
function renderPrepShootSelection(host,costs,model,waiting,keepFocus){
 if(keepFocus){refreshPrepShootResults(host,model,waiting);return;}
 host.innerHTML=prepShootEditor(costs,model,waiting);bindPrepShootEditor(host);
}
