'use strict';
(() => {
 const text = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money = value => new Intl.NumberFormat('en-GB',{style:'currency',currency:'EUR'}).format(value/100);
 const date = value => value ? value.split('-').reverse().join('.') : '—';
 const headers = {'X-Cashflow-Token':window.CASHFLOW_TOKEN};
 async function request(path){const r=await fetch(path,{headers});if(!r.ok){const error=await r.json();throw Error(error.error||'Could not load report');}return r;}
 document.getElementById('agreement-report').addEventListener('click',async()=>{
  const dialog=document.createElement('dialog');dialog.className='agreement-dialog';
  dialog.innerHTML='<div class="agreement-head"><div><h2>Reports</h2><p>Work dates and payments for preparing agreements.</p></div><button data-close>Close</button></div><p role="status">Loading saved plan…</p>';
  document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  try{
   const report=await (await request('/api/agreement-report')).json();if(!dialog.open)return;
   const pending=typeof hasPending==='function'&&hasPending();
   dialog.innerHTML='<div class="agreement-head"><div><h2>Reports</h2><p>'+text(report.project)+' · Saved revision '+text(report.revision)+'</p></div><div class="actions"><button data-download class="primary">Download Excel report</button><button data-close>Close</button></div></div>'+
    '<p class="agreement-notice">'+(pending?'<strong>You have unsaved edits. This report uses the saved plan.</strong> Save your edits and reopen the report to include them.':'This report uses your saved plan.')+'</p>'+
    '<p class="agreement-explainer">'+text(report.note)+'</p>'+
    '<div class="agreement-totals"><strong>'+report.summary.length+' costs</strong><span>Budget '+money(report.total)+'</span><span>Allocated '+money(report.scheduled)+'</span><span>Unallocated '+money(report.unallocated)+'</span></div>'+
    '<div class="agreement-tools"><label>Find a cost <input data-search type="search" placeholder="Role, description or source row"></label><div class="actions" role="group" aria-label="Report tables"><button data-table="summary" aria-pressed="true">Summary</button><button data-table="work" aria-pressed="false">Work periods</button><button data-table="payments" aria-pressed="false">Payments</button></div></div><p data-status role="status"></p><div class="agreement-scroll" data-content></div>';
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   let selected='summary';
   function render(){
    const q=dialog.querySelector('[data-search]').value.trim().toLocaleLowerCase();
    const ids=new Set(report.summary.filter(r=>[r.name,r.rows,r.description,r.budgetDetails].join(' ').toLocaleLowerCase().includes(q)).map(r=>r.id));
    const rows=report[selected].filter(r=>ids.has(r.id));
    let labels,body;
    if(selected==='summary'){
     labels=['Cost / budget','Work dates','Payments','To check'];
     body=rows.map(r=>'<tr><td><strong>'+text(r.name)+'</strong><small>Rows '+text(r.rows)+' · '+money(r.budget)+'</small><p>'+text(r.description)+'</p>'+(r.budgetDetails?'<details><summary>Budget quantities and rates</summary><p class="agreement-inputs">'+text(r.budgetDetails)+'</p></details>':'')+'</td><td>'+text(r.workStatus)+(r.workCount?' · '+r.workCount:'')+'</td><td>'+r.paymentCount+' scheduled payment'+(r.paymentCount===1?'':'s')+'<small>Historical '+money(r.historical)+'</small><small>Allocated '+money(r.scheduled)+'</small></td><td>'+text(r.checks||'—')+(r.unallocated?'<small>Unallocated '+money(r.unallocated)+'</small>':'')+(r.notes?'<details><summary>Assumptions</summary>'+text(r.notes)+'</details>':'')+'</td></tr>').join('');
    }else if(selected==='work'){
     labels=['Cost / role','Work period','Start','End','Quantity','Date basis'];
     body=rows.map(r=>'<tr><td><strong>'+text(r.name)+'</strong><small>Rows '+text(r.rows)+'</small></td><td>'+text(r.part)+'</td><td class="agreement-date">'+date(r.start)+'</td><td class="agreement-date">'+date(r.end)+'</td><td>'+text(r.quantity??'—')+' '+text(r.unit)+'</td><td>'+text(r.precision)+'<small>'+text(r.note)+'</small></td></tr>').join('');
    }else{
     labels=['Cost / role','Payment','When','Amount','Date basis'];
     body=rows.map(r=>'<tr><td><strong>'+text(r.name)+'</strong><small>Rows '+text(r.rows)+'</small></td><td>'+text(r.part)+'<small>Payment row '+r.number+(r.installment!=null?' · Installment '+text(r.installment):'')+'</small></td><td class="agreement-date">'+(r.date?date(r.date):'Historical')+'</td><td class="money">'+money(r.amount)+'</td><td>'+text(r.precision)+(r.outside?'<small>Outside cashflow display — included in report</small>':'')+'</td></tr>').join('');
    }
    dialog.querySelector('[data-content]').innerHTML=rows.length?'<table><thead><tr>'+labels.map(l=>'<th>'+l+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>':'<p>No '+(selected==='work'?'work periods recorded. Payment choices alone do not set work dates.':selected==='payments'?'payments recorded.':'matching costs.')+'</p>';
    dialog.querySelectorAll('[data-table]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.table===selected));
   }
   dialog.querySelector('[data-search]').oninput=render;
   dialog.querySelectorAll('[data-table]').forEach(b=>b.onclick=()=>{selected=b.dataset.table;render();});render();
   dialog.querySelector('[data-download]').onclick=async e=>{
    e.currentTarget.disabled=true;
    try{const r=await request('/api/agreement-report.xlsx?revision='+encodeURIComponent(report.revision));const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Cashflow Builder - Reports.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);dialog.querySelector('[data-status]').textContent='Excel report downloaded: all costs, work periods and payments. The search filter only affects this screen.';}
    catch(err){dialog.querySelector('[data-status]').textContent=err.message;}
    finally{dialog.querySelector('[data-download]').disabled=false;}
   };
  }catch(error){dialog.querySelector('[role=status]').textContent=error.message;}
 });
})();
