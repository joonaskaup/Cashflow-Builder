const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Exercise the actual dialog handlers without opening a user's browser/project.
function setup(){
 class Element{
  constructor(){this.children={};this.listeners={};this.value='';this.checked=false;this.disabled=false;this.open=false;}
  set innerHTML(html){this.html=html;for(const tag of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){const e=new Element();e.value=tag[0].match(/value="([^"]*)"/)?.[1]||'';this.children[tag[1]]=e;}}
  get innerHTML(){return this.html;}
  querySelector(id){if(this.children[id.slice(1)])return this.children[id.slice(1)];for(const child of Object.values(this.children)){const found=child.querySelector(id);if(found)return found;}return null;}
  addEventListener(name,fn){this.listeners[name]=fn;}showModal(){this.open=true;}focus(){}select(){}remove(){this.removed=true;}
  close(){this.open=false;this.listeners.close?.();}click(){return this.onclick?.();}
 }
 const ctx={console,Set,Map,JSON,document:{querySelectorAll:()=>[],createElement:()=>new Element(),body:{append:e=>ctx.dialog=e}},
  project:{state:{revision:1,config:{firstMonth:'2027-08-01'},dates:[]},model:{months:['2027-08','2028-12']}},busy:false,draft:null,draftKey:'',sourceDirty:false,sourceDraft:null,
  paymentDrafts:new Map(),paymentDirty:new Set(),dateDirty:false,dateDraft:[],previewModel:null,previewError:'',previewTicket:0,selectedMonth:'2027-08',
  formatMonth:m=>m==='historical'?m:m.slice(5)+'/'+m.slice(2,4),esc:s=>s,euro:n=>'€'+n/100,monthlyTotal:(m,i)=>m.values?.[i]||0,
  copy:v=>JSON.parse(JSON.stringify(v)),draftEntries:d=>[d],parseWeights:()=>{},render:()=>{},saveDraftStore:()=>{},queuePreview:()=>{ctx.queued=true;},notice:t=>{ctx.message=t;},
 };
 ctx.hasPending=()=>ctx.dateDirty||ctx.paymentDirty.size>0;
 ctx.report={months:['historical','2027-02','2027-03'],firstMonth:'2027-02-01',outsideBefore:20000,outsideAfter:0,confirmOpening:false,opening:0,model:{values:[1,2,3]}};
 ctx.calls=[];ctx.api=async(action,body)=>{ctx.calls.push({action,body});return action==='range-preview'?ctx.report:{state:{revision:2,config:{firstMonth:'2027-02-01'},dates:[]},model:{months:ctx.report.months}};};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../app/helper/display-range.js'),'utf8'),ctx);
 const el=id=>ctx.dialog.querySelector('#'+id);
 return {ctx,el};
}
test('preview retains typed first month; apply saves only range and keeps pending edits',async()=>{
 const {ctx,el}=setup();const pending={name:'Unsaved payment',costs:['one']};ctx.paymentDrafts.set('one',pending);ctx.paymentDirty.add('one');ctx.dateDirty=true;ctx.dateDraft=[{id:'shoot',start:'2027-03-01'}];
 ctx.sourceDirty=true;ctx.sourceDraft={firstMonth:'2027-02-01'};
 ctx.openCashflowRange();assert.equal(el('range-first').value,'02/2027');
 await el('range-preview').click();assert.equal(el('range-first').value,'02/2027');assert.equal(el('range-apply').disabled,false);
 assert.equal(ctx.calls[0].body.arrangements[0],pending);assert.equal(ctx.calls[0].body.dates[0].id,'shoot');
 await el('range-apply').click();
 assert.deepEqual(Object.keys(ctx.calls[1].body).sort(),['confirmOpening','firstMonth','openingAmount']);
 assert.equal(ctx.paymentDrafts.get('one'),pending);assert.equal(ctx.dateDirty,true);assert.equal(ctx.dateDraft[0].start,'2027-03-01');assert.equal(ctx.sourceDirty,false);
 assert.equal(ctx.project.state.config.firstMonth,'2027-02-01');assert.equal(ctx.queued,true);assert.equal(ctx.dialog.removed,true);
});
test('editing month invalidates preview; a failed save retains input and pending work',async()=>{
 const {ctx,el}=setup();ctx.openCashflowRange();el('range-first').value='02/2027';await el('range-preview').click();
 el('range-first').value='03/2027';el('range-first').oninput();assert.equal(el('range-apply').disabled,true);
 await el('range-preview').click();ctx.api=async()=>{throw Error('Save and close Excel');};await el('range-apply').click();
 assert.equal(ctx.project.state.config.firstMonth,'2027-08-01');assert.equal(el('range-first').value,'03/2027');assert.equal(el('range-error').textContent,'Save and close Excel');assert.equal(ctx.dialog.open,true);assert.equal(ctx.busy,false);
});
test('opening balance confirmation required and close changes nothing',async()=>{
 const {ctx,el}=setup();ctx.report.confirmOpening=true;ctx.report.opening=50000;ctx.openCashflowRange();await el('range-preview').click();
 assert.equal(el('range-apply').disabled,true);el('range-opening').checked=true;el('range-opening').onchange();assert.equal(el('range-apply').disabled,false);
 ctx.dialog.close();assert.equal(ctx.project.state.config.firstMonth,'2027-08-01');assert.equal(ctx.calls.length,1);
});
