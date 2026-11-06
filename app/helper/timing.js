/* Shared editor decisions. No workbook state is changed by these helpers. */
const Timing = (() => {
 const clone=v=>JSON.parse(JSON.stringify(v));
 const dateLabel=v=>v?v.split('-').reverse().join('/'):'dates needed';
 const periodLabel=d=>d.id==='hist'?'Historical · one total':`${d.name} · ${dateLabel(d.start)}${d.kind==='period'?' – '+dateLabel(d.end):''}`;
 const blank=(kind='balance',ref='')=>({kind,value:kind==='units'?1:0,ref,fixed:'',basis:'calendar-days',months:0,days:0,window:'whole',windowLength:1,windowUnit:'months',payAt:'month-end'});
 function seedDates(line,dates){
  if(line.window!=='dates')return;
  const period=dates.find(d=>d.id===line.ref&&d.kind==='period');
  if(!line.workStart&&period?.start)line.workStart=period.start;
  if(!line.workEnd&&period?.end)line.workEnd=period.end;
 }
 function seedBudgetLength(line,costs,force=false){
  if(!['start','end','after'].includes(line.window))return;
  if(line.lengthSource==='custom'&&!force)return;
  if(line.basis==='weekday-estimate'&&costs.length===1&&costs[0].sourceDurationUnit==='days'&&Number(costs[0].sourceDuration)>0){line.windowLength=Number(costs[0].sourceDuration);line.windowUnit='workdays';line.lengthSource='budget';return;}
  const valid=costs.length&&costs.every(c=>c.sourceDurationUnit==='months'&&Number(c.sourceDuration)>0);
  const values=new Set(costs.map(c=>Number(c.sourceDuration)));
  if(valid&&values.size===1){line.windowLength=Number(costs[0].sourceDuration);line.windowUnit='months';line.lengthSource='budget';}
  else{line.windowLength='';line.windowUnit='months';line.lengthSource='needed';}
  delete line.estimateNote;delete line.estimateConfirmed;
 }
 function lengthNote(line){
  if(line.basis==='weekday-estimate')return 'Estimate: Monday–Friday workdays; weekends skipped, public holidays not excluded. Adjust dates or use actual paid days if needed.';
  const n=Number(line.windowLength),prefix=line.lengthSource==='budget'?'From budget. ':line.lengthSource==='custom'?'Your duration override. ':'';
  if(line.lengthSource==='needed')return 'Enter a work length. Budget paid days are not consecutive calendar days; costs with different lengths need separate durations.';
  if(line.windowUnit==='months'&&n>0&&!Number.isInteger(n))return prefix+`${n} months = ${Math.floor(n)} whole calendar month(s) + ${Math.round((n-Math.floor(n))*30+1e-9)} days. Fractional months use 30 days, rounded to the nearest day.`;
  return prefix;
 }
 function balancedShares(value){
  const total=Number(String(value??'').replace(',','.'));if(!Number.isFinite(total)||total<=0||total>120)return null;
  const whole=Math.floor(total),fraction=Number((total-whole).toPrecision(12));
  return fraction?[fraction/2,...Array(whole).fill(1),fraction/2]:Array(whole).fill(1);
 }
 function spreadLine(cost,balanced=false){
  const line=blank('balance','pre');line.basis=balanced?'balanced-months':'equal-month';
  if(balanced)line.balancedMonths=cost.sourceDurationUnit==='months'?cost.sourceDuration:'';
  else line.endRef='post';
  return line;
 }
 function workSpan(line,dates){
  if(line.ref==='hist'||['day-split','prep-shoot','timing-action'].includes(line.basis))return null;
  let ref=dates.find(d=>d.id===line.ref);
  if(line.endRef){const end=dates.find(d=>d.id===line.endRef);if(!end?.end)return null;ref=ref?{...ref,end:end.end}:ref;}
  if(line.basis==='balanced-months'){const shares=balancedShares(line.balancedMonths);if(!shares||!ref?.start)return null;const start=new Date(ref.start.slice(0,7)+'-01T00:00:00Z');if(!Number.isFinite(start.getTime()))return null;return {start:start.toISOString().slice(0,10),end:new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+shares.length,0)).toISOString().slice(0,10)};}
  if(line.window!=='dates'&&(!ref?.start||!ref?.end))return null;
  const day=(d,n)=>new Date(d.getTime()+n*86400000),iso=d=>d.toISOString().slice(0,10);
  const shift=(d,n)=>{const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n+1,0));return new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),Math.min(d.getUTCDate(),end.getUTCDate())));};
  let a=new Date((ref?.start||'')+'T00:00:00Z'),b=new Date((ref?.end||'')+'T00:00:00Z');
  const n=Number(line.windowLength),whole=Math.floor(n),extra=Math.round((n-whole)*30+1e-9);
  const move=(anchor,sign)=>line.windowUnit==='days'?day(anchor,sign*n):day(shift(anchor,sign*whole),sign*extra);
  if(line.window==='dates'){a=new Date(line.workStart+'T00:00:00Z');b=new Date(line.workEnd+'T00:00:00Z');}
  else if(['start','end','after'].includes(line.window)){
   if(!Number.isFinite(n)||n<=0||n>1200||line.windowUnit==='days'&&!Number.isInteger(n)||line.windowUnit==='months'&&whole===0&&extra===0)return null;
   if(line.windowUnit==='workdays'){
    const sign=line.window==='end'?-1:1;let cursor=line.window==='end'?b:line.window==='after'?day(b,1):a,remaining=n,used=[];
    while(remaining>0){if(cursor.getUTCDay()!==0&&cursor.getUTCDay()!==6){used.push(cursor);remaining-=Math.min(remaining,1);}cursor=day(cursor,sign);}
    a=new Date(Math.min(...used));b=new Date(Math.max(...used));
   }
   else if(line.window==='start')b=day(move(a,1),-1);
   else if(line.window==='end')a=move(day(b,1),-1);
   else{a=day(b,1);b=day(move(a,1),-1);}
  }
  if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<a)return null;
  return {start:iso(a),end:iso(b)};
 }
 function proposal(cost,dates){
  const line=blank(),segment=cost.sourceSegment,n=Number(cost.sourceDuration);
  line.ref=segment==='wrap'?(dates.find(d=>d.kind==='period'&&d.id==='wrap')?.id||'shoot'):(['pre','shoot','post'].includes(segment)?segment:'');
  const separateWrap=line.ref==='wrap';
  if(n>0&&segment!=='shoot'&&cost.sourceDurationUnit==='months'){
   line.window=segment==='wrap'&&!separateWrap?'after':'start';
   seedBudgetLength(line,[cost]);
  }
  if(n>0&&segment==='wrap'&&cost.sourceDurationUnit==='days'){
   line.window=separateWrap?'start':'after';line.windowLength=n;line.windowUnit='days';
   line.estimateNote=`${n} budget days proposed as consecutive calendar days ${separateWrap?'during wrap':'after shooting'}. Confirm or enter actual dates.`;line.estimateConfirmed=false;
  }
  return {name:'',mode:'period',lines:[line],sharedId:null,updateShared:false};
 }
 function paymentChoice(line){
  if(Number(line.days||0))return'custom';
  const n=Number(line.months||0);
  if((line.payAt||'month-end')==='work-end')return n===0?'work-end':'custom';
  return n===0?'monthly':n===1?'next-month':'custom';
 }
 function setPayment(line,value){
  if(value==='custom')return;
  delete line.customPayment;
  line.payAt=value==='work-end'?'work-end':'month-end';line.months=value==='next-month'?1:0;line.days=0;
 }
 function usePeriodDefault(entry){
  // Keep the displayed dates and shares, including when detaching a shared rule.
  const lines=clone(entry.lines);unlink(entry);entry.lines=lines;
  for(const line of entry.lines){line.basis='calendar-days';setPayment(line,'monthly');}
  entry.sharedId=null;entry.updateShared=false;entry.linkOnly=false;entry.autoName=true;
  delete entry.customPayment;delete entry.customPaymentLines;
 }
 function delayLabel(line){
  const months=Number(line.months||0),days=Number(line.days||0);
  return months||days?`Payment shift: ${months} month${Math.abs(months)===1?'':'s'}, ${days} day${Math.abs(days)===1?'':'s'}.`:'Paid during the work period.';
 }
 function name(entry,dates){
  if(entry.mode==='installments')return'Contractual installments';
  if(entry.mode==='segments')return'Multiple work periods';
  const ln=entry.lines[0],d=dates.find(d=>d.id===ln?.ref);
  if(!ln)return'Payment timing';
  if(ln.basis==='prep-shoot')return 'Preparation + shooting · no wrap';
  if(ln.basis==='timing-action')return ln.action?.name||'Timing action';
  if(ln.basis==='day-split')return 'Split paid days — preparation '+(ln.remainder==='shooting'?(ln.prepDays??'?'):'remainder')+', shooting '+(ln.remainder==='shooting'?'remainder':ln.shootingLinked!==false?'from timetable':ln.shootingDays)+', wrap '+(ln.wrapDays===''?'?':ln.wrapDays??'?');
  if(ln.ref==='hist')return'Historical — one total';
  if(ln.basis==='balanced-months')return (d?.name||'Choose start period')+' — '+ln.balancedMonths+' months, balanced first and last payments';
  if(ln.endRef)return (d?.name||'Choose start period')+' → '+(dates.find(x=>x.id===ln.endRef)?.name||'Choose end period')+' — equal payments each month';
  if(entry.mode==='one')return(d?.name||dateLabel(ln.fixed))+' — one payment';
  const window={whole:'',start:` — first ${ln.windowLength} ${ln.windowUnit}`,end:` — last ${ln.windowLength} ${ln.windowUnit}`,after:` — ${ln.windowLength} ${ln.windowUnit} after end`,dates:` — ${dateLabel(ln.workStart)} to ${dateLabel(ln.workEnd)}`}[ln.window||'whole'];
  const paid={monthly:'paid monthly at month end','next-month':'paid monthly, following month','work-end':'paid at work end',custom:'custom payment timing'}[paymentChoice(ln)];
  const basis={'salary-months':'monthly salary shares','weekday-estimate':'Mon–Fri estimate','calendar-days':'calendar-day estimate','paid-days':'paid workdays','equal-month':'equal monthly amounts'}[ln.basis]||ln.basis;
  return (d?.name||'Choose work period')+(window||'')+' — '+paid+' · '+basis;
 }
 function reuse(rule,dates){
  const entry=clone(rule);entry.mode=entry.mode||(entry.lines.some(l=>l.kind==='units')?'segments':entry.lines.length>1?'installments':dates.find(d=>d.id===entry.lines[0]?.ref)?.kind==='period'?'period':'one');
  entry.sharedId=null;entry.updateShared=false;entry.linkOnly=false;entry.reuseSourceId=rule.id;entry.autoName=true;
  delete entry.id;delete entry.variants;return entry;
 }
 function unlink(entry){
  if(!entry.linkOnly)return;
  if(entry.reuseCopy)Object.assign(entry,clone(entry.reuseCopy));
  entry.linkOnly=false;entry.sharedId=null;entry.updateShared=false;
 }
 function setLinked(entry,rule,linked,dates){
  if(linked){
   if(!entry.linkOnly)entry.reuseCopy={lines:clone(entry.lines),mode:entry.mode,name:entry.name,autoName:entry.autoName};
   const original=reuse(rule,dates);entry.lines=original.lines;entry.mode=original.mode;entry.name=rule.name;entry.autoName=false;
  }else unlink(entry);
  entry.linkOnly=linked;entry.sharedId=linked?rule.id:null;entry.updateShared=false;entry.touched=true;
 }
 return {clone,dateLabel,periodLabel,blank,seedDates,proposal,paymentChoice,setPayment,name,reuse,unlink,setLinked,usePeriodDefault,delayLabel,seedBudgetLength,lengthNote,workSpan,balancedShares,spreadLine};
})();
if(typeof module!=='undefined')module.exports=Timing;
