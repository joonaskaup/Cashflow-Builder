"""Payment rules and budget refresh. Spreadsheet authoring lives in workbook.mjs."""
from __future__ import annotations
import calendar, collections, copy, datetime as dt, hashlib, json, re, uuid, zipfile
from decimal import Decimal, ROUND_HALF_UP, ROUND_FLOOR, InvalidOperation
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
LIST = ROOT / 'outputs/erittely-extraction/Erittely_cost_list.xlsx'
MONTHS = 17  # The original formatted cashflow has E:U, followed by its total.

def text(v): return ' '.join(str(v or '').split())
def normal(v): return text(v).casefold()
def cents(v):
    d = Decimal(str(v))
    if not d.is_finite(): raise ValueError('Amount must be a finite number')
    return int((d * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
def number(v):
    try: d = Decimal(str(v))
    except InvalidOperation: raise ValueError('Enter a number') from None
    if not d.is_finite(): raise ValueError('Enter a finite number')
    return d
def month(d): return d.replace(day=1)
def date(v):
    if not v: raise ValueError('Date missing')
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    return dt.date.fromisoformat(str(v))
def add_months(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + int(n), 12)
    return dt.date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))
def month_end(d): return d.replace(day=calendar.monthrange(d.year, d.month)[1])
def delay(d, line, end_of_month=False):
    m, days = number(line.get('months', 0)), number(line.get('days', 0))
    if m != m.to_integral_value() or days != days.to_integral_value():
        raise ValueError('Payment delays must be whole months and days')
    if abs(m)>120 or abs(days)>3650: raise ValueError('Payment delay is outside the supported range')
    shifted=add_months(d,int(m))
    if end_of_month:shifted=month_end(shifted)
    return shifted+dt.timedelta(days=int(days))
def months_between(a, b):
    if b < a: raise ValueError('Period end precedes its start')
    out=[];m=month(a)
    while m <= month(b): out.append(m);m=add_months(m,1)
    if len(out)>1200: raise ValueError('Period is too long')
    return out
def distribute(amount, weights):
    """Largest remainder in chronological order, exactly conserving signed cents."""
    total=sum(number(w) for _,w in weights)
    if total <= 0: raise ValueError('Add positive paid-day weights for this period')
    raw=[Decimal(abs(amount))*number(w)/total for _,w in weights]
    parts=[int(x.to_integral_value(rounding=ROUND_FLOOR)) for x in raw]
    order=sorted(range(len(parts)),key=lambda i:(-(raw[i]-parts[i]),weights[i][0]))
    for i in order[:abs(amount)-sum(parts)]: parts[i]+=1
    sign=-1 if amount<0 else 1
    return [(d,p*sign) for (d,_),p in zip(weights,parts)]

def safe_path(value):
    p=Path(value).expanduser()
    if not p.is_absolute(): p=ROOT/p
    p=p.resolve()
    if not p.is_relative_to(ROOT): raise ValueError('Choose a workbook inside this project folder')
    if p.suffix.lower() not in ['.xlsx','.xlsm']:
        raise ValueError('Save the budget as .xlsx or .xlsm in Excel before importing it')
    if p==LIST.resolve(): raise ValueError('The source budget must be separate from the extracted list')
    return p

def excluded_sections(config):
    raw=config.get('excludedSections','')
    parts=raw if isinstance(raw,list) else re.split(r'[,;\s]+',str(raw).strip())
    sections=set()
    for part in parts:
        if part in ('',None):continue
        try:code=int(part)
        except (ValueError,TypeError):raise ValueError('Excluded sections must be numbers from 1 to 21')
        if not 1<=code<=21:raise ValueError('Excluded sections must be numbers from 1 to 21')
        sections.add(code)
    return sections

def budget_signature(config):
    from .workbooks import source_signature
    value=source_signature(config['budget'],config['mapping']['sheet'])
    payload=value+json.dumps(config['mapping'],sort_keys=True,ensure_ascii=False)
    excluded=sorted(excluded_sections(config))
    if excluded:payload+='|excluded:'+json.dumps(excluded)
    return hashlib.sha256(payload.encode()).hexdigest()

def extract_budget(config):
    path=safe_path(config['budget']);mapping=config['mapping']
    formulas=openpyxl.load_workbook(path,data_only=False)
    values=openpyxl.load_workbook(path,data_only=True)
    name=mapping['sheet']
    if name not in formulas.sheetnames: raise ValueError(f'Budget worksheet "{name}" is missing')
    f=formulas[name];s=values[name]
    columns={k:re.sub(r'\s','',mapping[k]).upper() for k in ['label','amount','section','description','total']}
    duration_columns={k:re.sub(r'\s','',mapping.get(k,default)).upper() for k,default in [('duration','D'),('durationUnit','E')]}
    if bool(duration_columns['duration'])!=bool(duration_columns['durationUnit']):
        raise ValueError('Set both work-length columns, or leave both blank')
    if duration_columns['duration']:columns.update(duration_columns)
    if not all(re.fullmatch('[A-Z]{1,3}',v) for v in columns.values()): raise ValueError('Column letters must contain A–Z only')
    def val(col,r): return s[f'{columns[col]}{r}'].value
    def form(col,r): return f[f'{columns[col]}{r}'].value
    grand=[r for r in range(1,f.max_row+1) if normal(val('label',r))==normal(mapping['grandLabel'])]
    if len(grand)!=1: raise ValueError('The grand-total label must match exactly one budget row')
    end=grand[0];total=val('total',end)
    if not isinstance(total,(int,float)): raise ValueError('Save/recalculate the budget in Excel: its total has no numeric calculation cache')
    from .allowances import read_allowances,allowance_diagnostic
    def allowance_label_cells(r):
        limit=openpyxl.utils.column_index_from_string(columns['total'])
        return [(s.cell(r,c).coordinate,s.cell(r,c).value) for c in range(1,limit)]
    allowance_groups,allowance_rows=read_allowances(mapping,end,val,form,allowance_label_cells)
    groups=[];section=None;group=None;covered=[]
    phase_columns=mapping.get('phaseColumns',[])
    if len({text(p.get('column')).upper() for p in phase_columns})!=len(phase_columns) or len({p.get('phase') for p in phase_columns})!=len(phase_columns):
        raise ValueError('Each phase column must map to one distinct named period')
    for r in range(1,end):
        if r in allowance_rows:
            group=None
            continue
        a,b,h=form('section',r),val('label',r),form('amount',r)
        if a and b and h is None:
            try: code=int(a)
            except (ValueError,TypeError): continue
            # Detailed cost codes can also label rows with no amount formula.
            # Only the template's two-digit category codes start a section.
            if 1<=code<=21 and len(str(a).strip())<=2:
                section={'section':code,'section_name':text(b)};group=None
        if section is None or h is None: continue
        amount=val('amount',r)
        if not isinstance(amount,(int,float)):
            raise ValueError(f'Save/recalculate the budget in Excel: {name}!{columns["amount"]}{r} has no numeric value')
        if b or group is None:
            source_description=text(val('description',r))
            unit=normal(val('durationUnit',r)) if 'durationUnit' in columns else ''
            quantity=val('duration',r) if 'duration' in columns else None
            duration=float(quantity) if isinstance(quantity,(int,float)) and quantity>0 and unit in ('month','months','months.','day','days','days.') else None
            unit='months' if unit.startswith('month') else 'days' if unit.startswith('day') else ''
            tail=re.search(r'(?:,|—|–|-)\s*(prep|preparation|shoot|shooting|wrap|post|postproduction)\s*$',source_description,re.I)
            segment={'prep':'pre','preparation':'pre','shoot':'shoot','shooting':'shoot','wrap':'wrap','post':'post','postproduction':'post'}.get(tail.group(1).lower()) if tail else None
            if '|' in source_description:
                mentioned=set(re.findall(r'\b(?:prep|preparation|shoot|shooting|wrap|post|postproduction)\b',source_description,re.I))
                if len(mentioned)>1:segment='mixed'
            group={**section,'name':text(b or val('description',r)), 'first':r,'last':r,
                   'raw_amount':Decimal('0'),'components':[],'source_rows':[],'phases':{},'kind':'cost',
                   'sourceDescription':source_description,'sourceDuration':duration,'sourceDurationUnit':unit if duration else '',
                   'sourceSegment':segment}
            if not group['name']: raise ValueError(f'Cost label missing at row {r}')
            for item in mapping.get('phaseColumns',[]):
                column=text(item.get('column')).upper();phase=item.get('phase')
                if not re.fullmatch('[A-Z]{1,3}',column) or not phase: raise ValueError('Choose a column and named period for every phase mapping')
                v=s[f'{column}{r}'].value
                if v is not None:
                    if not isinstance(v,(int,float)) or not 0<=v<=1: raise ValueError(f'Phase shares in {column}{r} must be Excel percentages (0–100%)')
                    if v: group['phases'][phase]=float(v)*100
            groups.append(group)
        group['last']=r;group['raw_amount']+=Decimal(str(amount))
        group['components'].append(normal(val('description',r)));group['source_rows'].append(r);covered.append(r)
        from .source_details import row_detail
        group.setdefault('sourceDetails',[]).append(row_detail(s,f,mapping,r))
    from .source_details import expand
    groups=expand(groups)
    groups.extend(allowance_groups)
    assert covered==[r for g in groups if g['kind']=='cost' for r in g['source_rows']],'Component rows overlap or are missing'
    omitted=[g for g in groups if g['section'] in excluded_sections(config)]
    groups=[g for g in groups if g['section'] not in excluded_sections(config)]
    raw_total=sum(g['raw_amount'] for g in groups)
    if abs(raw_total-Decimal(str(total)))>Decimal('0.005'):
        raise ValueError(f'Extracted costs do not cover the budget: difference €{float(Decimal(str(total))-raw_total):,.2f}. Check column mapping before proceeding.'+'\n'+allowance_diagnostic(mapping,end,val,form,groups,allowance_label_cells))
    residuals=[]
    for g in groups:
        raw=g.pop('raw_amount')
        g['amount']=cents(raw)
        residuals.append(raw*100-g['amount'])
    rounding=cents(total)-sum(g['amount'] for g in groups)
    if abs(rounding)>len(groups):raise ValueError('Budget line rounding cannot be reconciled to the grand total')
    order=sorted(range(len(groups)),key=lambda i:(-residuals[i],groups[i]['first'])) if rounding>0 else sorted(range(len(groups)),key=lambda i:(residuals[i],groups[i]['first']))
    for i in order[:abs(rounding)]:
        groups[i]['amount']+=1 if rounding>0 else -1
        groups[i]['roundingAdjustment']=1 if rounding>0 else -1
    for i,g in enumerate(groups):
        g['key']=normal(g['section_name'])+'|'+normal(g['name'])+'|'+g['kind']
        neighbors=[x for x in groups if x['section']==g['section']]
        pos=neighbors.index(g)
        g['context']=[normal(x['name']) for x in neighbors[max(0,pos-2):pos]]+['|']+[normal(x['name']) for x in neighbors[pos+1:pos+3]]
    cash=config['cashflowSheet']
    if cash not in values.sheetnames: raise ValueError(f'The original cashflow worksheet "{cash}" is missing')
    finance={}
    fs=values[cash];ff=formulas[cash]
    for row in range(9,18):
        for col in range(5,22):
            c=fs.cell(row,col);v=c.value
            if v is None and ff.cell(row,col).data_type=='f': raise ValueError(f'Recalculate manual financing cell {c.coordinate} in Excel')
            if v not in [None,'','-','–'] and not isinstance(v,(int,float)): raise ValueError(f'Manual financing in {c.coordinate} must be numeric')
            finance[c.coordinate]=cents(v) if isinstance(v,(int,float)) else 0
    opening=fs['E8'].value
    if opening not in [None,'','-','–'] and not isinstance(opening,(int,float)): raise ValueError('Opening cash in E8 must be numeric')
    header=fs['F7'].value if isinstance(fs['E7'].value,str) and (fs['E7'].value=='Historical' or re.fullmatch(r'\d{2}/\d{2}[-–]\d{2}/\d{2}',fs['E7'].value)) else fs['E7'].value
    if (any(finance.values()) or isinstance(opening,(int,float)) and opening!=0) and isinstance(header,(dt.datetime,dt.date)):
        if month(date(header))!=month(date(config['firstMonth'])):
            raise ValueError('The first displayed month must match the source cashflow while manual financing or opening cash is entered')
    # Hash input worksheet plus string pool; generated cashflow cells do not affect it.
    signature=budget_signature({**config,'budget':str(path)})
    return {'groups':groups,'total':cents(total),'signature':signature,'path':str(path),
            'excluded':{'sections':sorted(excluded_sections(config)),'count':len(omitted),
                        'amount':cents(sum(g['raw_amount'] for g in omitted))},
            'roundingAdjustment':rounding,
            'finance':finance,'opening':cents(opening) if isinstance(opening,(int,float)) else 0}

def match_costs(old, incoming, initial=False):
    """Unique semantic keys survive row inserts. Ambiguous duplicates are reviewed."""
    result=[];used=set();oldfamilies=collections.defaultdict(list);newfamilies=collections.defaultdict(list)
    for c in old: oldfamilies[c['key']].append(c)
    for c in incoming:newfamilies[c['key']].append(c)
    ordered={key for key,new in newfamilies.items() if len(oldfamilies[key])==len(new)
             and all(a.get('components')==b.get('components') for a,b in zip(oldfamilies[key],new))}
    for g in incoming:
        family=[c for c in oldfamilies[g['key']] if c['id'] not in used]
        match=None;shifted=False
        if g['key'] in ordered:
            match=oldfamilies[g['key']][newfamilies[g['key']].index(g)]
            shifted=(match['first'],match['last'])!=(g['first'],g['last'])
        elif len(oldfamilies[g['key']])==1 and len(newfamilies[g['key']])==1: match=family[0] if family else None
        else:
            candidates=[c for c in family if c.get('context')==g['context']]
            if len(candidates)==1 and sum(n['context']==g['context'] for n in newfamilies[g['key']])==1: match=candidates[0]
            if match is None:
                candidates=[c for c in family if (c['first'],c['last'])==(g['first'],g['last'])]
                if len(candidates)==1 and sum((n['first'],n['last'])==(g['first'],g['last']) for n in newfamilies[g['key']])==1:
                    match=candidates[0]
        if match:
            used.add(match['id']);item={**match,**copy.deepcopy(g),'removed':False,'review':match.get('review','')}
            if shifted and match.get('rule'):item['review']='Source rows moved — check saved payment arrangement'
            if match.get('rule') and match.get('components')!=g.get('components'):
                item['review']='Source description changed — check saved payment arrangement'
            if match.get('rule') and match.get('phases')!=g.get('phases'):
                item['review']='Source phase shares changed — saved payment arrangement retained'
        else:
            item={**copy.deepcopy(g),'id':uuid.uuid4().hex,'rule':None,'removed':False,
                  'review':'New cost — choose payment timing' if not oldfamilies[g['key']] else 'Ambiguous source match — review identity'}
        result.append(item)
    for c in old:
        if c['id'] not in used: result.append({**c,'removed':True,'review':'Missing from source — retained for review'})
    return result

def line(kind, value, ref, basis='calendar-days', months=0, days=0):
    return {'kind':kind,'value':value,'ref':ref,'fixed':'','basis':basis,'months':months,'days':days}
def initial_state():
    raise ValueError('Create a project from the Projects page before opening the planner.')


def refresh(state):
    incoming=extract_budget(state['config'])
    if incoming['signature']!=state['source']['signature'] or incoming['groups']!=state['source']['groups']:
        from .source_details import inherit
        old=state['costs']
        state['costs']=match_costs(old,incoming['groups'])
        inherit(state,old,incoming['groups'])
    dates={d['id']:d for d in state['dates']}
    for c in state['costs']:
        if not c.get('rule') and c.get('phases'):
            if any(p not in dates for p in c['phases']):
                c['review']='Source phase mapping refers to a missing period';continue
            rid=uuid.uuid4().hex
            state['rules'][rid]={'id':rid,'name':'Imported phase split: '+c['name'],
                'lines':[line('percent',v,p) for p,v in c['phases'].items()]}
            c['rule']=rid
    state['source']=incoming
    return state

def description(rule, dates):
    lookup={d['id']:d for d in dates};parts=[]
    if not rule:return 'Choose payment timing'
    for ln in rule['lines']:
        if ln.get('basis')=='timing-action':
            parts.append(ln.get('action',{}).get('name','Timing action'));continue
        if ln.get('basis')=='prep-shoot':
            parts.append('Preparation remainder + shooting; no wrap');continue
        if ln.get('basis')=='day-split':
            shooting='remainder' if ln.get('remainder')=='shooting' else 'timetable' if ln.get('shootingLinked',True) else str(ln.get('shootingDays','?'))
            prep=str(ln.get('prepDays','?')) if ln.get('remainder')=='shooting' else 'remainder'
            parts.append(f"Split days: preparation {prep}; shooting {shooting}; wrap {ln.get('wrapDays','?')}")
            continue
        kind=ln['kind'];value=ln.get('value',0)
        amount=(f'{value:g}%' if isinstance(value,(int,float)) else str(value)+'%') if kind=='percent' else (f'€{float(value):,.2f}' if kind=='fixed' else (f'{value:g} work units' if kind=='units' else 'Balance'))
        ref=lookup.get(ln.get('ref'));when=ref['name'] if ref else (ln.get('fixed') or 'missing date')
        if ln.get('endRef'):when+=' → '+lookup.get(ln['endRef'],{}).get('name','missing end period')
        if ln.get('basis')=='balanced-months':when+=' / '+str(ln.get('balancedMonths','?'))+' full-rate months'
        if ln.get('ref')=='hist':
            parts.append(f'{amount}: Historical / one total');continue
        if ref and ref['kind']=='period':
            window=ln.get('window','whole')
            if window=='dates':when+=' / fixed work dates '+ln.get('workStart','?')+' to '+ln.get('workEnd','?')
            elif window!='whole':when+=' / '+{'start':'first','end':'last','after':'after'}.get(window,window)+f' {ln.get("windowLength", "?")} {ln.get("windowUnit", "months")}'
            when+=' / '+{'equal-month':'equal monthly amounts','calendar-days':'calendar days','paid-days':'paid days','balanced-months':'balanced first and last months','salary-months':'monthly salary shares','weekday-estimate':'Mon–Fri estimate'}.get(ln.get('basis'),'choose allocation basis')
            if ln.get('payAt')=='work-end':when+=' / paid at work end'
        lag=[]
        if ln.get('months'):lag.append(f'{ln["months"]:+g} months')
        if ln.get('days'):lag.append(f'{ln["days"]:+g} days')
        parts.append(f'{amount}: {when}'+ (' ('+', '.join(lag)+')' if lag else ''))
    return '; '.join(parts)

def historical_label(definitions):
    ref=next((d for d in definitions if d['id']=='hist'),{})
    label=text(ref.get('label'))
    if label:return label
    if ref.get('start') and ref.get('end'):
        return date(ref['start']).strftime('%m/%y')+'-'+date(ref['end']).strftime('%m/%y')
    return 'Historical'

def balanced_shares(value):
    try: total=number(value)
    except (ValueError,TypeError):raise ValueError('Enter the number of months at the full monthly rate') from None
    if not 0<total<=120:raise ValueError('Enter a monthly length greater than zero and no more than 120')
    whole=int(total);fraction=total-whole
    return [fraction/2]+[Decimal(1)]*whole+[fraction/2] if fraction else [Decimal(1)]*whole

def work_span(ln, ref):
    """Resolve linked work dates independently of the eventual payment dates."""
    if ln.get('basis')=='balanced-months':
        shares=balanced_shares(ln.get('balancedMonths'))
        a=month(date(ref.get('start')))
        return a,month_end(add_months(a,len(shares)-1))
    if ln.get('window')=='dates':
        a,b=date(ln.get('workStart')),date(ln.get('workEnd'))
        if b<a:raise ValueError('Work end precedes its start')
        return a,b
    a,b=date(ref.get('start')),date(ref.get('end'))
    if b<a:raise ValueError('Period end precedes its start')
    window=ln.get('window','whole')
    if window!='whole':
        try: size=number(ln.get('windowLength',0))
        except (ValueError,TypeError): raise ValueError('Enter a work length, or use a salary timing shortcut') from None
        unit=ln.get('windowUnit','months')
        if unit not in ('days','months','workdays'):raise ValueError('Choose days or months for work length')
        if size<=0:raise ValueError('Enter a work length greater than zero, or use a salary timing shortcut')
        if size>1200:raise ValueError('Work length cannot exceed 1200 units')
        if unit=='days' and size!=size.to_integral_value():raise ValueError('Calendar-day lengths must be whole days')
        if unit=='workdays':
            if window not in ('start','end','after'):raise ValueError('Choose first or last part of the period')
            direction=-1 if window=='end' else 1
            cursor=b if window=='end' else b+dt.timedelta(days=1) if window=='after' else a
            remaining=size;used=[]
            while remaining>0:
                if cursor.weekday()<5:
                    used.append(cursor);remaining-=min(remaining,Decimal(1))
                cursor+=dt.timedelta(days=direction)
            return min(used),max(used)
        whole=int(size)
        extra=int(((size-whole)*30).quantize(Decimal('1'),rounding=ROUND_HALF_UP)) if unit=='months' else 0
        if unit=='months' and whole==0 and extra==0:raise ValueError('Work length must cover at least one calendar day')
        # Inclusive windows: shift the exclusive end/start anchor by calendar months,
        # then by the fractional month's days (30-day convention, half-up rounding).
        def shift(anchor,direction):
            return add_months(anchor,direction*whole)+dt.timedelta(days=direction*extra) if unit=='months' else anchor+dt.timedelta(days=direction*whole)
        if window=='start':b=shift(a,1)-dt.timedelta(days=1)
        elif window=='end':a=shift(b+dt.timedelta(days=1),-1)
        elif window=='after':
            a=b+dt.timedelta(days=1)
            b=shift(a,1)-dt.timedelta(days=1)
        else:raise ValueError('Choose where the work falls relative to the period')
    return a,b

def shooting_day_total(definitions):
    shooting=next((d for d in definitions if d['id']=='shoot'),{})
    value=shooting.get('paidDaysTotal')
    if value in ('',None):
        weights=shooting.get('weights',{})
        if not weights:raise ValueError('Enter production shooting days, or untick the timetable link and enter days for this cost')
        value=sum(number(v) for v in weights.values())
    n=number(value)
    if not 0<=n<=1200:raise ValueError('Paid shooting days must be between 0 and 1200')
    return n

def split_days_for(cost, rule, definitions):
    """Resolve a reusable day split against each cost's current budget quantity."""
    try:
        if len(rule['lines'])!=1:raise ValueError('Keep Split days as one arrangement')
        ln=rule['lines'][0]
        if cost.get('sourceDurationUnit')!='days' or not cost.get('sourceDuration'):raise ValueError('Split days needs a budget quantity in days')
        total=number(cost['sourceDuration'])
        if not 0<total<=1200:raise ValueError('Budget days must be greater than zero and no more than 1200')
        remainder=ln.get('remainder','preparation')
        if remainder not in ('preparation','shooting'):raise ValueError('Choose preparation or shooting for the remaining days')
        linked=remainder=='preparation' and ln.get('shootingLinked',True)
        if ln.get('wrapDays') in ('',None):raise ValueError('Enter wrap days (0 if none)')
        wrap=number(ln['wrapDays'])
        if wrap<0:raise ValueError('Wrap days cannot be negative')
        if remainder=='shooting':
            if ln.get('prepDays') in ('',None):raise ValueError('Enter preparation days (0 if none); shooting is the remainder')
            prep=number(ln['prepDays']);shoot=total-prep-wrap
            if prep<0:raise ValueError('Preparation days cannot be negative')
            if shoot<0:raise ValueError(f'Preparation ({prep:g}) + wrap ({wrap:g}) exceeds the {total:g} budget days by {-shoot:g}. Reduce preparation or wrap days.')
        else:
            if not linked and ln.get('shootingDays') in ('',None):raise ValueError('Enter shooting days for this cost')
            shoot=shooting_day_total(definitions) if linked else number(ln['shootingDays'])
            prep=total-shoot-wrap
            if shoot<0:raise ValueError('Shooting days cannot be negative')
            if prep<0:raise ValueError(f'Shooting ({shoot:g}) + wrap ({wrap:g}) exceeds the {total:g} budget days by {-prep:g}. Enter this cost’s own days, or use preparation days to calculate the remaining shooting days.')
        shooting=next((d for d in definitions if d['id']=='shoot'),{})
        actual=bool(linked and shooting.get('weights'))
        if actual and sum(number(v) for v in shooting['weights'].values())!=shoot:
            raise ValueError('Monthly shooting-day counts must add up to the production shooting-day total; update the shared counts or clear them to use the weekday estimate')
        expanded=[];parts=[]
        for ref,name,days,window in [('pre','Preparation',prep,'end'),('shoot','Shooting',shoot,'whole'),('post','Wrap',wrap,'start')]:
            part={'name':name,'days':float(days),'amount':0};parts.append(part)
            if not days:continue
            item=line('units',float(days),ref,'paid-days' if ref=='shoot' and actual else 'weekday-estimate')
            item.update(window=window,windowUnit='workdays',windowLength=float(days),payAt='month-end',paidDaysSource='period')
            expanded.append(item)
        outcome=payments_for(cost,{**rule,'lines':expanded},definitions)
        it=iter(outcome.get('lineAmounts',[]))
        for part in parts:
            if part['days']:part['amount']=next(it,0)
        outcome['daySplit']={'total':float(total),'linked':linked,'parts':parts,'shootingDistribution':'actual' if actual else 'estimate'}
        outcome['lineAmounts']=[cost['amount']]
        positive_parts=[p for p in parts if p['days']]
        for allocation in outcome.get('allocations',[]):allocation['name']=positive_parts[allocation['line']-1]['name']
        return outcome
    except (ValueError,KeyError,ArithmeticError) as e:
        return {'payments':[],'allocations':[],'unallocated':cost['amount'],'issues':[str(e)]}

def prep_shoot_for(cost, rule, definitions):
    """One pattern, interpreted in each source cost's own unit; never convert days to months."""
    try:
        if len(rule['lines'])!=1:raise ValueError('Keep Preparation + shooting as one arrangement')
        ln=rule['lines'][0];unit=cost.get('sourceDurationUnit');total=number(cost.get('sourceDuration'))
        if unit not in ('days','months') or not 0<total<=1200:raise ValueError('This pattern needs a budget length in days or months')
        period=next((d for d in definitions if d['id']=='shoot'),{})
        linked=ln.get('shootingLinked',True)
        if linked and unit=='days':shoot=shooting_day_total(definitions)
        elif linked:
            a,b=date(period.get('start')),date(period.get('end'))
            if b<a:raise ValueError('Shooting end precedes its start')
            shoot=sum((Decimal((min(b,month_end(m))-max(a,m)).days+1)/Decimal(calendar.monthrange(m.year,m.month)[1]) for m in months_between(a,b)),Decimal(0))
        else:
            if ln.get('shootingQuantity') in ('',None):raise ValueError('Enter this cost’s shooting length')
            shoot=number(ln['shootingQuantity'])
        prep=total-shoot
        if shoot<0:raise ValueError('Shooting length cannot be negative')
        if prep<0:raise ValueError(f'Shooting needs {shoot:.3f} {unit}, but this budget has {total:g}. Enter this cost’s own shooting length.')
        if unit=='days':
            out=split_days_for(cost,{**rule,'lines':[{**ln,'basis':'day-split','remainder':'preparation','shootingLinked':linked,'shootingDays':float(shoot),'wrapDays':0}]},definitions)
            parts=out.get('daySplit',{}).get('parts',[])[:2]
        else:
            expanded=[]
            if prep:
                pre=line('units',float(prep),'pre','salary-months');pre.update(window='end',windowUnit='months',windowLength=float(prep));expanded.append(pre)
            if shoot:expanded.append(line('units',float(shoot),'shoot','salary-months'))
            out=payments_for(cost,{**rule,'lines':expanded},definitions)
            values=iter(out.get('lineAmounts',[]));parts=[{'name':name,'days':float(n),'amount':next(values,0) if n else 0} for name,n in [('Preparation',prep),('Shooting',shoot)]]
        out['prepShoot']={'unit':unit,'total':float(total),'shooting':float(shoot),'preparation':float(prep),'linked':linked,'parts':parts}
        out['lineAmounts']=[cost['amount']]
        return out
    except (ValueError,KeyError,ArithmeticError,TypeError) as e:
        return {'payments':[],'allocations':[],'unallocated':cost['amount'],'issues':[str(e)]}

def payments_for(cost, rule, definitions):
    if rule and any(l.get('basis')=='timing-action' for l in rule.get('lines',[])):
        from .reusable_actions import calculate
        return calculate(cost,rule,definitions)
    budget=cost['amount'];issues=[]
    if rule and any(l.get('basis')=='prep-shoot' for l in rule.get('lines',[])):return prep_shoot_for(cost,rule,definitions)
    if rule and any(l.get('basis')=='day-split' for l in rule.get('lines',[])):return split_days_for(cost,rule,definitions)
    if budget==0:return {'payments':[],'lineAmounts':[0]*len(rule.get('lines',[])) if rule else [],'unallocated':0,'issues':[]}
    if not rule:return {'payments':[],'unallocated':budget,'issues':['Choose payment timing']}
    lines=rule.get('lines',[])
    if not lines:return {'payments':[],'unallocated':budget,'issues':['Add payment lines']}
    try:
        balances=[i for i,l in enumerate(lines) if l['kind']=='balance']
        if len(balances)>1:raise ValueError('Use only one remaining-balance line')
        amounts=[];percent_total=Decimal('0');fixed_total=0;units=[]
        for ln in lines:
            kind=ln['kind']
            if kind=='percent':
                share=number(ln.get('value',0))
                if not 0<=share<=100:raise ValueError('Each percentage must be between 0 and 100')
                percent_total+=share;amounts.append(int((Decimal(budget)*share/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP)))
            elif kind=='fixed':
                value=cents(ln.get('value',0))
                if value*budget<0:raise ValueError('Fixed payments must have the same sign as the budget cost')
                fixed_total+=value;amounts.append(value)
            elif kind=='balance':amounts.append(0)
            elif kind=='units':
                value=number(ln.get('value',0))
                if value<=0:raise ValueError('Work units must be greater than zero')
                units.append((len(amounts),value));amounts.append(0)
            else:raise ValueError('Choose percentage, fixed amount, or balance')
        if percent_total>100:raise ValueError('Percentages exceed 100%')
        if not balances and not units and not fixed_total and percent_total==100:
            candidates=[i for i,l in enumerate(lines) if l['kind']=='percent' and number(l.get('value',0))>0]
            amounts[candidates[-1]]+=budget-sum(amounts)
        if abs(sum(amounts))>abs(budget):raise ValueError('Payments exceed the budget amount')
        if units:
            if balances:raise ValueError('Use work units or remaining balance, not both in the same arrangement')
            for i,v in distribute(budget-sum(amounts),units):amounts[i]=v
        if balances:amounts[balances[0]]=budget-sum(amounts)
    except (ValueError,KeyError,ArithmeticError) as e:
        return {'payments':[],'unallocated':budget,'issues':[str(e)]}
    lookup={d['id']:d for d in definitions};payments=[];allocations=[]
    for index,(ln,amount) in enumerate(zip(lines,amounts),1):
        if not amount:continue
        try:
            # Historical is an aggregate bucket. Legacy date/window fields do not
            # turn already-paid costs into future scheduled payments.
            if ln.get('ref')=='hist':
                payments.append({'date':'historical','bucket':'historical','amount':amount,'line':index,'cost':cost['id']})
                continue
            if ln.get('estimateNote') and not ln.get('estimateConfirmed'):raise ValueError('Confirm or replace the estimated work length before saving')
            ref=lookup.get(ln.get('ref'))
            if ln.get('ref') and not ref:raise ValueError('Named date or period is missing')
            if ln.get('endRef'):
                end_ref=lookup.get(ln['endRef'])
                if not ref or ref.get('kind')!='period' or not end_ref or end_ref.get('kind')!='period':raise ValueError('Choose valid start and end production periods')
                ref={**ref,'end':end_ref.get('end'),'name':ref['name']+' → '+end_ref['name']}
            if ref:
                a=date(ln.get('workStart') if ref['kind']=='period' and ln.get('window')=='dates' else ref.get('start'))
                if ref['kind']=='milestone':splits=[(a,amount)]
                elif ref['kind']=='period':
                    a,b=work_span(ln,ref);window=ln.get('window','whole')
                    months=months_between(a,b);basis=ln.get('basis')
                    if basis=='balanced-months':weights=list(zip(months,balanced_shares(ln.get('balancedMonths'))))
                    elif basis=='equal-month':weights=[(m,1) for m in months]
                    elif basis=='salary-months':weights=[(m,Decimal((min(b,month_end(m))-max(a,m)).days+1)/Decimal(calendar.monthrange(m.year,m.month)[1])) for m in months]
                    elif basis=='calendar-days':weights=[(m,(min(b,month_end(m))-max(a,m)).days+1) for m in months]
                    elif basis=='weekday-estimate':
                        weights_map={m:Decimal(0) for m in months}
                        days=[a+dt.timedelta(days=i) for i in range((b-a).days+1) if (a+dt.timedelta(days=i)).weekday()<5]
                        if ln.get('windowUnit')=='workdays' and window in ('start','end','after'):
                            remaining=number(ln['windowLength'])
                            if window=='end':days.reverse()
                            for day in days:
                                part=min(Decimal(1),remaining);weights_map[month(day)]+=part;remaining-=part
                        else:
                            for day in days:weights_map[month(day)]+=1
                        weights=list(weights_map.items())
                    elif basis=='paid-days':
                        local=ln.get('paidDaysSource')=='cost'
                        raw=ln.get('paidDays',{}) if local else ref.get('weights',{})
                        if not raw:raise ValueError('Enter actual monthly paid-day totals for this period')
                        if not local and window=='after':raise ValueError('Enter paid days for this cost after the named period')
                        valid=months if local else months_between(date(ref.get('start')),date(ref.get('end')))
                        if any(k not in [m.strftime('%Y-%m') for m in valid] for k in raw):raise ValueError('Paid-day totals fall outside the selected work span or production period; update the entered monthly totals')
                        if local and any(m.strftime('%Y-%m') not in raw for m in months):raise ValueError('Enter paid days for every work month, including zero days')
                        if not local and window!='whole' and ((a!=date(ref.get('start')) and a.day!=1) or (b!=date(ref.get('end')) and b!=month_end(b))):raise ValueError('A partial month needs paid days for this cost; full-period totals cannot identify its days')
                        weights=[(m,number(raw.get(m.strftime('%Y-%m'),0))) for m in months]
                        if any(w<0 for _,w in weights):raise ValueError('Paid-day totals cannot be negative')
                    else:raise ValueError('Choose monthly salary, equal-month, calendar-day, or paid-day allocation')
                    if rule.get('salary') and basis=='paid-days' and cost.get('sourceDurationUnit')=='days' and cost.get('sourceDuration') and len(lines)==1:
                        expected=number(cost['sourceDuration']);entered=sum(w for _,w in weights)
                        if abs(entered-expected)>Decimal('0.000001'):
                            raise ValueError(f"Budget has {expected.normalize()} paid days; entered {entered.normalize()}. Adjust the days to retain the budget rate and total.")
                    work=distribute(amount,weights)
                    pay_at=ln.get('payAt','month-end')
                    if pay_at not in ('month-end','work-end'):raise ValueError('Choose month-end payments or payment at work end')
                    work_rows=[]
                    for (m,v),(_,weight) in zip(work,weights):
                        paid=delay(b if pay_at=='work-end' else month_end(m),ln,pay_at=='month-end')
                        work_rows.append({'month':m.strftime('%Y-%m'),'weight':float(weight),'amount':v,'paymentDate':paid.isoformat()})
                    allocations.append({'line':index,'name':ref['name'],'start':a.isoformat(),'end':b.isoformat(),'basis':basis,'paidDaysSource':ln.get('paidDaysSource','period'),'payAt':pay_at,'months':ln.get('months',0),'days':ln.get('days',0),'rows':work_rows})
                    splits=[(b,amount)] if pay_at=='work-end' else [(month_end(m),v) for m,v in work]
                else:raise ValueError('Choose milestone or period')
            else:splits=[(date(ln.get('fixed')),amount)]
            payments.extend({'date':delay(d,ln, bool(ref and ref['kind']=='period' and ln.get('payAt','month-end')=='month-end')).isoformat(),'amount':v,'line':index,'cost':cost['id']} for d,v in splits if v)
        except (ValueError,KeyError,ArithmeticError,OverflowError) as e:
            issues.append(f'Payment {index}: {e}')
    unallocated=budget-sum(p['amount'] for p in payments)
    if unallocated and not issues:issues.append(f'€{abs(unallocated)/100:,.2f} still unallocated')
    return {'payments':payments,'allocations':allocations,'lineAmounts':amounts,'unallocated':unallocated,'issues':issues}

def evaluate(state):
    start=month(date(state['config']['firstMonth']));months=[add_months(start,i).strftime('%Y-%m') for i in range(MONTHS)]
    historical=any((l.get('ref')=='hist' or (l.get('basis')=='timing-action' and l.get('action',{}).get('type')=='months' and any(p.get('month')=='historical' for p in l['action'].get('paymentMonths',[])))) for c in state['costs'] if not c.get('removed') for l in state['rules'].get(c.get('rule'),{}).get('lines',[])) or any(d.get('label') for d in state['dates'] if d['id']=='hist')
    if historical:months=['historical']+months[:-1]
    categories={str(i):[0]*MONTHS for i in range(1,24)};views=[];all_payments=[];unallocated=outside=total=0
    for cost in state['costs']:
        rule=state['rules'].get(cost.get('rule'));desc=description(rule,state['dates'])
        if cost.get('removed'):
            views.append({**cost,'description':desc,'issues':[cost['review']],'payments':[],'unallocated':0,'outside':0});continue
        outcome=payments_for(cost,rule,state['dates']);out=0;total+=cost['amount'];unallocated+=outcome['unallocated']
        for p in outcome['payments']:
            key=p.get('bucket') or p['date'][:7]
            if key in months:categories[str(cost['section'])][months.index(key)]+=p['amount']
            else:out+=p['amount'];outside+=p['amount']
            all_payments.append({**p,'category':cost['section'],'name':cost['name']})
        issues=outcome['issues'][:]
        if cost.get('review'):issues.append(cost['review'])
        if out:issues.append(f'€{abs(out)/100:,.2f} outside displayed months')
        views.append({**cost,**outcome,'allocationIssues':outcome['issues'][:],'salary':bool(cost.get('salary',rule and rule.get('salary'))),'outside':out,'issues':issues,'description':desc})
    allocated=sum(sum(v) for v in categories.values())
    assert total==allocated+outside+unallocated,'Allocation does not reconcile'
    return {'costs':views,'months':months,'historicalLabel':historical_label(state['dates']),'categories':categories,'payments':all_payments,
            'total':total,'sourceTotal':state['source']['total'],'coverage':state['source']['total']-total,
            'allocated':allocated,'outside':outside,'unallocated':unallocated}
