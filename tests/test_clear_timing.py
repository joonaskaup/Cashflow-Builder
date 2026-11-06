"""Deliberate unplanning is savable; incomplete payment edits are not."""
import sys,copy,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import test_standalone as fixture
from helper import engine,workbooks
from helper.server import Project
import openpyxl

class ClearTimingTests(unittest.TestCase):
    setUp=fixture.StandaloneTests.setUp;tearDown=fixture.StandaloneTests.tearDown;create=fixture.StandaloneTests.create
    def project(self):
        root,_=self.create();fixture.app.configure(root);p=Project();s=copy.deepcopy(p.state)
        line=engine.line('balance',0,'');line['fixed']='2027-09-30'
        s['rules']['shared']={'id':'shared','name':'Shared fees','lines':[line],'salary':True}
        for c in s['costs'][:2]:c['rule']='shared';c['salary']=True
        p.commit(s);return p
    def clear(self,c):return {'costs':[c['id']],'clearTiming':True,'lines':[]}
    def request(self,p,action,**body):return p.preview(body) if action=='preview' else p.request(action,dict(revision=p.state['revision'],**body))
    def test_preview_save_reopen_refresh_and_reassign(self):
        p=self.project();before=copy.deepcopy(p.state);a,b=before['costs'][:2]
        preview=self.request(p,'preview',arrangements=[self.clear(a)])
        c=next(c for c in preview['costs'] if c['id']==a['id'])
        self.assertTrue(c['timingCleared']);self.assertEqual(c['payments'],[]);self.assertEqual(c['unallocated'],a['amount'])
        self.assertEqual(p.state,before)
        out=self.request(p,'rules',arrangements=[self.clear(a)])
        self.assertEqual(out['model']['total'],p.model['total']);self.assertEqual(p.model['total'],before['source']['total'])
        self.assertEqual(p.model['allocated'],b['amount']);self.assertIsNone(p.state['costs'][0]['rule'])
        self.assertEqual(p.state['costs'][1],b);self.assertTrue(p.state['costs'][0]['salary'])
        self.assertEqual(p.state['rules'],before['rules']);self.assertNotIn('timingCleared',p.state['costs'][0])
        reopened=Project();self.assertEqual(reopened.model,p.model)
        book=openpyxl.load_workbook(p.state['config']['budget'],data_only=True)
        sheet=book[p.state['config']['cashflowSheet']]
        self.assertEqual(sheet['V41'].value,b['amount']/100);self.assertEqual(sheet['E9'].value,10000)
        proposal=self.request(p,'refresh-preview');self.request(p,'refresh',refreshToken=proposal['token'])
        self.assertIsNone(p.state['costs'][0]['rule'])
        line=engine.line('balance',0,'');line['fixed']='2027-08-31'
        self.request(p,'rules',arrangements=[{'costs':[a['id']],'name':'New months','lines':[line]}])
        self.assertEqual(p.model['allocated'],a['amount']+b['amount'])
    def test_incomplete_or_conflicting_clear_cannot_bypass_validation(self):
        p=self.project();before=copy.deepcopy(p.state);a,b=before['costs'][:2]
        bad={'costs':[b['id']],'name':'Incomplete','lines':[engine.line('balance',0,'')]}
        with self.assertRaises(ValueError):self.request(p,'rules',arrangements=[self.clear(a),bad])
        self.assertEqual(p.state,before)
        for extra in [{'lines':[engine.line('balance',0,'')]},{'updateShared':True,'sharedId':'shared'},{'linkOnly':True},{'salaryOnly':True}]:
            for action in ['preview','rules']:
                with self.assertRaises(ValueError):self.request(p,action,arrangements=[{**self.clear(a),**extra}])
                self.assertEqual(p.state,before)
    def test_bulk_clear_with_dates_keeps_amounts_financing_and_shared_rules(self):
        p=self.project();before=copy.deepcopy(p.state);dates=copy.deepcopy(before['dates'])
        dates.append({'id':'later','name':'Later','kind':'milestone','start':'2027-12-31','end':''})
        self.request(p,'rules',dates=dates,arrangements=[{'costs':[c['id'] for c in before['costs'][:2]],'clearTiming':True,'lines':[]}])
        self.assertEqual(p.model['allocated'],0);self.assertEqual(p.model['total'],before['source']['total'])
        self.assertEqual(p.state['rules'],before['rules']);self.assertEqual(p.state['dates'],dates)
        self.assertEqual([c['amount'] for c in p.state['costs']],[c['amount'] for c in before['costs']])

if __name__=='__main__':unittest.main()
