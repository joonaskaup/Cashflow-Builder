(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Schedule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const pad=n=>String(n).padStart(2,'0');
 const norm=s=>String(s||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
 const types={period:'period',jakso:'period',milestone:'milestone',merkkipaalu:'milestone',historical:'historical',historia:'historical'};
 function last(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
 function parse(value,edge='start',kind='period'){
  const s=String(value||'').trim();let y,m,d,match,precision;
  if((match=/^(\d{4})-(\d{2})$/.exec(s))){y=+match[1];m=+match[2];precision='month';}
  else if((match=/^(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))){m=+match[1];y=+match[2]+(match[2].length===2?2000:0);precision='month';}
  else if((match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s))){y=+match[1];m=+match[2];d=+match[3];precision='day';}
  else if((match=/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))){d=+match[1];m=+match[2];y=+match[3];precision='day';}
  else throw Error('Use a month such as 02/2027, or an exact date such as 15/02/2027.');
  if(y<1900||y>2199||m<1||m>12)throw Error('Enter a valid month and year (1900–2199).');
  if(precision==='month')d=edge==='end'||kind==='milestone'?last(y,m):1;
  if(d<1||d>last(y,m))throw Error('That day does not exist in this month.');
  return {date:`${y}-${pad(m)}-${pad(d)}`,precision};
 }
 function display(value,precision){
  if(!value)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const [y,m,d]=value.split('-');return precision==='month'?`${m}/${y}`:`${d}/${m}/${y}`;
 }
 function mode(d){return d.precision||(d.start||d.end?'day':'month');}
 function validate(dates){
  const names=new Set();
  for(const d of dates){
   if(d.inputError)throw Error(d.name+': '+d.inputError);
   const n=norm(d.name);if(!n||names.has(n))throw Error('Give each period or milestone a distinct name.');names.add(n);
   if(d.id==='hist'){
    if(d.label){const m=/^(\d{2})\/(\d{2})[-–](\d{2})\/(\d{2})$/.exec(d.label);if(!m)throw Error('Historical: use MM/YY-MM/YY, for example 03/23-02/25, or leave it blank.');
     const a=parse(m[1]+'/'+m[2]),b=parse(m[3]+'/'+m[4]);if(b.date<a.date)throw Error('Historical ends before it starts.');}
    continue;
   }
   for(const key of ['start','end'])if(d[key]){const p=parse(d[key]);if(p.date!==d[key])throw Error(d.name+': invalid date.');}
   if(d.kind==='period'&&d.start&&d.end&&d.end<d.start)throw Error(d.name+': end precedes start.');
  }
 }
 function paste(text,existing,makeId=()=>crypto.randomUUID()){
  const result=[],errors=[],seen=new Set();
  const rows=String(text).split(/\r?\n/);
  rows.forEach((row,index)=>{
   if(!row.trim())return;
   try{
    let cells=row.split(row.includes('\t')?'\t':';').map(x=>x.trim());
    if(index===0&&['name','nimi'].includes(norm(cells[0]))&&cells.some(x=>/^(start|start date|alku)$/i.test(x)))return;
    if(cells.length<2||cells.length>4)throw Error('Use Name; Start; End, or Name; Type; Start; End.');
    let name,kind,a,b;
    if(cells.length===4){if(types[norm(cells[0])]&&!types[norm(cells[1])]){[kind,name,a,b]=cells;kind=types[norm(kind)];}else{[name,kind,a,b]=cells;kind=types[norm(kind)];}if(!kind)throw Error('Type must be period or milestone.');}
    else [name,a,b='']=cells;
    if(!name)throw Error('Enter a name.');const key=norm(name);
    if(seen.has(key))throw Error('This name appears more than once in the pasted list.');seen.add(key);
    const historical=key==='historical'||key==='historia'||kind==='historical';
    const matches=existing.filter(d=>historical?d.id==='hist':norm(d.name)===key);
    if(matches.length>1)throw Error('More than one existing entry has this name; rename it first.');
    const old=matches[0];let proposed;
    if(historical){
     if(!b&&/[-–]/.test(a)&&!/^\d{4}-\d{2}/.test(a)){const parts=a.split(/[-–]/);if(parts.length===2)[a,b]=parts;}
     let label='';if(a||b){if(!a||!b)throw Error('Historical needs both months, or both blank.');const first=parse(a),end=parse(b,'end');if(end.date<first.date)throw Error('Historical ends before it starts.');label=display(first.date,'month').replace(/\/(\d{2})(\d{2})$/,'/$2')+'-'+display(end.date,'month').replace(/\/(\d{2})(\d{2})$/,'/$2');}
     proposed={...(old||{id:'hist',name:'Historical',kind:'period',start:'',end:'',weights:{}}),label};
    }else{
     kind=kind||old?.kind||(b?'period':'milestone');
     if(!a)throw Error('Enter a start month or date.');
     if(kind==='period'&&!b)throw Error('A period needs an end month or date.');
     if(kind==='milestone'&&b)throw Error('A milestone has one date; leave End blank.');
     const start=parse(a,'start',kind),end=b?parse(b,'end',kind):null;
     if(end&&end.date<start.date)throw Error('End precedes start.');
     proposed={...(old||{id:makeId(),weights:{}}),name,kind,start:start.date,end:end?.date||'',precision:start.precision==='month'&&(!end||end.precision==='month')?'month':'day'};
    }
    delete proposed.inputError;delete proposed.inputStart;delete proposed.inputEnd;
    result.push({line:index+1,old:old||null,proposed,action:old?'Update':'Add'});
   }catch(e){errors.push({line:index+1,message:e.message});}
  });
  if(!result.length&&!errors.length)errors.push({line:0,message:'Paste at least one period or milestone.'});
  return {rows:result,errors};
 }
 function merge(existing,preview){
  if(preview.errors.length)throw Error('Correct the marked lines before applying.');
  const out=JSON.parse(JSON.stringify(existing));
  for(const r of preview.rows){const i=out.findIndex(d=>d.id===r.proposed.id);if(i<0)out.push(r.proposed);else out[i]=r.proposed;}
  validate(out);return out;
 }
 return {parse,display,mode,validate,paste,merge,last};
});
