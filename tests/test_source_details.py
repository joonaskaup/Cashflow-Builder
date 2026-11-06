"""Fictional independent fees, source inputs, and reviewed migration."""
import sys,copy,base64,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import test_standalone as fixture
from helper import engine,workbooks,source_details
from helper.server import Project
import openpyxl

class SourceTests(unittest.TestCase):
    setUp=fixture.StandaloneTests.setUp;tearDown=fixture.StandaloneTests.tearDown;create=fixture.StandaloneTests.create
    def variant(self):
        with zipfile.ZipFile(fixture.io_bytes(self.original)) as z:
            parts={n:z.read(n) for n in z.namelist()};path=workbooks.sheet_paths(z)['Erittely']
        sheet=workbooks.parse(parts[path]);data=sheet.find(workbooks.tag('sheetData'))
        def cell(row,col,value):
            r=next(r for r in data if r.get('r')==str(row));address=col+str(row)
            c=next((c for c in r if c.get('r')==address),None)
            if c is None:c=workbooks.E.SubElement(r,workbooks.tag('c'),r=address)
            for child in list(c):c.remove(child)
            c.attrib.pop('t',None)
            if isinstance(value,str):c.set('t','inlineStr');workbooks.E.SubElement(workbooks.E.SubElement(c,workbooks.tag('is')),workbooks.tag('t')).text=value
            elif value is not None:workbooks.E.SubElement(c,workbooks.tag('v')).text=str(value)
        cell(3,'F','Multiplier');cell(3,'G','Rate')
        for row,desc,amount in [(8,'Lead producer',2000),(9,'Partner production fee',3000),(10,'Partner wrap fee',940)]:
            cell(row,'B','Tuottajan korvaus' if row==8 else None);cell(row,'C',desc)
            for col,value in [('D',1),('E','pc'),('F',1),('G',amount),('H',amount)]:cell(row,col,value)
        # Independent quantity and rate are context, never a substitute for H.
        cell(11,'D',28);cell(11,'E','pv');cell(11,'G',252);cell(11,'F',None)
        cell(16,'D',1);cell(16,'E','kk');cell(16,'F',2);cell(16,'G',4500)
        if getattr(self,'other_independent_rows',False):cell(12,'C','Second independent component')
        if getattr(self,'zero_supplements',False):
            cell(10,'H',9100)
            for row,desc in [(11,'Holiday allowance'),(12,'Employer costs')]:
                cell(row,'B',None);cell(row,'C',desc);cell(row,'D',None);cell(row,'E','%');cell(row,'H',0)
        from openpyxl.utils.cell import column_index_from_string
        for row in data:row[:]=sorted(row,key=lambda c:column_index_from_string(''.join(x for x in c.get('r') if x.isalpha())))
        parts[path]=workbooks.xml(sheet);return fixture.archive(parts)
    def project(self):
        data=self.variant();stage=self.manager.stage({'filename':'fees.xlsx','data':base64.b64encode(data).decode()})
        result=self.manager.create({'upload':stage['upload'],'name':'Independent fees','firstMonth':stage['firstMonth']})
        fixture.app.configure(self.manager.root/result['id']);return Project()
    def request(self,p,action,**body):return p.request(action,dict(revision=p.state['revision'],**body))
    def legacy(self,rule):
        p=self.project();s=copy.deepcopy(p.state)
        children=[c for c in s['costs'] if c.get('sourceHeading')=='Tuottajan korvaus'];parent=copy.deepcopy(children[0])
        parent.update(name='Tuottajan korvaus',key=children[0]['sourceGroupKey'],first=8,last=children[-1]['last'],source_rows=[r for c in children for r in c['source_rows']],
                      components=[v for c in children for v in c['components']],amount=sum(c['amount'] for c in children),
                      sourceDetails=[d for c in children for d in c['sourceDetails']],rule='legacy')
        for key in ['sourceGroupKey','sourceGroupComponents','sourceHeading']:parent.pop(key,None)
        s['costs']=[parent]+[c for c in s['costs'] if c not in children]
        s['rules']['legacy']=dict(id='legacy',name='Existing grouped timing',lines=rule)
        s['source']['groups']=copy.deepcopy(s['costs'])
        p.commit(s);return p,parent['id']
    def test_independent_rows_and_salary_group_exact_totals(self):
        p=self.project();fees=[c for c in p.state['costs'] if c.get('sourceHeading')=='Tuottajan korvaus']
        self.assertEqual(len(fees),3);self.assertEqual([c['amount'] for c in fees],[200000,300000,94000])
        self.assertEqual([c['source_rows'] for c in fees],[[8],[9],[10]])
        self.assertEqual(p.model['total'],3080000)
        crew=next(c for c in p.state['costs'] if c['name']=='Camera assistant')
        self.assertEqual(crew['source_rows'],[11,12]);self.assertEqual(crew['amount'],816000)
        self.assertTrue(crew['groupedSalaryCosts']);self.assertEqual(crew['sourceDuration'],28);self.assertEqual(crew['sourceDurationUnit'],'days')
        edit=next(c for c in p.state['costs'] if c['name']=='Editing');d=edit['sourceDetails'][0]
        self.assertEqual([d[k] for k in ('quantity','unit','multiplier','rate')],[1,'kk',2,4500])
        self.assertEqual(edit['sourceDurationUnit'],'months');self.assertEqual(edit['amount'],500000)
        self.assertEqual(engine.match_costs(p.state['costs'],engine.extract_budget(p.state['config'])['groups']),p.state['costs'])
    def test_explicit_columns_blank_rate_and_fictional_header(self):
        root,_=self.create();fixture.app.configure(root);p=Project();d=p.state['costs'][0]['sourceDetails'][0]
        self.assertEqual(d['rate'],1500);self.assertIsNone(d['multiplier'])
        config=copy.deepcopy(p.state['config']);config['mapping'].update(rate='',multiplier='')
        groups=engine.extract_budget(config)['groups'];self.assertIsNone(groups[0]['sourceDetails'][0]['rate'])
        self.assertEqual(source_details.duration(1.5,'kk'),(1.5,'months'))
        self.assertEqual(source_details.duration(3,'kpl'),(None,''))
    def test_refresh_preview_fixed_payments_not_duplicated_and_independent(self):
        ln=engine.line('fixed',1000,'');ln['fixed']='2027-07-15'
        end=engine.line('balance',0,'');end['fixed']='2027-09-30'
        p,parentid=self.legacy([ln,end]);before=copy.deepcopy(p.state);path=Path(p.state['config']['budget']);original=path.read_bytes()
        with self.assertRaisesRegex(ValueError,'review'):self.request(p,'refresh')
        proposal=self.request(p,'refresh-preview');self.assertEqual(len(proposal['splits']),1)
        self.assertEqual(path.read_bytes(),original);self.assertEqual(p.state,before)
        children=proposal['splits'][0]['children'];self.assertEqual(len(children),3)
        self.assertEqual(sum(v['amount'] for c in children for v in c['payments'] if v['date']=='2027-07-15'),100000)
        self.assertTrue(all(not c['allocationIssues'] for c in children))
        out=self.request(p,'refresh',refreshToken=proposal['token']);self.assertEqual(out['model']['total'],3080000)
        self.assertEqual(out['model']['allocated'],594000)
        active=[c for c in p.state['costs'] if c.get('splitFrom')==parentid]
        self.assertEqual(len({c['rule'] for c in active}),3)
        self.assertTrue(next(c for c in p.state['costs'] if c['id']==parentid)['archived'])
        self.assertEqual(p.state['rules']['legacy'],before['rules']['legacy'])
        again=self.request(p,'refresh-preview');self.assertFalse(again['splits'])
        self.request(p,'refresh',refreshToken=again['token']);self.assertEqual(Project().model,p.model)
        values=openpyxl.load_workbook(path,data_only=True)[p.state['config']['cashflowSheet']]
        self.assertEqual(values['V41'].value,5940);self.assertEqual(values['E9'].value,10000)
    def test_linked_percentages_remain_linked_and_untouched_costs_stay_same(self):
        p,parentid=self.legacy([engine.line('percent',30,'shoot'),engine.line('balance',0,'post')])
        s=copy.deepcopy(p.state)
        for d in s['dates']:
            if d['id']=='shoot':d.update(start='2027-07-01',end='2027-07-31')
            if d['id']=='post':d.update(start='2027-08-01',end='2027-08-31')
        p.commit(s);before=copy.deepcopy(p.state)
        preview=self.request(p,'refresh-preview');self.request(p,'refresh',refreshToken=preview['token'])
        untouched={c['id']:c for c in before['costs'] if c['id']!=parentid}
        for c in p.state['costs']:
            if c['id'] in untouched:self.assertEqual(c['rule'],untouched[c['id']]['rule'])
        for c in p.state['costs']:
            if c.get('splitFrom')==parentid:self.assertEqual(p.state['rules'][c['rule']]['lines'],before['rules']['legacy']['lines'])
        s=copy.deepcopy(p.state);next(d for d in s['dates'] if d['id']=='shoot').update(start='2027-10-01',end='2027-10-31')
        model=engine.evaluate(s);self.assertTrue(any(pay['date']=='2027-10-31' for pay in model['payments']))
    def test_stale_refresh_and_rate_changes(self):
        p,_=self.legacy([engine.line('balance',0,'hist')]);report=self.request(p,'refresh-preview')
        with self.assertRaisesRegex(ValueError,'Preview'):self.request(p,'refresh',refreshToken='wrong')
        path=Path(p.state['config']['budget']);data=path.read_bytes()
        # Any source change after preview invalidates that preview before saving.
        with zipfile.ZipFile(fixture.io_bytes(data)) as z:parts={n:z.read(n) for n in z.namelist()};sheet=workbooks.sheet_paths(z)['Erittely']
        parts[sheet]=parts[sheet].replace(b'Lead producer',b'Other producer');path.write_bytes(fixture.archive(parts))
        with self.assertRaisesRegex(ValueError,'changed since preview'):self.request(p,'refresh',refreshToken=report['token'])
    def test_zero_fringe_rows_do_not_block_fee_split_or_migration(self):
        self.zero_supplements=True
        p,parentid=self.legacy([engine.line('balance',0,'hist')]);before=p.model['total']
        proposal=self.request(p,'refresh-preview');self.assertEqual(len(proposal['splits']),1)
        children=proposal['splits'][0]['children']
        self.assertEqual([c['source_rows'] for c in children],[[8],[9],[10,11,12]])
        self.assertEqual([c['amount'] for c in children],[200000,300000,910000])
        self.assertTrue(all(not c['groupedSalaryCosts'] for c in children))
        self.request(p,'refresh',refreshToken=proposal['token'])
        self.assertEqual(p.model['total'],before);self.assertEqual(p.model['allocated'],1410000)
        self.assertFalse(self.request(p,'refresh-preview')['splits'])
    def test_nonzero_shared_supplement_is_not_assigned_to_one_fee(self):
        rows=[dict(row=n,description=d,unit=u,amount=a,amountFormula=f) for n,d,u,a,f in [
            (8,'Fee A','pc',100,''),(9,'Fee B','pc',200,''),(10,'Employer costs','%',30,'=SUM(H8:H9)*10%')]]
        chunks,reason=source_details.row_chunks(rows)
        self.assertEqual(chunks,[rows]);self.assertIn('several fees',reason)
        rows[-1]['amountFormula']='=H9*10%'
        chunks,reason=source_details.row_chunks(rows)
        self.assertEqual([[r['row'] for r in c] for c in chunks],[[8],[9,10]])
        rows[-1]['amountFormula']=''
        self.assertEqual(source_details.row_chunks(rows)[0],[rows])
    def test_only_producer_heading_splits_and_other_timing_stays_identical(self):
        self.other_independent_rows=True
        p,parentid=self.legacy([engine.line('balance',0,'hist')])
        s=copy.deepcopy(p.state);other=next(c for c in s['costs'] if c['name']=='Camera assistant')
        other['rule']='legacy';p.commit(s);before=copy.deepcopy(p.state)
        proposal=self.request(p,'refresh-preview')
        self.assertEqual(len(proposal['splits']),1);self.assertEqual(proposal['splits'][0]['parent']['id'],parentid)
        self.assertEqual(len(proposal['splits'][0]['children']),3)
        self.request(p,'refresh',refreshToken=proposal['token'])
        for cost in before['costs']:
            if cost['id']!=parentid:self.assertEqual(next(c for c in p.state['costs'] if c['id']==cost['id']),cost)
        self.assertEqual(next(c for c in p.state['costs'] if c['id']==other['id'])['source_rows'],[11,12])
    def test_many_unrelated_groups_stay_grouped(self):
        p=self.project();sample=copy.deepcopy(next(g for g in p.state['source']['groups'] if g['name']=='Camera assistant'))
        sample['sourceDetails'][1]['description']='Independent second fee'
        groups=[]
        for i in range(98):
            g=copy.deepcopy(sample);g['name']='Tuottajan korvaus' if i==0 else f'Other fee heading {i}'
            groups.append(g)
        result=source_details.expand(copy.deepcopy(groups))
        self.assertEqual(len(result),99)
        self.assertEqual(len([g for g in result if g.get('sourceHeading')=='Tuottajan korvaus']),2)
        self.assertEqual([g['source_rows'] for g in result[2:]],[g['source_rows'] for g in groups[1:]])

if __name__=='__main__':unittest.main()
