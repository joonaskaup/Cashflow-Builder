/* Draft operations shared by the direct planner and its regression tests. */
(function(root){
 const clone=v=>JSON.parse(JSON.stringify(v));
 function cleared(entry,Timing){return entry.clearTiming===true&&JSON.stringify(entry.lines)===JSON.stringify([Timing.blank()]);}
 function independent(entry){const e=clone(entry);delete e.parts;delete e.id;delete e.beforeLink;delete e.reuseSourceId;delete e.reuseSourceLabel;e.linkOnly=false;e.sharedId=null;e.updateShared=false;return e;}
 function replace(pending,ids,entries,sharedUsers=()=>[]){
  const wanted=new Set(ids),out=[];
  for(const [key,entry] of pending){
   const pieces=entry.parts?Object.entries(entry.parts).filter(([,e])=>e.touched):[[key,entry]];
   for(const [part,e] of pieces){
    const affected=e.updateShared&&e.sharedId?[...new Set([...part.split('|'),...sharedUsers(e.sharedId)])]:part.split('|');
    if(e.updateShared&&affected.length>1&&affected.some(id=>wanted.has(id)))throw Error('This cost is part of a pending shared-rule change. Revisit that pending edit before assigning it separately.');
    const keep=part.split('|').filter(id=>!wanted.has(id));
    if(keep.length)out.push([keep.sort().join('|'),clone(e)]);
   }
  }
  for(const id of ids)out.push([id,independent(entries[id])]);
  return out;
 }
 function focus(pending,id,sharedUsers=()=>[]){
  const source=pending.flatMap(([key,e])=>e.parts?Object.entries(e.parts).filter(([,v])=>v.touched):[[key,e]]).find(([key,e])=>key.split('|').includes(id));
  if(!source||pending.some(([key,e])=>key===id&&!e.parts))return pending;
  const e=source[1];
  if(e.updateShared&&e.sharedId&&sharedUsers(e.sharedId).length>1)return pending;
  return replace(pending,[id],{[id]:e},sharedUsers);
 }
 function months(dates,model){
  const values=[...model.payments.filter(p=>p.date!=='historical').map(p=>p.date.slice(0,7)),...dates.filter(d=>d.kind==='period'&&d.id!=='hist').flatMap(d=>[d.start,d.end]).filter(Boolean).map(d=>d.slice(0,7))].sort();
  const future=model.months.filter(m=>m!=='historical'),start=values[0]||future[0],end=values.at(-1)||future.at(-1),out=model.months.includes('historical')?['historical']:[];
  let cursor=new Date(start+'-01T00:00:00Z');
  for(let n=0;n<240&&cursor.toISOString().slice(0,7)<=end;n++){out.push(cursor.toISOString().slice(0,7));cursor.setUTCMonth(cursor.getUTCMonth()+1);}
  return out;
 }
 function overlap(start,end,month){
  const a=Date.parse(month+'-01T00:00:00Z'),d=new Date(a),b=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1),s=Math.max(a,Date.parse(start+'T00:00:00Z')),e=Math.min(b,Date.parse(end+'T00:00:00Z')+86400000);
  return e>s?{left:(s-a)/(b-a)*100,width:(e-s)/(b-a)*100}:null;
 }

 function outsidePayments(cost,model){
  const months=new Set(model.months);
  return (cost.payments||[]).filter(p=>p.amount!==0&&!months.has(p.bucket||(p.date==='historical'?'historical':p.date.slice(0,7))));
 }
 function outsideCosts(model){return model.costs.filter(c=>!c.removed&&outsidePayments(c,model).length);}
 function outsideSaveCosts(model,saved,ids,dateDirty=false){
  return outsideCosts(model).filter(c=>ids.has(c.id)||(dateDirty&&JSON.stringify(outsidePayments(c,model))!==JSON.stringify(outsidePayments(saved.costs.find(x=>x.id===c.id)||{},saved))));
 }
 function salaryCandidate(cost){if(typeof cost.groupedSalaryCosts==='boolean')return cost.groupedSalaryCosts;return (cost.components||[]).some(s=>/palkansivukul|lomakorvaus|fringe|social.cost|holiday.pay/i.test(s));}
 function blockers(model,ids,saved,dateDirty=false){
  if(!model)return [];
  return model.costs.filter(c=>!c.removed&&!(c.timingCleared&&!c.rule&&!(c.allocationIssues||[]).length)&&(ids.has(c.id)||(dateDirty&&saved?.costs.some(x=>x.id===c.id&&!x.unallocated&&!x.allocationIssues?.length)))&&(c.unallocated||(c.allocationIssues||[]).length));
 }
 function salaryLine(cost,ref,Timing){
  const l=Timing.blank('balance',ref);
  if(cost.sourceDurationUnit==='days'){l.basis='paid-days';l.paidDaysSource='cost';l.paidDays={};}
  else{
   l.basis='salary-months';
   if(cost.sourceDurationUnit==='months'&&Number(cost.sourceDuration)>0){l.window=cost.sourceSegment==='pre'?'end':'start';Timing.seedBudgetLength(l,[cost],true);}
  }
  return l;
 }
 function salaryShortcut(cost,ref,placement,Timing){
  const l=Timing.blank('balance',ref),n=Number(cost.sourceDuration);
  l.window=placement;
  if(placement==='whole')l.basis=cost.sourceDurationUnit==='days'?'weekday-estimate':'salary-months';
  else if(n>0&&cost.sourceDurationUnit==='months'){l.basis='salary-months';Timing.seedBudgetLength(l,[cost],true);}
  else if(n>0&&cost.sourceDurationUnit==='days'){l.basis='weekday-estimate';l.windowLength=n;l.windowUnit='workdays';l.lengthSource='budget';}
  else{l.windowLength='';l.lengthSource='needed';}
  return l;
 }
 const api={cleared,outsidePayments,outsideCosts,outsideSaveCosts,independent,replace,focus,months,overlap,salaryCandidate,blockers,salaryLine,salaryShortcut};if(typeof module!=='undefined')module.exports=api;else root.PlanState=api;
})(typeof window!=='undefined'?window:globalThis);
