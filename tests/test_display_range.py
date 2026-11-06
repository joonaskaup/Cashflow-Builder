"""Range regression tests using disposable fictional projects only."""
import sys,copy,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_standalone as fixture
from helper import engine,workbooks,display_range
from helper.server import Project
import openpyxl

class RangeTests(unittest.TestCase):
    setUp=fixture.StandaloneTests.setUp
    tearDown=fixture.StandaloneTests.tearDown
    create=fixture.StandaloneTests.create
    def project(self):
        root,_=self.create();fixture.app.configure(root);return Project()
    def request(self,p,action,**body):
        return p.request(action,dict(revision=p.state['revision'],**body))
    def cell(self,p,address,value):
        path=Path(p.state['config']['budget'])
        with zipfile.ZipFile(path) as z:
            parts={n:z.read(n) for n in z.namelist()};sheet=workbooks.sheet_paths(z)[p.state['config']['cashflowSheet']]
        xml=workbooks.parse(parts[sheet]);c=next(c for c in xml.iter(workbooks.tag('c')) if c.get('r')==address)
        for child in list(c):c.remove(child)
        c.attrib.pop('t',None);workbooks.E.SubElement(c,workbooks.tag('v')).text=str(value);parts[sheet]=workbooks.xml(xml)
        path.write_bytes(fixture.archive(parts))
    def timing(self,months):
        ln=engine.line('balance',0,'')
        shares=[100//len(months)]*len(months);shares[-1]=100-sum(shares[:-1])
        ln.update(basis='timing-action',action={'type':'months','name':'Payment months','monthEqual':True,'paymentMonths':[{'month':m,'percent':share} for m,share in zip(months,shares)]})
        return {'id':'timed','name':'Payment months','lines':[ln]}
    def test_formats(self):
        for value in ['02/2027','2/2027','02/27','2027-02','2027-02-01']:
            self.assertEqual(display_range.first_month(value),'2027-02-01')
        for value in ['',None,'2027-13','13/2027','nonsense']:
            with self.assertRaisesRegex(ValueError,'MM/YYYY'):display_range.first_month(value)
    def test_wrong_august_start_corrected_dates_totals_styles_preserved(self):
        p=self.project();self.cell(p,'E9',0)
        self.request(p,'range',firstMonth='08/2027')
        s=copy.deepcopy(p.state);s['rules']['timed']=self.timing(['historical','2027-03','2027-07']);s['costs'][0]['rule']='timed'
        p.commit(s);before=copy.deepcopy(p.state);before_model=copy.deepcopy(p.model)
        path=Path(p.state['config']['budget']);original_bytes=path.read_bytes()
        original=openpyxl.load_workbook(path)[p.state['config']['cashflowSheet']]
        report=self.request(p,'range-preview',firstMonth='02/2027')
        self.assertGreater(report['outsideBefore'],0);self.assertEqual(report['outsideAfter'],0)
        self.assertEqual(report['months'][:3],['historical','2027-02','2027-03'])
        self.assertEqual(p.state,before);self.assertEqual(path.read_bytes(),original_bytes)
        out=self.request(p,'range',firstMonth='02/2027')
        self.assertEqual(out['model']['outside'],0)
        self.assertEqual(out['model']['payments'],before_model['payments'])
        for key in ['costs','rules','dates']:self.assertEqual(p.state[key],before[key])
        self.assertEqual(out['model']['total'],before_model['total'])
        reopened=Project();self.assertEqual(reopened.model,out['model'])
        result=openpyxl.load_workbook(path)[original.title]
        values=openpyxl.load_workbook(path,data_only=True)[original.title]
        self.assertEqual(values['F7'].value.strftime('%Y-%m'),'2027-02')
        self.assertEqual(values['V41'].value*100,out['model']['allocated'])
        for row in original:
            for cell in row:self.assertEqual(cell._style,result[cell.coordinate]._style,cell.coordinate)
        self.assertEqual(result['F7'].number_format,'mm"/"yy')
    def test_manual_financing_moves_columns_but_not_months(self):
        p=self.project();path=p.state['config']['budget']
        result=self.request(p,'range',firstMonth='02/2027')
        self.assertEqual(result['state']['source']['finance']['I9'],1000000)
        w=openpyxl.load_workbook(path,data_only=True)[p.state['config']['cashflowSheet']]
        self.assertEqual(w['I7'].value.strftime('%Y-%m'),'2027-06')
        self.assertEqual(w['I9'].value,10000);self.assertIn(w['E9'].value,[0,None])
        self.assertEqual(Project().state['source']['finance'],p.state['source']['finance'])
        self.request(p,'range',firstMonth='06/2027')
        self.assertEqual(p.state['source']['finance']['E9'],1000000)
    def test_financing_outside_range_is_blocked_without_writes(self):
        p=self.project();before=copy.deepcopy(p.state);path=Path(p.state['config']['budget']);data=path.read_bytes()
        for action in ['range-preview','range']:
            with self.assertRaisesRegex(ValueError,'financing payment would fall outside'):
                self.request(p,action,firstMonth='08/2027')
        self.assertEqual(p.state,before);self.assertEqual(path.read_bytes(),data)
    def test_pending_plan_in_preview_is_not_committed_by_range_save(self):
        p=self.project();before=copy.deepcopy(p.state)
        arrangement=dict(costs=[p.state['costs'][0]['id']],**self.timing(['2027-03']))
        dates=copy.deepcopy(p.state['dates']);dates[1].update(start='2027-03-01',end='2027-04-30')
        report=self.request(p,'range-preview',firstMonth='02/2027',arrangements=[arrangement],dates=dates)
        self.assertGreater(report['outsideBefore'],0);self.assertEqual(report['outsideAfter'],0)
        self.assertTrue(report['model']['payments'])
        out=self.request(p,'range',firstMonth='02/2027')
        self.assertFalse(out['model']['payments'])
        for key in ['rules','costs','dates']:self.assertEqual(p.state[key],before[key])
    def test_opening_balance_confirmation_and_stale_revision(self):
        p=self.project();self.cell(p,'E8',1234)
        report=self.request(p,'range-preview',firstMonth='02/2027')
        self.assertTrue(report['confirmOpening']);self.assertEqual(report['opening'],123400)
        with self.assertRaisesRegex(ValueError,'opening balance'):
            self.request(p,'range',firstMonth='02/2027')
        with self.assertRaisesRegex(ValueError,'opening balance'):
            self.request(p,'range',firstMonth='02/2027',confirmOpening=True,openingAmount=100)
        self.request(p,'range',firstMonth='02/2027',confirmOpening=True,openingAmount=123400)
        self.assertEqual(p.state['source']['opening'],123400)
        with self.assertRaisesRegex(ValueError,'another window'):
            p.request('range',dict(firstMonth='03/2027',revision=-1))
    def test_legacy_settings_change_first_only_without_refresh(self):
        p=self.project();config=copy.deepcopy(p.state['config']);config['firstMonth']='2027-02-01'
        out=self.request(p,'settings',config=config)
        self.assertEqual(out['model']['months'][0],'2027-02')
        self.assertEqual(out['state']['source']['finance']['I9'],1000000)
        config['firstMonth']='2027-03-01';config['mapping']['label']='Z'
        with self.assertRaisesRegex(ValueError,'separately'):self.request(p,'settings',config=config)

if __name__=='__main__':unittest.main()
