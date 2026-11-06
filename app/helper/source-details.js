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
