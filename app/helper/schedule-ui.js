/* Month-first editing sits on the existing shared date draft and Save action. */
let schedulePasteText='',schedulePastePreview=null,schedulePasteBase='';
function scheduleColor(d){return ({pre:'#e4edf7',shoot:'#e7f0e3',post:'#f5e9d8',hist:'#f0f0f0'})[d.id]||'#eef0f3';}
function redrawDatesWithFocus(){
 requestAnimationFrame(()=>{
  const active=document.activeElement,label=active?.getAttribute('aria-label'),start=active?.selectionStart,end=active?.selectionEnd;
  drawDates();
  if(label){const next=[...$('date-rows').querySelectorAll('[aria-label]')].find(x=>x.getAttribute('aria-label')===label);if(next){next.focus({preventScroll:true});if(start!==null&&start!==undefined&&next.setSelectionRange)try{next.setSelectionRange(start,end);}catch(_){}}}
 });
}
function scheduleSpan(d){
 if(d.id==='hist')return 'One historical total';
 if(!d.start)return 'Choose a month to begin';
 if(d.precision==='month')return d.kind==='milestone'?
  'Month estimate · payment on '+Schedule.display(d.start,'day')+' (month end).':
  'Whole months · '+Schedule.display(d.start,'day')+' to '+Schedule.display(d.end,'day')+'.';
 return 'Exact dates · '+Schedule.display(d.start,'day')+(d.kind==='period'?' to '+Schedule.display(d.end,'day'):'')+'.';
}
function drawScheduleTimeline(){
 if(window.drawInstallmentTimeline)return drawInstallmentTimeline();
 const host=$('schedule-timeline');if(!host)return;
 const valid=dateDraft.filter(d=>d.id!=='hist'&&/^\d{4}-\d{2}-\d{2}$/.test(d.start)&&(!d.end||d.end>=d.start));
 if(!valid.length){host.innerHTML='<p class="muted">Your periods and milestones will appear here as you add months.</p>';return;}
 const first=valid.map(d=>d.start.slice(0,7)).sort()[0],last=valid.map(d=>(d.end||d.start).slice(0,7)).sort().at(-1);
 const months=[];let cursor=new Date(first+'-01T00:00:00Z');
 for(let i=0;i<60&&cursor.toISOString().slice(0,7)<=last;i++){months.push(cursor.toISOString().slice(0,7));cursor.setUTCMonth(cursor.getUTCMonth()+1);}
 host.innerHTML='<div class="schedule-chart"><table><caption>Production timetable · '+(dateDirty?'includes unsaved edits':'saved dates')+'</caption><thead><tr><th>Period / milestone</th>'+months.map(m=>'<th>'+formatMonth(m)+'</th>').join('')+'</tr></thead><tbody>'+valid.map(d=>'<tr><th>'+esc(d.name)+'</th>'+months.map(m=>{
  const active=m>=d.start.slice(0,7)&&m<=(d.end||d.start).slice(0,7);
  return '<td'+(active?' style="background:'+scheduleColor(d)+'"':'')+' aria-label="'+esc(d.name+' '+formatMonth(m)+(active?' planned':''))+'">'+(active?(d.kind==='milestone'?'◆':'━'):'')+'</td>';
 }).join('')+'</tr>').join('')+'</tbody></table></div><small>Bars show planned months; diamonds are milestones. '+(months.at(-1)<last?'Showing the first 60 months. ':'')+'Amounts still use each cost’s chosen allocation method.</small>';
}
function setupSchedulePaste(){
 if($('schedule-paste'))return;
 const box=document.createElement('details');box.className='schedule-paste';box.id='schedule-paste';
 box.innerHTML='<summary>Paste a timetable</summary><p>One line per period or milestone. Use semicolons, or paste columns from Excel.</p><pre>Preparation; 02/2027; 05/2027\nShooting; 06/2027; 06/2027\nPicture lock; 09/2027;\nSound delivery; milestone; 15/11/2027;\nHistorical; 03/23; 02/25</pre><p class="muted">Format: Name; Start; End. An empty End creates a new milestone. You can also use Name; period/milestone; Start; End. Months: 02/2027, 02/27 or 2027-02. Exact dates: 15/02/2027 or 2027-02-15.</p><textarea id="schedule-paste-text" aria-label="Paste timetable" rows="6" placeholder="Preparation; 02/2027; 05/2027"></textarea><div class="actions"><button id="schedule-paste-review">Review pasted list</button></div><div id="schedule-paste-result" aria-live="polite"></div>';
 $('date-impact').before(box);
 $('schedule-paste-text').value=schedulePasteText;
 $('schedule-paste-text').oninput=e=>{schedulePasteText=e.target.value;schedulePastePreview=null;$('schedule-paste-result').textContent='List edited. Review it again before applying.';try{sessionStorage.setItem('cashflow-schedule-paste',schedulePasteText);}catch(_){}};
 $('schedule-paste-review').onclick=()=>{
  schedulePastePreview=Schedule.paste(schedulePasteText,dateDraft);
  schedulePasteBase=JSON.stringify(dateDraft);
  const errors=schedulePastePreview.errors;
  $('schedule-paste-result').innerHTML=(errors.length?'<div class="schedule-error">'+errors.map(e=>'<p>Line '+e.line+': '+esc(e.message)+'</p>').join('')+'</div>':'')+
   '<p>Matching names update the same entry and its linked costs. Unlisted dates, paid-day counts and payment choices stay as they are. Nothing is saved yet.</p>'+
   '<table><thead><tr><th>Change</th><th>Name</th><th>Before</th><th>Proposed dates</th><th>Linked costs</th></tr></thead><tbody>'+schedulePastePreview.rows.map(r=>'<tr><td>'+r.action+'</td><td>'+esc(r.proposed.name)+'</td><td>'+esc(r.old?(r.old.id==='hist'?r.old.label||'Historical':Schedule.display(r.old.start,'day')+' '+Schedule.display(r.old.end,'day')):'New entry')+'</td><td>'+esc(r.proposed.id==='hist'?r.proposed.label||'Historical':scheduleSpan(r.proposed))+'</td><td>'+(r.old?dateUsage(r.old.id).count:0)+'</td></tr>').join('')+'</tbody></table><button id="schedule-paste-apply" class="primary" '+(errors.length?'disabled':'')+'>Apply '+schedulePastePreview.rows.length+' entries to draft</button>';
  $('schedule-paste-apply').onclick=()=>{
   try{if(schedulePasteBase!==JSON.stringify(dateDraft))throw Error('The timetable changed. Review the pasted list again before applying.');dateDraft=Schedule.merge(dateDraft,schedulePastePreview);markDateDirty();drawDates();$('schedule-paste-result').textContent='Applied to the unsaved timetable. Review the monthly impact below, then Save changes.';schedulePastePreview=null;}
   catch(e){$('schedule-paste-result').textContent=e.message;}
  };
 };
}
function drawDates(){
 setupSchedulePaste();
 if(window.setupInstallments)setupInstallments();
 $('date-rows').innerHTML=dateDraft.map((d,i)=>{
  if(d.installmentGroup)return '';
  const usage=dateUsage(d.id),mode=Schedule.mode(d);
  if(d.id==='hist')return '<article class="schedule-card historical" style="--phase:#f0f0f0"><div class="schedule-card-head"><strong>Historical · one total</strong><span>'+usage.count+' costs · '+euro(usage.amount)+'</span></div><p>Costs already paid before the forecast. They stay together in one cashflow column; they are not spread over these months.</p><label>Column label (optional)<input data-date="'+i+'" data-key="label" aria-label="Historical column label" placeholder="03/23-02/25" value="'+esc(d.label||'')+'"></label><small>Enter <strong>MM/YY-MM/YY</strong>, e.g. <strong>03/23-02/25</strong> means March 2023 through February 2025. Leave blank to display “Historical”. This label does not automatically select costs; assign them the Historical timing action. No individual dates are needed.</small></article>';
  let html='<article class="schedule-card" style="--phase:'+scheduleColor(d)+'"><div class="schedule-card-head"><label>Name<input data-date="'+i+'" data-key="name" aria-label="Date name '+(i+1)+'" value="'+esc(d.name)+'"></label><label>Type<select data-date="'+i+'" data-key="kind" aria-label="Date type '+(i+1)+'">'+option('period','Period',d.kind)+option('milestone','Milestone',d.kind)+'</select></label><span>'+usage.count+' costs · '+euro(usage.amount)+'</span><button data-remove-date="'+i+'" aria-label="Remove '+esc(d.name)+'">Remove</button></div>';
  html+='<div class="schedule-date-fields"><label>'+(d.kind==='milestone'?'Payment month / date':'Start month / date')+'<input data-schedule-date="'+i+'" data-edge="start" aria-label="'+esc(d.name)+' start or payment date" placeholder="'+(mode==='month'?'02/2027':'15/02/2027')+'" value="'+esc(d.inputStart??Schedule.display(d.start,mode))+'"></label>';
  if(d.kind==='period')html+='<label>End month / date<input data-schedule-date="'+i+'" data-edge="end" aria-label="'+esc(d.name)+' period end" placeholder="'+(mode==='month'?'05/2027':'31/05/2027')+'" value="'+esc(d.inputEnd??Schedule.display(d.end,mode))+'"></label>';
  html+='<div class="schedule-precision"><strong>'+(mode==='month'?'Month planning':'Exact dates')+'</strong><button data-precision="'+i+'" data-mode="'+(mode==='month'?'day':'month')+'">'+(mode==='month'?'Use exact dates':'Use whole months')+'</button></div></div>';
  html+='<p class="schedule-assumption">'+esc(scheduleSpan(d))+' '+(mode==='month'?'You can enter an exact date in either field.':'Whole months expands the selected range to month boundaries.')+'</p>';
  if(d.inputError)html+='<p class="schedule-error">'+esc(d.inputError)+'</p>';
  if(d.kind==='period'){
   const months=periodMonths(d),filled=Object.keys(d.weights||{}).length;
   html+='<details class="schedule-paid"><summary>Paid workdays (optional)'+(d.id==='shoot'&&d.paidDaysTotal!==undefined&&d.paidDaysTotal!==''?' · '+esc(d.paidDaysTotal)+' shooting days':'')+'</summary>';
   if(d.id==='shoot')html+='<label>Paid shooting days<input type="number" min="0" max="1200" step="any" data-date="'+i+'" data-key="paidDaysTotal" aria-label="Production shooting days" value="'+esc(d.paidDaysTotal??'')+'" placeholder="e.g. 24"></label><small>Used by linked Split days costs. Calendar months do not imply paid-day counts.</small>';
   html+='<div class="schedule-weights">'+months.map(m=>'<label>'+formatMonth(m)+'<input type="number" min="0" step="any" data-weight-date="'+i+'" data-weight-month="'+m+'" aria-label="'+esc(d.name)+' paid days '+formatMonth(m)+'" value="'+esc(d.weights?.[m]??'')+'" placeholder="0"></label>').join('')+'</div><small>Enter actual paid days per month when known. Unlisted months have zero paid days.</small></details>';
  }
  return html+'</article>';
 }).join('');
 $('date-rows').querySelectorAll('[data-date]').forEach(input=>input.addEventListener(input.dataset.key==='kind'?'change':'input',()=>{
  const d=dateDraft[+input.dataset.date],key=input.dataset.key;d[key]=input.value;
  if(key==='kind'){
   if(d.precision==='month'&&d.start)d.start=Schedule.parse(d.start.slice(0,7),'start',d.kind).date;
   if(d.kind==='milestone')d.end='';delete d.inputError;delete d.inputStart;delete d.inputEnd;
  }
  markDateDirty();if(key==='kind')drawDates();else drawScheduleTimeline();
 }));
 $('date-rows').querySelectorAll('[data-schedule-date]').forEach(input=>{
 const updateInput=()=>{
  const d=dateDraft[+input.dataset.scheduleDate],key=input.dataset.edge;
  d.precision=Schedule.mode(d);
  const raw=input.value.trim();d[key==='start'?'inputStart':'inputEnd']=raw;
  try{
   if(raw){const parsed=Schedule.parse(raw,key,d.kind);d[key]=parsed.date;
    if(parsed.precision==='day')d.precision='day';else if(Schedule.mode(d)==='month')d.precision='month';
   }else d[key]='';
   // Validate both visible inputs; one corrected field must not clear another error.
   for(const edge of ['start','end']){
    const pending=d[edge==='start'?'inputStart':'inputEnd'];if(pending)Schedule.parse(pending,edge,d.kind);
   }
   delete d.inputError;delete d.inputStart;delete d.inputEnd;
  }catch(e){d.inputError=e.message;}
  markDateDirty();drawScheduleTimeline();
 };
 input.addEventListener('input',updateInput);
 input.addEventListener('change',()=>{updateInput();redrawDatesWithFocus();});
 });
 $('date-rows').querySelectorAll('[data-precision]').forEach(b=>b.onclick=()=>{
  const d=dateDraft[+b.dataset.precision];d.precision=b.dataset.mode;
  if(d.precision==='month')for(const key of ['start','end'])if(d[key])d[key]=Schedule.parse(d[key].slice(0,7),key,d.kind).date;
  delete d.inputError;delete d.inputStart;delete d.inputEnd;markDateDirty();drawDates();
 });
 $('date-rows').querySelectorAll('[data-weight-date]').forEach(input=>input.addEventListener('input',()=>{
  const d=dateDraft[+input.dataset.weightDate],m=input.dataset.weightMonth;d.weights??={};
  if(input.value==='')delete d.weights[m];else d.weights[m]=Number(input.value);markDateDirty();
 }));
 $('date-rows').querySelectorAll('[data-remove-date]').forEach(b=>b.onclick=()=>{
  const i=+b.dataset.removeDate,d=dateDraft[i],usage=dateUsage(d.id);
  if(usage.count){notice('This period is used by '+usage.count+' costs. Reassign those costs before removing it.',true);return;}
  dateDraft.splice(i,1);markDateDirty();drawDates();
 });
 drawScheduleTimeline();
}
try{schedulePasteText=sessionStorage.getItem('cashflow-schedule-paste')||'';}catch(_){}
