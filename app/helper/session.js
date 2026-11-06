'use strict';
document.getElementById('local-month-planner')?.addEventListener('click',()=>document.getElementById('plan-dates').click());
window.renderLocalStart=p=>{
 let note=document.getElementById('local-start-note');
 if(!note){
  note=document.createElement('div');note.id='local-start-note';
  note.style.cssText='padding:12px 25px;background:#e4edf6;border-bottom:1px solid #b8c7d5;line-height:1.5';
  document.querySelector('header').after(note);
 }
 const fresh=p.state.revision===0;
 note.hidden=!fresh;
 if(fresh){
  note.replaceChildren();
  const text=document.createElement('span');
  text.textContent='New project: set production dates, then assign timing to your costs. The first Save writes this plan into the working copy; the Original copy keeps the imported cashflow. ';
  const b=document.createElement('button');b.textContent='Set production dates';b.onclick=()=>document.getElementById('plan-dates').click();
  note.append(text,b);
 }
};
{
 const incoming=location.hash.slice(1);
 if(incoming){sessionStorage.setItem('cashflow-local-token',incoming);history.replaceState(null,'',location.pathname);}
 window.CASHFLOW_TOKEN=sessionStorage.getItem('cashflow-local-token')||'';
 // Project title and return link are authenticated, not embedded in public HTML.
 fetch('/api/state',{headers:{'X-Cashflow-Token':window.CASHFLOW_TOKEN}})
 .then(async r=>{if(!r.ok)throw Error('Open this project using Start Cashflow Builder.');return r.json();})
 .then(p=>{
   const home=document.getElementById('local-home');if(home)home.href=p.localHome;
   document.title=(p.localProject||'Project')+' · Cashflow Builder';
 }).catch(e=>{document.body.textContent=e.message;});
}
