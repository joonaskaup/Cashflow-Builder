"""Fictional co-production variants; no personal budgets are read."""
import copy,io,zipfile,sys,unittest,base64
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from test_standalone import StandaloneTests,app,Project,engine,workbooks
from helper.allowances import label_kind

class AllowanceTests(StandaloneTests):
    # Reuse only setup/create helpers, not the parent test suite.
    def coproduction(self):
        with zipfile.ZipFile(io.BytesIO(self.original)) as z:
            parts={n:z.read(n) for n in z.namelist()};path=workbooks.sheet_paths(z)['Erittely']
        sheet=workbooks.parse(parts[path]);data=sheet.find(workbooks.tag('sheetData'))
        rows={int(r.get('r')):r for r in data}
        grand=rows[24];grand.set('r','26')
        for cell in grand:cell.set('r',cell.get('r').replace('24','26'))
        def cell(row,col,value):
            from lxml import etree
            r=rows[row];old=next((c for c in r if c.get('r')==f'{col}{row}'),None)
            if old is not None:r.remove(old)
            c=etree.SubElement(r,workbooks.tag('c'),r=f'{col}{row}')
            if isinstance(value,str):
                c.set('t','inlineStr');etree.SubElement(etree.SubElement(c,workbooks.tag('is')),workbooks.tag('t')).text=value
            else:etree.SubElement(c,workbooks.tag('v')).text=str(value)
        from lxml import etree
        rows[26]=grand
        for n in (24,25):
            rows[n]=etree.Element(workbooks.tag('row'),r=str(n));data.insert(list(data).index(grand),rows[n])
        cell(22,'C','CONTINGENCY (VIRO)');cell(23,'C','OVERHEADS (VIRO)')
        cell(22,'H',.05);cell(23,'H',.07)
        cell(24,'B','HALLINTOKULUT korkeintaan 5%');cell(24,'I',400)
        cell(25,'B','VARAUS SATUNNAISIIN KULUIHIN 7–10%');cell(25,'I',600)
        cell(26,'I',31800)
        from openpyxl.utils.cell import column_index_from_string
        for row in data:
            row[:]=sorted(row,key=lambda c:column_index_from_string(''.join(x for x in c.get('r') if x.isalpha())))
        dimension=sheet.find(workbooks.tag('dimension'))
        if dimension is not None:dimension.set('ref','A1:I26')
        parts[path]=etree.tostring(sheet)
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for n,b in parts.items():z.writestr(n,b)
        return out.getvalue()
    def import_variant(self,authority='Primary labels'):
        data=self.coproduction();info=self.manager.stage({'filename':'coproduction.xlsx','data':base64.b64encode(data).decode()})
        self.assertEqual(len(info['allowanceConflicts']),2)
        result=self.manager.create({'upload':info['upload'],'name':'Fictional co-production','firstMonth':info['firstMonth'],'mapping':{'allowanceCategorySource':authority}})
        root=self.manager.root/result['id'];app.configure(root)
        return root,Project()
    def test_repeated_allowances_and_percentage_cells_are_not_double_counted(self):
        root,p=self.import_variant();groups=p.state['source']['groups']
        allowances=[g for g in groups if g['kind']!='cost']
        self.assertEqual(len(allowances),4)
        self.assertEqual(p.model['total'],3180000)
        self.assertEqual(sum(g['amount'] for g in allowances if g['kind']=='administration'),140000)
        self.assertEqual(sum(g['amount'] for g in allowances if g['kind']=='contingency'),260000)
        self.assertEqual(sum(g['amount'] for g in groups),3180000)
        self.assertEqual(len({r for g in allowances for r in g['source_rows']}),4)
        self.assertTrue(any('VIRO' in g['name'] for g in allowances))
        s=copy.deepcopy(p.state)
        s['rules']['paid']={'id':'paid','name':'Historical','lines':[engine.line('balance',0,'hist')]}
        for c in s['costs']:c['rule']='paid'
        out=p.commit(s);reopened=Project();self.assertEqual(out['model'],reopened.model)
        self.assertEqual(out['model']['allocated'],3180000)
        # Importing unchanged rows retains all saved identities and arrangements.
        incoming=engine.extract_budget(reopened.state['config'])['groups']
        refreshed=engine.match_costs(reopened.state['costs'],incoming)
        self.assertEqual({c['id'] for c in refreshed},{c['id'] for c in reopened.state['costs']})
        self.assertTrue(all(c['rule']=='paid' for c in refreshed))
    def test_english_descriptions_only_override_when_explicitly_selected(self):
        _,p=self.import_variant('English descriptions when present')
        groups=p.state['source']['groups']
        self.assertEqual(sum(g['amount'] for g in groups if g['kind']=='administration'),240000)
        self.assertEqual(sum(g['amount'] for g in groups if g['kind']=='contingency'),160000)
    def test_merged_finnish_labels_one_column_earlier_are_read_once(self):
        data=self.coproduction()
        with zipfile.ZipFile(io.BytesIO(data)) as z:parts={n:z.read(n) for n in z.namelist()};path=workbooks.sheet_paths(z)['Erittely']
        from lxml import etree
        sheet=workbooks.parse(parts[path]);merges=etree.SubElement(sheet,workbooks.tag('mergeCells'),count='2')
        for row in (22,23):
            next(c for c in sheet.iter(workbooks.tag('c')) if c.get('r')==f'B{row}').set('r',f'A{row}')
            etree.SubElement(merges,workbooks.tag('mergeCell'),ref=f'A{row}:B{row}')
        parts[path]=etree.tostring(sheet);out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for n,b in parts.items():z.writestr(n,b)
        info=self.manager.stage({'filename':'merged.xlsx','data':base64.b64encode(out.getvalue()).decode()})
        result=self.manager.create({'upload':info['upload'],'name':'Merged labels','firstMonth':info['firstMonth']})
        app.configure(self.manager.root/result['id']);p=Project()
        self.assertEqual(p.model['total'],3180000)
        allowances=[g for g in p.state['source']['groups'] if g['kind']!='cost']
        self.assertEqual(len(allowances),4)
        self.assertEqual({g['allowanceLabelCell'] for g in allowances},{'A22','A23','B24','B25'})
        self.assertEqual(sum(g['amount'] for g in allowances if g['kind']=='administration'),140000)

    def test_unrecognised_allowance_report_names_skipped_cells(self):
        from helper.allowances import allowance_diagnostic
        rows={22:{'label':'HALLINTOKULUT extra wording','description':'VIRO','total':123.45}}
        val=lambda col,row:rows.get(row,{}).get(col)
        report=allowance_diagnostic(app.MAPPING,26,val,val,[],lambda r:[(f'B{r}',val('label',r)),(f'C{r}',val('description',r))])
        self.assertIn('Row 22 not included',report);self.assertIn('B22:',report);self.assertIn('I22 = €123.45',report)
        self.assertIn('Allowance parser v2',report)

    def test_original_english_viro_labels_are_primary_allowances(self):
        data=self.coproduction()
        with zipfile.ZipFile(io.BytesIO(data)) as z:parts={n:z.read(n) for n in z.namelist()};path=workbooks.sheet_paths(z)['Erittely']
        from lxml import etree
        sheet=workbooks.parse(parts[path])
        for row,label in ((22,'CONTINGENCY (VIRO)'),(23,'OVERHEADS (VIRO)')):
            cell=next(c for c in sheet.iter(workbooks.tag('c')) if c.get('r')==f'B{row}')
            for child in list(cell):cell.remove(child)
            cell.set('t','inlineStr');etree.SubElement(etree.SubElement(cell,workbooks.tag('is')),workbooks.tag('t')).text=label
            description=next(c for c in sheet.iter(workbooks.tag('c')) if c.get('r')==f'C{row}')
            description.getparent().remove(description)
        parts[path]=etree.tostring(sheet);out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for n,b in parts.items():z.writestr(n,b)
        info=self.manager.stage({'filename':'original-viro.xlsx','data':base64.b64encode(out.getvalue()).decode()})
        self.assertEqual(info['allowanceConflicts'],[])
        result=self.manager.create({'upload':info['upload'],'name':'Original English labels','firstMonth':info['firstMonth']})
        app.configure(self.manager.root/result['id']);p=Project()
        allowances=[g for g in p.state['source']['groups'] if g['kind']!='cost']
        self.assertEqual(len(allowances),4)
        self.assertEqual(p.model['total'],3180000)
        self.assertEqual(next(g for g in allowances if g['name']=='CONTINGENCY (VIRO)')['kind'],'contingency')
        self.assertEqual(next(g for g in allowances if g['name']=='OVERHEADS (VIRO)')['kind'],'administration')
        self.assertEqual(sum(g['amount'] for g in allowances if g['kind']=='administration'),240000)
        self.assertEqual(sum(g['amount'] for g in allowances if g['kind']=='contingency'),160000)
        s=copy.deepcopy(p.state);s['rules']['paid']={'id':'paid','name':'Historical','lines':[engine.line('balance',0,'hist')]}
        for cost in s['costs']:cost['rule']='paid'
        result=p.commit(s);self.assertEqual(result['model']['allocated'],3180000)
        self.assertEqual(Project().model,result['model'])

    def test_label_variants_are_bounded_and_custom_labels_stay_exact(self):
        m=app.MAPPING
        for s in ('HALLINTOKULUT korkeintaan 4%','Hallintokulut 5,0 % (VIRO)'):
            self.assertEqual(label_kind(s,m),'administration')
        self.assertEqual(label_kind('VARAUS SATUNNAISIIN KULUIHIN 7–10%',m),'contingency')
        self.assertIsNone(label_kind('Hallintokulut yhteensä kaikille',m))
        custom={**m,'adminLabel':'Partner fee'}
        self.assertEqual(label_kind('Partner fee',custom),'administration')
        self.assertIsNone(label_kind('Partner fee estimate',custom))
    def test_bad_grand_total_still_blocks_import(self):
        data=self.coproduction()
        with zipfile.ZipFile(io.BytesIO(data)) as z:parts={n:z.read(n) for n in z.namelist()};path=workbooks.sheet_paths(z)['Erittely']
        from lxml import etree
        sheet=workbooks.parse(parts[path])
        next(c for c in sheet.iter(workbooks.tag('c')) if c.get('r')=='I26').find(workbooks.tag('v')).text='31900'
        parts[path]=etree.tostring(sheet)
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for n,b in parts.items():z.writestr(n,b)
        info=self.manager.stage({'filename':'bad.xlsx','data':base64.b64encode(out.getvalue()).decode()})
        with self.assertRaisesRegex(ValueError,'do not cover'):
            self.manager.create({'upload':info['upload'],'name':'Bad total','firstMonth':info['firstMonth']})

if __name__=='__main__':
    # Run only the targeted tests here; baseline is run separately.
    names=[n for n in AllowanceTests.__dict__ if n.startswith('test_')]
    result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(AllowanceTests(n) for n in names))
    sys.exit(not result.wasSuccessful())
