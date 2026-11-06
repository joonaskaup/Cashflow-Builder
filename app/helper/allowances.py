"""Repeated FFF allowance rows. The primary label remains the default authority."""
import re

def label_kind(value, mapping):
    from .engine import normal
    value=normal(value)
    matches=[]
    for key,kind,stem in [('adminLabel','administration','hallintokulut'),
                          ('reserveLabel','contingency','varaus satunnaisiin kuluihin')]:
        configured=normal(mapping[key])
        # Broaden only known FFF labels: percentages and country suffixes vary.
        suffix=r'(?:\s+korkeintaan)?(?:\s+\d+(?:[,.]\d+)?(?:\s*[-–]\s*\d+(?:[,.]\d+)?)?\s*%)?(?:\s+\([^)]*\))?'
        pattern=re.escape(stem)+suffix
        english=(r'(?:overheads?|administration(?: costs)?)' if kind=='administration'
                 else r'contingenc(?:y|ies)')
        english+=r'(?:\s*\([^)]*\))?'
        if value==configured or (re.fullmatch(pattern,configured) and
                                (re.fullmatch(pattern,value) or re.fullmatch(english,value))):
            matches.append(kind)
    if len(matches)>1:raise ValueError('Administration and contingency labels overlap. Use distinct source labels.')
    return matches[0] if matches else None

def description_kind(value):
    from .engine import normal
    value=normal(value)
    if re.match(r'^contingenc(?:y|ies)\b',value):return 'contingency'
    if re.match(r'^(?:overheads?|administration(?: costs)?)\b',value):return 'administration'
    return None

def read_allowances(mapping,end,val,form,label_cells=None):
    from .engine import text
    from decimal import Decimal
    authority=mapping.get('allowanceCategorySource','Primary labels')
    if authority not in ('Primary labels','English descriptions when present'):
        raise ValueError('Choose Primary labels or English descriptions when present for allowance categories.')
    groups=[];rows=set();found=set()
    for r in range(1,end):
        primary=label_kind(val('label',r),mapping)
        label=text(val('label',r));label_cell=mapping['label']+str(r)
        # Modified summary blocks sometimes anchor a merged heading one column
        # earlier. Only accept an explicit primary label, never translate a rate.
        if not primary and label_cells and form('total',r) is not None:
            detail=val('amount',r)
            if detail is None or isinstance(detail,(int,float)) and 0<=detail<=1:
                candidates=[(address,value,label_kind(value,mapping)) for address,value in label_cells(r)
                            if address.upper()!=mapping['description'].strip().upper()+str(r)
                            and isinstance(value,str) and label_kind(value,mapping)]
                kinds={kind for _,_,kind in candidates}
                if len(kinds)>1:raise ValueError(f'Allowance row {r} contains conflicting primary category labels. Check this row in Excel.')
                if candidates:
                    label_cell,label,primary=candidates[0];label=text(label)
        if not primary:continue
        # Detailed costs may use a similar name; a summary row has a total cell.
        if form('total',r) is None:continue
        amount=val('total',r)
        if not isinstance(amount,(int,float)) or isinstance(amount,bool):
            raise ValueError(f'Recalculate allowance at row {r} in Excel: its total has no numeric value')
        rows.add(r);found.add(primary)
        description=text(val('description',r));translated=description_kind(description)
        kind=translated if authority=='English descriptions when present' and translated else primary
        groups.append({'section':22 if kind=='administration' else 23,
                       'section_name':'HALLINTOKULUT JA VARAUS','name':label,
                       'first':r,'last':r,'raw_amount':Decimal(str(amount)),
                       'components':[],'phases':{},'kind':kind,
                       'sourceDescription':description,'source_rows':[r],
                       'allowancePrimaryKind':primary,'allowanceCategorySource':authority,
                       'allowanceLabelCell':label_cell,
                       'allowanceLabelConflict':bool(translated and translated!=primary)})
    for key,kind in [('adminLabel','administration'),('reserveLabel','contingency')]:
        if kind not in found:raise ValueError(f'Allowance label "{mapping[key]}" must match at least one summary row')
    # Distinguish repeated country/partner entries without renaming ordinary rows.
    from collections import Counter
    counts=Counter(g['name'] for g in groups)
    for g in groups:
        if g['sourceDescription'] and counts[g['name']]>1:
            g['name']+=' · '+g['sourceDescription']
    return groups,rows

def allowance_diagnostic(mapping,end,val,form,groups,label_cells):
    """Local-only, targeted footer details; no guess is added to the cashflow."""
    from .engine import text
    lines=['Allowance parser v2. Primary labels determine categories unless explicitly overridden.']
    read=[g for g in groups if g['kind'] in ('administration','contingency')]
    lines.append('Allowance rows read: '+('; '.join(
        f"{g.get('allowanceLabelCell',str(g['first']))}: {g['name']} = €{g['raw_amount']:,.2f}"
        for g in read) or 'none'))
    covered={r for g in groups for r in g.get('source_rows',[])}
    candidates=[]
    for r in range(max(1,end-40),end):
        if r in covered:continue
        labels=[(a,text(v)) for a,v in label_cells(r) if isinstance(v,str) and not v.startswith('=')]
        if not any(re.search(r'hallinto|varaus|overhead|contingen',v,re.I) for _,v in labels):continue
        summary=' / '.join(a+': '+v[:140] for a,v in labels)
        value=val('total',r)
        amount=f'€{value:,.2f}' if isinstance(value,(int,float)) else 'blank / no calculated value'
        candidates.append(f'Row {r} not included: {summary}; mapped total {mapping["total"]}{r} = {amount}')
    lines.extend(candidates[:12])
    if not candidates:lines.append('No other labelled allowance rows found in the last 40 rows. Check the source label and total-column addresses.')
    return '\n'.join(lines)
