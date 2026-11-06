const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../app/helper/schedule.js');
test('month and exact formats, inclusive boundaries and leap year',()=>{
 for(const v of ['02/2028','02/28','2028-02'])assert.deepEqual(S.parse(v,'end'),{date:'2028-02-29',precision:'month'});
 assert.equal(S.parse('02/2027').date,'2027-02-01');
 assert.equal(S.parse('02/2027','start','milestone').date,'2027-02-28');
 for(const v of ['15/02/2027','15.02.2027','2027-02-15'])assert.equal(S.parse(v).date,'2027-02-15');
 for(const v of ['13/2027','29/02/2027','31/04/2027','02/00/2027','abc'])assert.throws(()=>S.parse(v));
});
const old=[{id:'pre',name:'Preparation',kind:'period',start:'2027-02-10',end:'2027-05-20',weights:{'2027-02':12},paidDaysTotal:16},
 {id:'shoot',name:'Shooting',kind:'period',start:'2027-06-01',end:'2027-06-29',weights:{'2027-06':16},paidDaysTotal:16},
 {id:'hist',name:'Historical',kind:'period',label:''}];
test('paste preview preserves identity, amounts-independent metadata and unlisted dates',()=>{
 const snapshot=JSON.stringify(old);
 const preview=S.paste('Preparation;02/2027;05/2027\nPicture lock;09/2027;\nSound delivery;milestone;15/11/2027;\nHistorical;03/23;02/25',old,()=> 'new-'+Math.random());
 assert.deepEqual(preview.errors,[]);assert.equal(JSON.stringify(old),snapshot);
 const merged=S.merge(old,preview);assert.equal(merged[0].id,'pre');assert.deepEqual(merged[0].weights,old[0].weights);
 assert.equal(merged[0].start,'2027-02-01');assert.equal(merged[0].end,'2027-05-31');assert.equal(merged[0].precision,'month');
 assert.deepEqual(merged[1],old[1]);assert.equal(merged[2].label,'03/23-02/25');
 assert.equal(merged.find(x=>x.name==='Picture lock').start,'2027-09-30');
 assert.equal(merged.find(x=>x.name==='Sound delivery').start,'2027-11-15');
});
test('tab-separated list, header, explicit types and historical range',()=>{
 const result=S.paste('Name\tType\tStart\tEnd\nPrep\tperiod\t02/2027\t05/2027\nmilestone\tDelivery\t12/2027\t\nHistorical\t03/23–02/25\t',[],()=> 'new');
 assert.deepEqual(result.errors,[]);assert.equal(result.rows[1].proposed.start,'2027-12-31');assert.equal(result.rows[2].proposed.label,'03/23-02/25');
});
test('invalid and ambiguous rows block all application',()=>{
 for(const text of ['Preparation;02/2027;','Prep;06/2027;05/2027','X;13/2027;','X;02/2027;\nX;03/2027;','X;milestone;02/2027;03/2027','Historical;02/25;03/23']){
  const p=S.paste(text,old);assert.ok(p.errors.length,text);assert.throws(()=>S.merge(old,p));
 }
 assert.ok(S.paste('Preparation;02/2027;05/2027',[old[0],old[0]]).errors.length);
});
test('old precise dates stay exact, new blank entries start in months',()=>{
 assert.equal(S.mode(old[0]),'day');assert.equal(S.mode({start:'',end:''}),'month');
 assert.equal(S.display(old[0].start,S.mode(old[0])),'10/02/2027');
 assert.throws(()=>S.validate([{...old[0],inputError:'Invalid month'}]));
 assert.throws(()=>S.validate([{...old[0],end:'2027-01-01'}]));
 assert.throws(()=>S.validate([{id:'hist',name:'Historical',label:'03/2023-02/2025'}]));
});
