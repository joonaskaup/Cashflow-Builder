"""Parenthetical title notes on salary-supplement rows are not new jobs."""
import copy,re,uuid
from collections import defaultdict
from decimal import Decimal

def combine(groups):
    from .source_details import FRINGE
    result=[]
    for group in groups:
        rows=group.get('sourceDetails',[])
        previous=result[-1] if result else None
        if (previous and previous['section']==group['section']
            and previous['last']+1==group['first']
            and re.fullmatch(r'\([^\n]+\)',group['name'].strip())
            and rows and all(FRINGE.search(r['description']) for r in rows)
            and previous.get('sourceDetails')
            and not FRINGE.search(previous['sourceDetails'][0]['description'])):
            previous.setdefault('sourceNotes',[]).append(group['name'])
            previous.setdefault('sourceContinuations',[]).append({'name':group['name'],'rows':group['source_rows'][:]})
            for key in ('sourceDetails','source_rows','components'):previous[key].extend(group[key])
            previous['last']=group['last'];previous['raw_amount']+=group['raw_amount']
        else:result.append(group)
    return result

def clean(value):
    # Display names/identifiers do not alter a payment schedule.
    if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ('id','name')}
    if isinstance(value,list):return [clean(v) for v in value]
    return value

def proportional(rule):
    return rule and all(line.get('kind') in ('percent','balance') and
        (line.get('basis','calendar-days') in ('calendar-days','equal-month') or
         line.get('basis')=='timing-action' and line.get('action',{}).get('type') in ('months','historical'))
        for line in rule.get('lines',[]))

def payment_totals(costs,rules,dates):
    from . import engine
    totals=defaultdict(int);unallocated=0
    for cost in costs:
        outcome=engine.payments_for(cost,rules.get(cost.get('rule')),dates)
        if outcome['issues'] and rules.get(cost.get('rule')):return None
        unallocated+=outcome['unallocated']
        for p in outcome['payments']:totals[(p.get('bucket',''),p['date'])]+=p['amount']
    return dict(totals),unallocated

def retain_payments(state,target,totals):
    """Use ordinary fixed installments when separate saved rules cannot be reused.

    Only invoked in the explicit grouping preview. Keep original rules intact,
    and compare exact dates/buckets/cents again before allowing the merge.
    """
    from . import engine
    if totals is None or totals[1]:
        raise ValueError(target['name']+': one of the existing rows still needs payment timing. Nothing was changed. Finish or clear the timing on both rows, then refresh again.')
    lines=[]
    for (bucket,date),amount in sorted(totals[0].items()):
        if not amount:continue
        ln=engine.line('fixed',str(Decimal(amount)/100),'hist' if bucket=='historical' else '')
        if bucket!='historical':ln['fixed']=date
        lines.append(ln)
    rid=uuid.uuid4().hex
    state['rules'][rid]={'id':rid,'name':target['name']+' · retained payments','lines':lines}
    target['rule']=rid
    target['sourceMergeFixedPayments']=True
    if payment_totals([target],state['rules'],state['dates'])!=totals:
        raise ValueError(target['name']+': existing payment amounts could not be retained exactly. No grouping change was saved.')
    return 'Existing payments retained as fixed euro installments on their saved dates. These payments no longer follow production timetable changes or budget increases automatically. You can edit the combined cost after applying. Original timing rules are kept for reference.'

def inherit(state,old,incoming):
    from . import engine
    for group in incoming:
        if not group.get('sourceContinuations'):continue
        wanted=group['source_rows']
        parents=sorted([c for c in old if not c.get('removed') and c['section']==group['section']
                        and c.get('source_rows') and set(c['source_rows']).issubset(wanted)],key=lambda c:c['first'])
        if len(parents)<2:continue
        if [r for c in parents for r in c['source_rows']]!=wanted:
            raise ValueError(group['name']+': source-row identities overlap. No grouping change was saved.')
        if [v for c in parents for v in c['components']]!=group['components'] or sum(c['amount'] for c in parents)!=group['amount']:
            raise ValueError(group['name']+': budget rows also changed. Keep the previous extraction until the salary grouping can be checked.')
        target=next(c for c in state['costs'] if not c.get('removed') and c['key']==group['key'] and c['source_rows']==wanted)
        rules=[state['rules'].get(c.get('rule')) for c in parents]
        compatible=all(r is None for r in rules) or (all(proportional(r) for r in rules) and all(clean(r['lines'])==clean(rules[0]['lines']) for r in rules))
        target['rule']=parents[0].get('rule')
        totals=payment_totals(parents,state['rules'],state['dates'])
        note='Salary and related costs reunited; existing payments retained.'
        if not compatible or totals is None or totals!=payment_totals([target],state['rules'],state['dates']):
            note=retain_payments(state,target,totals)
        target.update(sourceMergedFrom=[c['id'] for c in parents],sourceBeforeMerge=copy.deepcopy(parents),
                      sourceMergeNote=note,review=parents[0].get('review',''))
        for parent in parents:
            if parent['id']!=target['id']:
                previous=next(c for c in state['costs'] if c['id']==parent['id'])
                previous.update(removed=True,archived=True,review='Reunited with '+target['name']+'; previous timing retained for reference')

def report(before,after):
    from . import engine
    old={c['id']:c for c in before['costs']}
    changed=[c for c in after['costs'] if not c.get('removed') and c.get('sourceMergedFrom') and
             c.get('sourceMergedFrom')!=old.get(c['id'],{}).get('sourceMergedFrom')]
    if not changed:return []
    model={c['id']:c for c in engine.evaluate(after)['costs']}
    return [{'parents':[old[i] for i in c['sourceMergedFrom']], 'cost':model[c['id']]} for c in changed]
