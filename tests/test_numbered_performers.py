"""Fictional repeated performer codes and salary supplements."""
import copy
from pathlib import Path
import sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from helper import engine
import openpyxl

class NumberedPerformers(unittest.TestCase):
    def extract(self,base_in_h=True):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();path=root/'Fictional cast.xlsx'
            w=openpyxl.Workbook();s=w.active;s.title='Erittely'
            w.create_sheet('Maksuvalmiussuunnitelma')
            s.append(['06','ESIINTYJÄT'])
            total=0
            for n in range(7):
                row=2+4*n;name='Pääosat' if n<5 else 'Muut roolit' if n==5 else 'Avustajat'
                s.cell(row,1,30101 if n<5 else 30103 if n==5 else 30105);s.cell(row,2,name)
                for offset,(desc,amount) in enumerate([(f'Fictional performer {n+1}',1000+n*100),('lomakorvaus',100),('palkansivukulut',200),('tekijänoikeuskorvaus',50)]):
                    s.cell(row+offset,3,desc)
                    if offset or base_in_h:s.cell(row+offset,8,amount)
                    total+=amount
                s.cell(row,4,5);s.cell(row,5,'pv');s.cell(row+3,9,1350+n*100)
            s.cell(30,2,'HALLINTOKULUT korkeintaan 5%');s.cell(30,9,100)
            s.cell(31,2,'VARAUS SATUNNAISIIN KULUIHIN 7-10%');s.cell(31,9,200)
            s.cell(32,2,'KOKONAISKUSTANNUKSET YHTEENSÄ');s.cell(32,9,total+300)
            w.save(path)
            config=dict(budget=str(path),cashflowSheet='Maksuvalmiussuunnitelma',firstMonth='2027-01-01',mapping=dict(sheet='Erittely',label='B',description='C',amount='H',total='I',section='A',duration='D',durationUnit='E',adminLabel='HALLINTOKULUT korkeintaan 5%',reserveLabel='VARAUS SATUNNAISIIN KULUIHIN 7-10%',grandLabel='KOKONAISKUSTANNUKSET YHTEENSÄ'))
            with patch.object(engine,'ROOT',root):return engine.extract_budget(config)
    def test_repeated_codes_are_separate_roles_with_supplements(self):
        out=self.extract();costs=[g for g in out['groups'] if g['kind']=='cost']
        self.assertEqual(len(costs),7);self.assertEqual(sum(c['name']=='Pääosat' for c in costs),5)
        self.assertTrue(all(c['section']==6 for c in costs))
        self.assertEqual([c['source_rows'] for c in costs],[list(range(2+4*n,6+4*n)) for n in range(7)])
        self.assertEqual([c['amount'] for c in costs],[(1350+n*100)*100 for n in range(7)])
        old=engine.match_costs([],costs,initial=True)
        for i,c in enumerate(old):c['rule']='separate-'+str(i)
        refreshed=engine.match_costs(old,costs)
        self.assertEqual([c['rule'] for c in refreshed],[c['rule'] for c in old])
        self.assertEqual(sum(c['amount'] for c in out['groups']),out['total'])
    def test_missing_detail_amounts_are_not_silently_accepted(self):
        with self.assertRaisesRegex(ValueError,'do not cover the budget'):self.extract(False)

if __name__=='__main__':unittest.main()
