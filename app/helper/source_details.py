"""Independent source fees and their original calculation inputs."""
import copy,re,uuid
from decimal import Decimal

FRINGE=re.compile(r'palkansivukul|sivukul|lomakorv|lomapalk|sosiaalikul|tyel|fringe|social[ -]?cost|holiday[ -]?(?:pay|allowance)|employer.*(?:contribution|cost)',re.I)

def duration(quantity,unit):
    u=str(unit or '').strip().lower().rstrip('.')
    normalized='months' if u in ('kk','kuukausi','kuukautta','month','months','mth','mths') else 'days' if u in ('pv','pvä','päivä','päivää','day','days') else ''
    return (float(quantity),normalized) if isinstance(quantity,(int,float)) and quantity>0 and normalized else (None,'')

def row_detail(sheet,formulas,mapping,row):
    # The bundled fictional example labels F as Rate; standard FFF uses G.
    # Honour explicit mapping, otherwise recognise a clear rate header.
    mapping=dict(mapping)
    if 'rate' not in mapping:
        headers=lambda col:{str(sheet[f'{col}{r}'].value or '').strip().casefold() for r in range(1,min(sheet.max_row+1,26))}
        rate_headers={'rate','unit rate','unit price','yksikköhinta','a-hinta','à-hinta'}
        mapping['rate']='F' if headers('F')&rate_headers and not headers('G')&rate_headers else 'G'
    if 'multiplier' not in mapping:mapping['multiplier']='' if mapping['rate']=='F' else 'F'
    def get(key,default=''):
        col=str(mapping.get(key,default) or '').strip().upper()
        if not col:return None
        if not re.fullmatch('[A-Z]{1,3}',col):raise ValueError('Use a column letter for '+key+', or leave it blank')
        return sheet[f'{col}{row}'].value
    from .engine import text
    detail={'row':row,'description':text(get('description')),'quantity':get('duration','D'),'unit':text(get('durationUnit','E')),
            'multiplier':get('multiplier','F'),'rate':get('rate','G'),'amount':get('amount'),
            'amountCell':mapping['amount'].strip().upper()+str(row),
            'amountFormula':formulas[mapping['amount'].strip().upper()+str(row)].value if formulas[mapping['amount'].strip().upper()+str(row)].data_type=='f' else '',
            'rateColumn':mapping['rate'],'multiplierColumn':mapping['multiplier']}
    for key in ('quantity','multiplier','rate'):
        if not isinstance(detail[key],(int,float,str)):detail[key]=None
    detail['phases']={}
    for part in mapping.get('phaseColumns',[]):
        col=text(part.get('column')).upper();v=sheet[f'{col}{row}'].value
        if v is not None:
            if not isinstance(v,(int,float)) or not 0<=v<=1:raise ValueError(f'Phase shares in {col}{row} must be Excel percentages (0–100%)')
            if v:detail['phases'][part['phase']]=float(v)*100
    return detail

def row_chunks(rows):
    """Attach supplements to their base, but retain ambiguous shared charges."""
    chunks=[]
    for row in rows:
        supplement=bool(FRINGE.search(row['description'])) or row['unit'].strip()=='%'
        if not supplement or not chunks:
            chunks.append([row]);continue
        if len(chunks)>1 and Decimal(str(row['amount']))!=0:
            formula=row.get('amountFormula','')
            refs={int(n) for n in re.findall(r'\$?[A-Z]{1,3}\$?(\d+)',formula)}
            for a,b in re.findall(r'\$?[A-Z]{1,3}\$?(\d+):\$?[A-Z]{1,3}\$?(\d+)',formula):
                refs.update(range(int(a),int(b)+1))
            current={r['row'] for r in chunks[-1]}
            earlier={r['row'] for chunk in chunks[:-1] for r in chunk}
            if not refs.intersection(current) or refs.intersection(earlier) or '!' in formula:
                return [rows],'Rows stay together because a nonzero supplement may cover several fees. Its allocation needs checking.'
        chunks[-1].append(row)
    return chunks,''

def expand(groups):
    from .engine import normal
    from .salary_notes import combine
    groups=combine(groups)
    result=[]
    for group in groups:
        rows=group.get('sourceDetails',[])
        # This is a targeted exception for the producer-fee heading shown by
        # the user, not a general instruction to split other budget groups.
        producer_fee=group.get('section')==5 and normal(group['name'])=='tuottajan korvaus'
        chunks,reason=row_chunks(rows) if producer_fee else ([rows],'')
        salary=any(FRINGE.search(r['description']) and Decimal(str(r['amount']))!=0 for r in rows)
        if len(chunks)<2:
            group['groupedSalaryCosts']=bool(salary)
            group['groupingReason']=reason or ('Salary and related employer costs stay together.' if salary else '')
            if rows:group['sourceDuration'],group['sourceDurationUnit']=duration(rows[0]['quantity'],rows[0]['unit'])
            result.append(group);continue
        key=normal(group['section_name'])+'|'+normal(group['name'])+'|'+group['kind']
        for chunk in chunks:
            row=chunk[0]
            g=copy.deepcopy(group);desc=row['description']
            g.update(name=group['name']+' — '+(desc or 'row '+str(row['row'])),sourceHeading=group['name'],
                     sourceGroupKey=key,sourceGroupComponents=group['components'],
                     first=row['row'],last=chunk[-1]['row'],source_rows=[r['row'] for r in chunk],components=[normal(r['description']) for r in chunk],
                     sourceDetails=chunk,sourceDescription=desc,raw_amount=sum((Decimal(str(r['amount'])) for r in chunk),Decimal(0)),
                     phases=row['phases'] or copy.deepcopy(group['phases']),
                     groupedSalaryCosts=any(FRINGE.search(r['description']) and Decimal(str(r['amount']))!=0 for r in chunk),
                     groupingReason='This fee can be timed independently. Any following related supplements remain attached.')
            g['sourceDuration'],g['sourceDurationUnit']=duration(row['quantity'],row['unit'])
            g['sourceSegment']=None
            tail=re.search(r'(?:,|—|–|-)\s*(prep|preparation|shoot|shooting|wrap|post|postproduction)\s*$',desc,re.I)
            if tail:g['sourceSegment']={'prep':'pre','preparation':'pre','shoot':'shoot','shooting':'shoot','wrap':'wrap','post':'post','postproduction':'post'}[tail[1].lower()]
            result.append(g)
    return result

def split_parents(old,incoming):
    """Require an unambiguous whole group; never guess across budget revisions."""
    grouped={}
    for g in incoming:
        if g.get('sourceGroupKey'):grouped.setdefault(g['sourceGroupKey'],[]).append(g)
    result=[]
    for key,children in grouped.items():
        parents=[c for c in old if not c.get('removed') and c['key']==key]
        if len(parents)!=1:continue
        parent=parents[0]
        if len(children)>1 and parent.get('components')==[component for g in children for component in g['components']]:result.append((parent,children))
    return result

def inherit(state,old,incoming):
    """Copy rules independently, distributing fixed euros instead of duplicating them.

    Called only as part of a refresh candidate, reviewed before it can be saved.
    Original rules and removed parent records remain available for recovery.
    """
    from . import engine
    from . import salary_notes
    salary_notes.inherit(state,old,incoming)
    for parent,groups in split_parents(old,incoming):
        children=[next(c for c in state['costs'] if not c.get('removed') and c['key']==g['key'] and c['source_rows']==g['source_rows']) for g in groups]
        rule=state['rules'].get(parent.get('rule'))
        weights=[(i,abs(c['amount'])) for i,c in enumerate(children)]
        copies=[copy.deepcopy(rule) for _ in children] if rule else []
        if rule and sum(w for _,w in weights):
            for index,line in enumerate(rule['lines']):
                if line.get('kind')=='fixed':
                    for i,value in engine.distribute(engine.cents(line['value']),weights):copies[i]['lines'][index]['value']=value/100
                action=line.get('action',{})
                if action.get('splitBy')=='amount':
                    for j,part in enumerate(action.get('parts',[])):
                        if part.get('moneyKind')=='remainder':continue
                        value=engine.number(str(part.get('amount','')).replace(',','.'))
                        for i,value in engine.distribute(engine.cents(value),weights):copies[i]['lines'][index]['action']['parts'][j]['amount']=value/100
        elif rule:
            copies=[] # No proportional split can be inferred from all-zero fees.
        for i,c in enumerate(children):
            c.update(splitFrom=parent['id'],splitFromName=parent['name'],review='' if copies else 'New cost — choose payment timing',
                     sourceSplitNote='Started from the previous grouped timing; this fee can now be changed independently.' if copies else 'Separated from the previous group; choose payment timing for this fee.')
            if copies:
                rid=uuid.uuid4().hex;r=copies[i];r.update(id=rid,name=rule['name']+' · '+c['name'])
                state['rules'][rid]=r;c['rule']=rid
                if 'salary' in parent:c['salary']=parent['salary']
        original=next(c for c in state['costs'] if c['id']==parent['id'])
        original.update(removed=True,archived=True,review='Separated into independently timed source rows; previous arrangement retained here')

def report(before,after):
    from . import engine
    oldids={c['id'] for c in before['costs']};groups={}
    if not any(c.get('splitFrom') and c['id'] not in oldids for c in after['costs']):return []
    model=engine.evaluate(after)
    for cost in model['costs']:
        if cost.get('splitFrom') and cost['id'] not in oldids:groups.setdefault(cost['splitFrom'],[]).append(cost)
    return [{'parent':next(c for c in before['costs'] if c['id']==key),'children':children} for key,children in groups.items()]
