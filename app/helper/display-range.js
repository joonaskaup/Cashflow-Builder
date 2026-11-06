'use strict';
// Display changes never rewrite payment dates or commit pending arrangements.
function rangeCaption(months){
 const dated=months.filter(m=>m!=='historical');
 return (months.includes('historical')?'Historical + ':'')+formatMonth(dated[0])+' – '+formatMonth(dated.at(-1));
}
function rangeDraftBody(value){
 const body={firstMonth:value,arrangements:[...paymentDrafts].filter(([k])=>paymentDirty.has(k)).flatMap(([k,d])=>draftEntries(d,k))};
 if(dateDirty){body.dates=copy(dateDraft);parseWeights(body.dates);}
 return body;
}
function acceptRangeResult(result){
 project=result;
 if(sourceDraft){
  sourceDraft.firstMonth=project.state.config.firstMonth;
  sourceDirty=JSON.stringify(sourceDraft)!==JSON.stringify(project.state.config);
  if(!sourceDirty)sourceDraft=null;
 }
 previewModel=null;previewError='';previewTicket++;selectedMonth=null;
 render();saveDraftStore();if(hasPending())queuePreview();
}
function openCashflowRange(){
 if(!project||busy)return;
 if(draft&&draftKey&&paymentDirty.has(draftKey))paymentDrafts.set(draftKey,copy(draft));
 const dialog=document.createElement('dialog');dialog.className='cashflow-range-dialog';
 const initial=(sourceDirty&&sourceDraft?sourceDraft.firstMonth:project.state.config.firstMonth).slice(0,7).split('-');
 dialog.innerHTML='<form method="dialog"><div class="actions"><h2>Cashflow range</h2><button id="range-close">Close</button></div></form>'+
  '<p>Currently saved: <strong>'+rangeCaption(project.model.months)+'</strong></p>'+
  '<label for="range-first">First cashflow month (MM/YYYY)</label><div class="actions"><input id="range-first" type="text" placeholder="02/2027" value="'+esc(initial[1]+'/'+initial[0])+'"><button id="range-preview">Preview range</button></div>'+
  '<p>Change which months appear in the cashflow. Work dates and payment dates stay where you placed them. Historical stays in its own column.</p>'+
  '<p class="muted">The Excel template has 17 columns, or Historical and 16 months. Payments beyond the chosen range remain flagged.</p>'+
  '<div id="range-result" aria-live="polite"></div><div id="range-error" class="issue" role="alert"></div>'+
  '<div class="actions"><button id="range-apply" class="primary" disabled>Apply cashflow range</button><span>Saves the range to the app and working Excel copy. Other pending edits stay unsaved.</span></div>';
 document.body.append(dialog);
 const el=id=>dialog.querySelector('#'+id),input=el('range-first'),apply=el('range-apply'),preview=el('range-preview');
 let report=null,ticket=0,waiting=false;
 function invalidate(){ticket++;report=null;apply.disabled=true;el('range-result').innerHTML='';el('range-error').textContent='';}
 input.oninput=invalidate;
 dialog.addEventListener('close',()=>{ticket++;dialog.remove();});
 dialog.addEventListener('cancel',event=>{if(waiting)event.preventDefault();});
 function controls(value){waiting=value;input.disabled=value;preview.disabled=value;el('range-close').disabled=value;}
 preview.onclick=async()=>{
  invalidate();const current=ticket;controls(true);el('range-result').textContent='Checking the proposed range…';
  try{
   const response=await api('range-preview',rangeDraftBody(input.value));
   if(current!==ticket||!dialog.open)return;
   report=response;
   const pending=hasPending();
   el('range-result').innerHTML='<div class="range-summary"><strong>Proposed: '+rangeCaption(report.months)+'</strong><p>Costs outside the display: '+euro(report.outsideBefore)+' → '+euro(report.outsideAfter)+'</p><p>Manual financing keeps its calendar months.</p></div>'+
    (report.confirmOpening?'<p><label><input id="range-opening" type="checkbox"> I confirm '+euro(report.opening)+' is the correct opening cash balance for the new first month.</label></p>':'')+
    '<p>'+(pending?'Preview includes pending timing and date edits. Apply saves only the range.':'Preview of saved payments in the new range.')+'</p>'+
    '<div class="range-months"><table><thead><tr><th>Month</th><th>Planned costs</th></tr></thead><tbody>'+report.months.map((m,i)=>'<tr><td>'+formatMonth(m)+'</td><td>'+euro(monthlyTotal(report.model,i))+'</td></tr>').join('')+'</tbody></table></div>';
   apply.disabled=report.confirmOpening;
   if(report.confirmOpening)el('range-opening').onchange=()=>apply.disabled=!el('range-opening').checked;
  }catch(e){report=null;el('range-result').innerHTML='';el('range-error').textContent=e.message;}
  finally{controls(false);}
 };
 input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();preview.click();}};
 apply.onclick=async()=>{
  if(!report||waiting||busy)return;
  controls(true);apply.disabled=true;busy=true;el('range-error').textContent='';
  try{
   const result=await api('range',{firstMonth:report.firstMonth,confirmOpening:el('range-opening')?.checked===true,openingAmount:report.opening});
   busy=false;acceptRangeResult(result);dialog.close();
   notice('Cashflow range saved: '+rangeCaption(result.model.months)+'. Payment dates are unchanged.'+(hasPending()?' Your other pending edits are still unsaved.':''));
  }catch(e){el('range-error').textContent=e.message;apply.disabled=report.confirmOpening&&!el('range-opening')?.checked;}
  finally{busy=false;controls(false);}
 };
 dialog.showModal();input.focus();input.select();
}
document.querySelectorAll('[data-open-range]').forEach(button=>button.addEventListener('click',openCashflowRange));
