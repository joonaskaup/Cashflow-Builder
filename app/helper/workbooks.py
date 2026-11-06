"""Native template-preserving packaging around artifact-tool-authored values."""
from __future__ import annotations
import copy, datetime as dt, hashlib, json, os, re, shutil, subprocess, tempfile, zipfile
from pathlib import Path
from lxml import etree as E
import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.utils.datetime import to_excel

ROOT=Path(__file__).resolve().parents[1]
LIST=ROOT/'outputs/erittely-extraction/Erittely_cost_list.xlsx'

S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def tag(n):return '{'+S+'}'+n
def parse(b):return E.fromstring(b)
def xml(r):return E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
def sheet_paths(z):
    rel={r.get('Id'):r.get('Target') for r in parse(z.read('xl/_rels/workbook.xml.rels'))}
    return {s.get('name'):(rel[s.get('{'+R+'}id')][1:] if rel[s.get('{'+R+'}id')].startswith('/') else 'xl/'+rel[s.get('{'+R+'}id')]) for s in parse(z.read('xl/workbook.xml')).find(tag('sheets'))}
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def source_signature(path,name):
    """Hash worksheet data, ignoring Excel's display/style normalization."""
    with zipfile.ZipFile(path) as z:
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(n.itertext()) for n in parse(z.read('xl/sharedStrings.xml')).findall(tag('si'))]
        root=parse(z.read(sheet_paths(z)[name]));entries=[]
        for c in root.iter(tag('c')):
            f=c.find(tag('f'));v=c.find(tag('v'));inline=c.find(tag('is'))
            if f is None and v is None and inline is None:continue
            value=v.text if v is not None else None
            if c.get('t')=='s' and value is not None:value=strings[int(value)]
            if inline is not None:value=''.join(inline.itertext())
            entries.append([c.get('r'),f.text if f is not None else None,value])
    return hashlib.sha256(json.dumps(entries,ensure_ascii=False).encode()).hexdigest()
def locks(path):
    p=Path(path)
    return any((p.parent/n).exists() for n in ['~$'+p.name,'~$'+p.name[2:]])
def read_state():
    w=openpyxl.load_workbook(LIST,data_only=True)
    if '__Cashflow' not in w.sheetnames:return None
    chunks=[row[0].value for row in w['__Cashflow'].iter_rows() if isinstance(row[0].value,str)]
    state=json.loads(''.join(chunks))
    if 'Päivät' in w.sheetnames:
        definitions=[]
        for row in w['Päivät'].iter_rows(min_row=5,max_col=7):
            name,kind,start,end,weights,ident,shooting_days=[c.value for c in row]
            if not name:continue
            if not ident:raise ValueError('New dates need to be added using the helper so references remain stable')
            if str(ident)=='hist' and kind=='Historical':
                prior=next((d for d in state['dates'] if d['id']=='hist'),{})
                definitions.append({**prior,'id':'hist','name':str(name),'kind':'period','label':str(start) if start and start!='Historical' else ''})
                continue
            def iso(v):
                if v is None:return ''
                if isinstance(v,(dt.datetime,dt.date)):return v.strftime('%Y-%m-%d')
                return str(v)
            parsed={}
            if weights:
                for pair in str(weights).split(';'):
                    m,v=pair.strip().split(':',1);parsed[m.strip()]=float(v)
            prior=next((d for d in state['dates'] if d['id']==str(ident)),{})
            precision=prior.get('precision','day' if start or end else 'month') if (prior.get('start',''),prior.get('end',''),prior.get('kind'))==(iso(start),iso(end),str(kind)) else 'day'
            definitions.append({**{k:prior[k] for k in ('installmentGroup','installmentGroupName','installmentNumber') if k in prior},'id':str(ident),'name':str(name),'kind':str(kind),'start':iso(start),'end':iso(end),'weights':parsed,'precision':precision})
        prior_shoot=next((d for d in state['dates'] if d['id']=='shoot'),{})
        for d in definitions:
            if d['id']=='shoot':
                if w['Päivät']['G4'].value=='Paid shooting days':
                    row=next(r for r in w['Päivät'].iter_rows(min_row=5,max_col=7) if str(r[5].value)=='shoot')
                    d['paidDaysTotal']=row[6].value if row[6].value is not None else ''
                elif 'paidDaysTotal' in prior_shoot:d['paidDaysTotal']=prior_shoot['paidDaysTotal']
        labels={d['id']:d.get('label','') for d in state['dates']}
        for d in definitions:
            if d['id']=='hist' and 'label' not in d:d['label']=labels.get('hist','')
        state['dates']=definitions
    return state

def cashflow_key(value):
    if isinstance(value,(dt.datetime,dt.date)):return value.strftime('%Y-%m')
    if isinstance(value,str) and (value=='Historical' or re.fullmatch(r'\d{2}/\d{2}[-–]\d{2}/\d{2}',value)):return 'historical'
    return None

def relocated_finance_formula(formula, old_keys, new_keys, sheet_name):
    """Move references to the same cashflow month; keep other-sheet inputs intact."""
    from openpyxl.formula.tokenizer import Tokenizer
    tokens=Tokenizer('='+formula).items
    for token in tokens:
        if token.type!='OPERAND' or token.subtype!='RANGE':continue
        prefix,sep,refs=token.value.rpartition('!')
        if sep and prefix.strip("'").replace("''", "'")!=sheet_name:continue
        if not sep:refs=token.value
        pattern=r'(\$?)([A-Z]{1,3})(\$?)(\d+)'
        if not re.fullmatch(pattern+'(?::'+pattern+')?',refs):continue
        def move(m):
            col=openpyxl.utils.column_index_from_string(m[2])
            if not 5<=col<=21:return m[0]
            key=old_keys[col-5]
            if key not in new_keys:raise ValueError('A financing formula refers to a month outside the new display; adjust its range before saving')
            return m[1]+get_column_letter(new_keys.index(key)+5)+m[3]+m[4]
        token.value=(prefix+'!' if sep else '')+re.sub(pattern,move,refs)
    return ''.join(t.value for t in tokens)

def cash_values(state, model):
    """Keep original formulas; generate their correct caches including manual finance."""
    from .engine import date, cents, month
    w=openpyxl.load_workbook(state['config']['budget'],data_only=True)
    s=w[state['config']['cashflowSheet']];values={};finance=state['source']['finance']
    months=model['months'];category=model['categories']
    old_keys=[cashflow_key(s.cell(7,c).value) for c in range(5,22)]
    formulas=openpyxl.load_workbook(state['config']['budget'],data_only=False)[state['config']['cashflowSheet']]
    old_finance={}
    for i,key in enumerate(old_keys):
        entries={}
        for r in range(9,18):
            cell=s.cell(r,i+5);v=cell.value
            if v is None and formulas.cell(r,i+5).data_type=='f':raise ValueError(f'Recalculate manual financing cell {cell.coordinate} in Excel before saving')
            if v not in (None,'','-','–') and not isinstance(v,(int,float)):raise ValueError(f'Manual financing in {cell.coordinate} must be numeric')
            entries[r]=cents(v) if isinstance(v,(int,float)) else 0
        if key is None and any(entries.values()):raise ValueError('A financing column has no recognised month heading; check its heading in Excel before saving')
        if key in old_finance and any(entries.values()):raise ValueError('Financing columns have duplicate month headings; check them in Excel before saving')
        old_finance[key]=entries
    if any((any(old_finance.get(key,{}).values()) or any(formulas.cell(r,i+5).data_type=='f' for r in range(9,18))) for i,key in enumerate(old_keys) if key not in months):
        raise ValueError('A financing payment would fall outside the displayed columns. Extend or adjust the cashflow range before saving.')
    finance={get_column_letter(i+5)+str(r):old_finance.get(key,{}).get(r,0) for i,key in enumerate(months) for r in range(9,18)}
    # Reading current financing also preserves edits made in Excel since the last budget refresh.
    state['source']['finance']=finance
    for i,key in enumerate(months):
        if old_keys[i]!=key:
            for r in range(9,18):
                old_col=old_keys.index(key)+5 if key in old_keys else None
                origin=formulas.cell(r,old_col) if old_col else None
                target=formulas.cell(r,i+5)
                if origin is None and target.value in (None,'','-','–'):continue
                if origin is not None and origin.data_type!='f' and target.value==origin.value:continue
                values[get_column_letter(i+5)+str(r)]=finance[get_column_letter(i+5)+str(r)]/100
    def put(address,value):values[address]=value/100
    for i,m in enumerate(months):
        col=get_column_letter(i+5);serial=model['historicalLabel'] if m=='historical' else to_excel(dt.datetime.combine(date(m+'-01'),dt.time()))
        values[col+'7']=serial;values[col+'20']=serial
    category_rows={21:[1,2,3,4],**{r:[r-17] for r in range(22,39)},39:[22],40:[23]}
    for row,keys in category_rows.items():
        costs=sum(c['amount'] for c in state['costs'] if not c.get('removed') and c['section'] in keys)
        put('D'+str(row),costs)
        for i in range(17):put(get_column_letter(i+5)+str(row),sum(category[str(k)][i] for k in keys))
        put('V'+str(row),sum(sum(category[str(k)]) for k in keys))
    put('D41',model['total']);put('V41',model['allocated'])
    opening_value=s['E8'].value
    if opening_value not in (None,'','-','–') and not isinstance(opening_value,(int,float)):raise ValueError('Opening cash in E8 must be numeric')
    opening=cents(opening_value) if isinstance(opening_value,(int,float)) else 0
    state['source']['opening']=opening
    for i in range(17):
        col=get_column_letter(i+5)
        if i:put(col+'8',opening)
        receipts=sum(finance.get(col+str(r),0) for r in range(9,18))
        available=opening+receipts;spent=sum(values[col+str(r)] for r in range(21,41))
        put(col+'18',available);put(col+'41',round(spent*100))
        opening=available-round(spent*100);put(col+'42',opening)
    for r in range(9,18):put('V'+str(r),sum(finance.get(get_column_letter(c)+str(r),0) for c in range(5,22)))
    put('V18',sum(finance.values()))
    return values

def hide_metadata(path):
    with zipfile.ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()};paths=sheet_paths(z)
    book=parse(parts['xl/workbook.xml'])
    for sheet in book.find(tag('sheets')):
        if sheet.get('name')=='__Cashflow':sheet.set('state','veryHidden')
    parts['xl/workbook.xml']=xml(book)
    root=parse(parts[paths['Päivät']]);cols=root.find(tag('cols'))
    if cols is None:cols=E.Element(tag('cols'));root.insert(list(root).index(root.find(tag('sheetData'))),cols)
    for c in list(cols):
        if int(c.get('min'))<=6<=int(c.get('max')):
            if int(c.get('min'))<6:c.set('max','5')
            else:cols.remove(c)
    E.SubElement(cols,tag('col'),min='6',max='6',hidden='1',width='10',customWidth='1')
    parts[paths['Päivät']]=xml(root)
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)

def patch_cashflow(budget, donor, name, output):
    """Change only monthly costs/headings and dependent caches in the original sheet."""
    with zipfile.ZipFile(budget) as source,zipfile.ZipFile(donor) as authored:
        parts={n:source.read(n) for n in source.namelist()};p=sheet_paths(source)[name]
        original=parse(parts[p]);incoming=parse(authored.read(sheet_paths(authored)[name]))
        original_cells={c.get('r'):copy.deepcopy(c) for c in original.iter(tag('c'))}
        source_values=openpyxl.load_workbook(budget,data_only=True)[name]
        donor_values=openpyxl.load_workbook(donor,data_only=True)[name]
        old_keys=[cashflow_key(source_values.cell(7,i).value) for i in range(5,22)]
        new_keys=[cashflow_key(donor_values.cell(7,i).value) for i in range(5,22)]
        # Donor date serials can have a date style; labels are plain strings.
        styles=parse(parts['xl/styles.xml']);xfs=styles.find(tag('cellXfs'));num=styles.find(tag('numFmts'))
        if num is None:num=E.Element(tag('numFmts'),count='0');styles.insert(0,num)
        # Quote the slash: Excel otherwise substitutes the local date separator.
        month_format='mm"/"yy'
        fmt=next((int(n.get('numFmtId')) for n in num if n.get('formatCode')==month_format),None)
        if fmt is None:
            fmt=max([163]+[int(n.get('numFmtId')) for n in num])+1
            E.SubElement(num,tag('numFmt'),numFmtId=str(fmt),formatCode=month_format);num.set('count',str(len(num)))
        style_map={};data=original.find(tag('sheetData'));rows={int(r.get('r')):r for r in data};cells={c.get('r'):c for c in original.iter(tag('c'))}
        for authored_cell in incoming.iter(tag('c')):
            address=authored_cell.get('r');rn=int(re.search(r'\d+',address)[0]);column=re.match('[A-Z]+',address)[0]
            c=cells.get(address)
            if c is None:
                style=next((n.get('s') for n in rows[rn] if n.get('s') is not None and re.match('[A-Z]+',n.get('r'))[0] in ['E','F','G']),None)
                c=E.SubElement(rows[rn],tag('c'),r=address)
                if style is not None:c.set('s',style)
                cells[address]=c
            is_heading=rn in [7,20]
            is_cost=21<=rn<=40 and column not in ['D','V']
            for child in list(c):
                if child.tag in [tag('v'),tag('is')] or ((is_heading or is_cost) and child.tag==tag('f')):c.remove(child)
            c.attrib.pop('t',None)
            if 9<=rn<=17 and column not in ['D','V']:
                key=new_keys[openpyxl.utils.column_index_from_string(column)-5]
                prior=original_cells.get(get_column_letter(old_keys.index(key)+5)+str(rn)) if key in old_keys else None
                for child in list(c):
                    if child.tag==tag('f'):c.remove(child)
                if prior is not None and prior.find(tag('f')) is not None:
                    f=copy.deepcopy(prior.find(tag('f')))
                    f.text=relocated_finance_formula(f.text,old_keys,new_keys,name)
                    c.append(f)
            # Resolve donor shared strings into inline strings; never borrow its string pool.
            if authored_cell.get('t') in ('s','inlineStr','str'):
                c.set('t','inlineStr');node=E.SubElement(c,tag('is'));E.SubElement(node,tag('t')).text=str(donor_values[address].value)
            else:
                v=authored_cell.find(tag('v'))
                if v is None:raise ValueError(f'No authored value in {address}')
                c.append(copy.deepcopy(v))
            if is_heading and authored_cell.get('t') not in ('s','inlineStr','str'):
                old=int(c.get('s','0'))
                if int(xfs[old].get('numFmtId','0'))!=fmt:
                    if old not in style_map:
                        clone=copy.deepcopy(xfs[old]);clone.set('numFmtId',str(fmt));clone.set('applyNumberFormat','1')
                        style_map[old]=len(xfs);xfs.append(clone)
                    c.set('s',str(style_map[old]))
        xfs.set('count',str(len(xfs)))
        def col(a):
            n=0
            for c in re.match('[A-Z]+',a)[0]:n=n*26+ord(c)-64
            return n
        for row in data:row[:]=sorted(row,key=lambda c:col(c.get('r')))
        from .zero_values import apply_zero_format
        apply_zero_format(original,styles)
        parts[p]=xml(original);parts['xl/styles.xml']=xml(styles)
        # Preserve workbook views and every other worksheet byte for byte.
        # The dependency graph is unchanged: preserve the original chain and formulas.
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)

def save_project(state, model, render=False):
    budget=Path(state['config']['budget']);paths=[LIST,budget]
    for p in paths:
        if locks(p):raise ValueError(f'Save and close {p.name} in Excel, then retry. The helper updates that file.')
    before={p:digest(p) for p in paths}
    backup=ROOT/'work/backups';backup.mkdir(parents=True,exist_ok=True)
    budget_backup=budget.stem+'.before-cashflow'+budget.suffix
    for p,label in [(LIST,'Erittely_cost_list.before-rules.xlsx'),(budget,budget_backup)]:
        if not (backup/label).exists():shutil.copy2(p,backup/label)
    with tempfile.TemporaryDirectory(prefix='cashflow-',dir=ROOT/'work') as td:
        folder=Path(td)
        from .local_writer import write_list, write_donor
        write_list(state,model,folder/'list.xlsx')
        write_donor(state['config']['cashflowSheet'],cash_values(state,model),folder/'cash.xlsx')
        hide_metadata(folder/'list.xlsx')
        patch_cashflow(budget,folder/'cash.xlsx',state['config']['cashflowSheet'],folder/'budget.xlsm')
        for p in paths:
            if digest(p)!=before[p] or locks(p):raise ValueError(f'{p.name} changed while updating. Save and close Excel, then retry.')
        # Both generated files are validated before either replaces a user workbook.
        checks=openpyxl.load_workbook(folder/'budget.xlsm',data_only=True)
        if cents_value(checks[state['config']['cashflowSheet']]['V41'].value)!=model['allocated']:raise ValueError('Saved cashflow total mismatch')
        original_list=LIST.read_bytes()
        os.replace(folder/'list.xlsx',LIST)
        try:os.replace(folder/'budget.xlsm',budget)
        except Exception:
            LIST.write_bytes(original_list);raise
    return {'list':str(LIST),'budget':str(budget)}

def cents_value(v):
    from .engine import cents
    return cents(v)
