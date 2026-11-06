"""Reusable instructions resolve against the current cost, never a selection group."""
import copy
from decimal import Decimal


def calculate(cost, rule, definitions):
    from . import engine as e
    try:
        if len(rule['lines']) != 1: raise ValueError('Keep a timing action as one arrangement')
        action = rule['lines'][0]['action']
        mode = action.get('type', 'period')
        if mode=='months':
            return calculate_months(cost,rule,definitions)
        if mode=='split' and action.get('splitBy','quantity') in ('percent','amount'):
            return calculate_money(cost,rule,definitions)
        unit = cost.get('sourceDurationUnit')
        total = e.number(cost.get('sourceDuration') or 0)
        dates = {d['id']: d for d in definitions}
        parts = []
        expanded = []
        notes = []
        def add(name, ref, quantity, window='whole', basis=None, end_ref=None):
            if quantity == 0: return
            basis = basis or ('salary-months' if unit == 'months' else 'weekday-estimate' if unit == 'days' else 'calendar-days')
            ln = e.line('units', float(quantity), ref, basis)
            ln.update(window=window, payAt='month-end')
            if end_ref: ln['endRef'] = end_ref
            if window != 'whole':
                ln.update(windowLength=float(quantity), windowUnit='months' if unit == 'months' else 'workdays')
            expanded.append(ln)
            parts.append({'name':name,'quantity':float(quantity),'ref':ref,'placement':window})
        if mode == 'historical':
            expanded=[e.line('balance',0,'hist')]
            parts=[{'name':'Historical','quantity':None,'ref':'hist','placement':'whole'}]
        elif mode == 'span':
            basis=action.get('basis','equal-month')
            ln=e.line('balance',0,action.get('ref','pre'),basis)
            if basis=='balanced-months':
                n=action.get('length') or (total if unit=='months' else '')
                ln['balancedMonths']=float(e.number(str(n).replace(',','.')));notes.append('Payment shares: balanced first and last months; no daily work dates inferred.')
            else:ln['endRef']=action.get('endRef','post')
            expanded=[ln];parts=[{'name':'Across periods','quantity':None,'ref':ln['ref'],'placement':'whole'}]
        elif mode == 'period':
            window=action.get('window','whole')
            if window!='whole' and (unit not in ('days','months') or total<=0):raise ValueError('Start/end placement needs a budget quantity in days or months. Use the whole period or enter detailed dates.')
            ref=action.get('ref','shoot')
            add(dates.get(ref,{}).get('name',ref),ref,total if total>0 else 1,window,action.get('basis') or None)
            if total<=0 or unit not in ('days','months'):parts[0]['quantity']=None
        elif mode == 'split':
            if unit not in ('days','months') or total<=0:raise ValueError('This cost has no recognised budget days or months. Choose Split by → Percentages or Euros.')
            rows=action.get('parts',[])
            if not rows or len(rows)>12:raise ValueError('Add between 1 and 12 work parts')
            remaining=[i for i,p in enumerate(rows) if p.get('quantity')=='remainder']
            if len(remaining)!=1:raise ValueError('Choose exactly one part for the remaining budget quantity')
            values=[]
            for p in rows:
                kind=p.get('quantity');ref=p.get('ref')
                if kind=='remainder':n=Decimal(0)
                elif kind=='fixed':
                    raw=p.get(unit)
                    if raw in ('',None):raise ValueError(f'Enter {unit} for {p.get("name",ref)}; each budget unit has its own input')
                    n=e.number(str(raw).replace(',','.'))
                elif kind=='timetable':
                    period=dates.get(ref,{})
                    if unit=='days':
                        if ref=='shoot':n=e.shooting_day_total(definitions)
                        elif period.get('weights'):n=sum(e.number(v) for v in period['weights'].values())
                        else:raise ValueError(f'{p.get("name",ref)} has no shared paid-day count; enter a quantity instead')
                    else:
                        a,b=e.date(period.get('start')),e.date(period.get('end'))
                        n=sum((Decimal((min(b,e.month_end(m))-max(a,m)).days+1)/Decimal(e.calendar.monthrange(m.year,m.month)[1]) for m in e.months_between(a,b)),Decimal(0))
                        notes.append('Timetable months use full calendar months plus the fraction of each boundary month; days are not converted to months.')
                else:raise ValueError('Choose a quantity for every part')
                if n<0:raise ValueError('Work quantities cannot be negative')
                values.append(n)
            rest=total-sum(values)
            if rest<0:raise ValueError(f'This action needs {sum(values):g} {unit}; this cost has {total:g}. Reduce a quantity or assign a different action.')
            values[remaining[0]]=rest
            for p,n in zip(rows,values):
                ref=p['ref'];basis=None
                if unit=='days' and p.get('quantity')=='timetable' and p.get('window','whole')=='whole' and dates.get(ref,{}).get('weights'):
                    if sum(e.number(v) for v in dates[ref]['weights'].values())!=n:raise ValueError('Monthly paid days must match the shared total')
                    basis='paid-days'
                add(p.get('name') or dates.get(ref,{}).get('name',ref),ref,n,p.get('window','whole'),basis)
        else:raise ValueError('Choose a supported timing action')
        out=e.payments_for(cost,{**rule,'lines':expanded},definitions)
        for i,p in enumerate(parts):
            p['amount']=out.get('lineAmounts',[0]*len(parts))[i]
            allocation=next((a for a in out.get('allocations',[]) if a['line']==i+1),None)
            if allocation:
                allocation['name']=p['name'];p.update(start=allocation['start'],end=allocation['end'])
                d=dates.get(p['ref'],{})
                if d.get('start') and p['start']<d['start']:notes.append(p['name']+' starts before the production period: '+p['start']+'. Review this estimate.')
                if d.get('end') and p['end']>d['end']:notes.append(p['name']+' ends after the production period: '+p['end']+'. Review this estimate.')
        bases={l.get('basis') for l in expanded}
        if 'weekday-estimate' in bases:notes.append('Days are estimated over Mon–Fri, without public holidays. Whole-period work is spread across that period; individual work dates are unknown.')
        if 'salary-months' in bases:notes.append('Monthly work uses calendar-month shares. Anchored fractional durations use whole months plus the fraction × 30 days.')
        if 'calendar-days' in bases:notes.append('Calendar-day estimate: each month receives its share of the work period.')
        if 'equal-month' in bases:notes.append('Equal payments in every covered month, including partial boundary months.')
        out['actionResult']={'name':action.get('name','Timing action'),'unit':unit,'total':float(total),'parts':parts,'notes':list(dict.fromkeys(notes)),'resolvedLines':expanded}
        out['lineAmounts']=[cost['amount']]
        return out
    except (ValueError,KeyError,TypeError,ArithmeticError) as ex:
        return {'payments':[],'allocations':[],'unallocated':cost['amount'],'issues':[str(ex)]}


def defaults():
    def part(name,ref,quantity,window,days='',months=''):
        return dict(name=name,ref=ref,quantity=quantity,window=window,days=days,months=months)
    prep=part('Preparation','pre','remainder','end')
    shoot=part('Shooting','shoot','timetable','whole')
    return [
        dict(id='end-prep',name='End of preparation',type='period',ref='pre',window='end'),
        dict(id='during-shoot',name='During shooting',type='period',ref='shoot',window='whole'),
        dict(id='prep-shoot',name='Preparation + shooting',type='split',parts=[prep,shoot]),
        dict(id='crew-wrap',name='Preparation + shooting + wrap',type='split',parts=[prep,shoot,part('Wrap','post','fixed','start','','')]),
        dict(id='wrap',name='Wrap',type='period',ref='post',window='start'),
        dict(id='production',name='Across production',type='span',ref='pre',endRef='post',basis='equal-month'),
        dict(id='historical',name='Historical',type='historical'),
    ]


def library_path():
    from . import engine
    return engine.ROOT/'outputs/timing-actions.json'


def read_library():
    import json
    p=library_path()
    return json.loads(p.read_text()) if p.exists() else {'version':0,'actions':defaults()}


def save_library(body):
    import json, os, shutil, datetime
    current=read_library()
    if body.get('version')!=current['version']:raise ValueError('Timing actions changed in another window. Reopen the action library before saving.')
    items=body.get('actions')
    if not isinstance(items,list) or len(items)>100:raise ValueError('Keep up to 100 timing actions')
    ids=set()
    for a in items:
        if not a.get('id') or a['id'] in ids or not str(a.get('name','')).strip():raise ValueError('Each action needs its own identity and a name')
        if a.get('type') not in ('period','span','split','historical','months'):raise ValueError('Choose an action type')
        if a.get('type')=='split':
            key='quantity' if a.get('splitBy','quantity')=='quantity' else 'moneyKind'
            count=sum(p.get(key)=='remainder' for p in a.get('parts',[]))
            if count>1 or key=='quantity' and count!=1:raise ValueError('Choose one remaining-quantity part, or enter a complete percentage/euro split')
        ids.add(a['id'])
    value={'version':current['version']+1,'actions':items}
    p=library_path();p.parent.mkdir(parents=True,exist_ok=True)
    if p.exists():
        backup=p.parent/'timing-action-backups';backup.mkdir(exist_ok=True)
        shutil.copy2(p,backup/(datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.json'))
    temp=p.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2));os.replace(temp,p)
    return value


def calculate_money(cost, rule, definitions):
    """Split budget money independently of work duration; retain exact cents."""
    from . import engine as e
    try:
        a=rule['lines'][0]['action'];basis=a['splitBy'];rows=a.get('parts',[])
        if not rows or len(rows)>12:raise ValueError('Add between 1 and 12 payment parts')
        remaining=[i for i,p in enumerate(rows) if p.get('moneyKind')=='remainder']
        if len(remaining)>1:raise ValueError('Only one part can receive the remaining amount')
        budget=cost['amount'];limit=Decimal(100) if basis=='percent' else Decimal(abs(budget))/100
        values=[]
        for p in rows:
            if p.get('moneyKind','fixed')=='remainder':v=Decimal(0)
            else:
                raw=p.get(basis)
                label=p.get('name') or 'This part'
                text='' if raw is None else str(raw).strip()
                if basis=='percent' and text.endswith('%'):text=text[:-1].strip()
                example='5 or 5%' if basis=='percent' else '4400 or 4400,50'
                try:v=e.number(text.replace(',','.'))
                except (ValueError,ArithmeticError):
                    raise ValueError(f'{label}: enter '+('a percentage' if basis=='percent' else 'euros')+f' (for example {example}).') from None
                if v<0:raise ValueError(f'{label}: enter a positive share or amount (0 for none).')
                if basis=='amount':v=Decimal(e.cents(v))/100
            values.append(v)
        rest=limit-sum(values)
        suffix='%' if basis=='percent' else ' euros'
        if rest<0:raise ValueError(f'The split exceeds the budget by {-rest:g}{suffix}. Reduce a value.')
        if remaining:values[remaining[0]]=rest
        elif rest:raise ValueError(f'{rest:g}{suffix} remains. Enter the rest or choose Remaining for one part.')
        if basis=='percent':amounts=[v for _,v in e.distribute(budget,list(enumerate(values)))]
        else:amounts=[e.cents(v)*(-1 if budget<0 else 1) for v in values]
        dates={d['id']:d for d in definitions};expanded=[];parts=[]
        for p,v,amount in zip(rows,values,amounts):
            ref=p.get('ref');name=p.get('name') or dates.get(ref,{}).get('name',ref)
            ln=e.line('fixed',amount/100,ref,'calendar-days');placement=p.get('moneyPlacement','whole')
            if placement not in ('whole','start','end'):raise ValueError('Choose when each part is paid')
            if amount and placement!='whole':
                period=dates.get(ref,{})
                point=e.date(period.get('start' if placement=='start' else 'end')).isoformat()
                ln.update(window='dates',workStart=point,workEnd=point,payAt='work-end')
            expanded.append(ln)
            parts.append(dict(name=name,ref=ref,quantity=float(v),amount=amount,placement=placement,remainder=bool(p.get('moneyKind')=='remainder')))
        out=e.payments_for(cost,{**rule,'lines':expanded},definitions)
        for i,p in enumerate(parts):
            allocation=next((x for x in out.get('allocations',[]) if x['line']==i+1),None)
            if allocation:allocation['name']=p['name'];p.update(start=allocation['start'],end=allocation['end'])
            elif dates.get(p['ref'],{}).get('kind')=='milestone':p.update(start=dates[p['ref']].get('start',''),end=dates[p['ref']].get('start',''))
        notes=['Shares divide the budget amount, not work days or months. During-period payments use proportional calendar days at month end. Start/end payments follow the selected period boundary.']
        if basis=='amount':notes.append('Euro entries stay fixed when reused; each cost’s remaining part receives its own balance.')
        out['actionResult']=dict(name=a.get('name','Timing action'),splitBy=basis,unit='%' if basis=='percent' else '€',total=float(limit),parts=parts,notes=notes,resolvedLines=expanded)
        out['lineAmounts']=[budget]
        return out
    except (ValueError,KeyError,TypeError,ArithmeticError) as ex:
        return dict(payments=[],allocations=[],unallocated=cost['amount'],issues=[str(ex)])


def calculate_months(cost, rule, definitions):
    """Fixed payment months divide the whole budget, independently of production."""
    from . import engine as e
    import re
    try:
        action=rule['lines'][0]['action'];rows=action.get('paymentMonths',[])
        if not rows:raise ValueError('Choose at least one payment month')
        if len(rows)>120:raise ValueError('Choose up to 120 payment months')
        rows=sorted(rows,key=lambda p:(p['month']!='historical',p['month']))
        seen=set();weights=[]
        for p in rows:
            m=p['month']
            if m!='historical' and not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',m):raise ValueError('Choose a valid payment month')
            if m in seen:raise ValueError('Each payment month can appear only once')
            seen.add(m)
            if m!='historical':e.date(m+'-01')
            try:v=e.number(str(p.get('percent','')).strip().removesuffix('%').strip().replace(',','.'))
            except (ValueError,ArithmeticError):raise ValueError(m+': enter a percentage from 0 to 100') from None
            if not 0<=v<=100:raise ValueError(m+': enter a percentage from 0 to 100')
            weights.append((m,v))
        if sum(v for _,v in weights)!=100:raise ValueError('Payment month percentages must total 100%. Edit a share or use Split equally.')
        amounts=e.distribute(cost['amount'],[(m,1) for m,_ in weights] if action.get('monthEqual') else weights)
        expanded=[];parts=[]
        for (m,amount),(_,share) in zip(amounts,weights):
            historical=m=='historical'
            point='historical' if historical else e.month_end(e.date(m+'-01')).isoformat()
            ln=e.line('fixed',amount/100,'hist' if historical else '')
            if not historical:ln['fixed']=point
            expanded.append(ln)
            parts.append(dict(name='Historical' if historical else m[5:]+'/'+m[2:4],ref='hist' if historical else '',quantity=float(share),amount=amount,start=point,end=point))
        out=e.payments_for(cost,{**rule,'lines':expanded},definitions)
        out['actionResult']=dict(name=action.get('name','Payment months'),splitBy='percent',unit='%',total=100,parts=parts,
            notes=['Historical is one already-paid total. Selected months are paid at month end. Production date changes do not move these payments. Percentages follow each cost’s full budget.'],
            resolvedLines=expanded)
        out['lineAmounts']=[cost['amount']]
        return out
    except (ValueError,KeyError,TypeError,ArithmeticError) as ex:
        return dict(payments=[],allocations=[],unallocated=cost['amount'],issues=[str(ex)])
