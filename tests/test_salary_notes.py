"""Fictional salary notes, safe reunion and unchanged saved payments."""
import sys,copy,base64,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import test_standalone as fixture
import test_source_details as source_fixture
from helper import engine,workbooks,salary_notes
from helper.server import Project
import openpyxl

class SalaryNoteTests(unittest.TestCase):
    setUp=fixture.StandaloneTests.setUp;tearDown=fixture.StandaloneTests.tearDown
    def project(self):
        data=source_fixture.SourceTests.variant(self)
        with zipfile.ZipFile(fixture.io_bytes(data)) as z:
            parts={n:z.read(n) for n in z.namelist()};path=workbooks.sheet_paths(z)['Erittely']
        sheet=workbooks.parse(parts[path])
        changes={'B8':'Järjestäjä','B9':'(kuvaukset Suomessa)','C8':'TBC','C9':'lomakorvaus','C10':'palkansivukulut',
                 'D8':5,'E8':'pv','D9':0.135,'E9':'%','D10':0.216,'E10':'%','H8':4500,'H9':540,'H10':900}
        for address,value in changes.items():
            c=next(c for c in sheet.iter(workbooks.tag('c')) if c.get('r')==address)
            for child in list(c):c.remove(child)
            c.attrib.pop('t',None)
            if isinstance(value,str):c.set('t','inlineStr');workbooks.E.SubElement(workbooks.E.SubElement(c,workbooks.tag('is')),workbooks.tag('t')).text=value
            else:workbooks.E.SubElement(c,workbooks.tag('v')).text=str(value)
        parts[path]=workbooks.xml(sheet)
        upload=self.manager.stage({'filename':'notes.xlsx','data':base64.b64encode(fixture.archive(parts)).decode()})
        created=self.manager.create({'upload':upload['upload'],'name':'Salary note example','firstMonth':upload['firstMonth']})
        fixture.app.configure(self.manager.root/created['id']);return Project()
    def request(self,p,action,**body):return p.request(action,dict(revision=p.state['revision'],**body))
    def legacy(self,different=False,untimed=False):
        p=self.project();s=copy.deepcopy(p.state);c=next(c for c in s['costs'] if c['name']=='Järjestäjä')
        base=copy.deepcopy(c);extra=copy.deepcopy(c)
        base.update(source_rows=[8],first=8,last=8,components=c['components'][:1],sourceDetails=c['sourceDetails'][:1],amount=450000)
        extra.update(id='old-note-cost',name='(kuvaukset Suomessa)',key=engine.normal(c['section_name'])+'|(kuvaukset suomessa)|cost',
                     source_rows=[9,10],first=9,last=10,components=c['components'][1:],sourceDetails=c['sourceDetails'][1:],amount=144000,
                     sourceDuration=None,sourceDurationUnit='',sourceDescription='lomakorvaus')
        for part in (base,extra):
            part.pop('sourceNotes',None);part.pop('sourceContinuations',None)
        for i,part in enumerate((base,extra)):
            action={'type':'months','name':'Timing '+str(i),'paymentMonths':[{'month':'2027-10' if different and i else '2027-09','percent':'100'}]}
            ln=engine.line('balance',0,'');ln.update(basis='timing-action',action=action)
            rid='old-'+str(i);s['rules'][rid]={'id':rid,'name':rid,'lines':[ln]};part['rule']=None if untimed else rid
        s['costs']=[base,extra]+[other for other in s['costs'] if other['id']!=c['id']];s['source']['groups']=copy.deepcopy(s['costs']);p.commit(s)
        return p
    def test_note_attaches_to_salary_with_all_source_inputs(self):
        p=self.project();cost=next(c for c in p.state['costs'] if c['name']=='Järjestäjä')
        self.assertEqual(cost['name'],'Järjestäjä');self.assertEqual(cost['source_rows'],[8,9,10]);self.assertEqual(cost['amount'],594000)
        self.assertEqual(cost['sourceDuration'],5);self.assertEqual(cost['sourceDurationUnit'],'days')
        self.assertEqual(cost['sourceNotes'],['(kuvaukset Suomessa)']);self.assertTrue(cost['groupedSalaryCosts'])
        self.assertEqual([r['description'] for r in cost['sourceDetails']],['TBC','lomakorvaus','palkansivukulut'])
        self.assertEqual(p.model['total'],3080000)
    def test_review_then_reunite_preserves_cashflow_rules_and_other_costs(self):
        p=self.legacy();before=copy.deepcopy(p.state);model=copy.deepcopy(p.model)
        with self.assertRaisesRegex(ValueError,'review'):self.request(p,'refresh')
        proposal=self.request(p,'refresh-preview');self.assertFalse(proposal['splits']);self.assertEqual(len(proposal['merges']),1)
        self.assertEqual(p.state,before);self.assertEqual(proposal['merges'][0]['cost']['amount'],594000)
        self.request(p,'refresh',refreshToken=proposal['token'])
        self.assertEqual(p.model['categories'],model['categories']);self.assertEqual(p.model['allocated'],model['allocated'])
        self.assertEqual(p.model['total'],model['total']);self.assertEqual(p.state['rules'],before['rules'])
        active=[c for c in p.state['costs'] if not c.get('removed')];self.assertEqual(len(active),9)
        merged=next(c for c in active if c['name']=='Järjestäjä')
        self.assertEqual(merged['id'],before['costs'][0]['id']);self.assertEqual(merged['source_rows'],[8,9,10])
        self.assertEqual(merged['sourceBeforeMerge'],before['costs'][:2])
        for old in before['costs'][2:]:self.assertEqual(next(c for c in p.state['costs'] if c['id']==old['id']),old)
        self.assertTrue(next(c for c in p.state['costs'] if c['id']=='old-note-cost')['archived'])
        self.assertEqual(Project().model,p.model)
        book=openpyxl.load_workbook(p.state['config']['budget'],data_only=True)
        self.assertEqual(book[p.state['config']['cashflowSheet']]['V41'].value,5940)
        self.assertEqual(book[p.state['config']['cashflowSheet']]['E9'].value,10000)
        again=self.request(p,'refresh-preview');self.assertEqual(again['merges'],[])
    def check_retained_merge(self,p):
        before=copy.deepcopy(p.state);model=copy.deepcopy(p.model)
        disk_before=Project().state
        totals=salary_notes.payment_totals(before['costs'][:2],before['rules'],before['dates'])
        proposal=self.request(p,'refresh-preview')
        self.assertEqual(p.state,before);self.assertEqual(Project().state,disk_before)
        merged=proposal['merges'][0]['cost']
        self.assertTrue(merged['sourceMergeFixedPayments'])
        self.assertIn('no longer follow production timetable',merged['sourceMergeNote'])
        self.request(p,'refresh',refreshToken=proposal['token'])
        target=next(c for c in p.state['costs'] if not c.get('removed') and c['name']=='Järjestäjä')
        self.assertEqual(salary_notes.payment_totals([target],p.state['rules'],p.state['dates']),totals)
        self.assertEqual(p.model['categories'],model['categories'])
        self.assertEqual(p.model['total'],model['total']);self.assertEqual(p.model['allocated'],model['allocated'])
        self.assertEqual(target['sourceBeforeMerge'],before['costs'][:2])
        for rid,rule in before['rules'].items():self.assertEqual(p.state['rules'][rid],rule)
        for old in before['costs'][2:]:self.assertEqual(next(c for c in p.state['costs'] if c['id']==old['id']),old)
        self.assertEqual(Project().model,p.model)
        self.assertEqual(self.request(p,'refresh-preview')['merges'],[])
        return target
    def test_different_months_reunite_without_moving_payments(self):
        self.check_retained_merge(self.legacy(different=True))
    def test_cosmetic_action_fields_do_not_block_reunion(self):
        p=self.legacy();s=copy.deepcopy(p.state)
        s['rules']['old-1']['lines'][0]['action']['monthEqual']=True
        p.commit(s);self.check_retained_merge(p)
    def test_fixed_euros_historical_and_exact_dates_survive(self):
        p=self.legacy();s=copy.deepcopy(p.state)
        first=engine.line('fixed','1234.56','hist')
        second=engine.line('balance',0,'');second['fixed']='2027-08-17'
        s['rules']['old-0']['lines']=[first,second]
        other=engine.line('balance',0,'');other['fixed']='2027-10-09'
        s['rules']['old-1']['lines']=[other];p.commit(s)
        self.check_retained_merge(p)
    def test_identical_linked_rules_stay_linked(self):
        p=self.legacy();s=copy.deepcopy(p.state)
        next(d for d in s['dates'] if d['id']=='shoot').update(start='2027-09-01',end='2027-09-30')
        for rid in ('old-0','old-1'):s['rules'][rid]['lines']=[engine.line('balance',0,'shoot')]
        p.commit(s);before=copy.deepcopy(p.state)
        proposal=self.request(p,'refresh-preview');self.request(p,'refresh',refreshToken=proposal['token'])
        merged=next(c for c in p.state['costs'] if c['name']=='Järjestäjä' and not c.get('removed'))
        self.assertEqual(p.state['rules'],before['rules']);self.assertEqual(merged['rule'],'old-0')
        self.assertFalse(merged.get('sourceMergeFixedPayments'))
    def test_separate_rounding_is_preserved_to_the_cent(self):
        parents=[{'id':'a','amount':1,'rule':'r'},{'id':'b','amount':1,'rule':'r'}]
        a=engine.line('percent',50,'');a['fixed']='2027-09-15'
        b=engine.line('percent',50,'');b['fixed']='2027-10-15'
        state={'rules':{'r':{'lines':[a,b]}},'dates':[]}
        target={'id':'combined','name':'Salary','amount':2,'rule':'r'}
        totals=salary_notes.payment_totals(parents,state['rules'],[])
        self.assertNotEqual(totals,salary_notes.payment_totals([target],state['rules'],[]))
        salary_notes.retain_payments(state,target,totals)
        self.assertEqual(totals,salary_notes.payment_totals([target],state['rules'],[]))
    def test_invalid_saved_timing_still_blocks_atomically(self):
        p=self.legacy();s=copy.deepcopy(p.state)
        s['rules']['old-1']['lines']=[engine.line('balance',0,'')];p.commit(s)
        before=copy.deepcopy(p.state)
        with self.assertRaisesRegex(ValueError,'still needs payment timing'):self.request(p,'refresh-preview')
        self.assertEqual(p.state,before);self.assertEqual(Project().state,before)
    def test_untimed_rows_can_be_reunited_without_inventing_payments(self):
        p=self.legacy(untimed=True);proposal=self.request(p,'refresh-preview')
        self.request(p,'refresh',refreshToken=proposal['token']);self.assertEqual(p.model['allocated'],0)
        self.assertIsNone(p.state['costs'][0]['rule'])
    def test_parenthetical_new_job_or_nonadjacent_note_does_not_merge(self):
        p=self.project();base=copy.deepcopy(next(c for c in p.state['source']['groups'] if c['name']=='Järjestäjä'));note=copy.deepcopy(base)
        base.update(first=8,last=8,source_rows=[8],sourceDetails=base['sourceDetails'][:1])
        note.update(name='(Second job)',first=9,last=9,source_rows=[9],sourceDetails=[{'description':'A different job'}])
        self.assertEqual(len(salary_notes.combine([copy.deepcopy(base),copy.deepcopy(note)])),2)
        note['sourceDetails'][0]['description']='lomakorvaus';note['first']=10;note['last']=10
        self.assertEqual(len(salary_notes.combine([copy.deepcopy(base),copy.deepcopy(note)])),2)
        note.update(first=9,last=9,section=6)
        self.assertEqual(len(salary_notes.combine([copy.deepcopy(base),copy.deepcopy(note)])),2)

if __name__=='__main__':unittest.main()
