"""Offline workbook writer for the standalone application.

Only generated list/donor workbooks are authored here. The budget itself is
patched by the existing XML-preserving writer, never resaved by openpyxl.
"""
import datetime as dt
import json
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment

def write_list(state,model,path):
    wb=Workbook();s=wb.active;s.title='Kustannukset'
    for address,value in {
        'A1':'Erittelyn kustannukset',
        'A2':'Palkka, lomakorvaus ja sivukulut ovat yksi kustannus.',
        'A3':f"Lähde: {Path(state['config']['budget']).name} / {state['config']['mapping']['sheet']}.",
        'A4':'Maksuerät ja päivät muokataan apurissa. Budjetin tallennuksen jälkeen: Refresh budget.',
    }.items():put(s[address],value)
    for c,v in enumerate(['Kustannus','Summa (€)','Erittelyn rivit','Maksutapa','Huomio'],1):
        put(s.cell(6,c),v);s.cell(6,c).font=Font(name='Arial',bold=True)
    previous=None;row=7
    for cost in model['costs']:
        section='Removed from source — review' if cost.get('removed') else cost['section_name']
        if section!=previous:
            put(s.cell(row,1),section);s.cell(row,1).font=Font(name='Arial',bold=True)
            previous=section;row+=1
        values=[cost['name'],None if cost.get('removed') else cost['amount']/100,
                str(cost['first']) if cost['first']==cost['last'] else f"{cost['first']}–{cost['last']}",
                cost['description'],'; '.join(x for x in cost['issues'] if x!=cost['description'])]
        for col,value in enumerate(values,1):
            put(s.cell(row,col),value);s.cell(row,col).alignment=Alignment(vertical='top',wrap_text=True)
        s.cell(row,2).number_format='#,##0.00'
        s.row_dimensions[row].height=max(24,16*(1+max(len(str(values[3]))//60,len(str(values[4]))//46)))
        row+=1
    put(s.cell(row+1,1),'Yhteensä');s.cell(row+1,2,model['total']/100).number_format='#,##0.00'
    for col,width in {'A':38,'B':18,'C':18,'D':64,'E':52}.items():s.column_dimensions[col].width=width
    s.freeze_panes='A7'
    d=wb.create_sheet('Päivät')
    put(d['A1'],'Production periods and payment dates')
    put(d['A2'],'Historical is one total; its label can be a month range. Paid days are production-plan totals.')
    for i,v in enumerate(['Name','Type','Start / payment date','Period end','Paid days by month','Reference','Paid shooting days'],1):
        put(d.cell(4,i),v);d.cell(4,i).font=Font(name='Arial',bold=True)
    for r,x in enumerate(state['dates'],5):
        historic=x['id']=='hist'
        values=[x['name'],'Historical' if historic else x['kind'],
                model['historicalLabel'] if historic else dt.date.fromisoformat(x['start']) if x.get('start') else None,
                None if historic or not x.get('end') else dt.date.fromisoformat(x['end']),
                '; '.join(f'{k}: {v}' for k,v in x.get('weights',{}).items()),x['id'],
                x.get('paidDaysTotal') if x['id']=='shoot' else None]
        for c,v in enumerate(values,1):put(d.cell(r,c),v)
        if not historic:
            d.cell(r,3).number_format=d.cell(r,4).number_format='dd/mm/yy'
    for c,w in {'A':27,'B':14,'C':22,'D':22,'E':40,'F':12,'G':23}.items():d.column_dimensions[c].width=w
    d.column_dimensions['F'].hidden=True;d.freeze_panes='A5'
    meta=wb.create_sheet('__Cashflow');meta.sheet_state='veryHidden'
    serialized=json.dumps(state,ensure_ascii=False)
    for i,start in enumerate(range(0,len(serialized),28000),1):put(meta.cell(i,1),serialized[start:start+28000])
    wb.save(path)

def put(cell,value):
    cell.value=value
    # Descriptions and labels are data, even if a workbook supplied '=...'.
    if isinstance(value,str):cell.data_type='s'

def write_donor(name,values,path):
    wb=Workbook();s=wb.active;s.title=name
    for address,value in values.items():put(s[address],value)
    for row in [7,20]:
        for col in range(5,22):s.cell(row,col).number_format='mm"/"yy'
    wb.save(path)
