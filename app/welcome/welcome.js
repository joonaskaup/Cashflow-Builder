'use strict';
const $=id=>document.getElementById(id);
let token=location.hash.slice(1);
if(token){sessionStorage.setItem('cashflow-local-token',token);history.replaceState(null,'',location.pathname);}
else token=sessionStorage.getItem('cashflow-local-token')||'';
let upload=null,defaults=null,busy=false;
function notice(text,success=false){$('notice').textContent=text;$('notice').classList.toggle('success',success);}
async function api(path,body){
 const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Cashflow-Token':token},body:body?JSON.stringify(body):undefined});
 const value=await response.json();if(!response.ok)throw Error(value.error||'The local helper could not finish.');return value;
}
async function task(fn){
 if(busy)return;busy=true;document.querySelectorAll('button,input').forEach(x=>x.disabled=true);notice('');
 try{await fn();}catch(e){notice(e.message);}
 finally{busy=false;document.querySelectorAll('button,input').forEach(x=>x.disabled=false);}
}
async function refresh(){
 const data=await api('projects');$('projects').replaceChildren();$('folder').textContent='Stored on this Mac: '+data.folder;
 if(!data.projects.length){$('projects').textContent='No projects yet. Try the fictional example or choose a budget below.';return;}
 for(const p of data.projects){
  const row=document.createElement('div');row.className='project';
  const info=document.createElement('div'),name=document.createElement('strong'),created=document.createElement('span');
  name.textContent=p.name;created.textContent='Created '+new Date(p.created).toLocaleDateString();created.className='muted';info.append(name,created);
  const open=document.createElement('button');open.textContent='Open project';
  open.onclick=()=>task(async()=>{const value=await api('open',{id:p.id});location.href=value.url;});
  row.append(info,open);$('projects').append(row);
 }
}
function field(key,label,value,parent,opts){
 const wrap=document.createElement('label');wrap.textContent=label;
 const input=document.createElement(opts?'select':'input');input.id='map-'+key;
 if(opts)for(const s of opts){const option=document.createElement('option');option.value=option.textContent=s;input.append(option);}
 input.value=value;wrap.append(input);parent.append(wrap);
}
async function stage(body){
 const data=await api('stage',body);upload=data.upload;defaults=data.mapping;
 $('filename').textContent=data.filename;$('name').value=data.demo?'Fictional example':data.filename.replace(/\.[^.]+$/,'');
 $('first').value=data.firstMonth?data.firstMonth.slice(5)+'/'+data.firstMonth.slice(0,4):'';$('mapping').replaceChildren();
 field('sheet','Erittely worksheet',defaults.sheet,$('mapping'),data.sheets);
 field('cash','Cashflow worksheet',data.cashflowSheet,$('mapping'),data.sheets);
 for(const [key,label] of Object.entries({label:'Cost name column',amount:'Detailed amount column',section:'Section code column',description:'Description column',total:'Total column',duration:'Work quantity column',durationUnit:'Work unit column',grandLabel:'Grand-total row label',adminLabel:'Administration row label',reserveLabel:'Contingency row label'}))
  field(key,label,defaults[key],$('mapping'));
 const allowanceHost=$('allowance-choice');allowanceHost.replaceChildren();allowanceHost.hidden=false;
 const info=document.createElement('p');info.textContent=data.allowanceConflicts?.length?'The overhead and contingency labels disagree in '+data.allowanceConflicts.length+' rows. Primary labels are selected below: Finnish Hallintokulut goes to overheads, and Varaus to contingency. The English descriptions stay visible. Each row remains a separate cost.':'Co-production budgets can contain several overhead and contingency rows. Each row remains a separate cost; Finnish or English primary labels determine the categories unless you choose to override them with descriptions.';allowanceHost.append(info);
 for(const row of data.allowanceConflicts||[]){const p=document.createElement('p');p.textContent='Row '+row.row+': '+row.label+' / '+row.description;allowanceHost.append(p);}
 field('allowanceCategorySource','Overhead / contingency categories',defaults.allowanceCategorySource,allowanceHost,['Primary labels','English descriptions when present']);
 $('map-allowanceCategorySource').required=true;
 $('setup').hidden=false;
 notice('Workbook selected. Check the project name and first month, then create the project.',true);
}
$('demo').onclick=()=>task(()=>stage({demo:true}));
$('file').onchange=()=>task(async()=>{
 const file=$('file').files[0];if(!file)return;
 if(file.size>25*1024*1024)throw Error('Choose a workbook smaller than 25 MB.');
 const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(Error('Could not read this file'));r.readAsDataURL(file);});
 await stage({filename:file.name,data:base64});
});
$('setup').onsubmit=event=>{
 event.preventDefault();task(async()=>{
  const mapping={...defaults};for(const key of Object.keys(defaults))if($('map-'+key))mapping[key]=$('map-'+key).value.trim();
  notice('Checking the budget and creating its local working copy…',true);
  const result=await api('create',{upload,name:$('name').value,firstMonth:$('first').value,mapping,cashflowSheet:$('map-cash').value});
  $('setup').hidden=true;upload=null;await refresh();
  notice(`Created ${result.name}: ${result.costs} costs, ${new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(result.total/100)}. Open the project and set production dates to begin.`,true);
 });
};
$('stop').onclick=()=>{
 if(!confirm('Stop Cashflow Builder? Save pending work in your open project tabs first.'))return;
 task(async()=>{await api('stop',{});document.body.replaceChildren();const p=document.createElement('p');p.style.padding='35px';p.textContent='Cashflow Builder has stopped. You can close this tab. Use the launcher to start again.';document.body.append(p);});
};
refresh().catch(e=>notice(e.message));
