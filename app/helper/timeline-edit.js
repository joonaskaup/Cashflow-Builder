/* Direct edits use the existing independent drafts, calculation engine and Save. */
const TimelineMonths={
 scope(id,selection){return selection.has(id)?[...selection]:[id];},
 editable(entry){return !entry.lines?.length||(entry.lines.length===1&&JSON.stringify(entry.lines[0])===JSON.stringify(Timing.blank()))||(entry.lines.length===1&&entry.lines[0].basis==='timing-action'&&entry.lines[0].action?.type==='months');},
 action(entry){const a=entry.lines?.[0]?.action;if(a)return {...JSON.parse(JSON.stringify(a)),monthEqual:a.monthEqual??false};return {name:'Payment months',type:'months',paymentMonths:[],monthEqual:true};},
 range(a,b){if(a==='historical'||b==='historical')return [b];const out=[],end=[a,b].sort()[1];let d=new Date([a,b].sort()[0]+'-01T00:00:00Z');for(let i=0;i<240&&d.toISOString().slice(0,7)<=end;i++){out.push(d.toISOString().slice(0,7));d.setUTCMonth(d.getUTCMonth()+1);}return out;},
 parse(value,max){const s=String(value).trim().replace(',','.').replace(/%$/,'');if(!/^\d+(\.\d{1,2})?$/.test(s)||Number(s)>max)throw Error('Enter a number from 0 to '+max+' with at most two decimals.');return Number(s);},
 redistribute(a,month,percent){
  const p=TimelineMonths.parse(percent,100),rows=a.paymentMonths;
  const row=rows.find(r=>r.month===month);if(!row)throw Error('Add this month first.');
  if(rows.length===1&&p!==100)throw Error('Add another month to receive the remaining '+(100-p)+'%.');
  row.percent=String(p);a.monthEqual=false;
  const rest=rows.filter(r=>r!==row);if(rest.length)spreadMonthShares(rest,10000-Math.round(p*100));
 },
 add(a,months){for(const month of months)if(!a.paymentMonths.some(p=>p.month===month))togglePaymentMonth(a,month);},
 remove(a,month){a.paymentMonths=a.paymentMonths.filter(p=>p.month!==month);if(a.monthEqual)a.paymentMonths.forEach(p=>p.percent='1');spreadMonthShares(a.paymentMonths);}
};
let timelineAnchor=null,timelineMenuScope=null,timelineMenuSelectionKey='',timelineMenuPlanKey='';
function timelineFixed(id){return TimelineMonths.editable(planEntry(id));}
function timelineScope(id){return TimelineMonths.scope(id,selected).filter(id=>project.model.costs.some(c=>c.id===id&&!c.removed));}
function timelineMonthCell(c,m,content){
 const a=actionFor(c.id),on=a?.type==='months'&&a.paymentMonths?.some(p=>p.month===m);
 return '<button class="timeline-cell" data-timeline-cost="'+c.id+'" data-timeline-month="'+m+'" aria-label="'+esc(c.name+' · '+formatMonth(m)+' · '+(on?'edit payment':'add or review payment'))+'"'+(a?.type==='months'?' aria-pressed="'+!!on+'"':'')+'>'+content+'</button>';
}
function timelineLabel(id){const e=planEntry(id);return '<span class="timing-link-label">'+(PlanState.cleared(e,Timing)?'Timing removed · ready to save':timelineFixed(id)?(e.lines?.[0]?.action?.type==='months'?'Fixed payment months':'Click months to plan'):'Period / detailed timing · review before changing')+'</span>';}
function clearedTimingEntry(id){return {name:'Timing removed',mode:'period',salary:!!planEntry(id).salary,clearTiming:true,lines:[Timing.blank()],sharedId:null,updateShared:false,linkOnly:false};}
function clearedTimingHTML(costs){return '<div class="plan-selection"><strong>Payment timing will be cleared for '+costs.length+' cost'+(costs.length===1?'':'s')+'</strong><p>'+costs.map(c=>esc(c.name)+' · '+euro(c.amount)).join('<br>')+'</p><p>Ready to save. These costs stay in the budget as Needs timing. Save changes removes their payments from the cashflow. Click months to plan them again, or Undo to restore the previous edit.</p></div>';}
function clearTimelineTiming(ids){const entries={};for(const id of ids)entries[id]=clearedTimingEntry(id);stagePlan(ids,entries,'Payment timing removed in the preview. The costs remain in the budget. Save changes to keep them unplanned; Undo restores the previous edit.',false);}
function timelineStage(ids,change){
 try{
  const entries={};for(const id of ids){if(!timelineFixed(id))throw Error('This selection includes linked or detailed timing. Review a replacement first.');const a=TimelineMonths.action(planEntry(id));change(a,id);entries[id]=a.paymentMonths.length?actionEntry(a,id):clearedTimingEntry(id);}
  stagePlan(ids,entries,'Timeline updated for '+ids.length+' cost'+(ids.length===1?'':'s')+'. Preview only — Save changes writes to Excel. Undo restores the previous timing.',false);
 }catch(e){notice(e.message,true);}
}
function timelineClick(id,month,shift){
 const ids=timelineScope(id),key=[...ids].sort().join('|');
 if(!ids.every(timelineFixed)){openTimelineMenu(id,month);return;}
 const range=shift&&timelineAnchor?.key===key?TimelineMonths.range(timelineAnchor.month,month):[month];
 const hasPayment=ids.some(id=>TimelineMonths.action(planEntry(id)).paymentMonths.some(p=>p.month===month));
 if(hasPayment&&!shift){openTimelineMenu(id,month);return;}
 timelineStage(ids,a=>TimelineMonths.add(a,range));timelineAnchor={key,month};
}
function closeTimelineMenu(){const d=$('timeline-menu');if(d){d.remove();timelineMenuScope=null;}}
function openTimelineMenu(id,month){
 closeTimelineMenu();const ids=timelineScope(id),fixed=ids.every(timelineFixed),costs=ids.map(id=>project.model.costs.find(c=>c.id===id));
 const ready=fixed&&ids.every(id=>TimelineMonths.action(planEntry(id)).paymentMonths.some(p=>p.month===month));
 const shares=ready?ids.map(id=>TimelineMonths.action(planEntry(id)).paymentMonths.find(p=>p.month===month).percent):[];
 const entryKey=JSON.stringify([project.state.config.budget,ids,month,ids.map(planEntry)]);let remembered=null;try{const saved=JSON.parse(sessionStorage.getItem('cashflow-timeline-share'));if(saved?.key===entryKey)remembered=saved.value;}catch(_){}
 const same=shares.length&&shares.every(p=>Number(p)===Number(shares[0]));
 const host=document.createElement('section');host.id='timeline-menu';host.setAttribute('role','dialog');host.setAttribute('aria-label','Timeline payment options');
 host.innerHTML='<div class="timeline-menu-title"><strong>'+formatMonth(month)+' · '+(ids.length===1?esc(costs[0].name):ids.length+' selected costs')+'</strong><button id="timeline-close" aria-label="Close payment options">×</button></div><p>'+ (ids.length===1?'Only this cost changes.':'Applies to all '+ids.length+' selected costs, including any hidden by the filter.')+'</p>'+(ids.length===1?sourceDetailHTML(costs[0]):'')+
 (fixed?'<p>Fixed months · adding months splits equally until you set custom shares. Changing a share redistributes the remainder.</p><div class="actions"><button id="timeline-add">Include this month</button><button id="timeline-remove" '+(!ready?'disabled':'')+'>Remove this payment</button><button id="timeline-equal">Split chosen months equally</button></div>'+(ready?'<div class="actions"><label>'+ 'Percentage for each cost'+'<input id="timeline-share" inputmode="decimal" aria-label="Payment percentage" value="'+(remembered!==null?esc(remembered):same?esc(shares[0]):'')+'" placeholder="'+(same?'':'Mixed shares')+'"></label><span>%</span><button id="timeline-share-apply">Apply share</button></div><p id="timeline-share-result" aria-live="polite"></p><small>Apply share includes this entry in the preview. Closing keeps the entry here for later.</small>':''):
 '<p class="schedule-error">This selection includes a period, salary calculation or installment arrangement. Choosing fixed months replaces that timing for these costs. Review the new amounts before assigning.</p><button id="timeline-replace">Review fixed months instead…</button>')+
 '<p><button id="timeline-clear">Clear all payment timing</button> Keep '+(ids.length===1?'this cost':'these '+ids.length+' costs')+' in the budget, ready to plan later.</p><details><summary>Other timing choices</summary><p>These open a review before replacing the selected costs’ timing.</p><div class="actions">'+actionChoices().filter(a=>a.type!=='months').map(a=>'<button data-timeline-action="'+esc(a.id)+'">'+esc(a.name)+'</button>').join('')+'</div></details><small>Changes remain in the preview until Save changes. Escape closes this menu.</small>';
 document.body.append(host);timelineMenuScope=ids;timelineMenuSelectionKey=[...selected].sort().join('|');timelineMenuPlanKey=JSON.stringify(ids.map(planEntry));
 $('timeline-close').onclick=closeTimelineMenu;
 host.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeTimelineMenu();}};
 const stage=fn=>{timelineStage(ids,fn);closeTimelineMenu();};
 $('timeline-add')?.addEventListener('click',()=>stage(a=>TimelineMonths.add(a,[month])));
 $('timeline-remove')?.addEventListener('click',()=>stage(a=>TimelineMonths.remove(a,month)));
 $('timeline-clear').onclick=()=>{clearTimelineTiming(ids);closeTimelineMenu();};
 $('timeline-equal')?.addEventListener('click',()=>stage(a=>{a.monthEqual=true;a.paymentMonths.forEach(p=>p.percent='1');spreadMonthShares(a.paymentMonths);}));
 const percentage=()=>TimelineMonths.parse($('timeline-share').value,100);
 const preview=()=>{try{const p=percentage();$('timeline-share-result').textContent='Estimated amount: '+costs.map(c=>c.name+': '+euro(Math.round(c.amount*p/100))).join(' · ')+(p!==100?' · '+(100-p).toFixed(2)+'% goes to other chosen months.':'');}catch(e){$('timeline-share-result').textContent=e.message;}};
 $('timeline-share')?.addEventListener('input',()=>{try{sessionStorage.setItem('cashflow-timeline-share',JSON.stringify({key:entryKey,value:$('timeline-share').value}));}catch(_){}preview();});
 if(ready&&(same||remembered!==null))preview();
 $('timeline-share-apply')?.addEventListener('click',()=>{try{const p=percentage();for(const id of ids)TimelineMonths.redistribute(TimelineMonths.action(planEntry(id)),month,p);try{sessionStorage.removeItem('cashflow-timeline-share');}catch(_){}stage(a=>TimelineMonths.redistribute(a,month,p));}catch(e){$('timeline-share-result').textContent=e.message;}});
 $('timeline-replace')?.addEventListener('click',()=>{closeTimelineMenu();openAction({id:crypto.randomUUID(),name:'Fixed payment months',type:'months',monthEqual:true,paymentMonths:[{month,percent:'100'}]},ids,false);});
 host.querySelectorAll('[data-timeline-action]').forEach(b=>b.onclick=()=>{const a=actionChoices().find(a=>a.id===b.dataset.timelineAction);closeTimelineMenu();if(a)openAction(a,ids,false);});
 $('timeline-close').focus({preventScroll:true});
}
function bindTimeline(){
 const host=$('plan-rows');
 host.querySelectorAll('[data-timeline-cost]').forEach(b=>{
  b.onclick=e=>timelineClick(b.dataset.timelineCost,b.dataset.timelineMonth,e.shiftKey);
  b.oncontextmenu=e=>{e.preventDefault();openTimelineMenu(b.dataset.timelineCost,b.dataset.timelineMonth);};
 });
 host.querySelectorAll('[data-timeline-menu]').forEach(b=>b.onclick=()=>{const c=(previewModel||project.model).costs.find(c=>c.id===b.dataset.timelineMenu),m=actionFor(c.id)?.paymentMonths?.[0]?.month||Object.keys(paymentsByMonth(c))[0]||project.state.config.firstMonth.slice(0,7);openTimelineMenu(c.id,m);});
 if(timelineMenuScope&&(timelineMenuSelectionKey!==[...selected].sort().join('|')||timelineMenuPlanKey!==JSON.stringify(timelineMenuScope.map(planEntry))||timelineMenuScope.some(id=>!project.model.costs.some(c=>c.id===id&&!c.removed))))closeTimelineMenu();
}
