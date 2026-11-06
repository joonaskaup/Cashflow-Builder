"""Isolated acceptance tests. Uses only the generated fictional workbook."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
import urllib.error
import zipfile

APP=Path(__file__).resolve().parents[1]/'app'
sys.path.insert(0,str(APP))
import local_app as app
from helper import engine,workbooks
from helper.server import Project
import openpyxl

class StandaloneTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='cashflow-local-test-')
        self.root=Path(self.tmp.name);self.manager=app.Manager(self.root/'Projects','test-secret')
        self.example=APP/'Example/Fictional budget.xlsx'
        self.original=self.example.read_bytes()
    def tearDown(self):
        self.manager.close();self.tmp.cleanup()
    def create(self,name='Fictional'):
        stage=self.manager.stage({'filename':'example.xlsx','data':base64.b64encode(self.original).decode()})
        result=self.manager.create({'upload':stage['upload'],'name':name,'firstMonth':stage['firstMonth']})
        root=self.manager.root/result['id']
        return root,result
    def test_import_isolated_totals_and_copy(self):
        root,result=self.create()
        self.assertEqual(result['costs'],9);self.assertEqual(result['total'],3080000)
        app.configure(root);s=workbooks.read_state()
        self.assertFalse(s['rules']);self.assertTrue(all(not c['rule'] for c in s['costs']))
        self.assertTrue(all(not d.get('start') for d in s['dates']))
        self.assertEqual((root/'Original/example.xlsx').read_bytes(),self.original)
        self.assertEqual((root/'Budget/example.xlsx').read_bytes(),self.original)
        self.assertEqual(s['source']['finance']['E9'],1000000)
        other,_=self.create('Other');self.assertNotEqual(root,other)
        app.configure(other);other_s=workbooks.read_state()
        self.assertTrue(set(c['id'] for c in s['costs']).isdisjoint(c['id'] for c in other_s['costs']))
        self.assertEqual(self.example.read_bytes(),self.original)
    def test_save_reopen_conservation_finance_and_formatting(self):
        root,_=self.create();app.configure(root)
        budget=root/'Budget/example.xlsx'
        before=openpyxl.load_workbook(budget,data_only=False)
        source_zip=zipfile.ZipFile(budget);source_xml=source_zip.read(workbooks.sheet_paths(source_zip)['Erittely'])
        p=Project();s=copy.deepcopy(p.state)
        next(d for d in s['dates'] if d['id']=='shoot').update(start='2027-09-01',end='2027-10-02')
        s['rules']['during']={'id':'during','name':'During shooting','lines':[engine.line('balance',0,'shoot')]}
        for c in s['costs']:c.update(rule='during',review='')
        out=p.commit(s)
        self.assertEqual(out['model']['total'],out['model']['allocated'])
        self.assertEqual(out['model']['unallocated'],0)
        paid=out['model']['categories']['5']
        self.assertGreater(paid[3],paid[4]*10)
        reopened=Project()
        self.assertEqual(reopened.model,out['model'])
        after=openpyxl.load_workbook(budget,data_only=False)
        values=openpyxl.load_workbook(budget,data_only=True)
        b=before['Maksuvalmiussuunnitelma'];a=after[b.title];v=values[b.title]
        self.assertEqual(v['V41'].value,30800)
        self.assertEqual(v['E9'].value,10000)
        for row in b:
            for cell in row:
                new=a[cell.coordinate]
                if cell.row not in (7,20):self.assertEqual(cell._style,new._style,cell.coordinate)
                if cell.data_type=='f':self.assertEqual(cell.value,new.value,cell.coordinate)
        for col in range(5,22):self.assertEqual(a.cell(7,col).number_format,'mm"/"yy')
        with zipfile.ZipFile(budget) as z:self.assertEqual(z.read(workbooks.sheet_paths(z)['Erittely']),source_xml)
        self.assertEqual((root/'Original/example.xlsx').read_bytes(),self.original)
        self.assertTrue((root/'work/backups/example.before-cashflow.xlsx').exists())
    def test_bad_layout_and_bad_totals_do_not_create_project(self):
        # Alter XML in a test copy, preserving the real synthetic seed.
        with zipfile.ZipFile(io_bytes(self.original)) as z:parts={n:z.read(n) for n in z.namelist()};paths=workbooks.sheet_paths(z)
        data=workbooks.parse(parts[paths['Erittely']])
        for c in data.iter(workbooks.tag('c')):
            if c.get('r')=='I24':c.find(workbooks.tag('v')).text='1'
        parts[paths['Erittely']]=workbooks.xml(data)
        bad=archive(parts)
        stage=self.manager.stage({'filename':'bad.xlsx','data':base64.b64encode(bad).decode()})
        with self.assertRaisesRegex(ValueError,'do not cover'):
            self.manager.create({'upload':stage['upload'],'name':'Bad','firstMonth':'2027-06'})
        self.assertEqual(self.manager.projects(),[])
        data=workbooks.parse(parts[paths['Maksuvalmiussuunnitelma']])
        for row in list(data.find(workbooks.tag('sheetData'))):
            if row.get('r')=='41':data.find(workbooks.tag('sheetData')).remove(row)
        parts[paths['Maksuvalmiussuunnitelma']]=workbooks.xml(data)
        stage=self.manager.stage({'filename':'wrong.xlsx','data':base64.b64encode(archive(parts)).decode()})
        with self.assertRaisesRegex(ValueError,'layout is not supported'):
            self.manager.create({'upload':stage['upload'],'name':'Wrong','firstMonth':'2027-06'})
        self.assertEqual(self.manager.projects(),[])
    def test_authenticated_server_and_relocation(self):
        root,_=self.create()
        relocated=self.root/'Moved Projects';shutil.move(self.manager.root,relocated)
        self.manager.root=relocated
        url=self.manager.open(root.name)['url'];base,token=url.split('#')
        self.assertEqual(self.manager.open(root.name)['url'],url)
        def get(path,secret=None,origin=None,host=None):
            headers={}
            if secret:headers['X-Cashflow-Token']=secret
            if origin:headers['Origin']=origin
            if host:headers['Host']=host
            return urllib.request.urlopen(urllib.request.Request(base+path,headers=headers))
        with self.assertRaises(urllib.error.HTTPError) as ctx:get('api/state')
        self.assertEqual(ctx.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError):get('api/state',token,'https://example.org')
        with self.assertRaises(urllib.error.HTTPError):get('api/state',token,host='evil.invalid')
        with get('') as r:
            self.assertIn("connect-src 'self'",r.headers['Content-Security-Policy'])
            self.assertNotIn(token,r.read().decode())
        with get('api/state',token) as r:state=json.load(r)
        self.assertTrue(state['files']['budget'].startswith(str(relocated)))
        body={'revision':state['state']['revision'],'dates':state['state']['dates']}
        req=urllib.request.Request(base+'api/dates',json.dumps(body).encode(),{'Content-Type':'application/json','X-Cashflow-Token':token})
        try:
            with urllib.request.urlopen(req) as r:result=json.load(r)
        except urllib.error.HTTPError as e:
            self.fail(e.read().decode())
        self.assertEqual(result['state']['revision'],1)
        self.assertEqual((relocated/root.name/'Original/example.xlsx').read_bytes(),self.original)
    def test_network_guard(self):
        import socket
        with self.assertRaisesRegex(PermissionError,'external'):
            socket.getaddrinfo('example.org',443)
        with socket.socket() as s:
            with self.assertRaisesRegex(PermissionError,'external'):s.connect(('192.0.2.1',443))
    def test_month_precision_and_exact_dates_survive_save(self):
        root,_=self.create();app.configure(root);p=Project();s=copy.deepcopy(p.state)
        pre=next(d for d in s['dates'] if d['id']=='pre')
        pre.update(start='2027-06-01',end='2027-08-31',precision='month')
        shoot=next(d for d in s['dates'] if d['id']=='shoot')
        shoot.update(start='2027-09-06',end='2027-10-07',precision='day',paidDaysTotal=24)
        s['dates'].append(dict(id='delivery',name='Delivery',kind='milestone',start='2028-02-29',end='',weights={},precision='month'))
        s['rules']['delivery']={'id':'delivery','name':'Delivery','lines':[engine.line('balance',0,'delivery')]}
        s['costs'][0]['rule']='delivery';s['costs'][0]['review']=''
        p.check_dates(s['dates']);out=p.commit(s);reopened=Project()
        dates={d['id']:d for d in reopened.state['dates']}
        self.assertEqual(dates['pre']['precision'],'month')
        self.assertEqual(dates['shoot']['start'],'2027-09-06')
        self.assertEqual(dates['shoot']['precision'],'day')
        self.assertEqual(dates['shoot']['paidDaysTotal'],24)
        self.assertEqual(dates['delivery']['start'],'2028-02-29')
        self.assertEqual(dates['delivery']['precision'],'month')
        self.assertEqual(out['model'],reopened.model)
        self.assertTrue(out['model']['payments'])
        self.assertEqual({payment['date'] for payment in out['model']['payments']},{'2028-02-29'})
        bad=copy.deepcopy(s['dates']);bad[1]['inputError']='Invalid month'
        with self.assertRaisesRegex(ValueError,'Invalid month'):p.check_dates(bad)
    def test_first_month_accepts_visible_format(self):
        stage=self.manager.stage({'filename':'example.xlsx','data':base64.b64encode(self.original).decode()})
        result=self.manager.create({'upload':stage['upload'],'name':'Month format','firstMonth':'06/2027'})
        self.assertEqual(result['total'],3080000)
    def test_installment_group_identity_totals_and_moving_dates(self):
        root,_=self.create();app.configure(root);p=Project();s=copy.deepcopy(p.state)
        for n,month in enumerate(('06','08','11'),1):
            s['dates'].append(dict(id='director-'+str(n),name='Director · Installment '+str(n),kind='milestone',start='2027-'+month+'-15',end='',weights={},precision='day',installmentGroup='director',installmentGroupName='Director',installmentNumber=n))
        parts=[dict(name='Installment '+str(n),ref='director-'+str(n),moneyKind='fixed',percent=share,moneyPlacement='whole') for n,share in enumerate((30,40,30),1)]
        action=dict(type='split',splitBy='percent',installmentGroup='director',parts=parts,name='Director')
        ln=engine.line('balance',0,'shoot');ln.update(basis='timing-action',action=action)
        s['rules']['director']={'id':'director','name':'Director','lines':[ln]}
        for c in s['costs'][:2]:c.update(rule='director',review='')
        out=p.commit(s);reopened=Project()
        self.assertEqual(out['model'],reopened.model)
        self.assertEqual([d['installmentNumber'] for d in reopened.state['dates'] if d.get('installmentGroup')=='director'],[1,2,3])
        for c in s['costs'][:2]:
            payments=[v for v in out['model']['payments'] if v['cost']==c['id']]
            self.assertEqual(sum(v['amount'] for v in payments),c['amount'])
            self.assertEqual({v['date'] for v in payments},{'2027-06-15','2027-08-15','2027-11-15'})
        moved=copy.deepcopy(reopened.state)
        next(d for d in moved['dates'] if d['id']=='director-2')['start']='2027-12-03'
        changed=reopened.commit(moved)
        self.assertEqual(changed['model']['allocated'],out['model']['allocated'])
        self.assertIn('2027-12-03',{v['date'] for v in changed['model']['payments']})
        self.assertNotIn('2027-08-15',{v['date'] for v in changed['model']['payments']})
    def test_historical_and_future_month_split_save_and_excel(self):
        root,_=self.create();app.configure(root);p=Project();s=copy.deepcopy(p.state)
        c=s['costs'][0]
        action={'type':'months','name':'Rights payments','monthEqual':False,'paymentMonths':[{'month':'historical','percent':'30'},{'month':'2027-08','percent':'70'}]}
        ln=engine.line('balance',0,'');ln.update(basis='timing-action',action=action)
        s['rules']['rights']={'id':'rights','name':'Rights payments','lines':[ln]};c.update(rule='rights',review='')
        out=p.commit(s);payments=[v for v in out['model']['payments'] if v['cost']==c['id']]
        self.assertEqual({v['date']:v['amount'] for v in payments},{'historical':45000,'2027-08-31':105000})
        self.assertEqual(sum(v['amount'] for v in payments),c['amount'])
        self.assertEqual(Project().model,out['model'])
        values=openpyxl.load_workbook(root/'Budget/example.xlsx',data_only=True)['Maksuvalmiussuunnitelma']
        self.assertEqual(values['E41'].value,450);self.assertEqual(values['H41'].value,1050)
        self.assertEqual(values['V41'].value,1500)
        # Whole-cost Historical and date independence; original monthly arrangements remain valid.
        from helper import reusable_actions
        for rows in ([{'month':'historical','percent':100}],[{'month':'2027-08','percent':100}]):
            trial=copy.deepcopy(s['rules']['rights']);trial['lines'][0]['action']['paymentMonths']=rows
            result=reusable_actions.calculate(c,trial,s['dates'])
            self.assertFalse(result['issues']);self.assertEqual(sum(v['amount'] for v in result['payments']),c['amount'])
    def test_direct_timeline_bulk_shares_are_independent_and_survive_reopen(self):
        root,_=self.create();app.configure(root);p=Project();s=copy.deepcopy(p.state)
        ids=[c['id'] for c in s['costs'][:2]]
        for i,c in enumerate(s['costs'][:2]):
            action={'type':'months','name':'Payment months','monthEqual':False,'paymentMonths':[{'month':'2027-08','percent':'30.25'},{'month':'2027-09','percent':'69.75'}]}
            ln=engine.line('balance',0,'');ln.update(basis='timing-action',action=action)
            rid='timeline-'+str(i);s['rules'][rid]={'id':rid,'name':'Payment months','lines':[ln]};c.update(rule=rid,review='')
        out=p.commit(s);reopened=Project();self.assertEqual(out['model'],reopened.model)
        for c in out['model']['costs'][:2]:
            self.assertEqual(sum(v['amount'] for v in c['payments']),c['amount'])
            self.assertFalse(c['allocationIssues'])
        unchanged=copy.deepcopy(out['model']['costs'][1]['payments'])
        s=copy.deepcopy(reopened.state)
        s['rules']['timeline-0']['lines'][0]['action']['paymentMonths']=[{'month':'historical','percent':'100'}]
        changed=reopened.commit(s)
        self.assertEqual(changed['model']['costs'][1]['payments'],unchanged)
        self.assertEqual(changed['model']['allocated'],out['model']['allocated'])
        self.assertEqual(Project().model,changed['model'])
        # Adding Historical inserts a column; the manual financing amount is retained.
        self.assertEqual(sum(s['source']['finance'].values()),1000000)

    def test_code_only_updater_preserves_projects_and_backs_up(self):
        import update_app,fcntl
        target=self.root/'Installed';(target/'helper').mkdir(parents=True)
        (target/'helper/engine.py').write_text('old engine')
        (target/'local_app.py').write_text('old app')
        (target/'Projects/project').mkdir(parents=True)
        marker=target/'Projects/project/private.xlsx';marker.write_bytes(b'private test bytes')
        (target/'Start Cashflow Local.command').write_text('old launcher')
        backup=update_app.update(target)
        self.assertTrue((target/'Start Cashflow Builder.command').exists())
        self.assertFalse((target/'Start Cashflow Local.command').exists())
        self.assertEqual((backup/'Start Cashflow Local.command').read_text(),'old launcher')
        self.assertEqual(marker.read_bytes(),b'private test bytes')
        self.assertEqual((backup/'local_app.py').read_text(),'old app')
        self.assertEqual((target/'helper/schedule.js').read_bytes(),(APP/'helper/schedule.js').read_bytes())
        with (target/'Projects/.manager.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError,'stop the existing app'):update_app.update(target)
    def test_no_absolute_runtime_symlinks(self):
        for p in (APP/'runtime').rglob('*'):
            if p.is_symlink():
                self.assertTrue(p.resolve().is_relative_to(APP/'runtime'),str(p))

def io_bytes(data):
    import io
    return io.BytesIO(data)
def archive(parts):
    out=io_bytes(b'')
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for n,data in parts.items():z.writestr(n,data)
    return out.getvalue()
if __name__=='__main__':unittest.main()
