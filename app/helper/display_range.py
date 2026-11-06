"""Change the cashflow display without reimporting or retiming budget costs."""
import copy,re
from . import engine,workbooks

def first_month(value):
    value=str(value).strip()
    match=re.fullmatch(r'(0?[1-9]|1[0-2])/(\d{2}|\d{4})',value)
    if match:
        mm,yy=match.groups();value=f'{int(yy)+(2000 if len(yy)==2 else 0):04d}-{int(mm):02d}'
    if re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',value):value+='-01'
    try:return engine.month(engine.date(value)).isoformat()
    except (ValueError,TypeError):raise ValueError('Enter the first cashflow month as MM/YYYY, for example 02/2027.') from None

def prepare(state,value,model=None):
    candidate=copy.deepcopy(state);candidate['config']['firstMonth']=first_month(value)
    model=model or engine.evaluate(candidate)
    # Existing writer maps manual finance by month and rejects dropped payments.
    # Formula relocation is validated again during the atomic workbook save.
    workbooks.cash_values(candidate,model)
    old=engine.evaluate(state)
    opening=candidate['source'].get('opening',0)
    changed=candidate['config']['firstMonth']!=state['config']['firstMonth']
    return candidate,{'model':model,'oldMonths':old['months'],'months':model['months'],
                      'firstMonth':candidate['config']['firstMonth'],
                      'outsideBefore':old['outside'],'outsideAfter':model['outside'],
                      'opening':opening,'confirmOpening':bool(opening and changed)}

def save_candidate(state,value,confirm=False,confirmed_amount=None):
    candidate,report=prepare(state,value)
    if report['confirmOpening'] and (not confirm or confirmed_amount!=report['opening']):
        raise ValueError('The opening balance belongs to the previous first month. Review Cashflow range and confirm the balance for the new first month before applying.')
    return candidate
