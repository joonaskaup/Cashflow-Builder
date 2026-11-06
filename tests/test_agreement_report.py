"""Fictional timing cases: no private workbooks needed."""
import copy
import datetime as dt
import io
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from helper import engine as e, agreement_report as report
import openpyxl

class AgreementReportTests(unittest.TestCase):
    def setUp(self):
        self.state=dict(revision=3,config=dict(firstMonth='2027-02-01'),source=dict(total=100001),
            dates=[dict(id='hist',name='Historical',kind='historical'),
                   dict(id='pre',name='Preparation',kind='period',start='2027-02-01',end='2027-03-31',precision='month'),
                   dict(id='shoot',name='Shooting',kind='period',start='2027-04-01',end='2027-04-30',precision='day'),
                   dict(id='d1',name='Director installment 1',kind='milestone',start='2027-03-31',precision='month',installmentNumber=1),
                   dict(id='d2',name='Director installment 2',kind='milestone',start='2027-03-31',precision='day',installmentNumber=2)],
            costs=[dict(id='c1',name='Set designer',first=10,last=12,section=5,amount=100001,rule='r',review='',sourceDuration=10,sourceDurationUnit='days',sourceDescription='Fictional role',sourceDetails=[dict(description='Design',quantity=10,unit='pv',rate=80,amount=800)])],
            rules={})
    def rule(self,lines):self.state['rules']['r']=dict(id='r',name='Test',lines=lines)
    def action(self,action):self.rule([dict(e.line('balance',0,''),basis='timing-action',action=action)])
    def build(self):return report.build(self.state,'Fictional')
    def test_explicit_work_dates_and_read_only(self):
        self.rule([dict(e.line('balance',0,'pre'),window='dates',workStart='2027-02-10',workEnd='2027-02-21')])
        before=copy.deepcopy(self.state);r=self.build()
        self.assertEqual(self.state,before)
        self.assertEqual(r['work'][0]['start'],'2027-02-10')
        self.assertEqual(r['work'][0]['precision'],'Entered work dates')
        self.assertEqual(r['scheduled'],100001)
    def test_month_period_and_estimated_anchor_are_distinct(self):
        self.rule([e.line('balance',0,'pre')]);r=self.build()
        self.assertIn('Month plan',r['work'][0]['precision'])
        self.rule([dict(e.line('balance',0,'pre','weekday-estimate'),window='end',windowLength=5,windowUnit='workdays')])
        self.assertIn('Calculated work estimate',self.build()['work'][0]['precision'])
    def test_month_payments_historical_and_outside_never_become_work(self):
        self.action(dict(type='months',paymentMonths=[dict(month='historical',percent=20),dict(month='2027-03',percent=30),dict(month='2030-01',percent=50)]))
        r=self.build();self.assertEqual(r['work'],[])
        self.assertEqual(r['summary'][0]['paymentCount'],2)
        self.assertIsNone(r['payments'][0]['date'])
        self.assertTrue(r['payments'][-1]['outside'])
        self.assertEqual(sum(p['amount'] for p in r['payments']),100001)
        self.assertEqual(r['summary'][0]['workStatus'],'Work dates not set')
    def test_percentage_period_split_does_not_invent_work_dates(self):
        self.action(dict(type='split',splitBy='percent',parts=[dict(name='Early',ref='pre',percent=20,moneyPlacement='start'),dict(name='Main',ref='shoot',percent=80)]))
        r=self.build();self.assertFalse(r['work']);self.assertEqual(r['unallocated'],0)
    def test_quantity_split_and_legacy_days(self):
        self.action(dict(type='split',splitBy='quantity',parts=[dict(name='Prep',ref='pre',quantity='remainder',window='end'),dict(name='Shoot',ref='shoot',quantity='fixed',days=6,window='whole')]))
        r=self.build();self.assertEqual([w['quantity'] for w in r['work']],[4,6]);self.assertEqual(r['unallocated'],0)
        self.rule([dict(e.line('balance',0,'shoot'),basis='day-split',shootingLinked=False,shootingDays=6,wrapDays=0)])
        r=self.build();self.assertEqual([w['quantity'] for w in r['work']],[4,6])
    def test_same_date_installments_remain_separate(self):
        self.action(dict(type='split',splitBy='percent',parts=[dict(name='Signing',ref='d1',percent=30),dict(name='Delivery',ref='d2',percent=70)]))
        r=self.build();self.assertEqual(len(r['payments']),2)
        self.assertEqual([p['installment'] for p in r['payments']],[1,2])
        self.assertIn('month',r['payments'][0]['precision']);self.assertEqual(r['payments'][1]['precision'],'Dated milestone')
        self.assertFalse(r['work'])
    def test_relative_work_units_are_not_mislabeled_as_budget_days(self):
        self.rule([e.line('units',1,'pre'),e.line('units',2,'shoot')])
        r=self.build();self.assertEqual([w['unit'] for w in r['work']],['work units','work units'])
    def test_payment_delay_is_explicit(self):
        self.rule([e.line('balance',0,'d2',days=5)])
        r=self.build();self.assertEqual(r['payments'][0]['date'],'2027-04-05')
        self.assertIn('delay',r['payments'][0]['precision'])
    def test_unallocated_and_archived_rows(self):
        self.state['costs'].append(dict(self.state['costs'][0],id='old',removed=True))
        r=self.build();self.assertEqual(len(r['summary']),1);self.assertEqual(r['unallocated'],100001)
        self.assertTrue(r['summary'][0]['checks']);self.assertEqual(r['payments'],[])
    def test_spreadsheet_types_text_safety_and_totals(self):
        self.state['costs'][0]['name']='=1+2'
        self.rule([e.line('percent',30,'d1'),e.line('balance',0,'d2')]);r=self.build()
        wb=openpyxl.load_workbook(io.BytesIO(report.spreadsheet(r)))
        self.assertEqual(wb.sheetnames,['Summary','Work periods','Payments'])
        self.assertEqual(wb['Summary']['A6'].data_type,'s');self.assertEqual(wb['Summary']['A6'].value,'=1+2')
        self.assertEqual(wb['Payments']['F6'].value,dt.datetime(2027,3,31))
        self.assertEqual(wb['Payments']['F6'].number_format,'dd"."mm"."yyyy')
        self.assertAlmostEqual(sum(wb['Payments'].cell(i,8).value for i in (6,7)),1000.01)
        self.assertEqual(wb['Summary'].freeze_panes,'C6')
        self.assertEqual(wb['Summary'].auto_filter.ref,'A5:N6')

if __name__=='__main__':unittest.main()
