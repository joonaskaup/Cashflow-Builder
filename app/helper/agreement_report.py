"""Read-only agreement preparation snapshot of the saved cashflow plan."""
import datetime as dt
import io
import math

NOTE = ('Saved plan only. Budget totals may include holiday pay, employer costs or other supplements; '
        'they are not automatically the fee payable to a person. Month plans and calculated dates need '
        'confirming before agreements. Payment timing alone does not establish work dates.')


def build(state, project_name, model=None):
    from . import engine
    model = model if model is not None else engine.evaluate(state)
    dates = {d['id']: d for d in state['dates']}
    summary, work, payments = [], [], []
    for cost in model['costs']:
        if cost.get('removed'):
            continue
        rule = state['rules'].get(cost.get('rule'), {})
        original = rule.get('lines', [])
        action = next((l.get('action', {}) for l in original if l.get('basis') == 'timing-action'), {})
        result = cost.get('actionResult', {})
        lines = result.get('resolvedLines', original)
        parts = result.get('parts', [])
        # Monetary allocations use work-shaped internal rows for calculation only.
        monetary = action.get('type') in ('months', 'historical', 'span') or result.get('splitBy') in ('percent', 'amount')
        legacy = cost.get('prepShoot') or cost.get('daySplit') or {}
        legacy_parts = [p for p in legacy.get('parts', []) if p.get('days')]
        common = dict(id=cost['id'], name=cost['name'], rows=f"{cost.get('first', '')}–{cost.get('last', '')}")
        own_work = []
        if not monetary:
            for allocation in cost.get('allocations', []):
                index = allocation['line'] - 1
                ln = lines[index] if index < len(lines) else {}
                part = parts[index] if index < len(parts) else {}
                if legacy_parts and index < len(legacy_parts):
                    lp = legacy_parts[index]
                    ref = {'Preparation':'pre', 'Shooting':'shoot', 'Wrap':'post'}.get(lp['name'])
                    ln = dict(ref=ref, window='whole' if ref == 'shoot' else 'end' if ref == 'pre' else 'start')
                    part = dict(quantity=lp['days'])
                period = dates.get(ln.get('ref'), {})
                if ln.get('basis') == 'balanced-months' or ln.get('endRef'):
                    continue  # Payment spread over phases, not a work commitment.
                window = ln.get('window', 'whole')
                exact = window == 'dates'
                if exact:
                    precision = 'Entered work dates'
                elif window in ('start', 'end', 'after'):
                    precision = 'Calculated work estimate — confirm dates'
                elif period.get('precision') == 'month':
                    precision = 'Month plan — individual work dates not set'
                else:
                    precision = 'Production period — confirm individual work dates'
                basis = allocation.get('basis', '')
                detail = 'Mon–Fri estimate; public holidays are not excluded.' if basis == 'weekday-estimate' else ''
                quantity = part.get('quantity')
                unit = result.get('unit') or legacy.get('unit') or cost.get('sourceDurationUnit', '')
                if not parts and not legacy:
                    quantity = ln.get('windowLength') if window in ('start', 'end', 'after') else None
                    unit = {'workdays':'days', 'days':'calendar days', 'months':'months'}.get(ln.get('windowUnit'), '')
                    if quantity is None and ln.get('kind') == 'units':
                        quantity, unit = ln.get('value'), 'work units'
                    if quantity is None:unit = ''
                own_work.append({**common, 'part':allocation['name'], 'start':allocation['start'],
                    'end':allocation['end'], 'precision':precision,
                    'quantity':quantity, 'unit':unit,
                    'note':detail})
        work.extend(own_work)
        own_payments = []
        for p in sorted(cost.get('payments', []), key=lambda p: ('' if p.get('bucket') == 'historical' or p['date'] == 'historical' else p['date'], p.get('line', 0))):
            index = p.get('line', 1) - 1
            ln = lines[index] if index < len(lines) else {}
            part = parts[index] if index < len(parts) else {}
            period = dates.get(ln.get('ref') or part.get('ref'), {})
            historical = p.get('bucket') == 'historical' or p['date'] == 'historical'
            month_choice = action.get('type') == 'months'
            if historical:
                precision = 'Historical total — individual date not recorded'
            elif month_choice:
                precision = 'Payment month — month-end used for calculation'
            elif period.get('kind') == 'milestone':
                precision = ('Calculated from milestone with payment delay' if ln.get('months') or ln.get('days') else
                             'Milestone month — month-end used for calculation' if period.get('precision') == 'month' else 'Dated milestone')
            elif ln.get('fixed'):
                precision = 'Entered payment date'
            else:
                precision = 'Calculated payment date'
            name = part.get('name') or period.get('name') or 'Payment'
            own_payments.append({**common, 'number':len(own_payments)+1, 'part':name,
                'installment':period.get('installmentNumber'), 'date':None if historical else p['date'],
                'month':'Historical' if historical else p['date'][:7], 'precision':precision,
                'amount':p['amount'], 'outside':(p.get('bucket') or p['date'][:7]) not in model['months']})
        payments.extend(own_payments)
        details = []
        for row in cost.get('sourceDetails', []):
            fields = [str(row.get('description') or '')]
            for label, key in [('quantity', 'quantity'), ('unit', 'unit'), ('multiplier', 'multiplier'), ('rate €', 'rate'), ('row total €', 'amount')]:
                if row.get(key) not in ('', None):fields.append(f'{label}: {row[key]}')
            details.append(' · '.join(filter(None, fields)))
        summary.append({**common, 'description':cost.get('sourceDescription') or ' · '.join(filter(None, cost.get('components', []))),
            'quantity':cost.get('sourceDuration'), 'unit':cost.get('sourceDurationUnit', ''),
            'budget':cost['amount'], 'budgetDetails':'\n'.join(details),
            'workCount':len(own_work), 'workStatus':'See Work periods' if own_work else 'Work dates not set',
            'paymentCount':sum(p['month'] != 'Historical' for p in own_payments),
            'historical':sum(p['amount'] for p in own_payments if p['month'] == 'Historical'),
            'scheduled':sum(p['amount'] for p in own_payments), 'unallocated':cost.get('unallocated', 0),
            'checks':'; '.join(cost.get('issues', [])), 'notes':' '.join(result.get('notes', []))})
    return dict(project=project_name, revision=state['revision'], generated=dt.datetime.now(dt.timezone.utc).isoformat(),
                note=NOTE, summary=summary, work=work, payments=payments,
                total=model['total'], scheduled=sum(p['amount'] for p in payments), unallocated=model['unallocated'])


# key, label, kind, column width
COLUMNS = {
    'Summary': [('name','Cost / role','text',28),('rows','Source rows','text',14),('description','Description','text',40),
                ('quantity','Budget quantity','number',16),('unit','Unit','text',14),('budget','Budget total €','money',18),
                ('workStatus','Work dates','text',30),('paymentCount','Scheduled payments','number',20),
                ('historical','Historical €','money',18),('scheduled','All allocated €','money',18),('unallocated','Unallocated €','money',18),
                ('checks','To check','text',40),('budgetDetails','Budget calculation inputs','text',60),('notes','Planning assumptions','text',50)],
    'Work periods': [('name','Cost / role','text',28),('rows','Source rows','text',14),('part','Work period','text',24),
                     ('start','Start','date',16),('end','End','date',16),('precision','Date basis','text',48),
                     ('quantity','Work quantity','number',17),('unit','Unit','text',14),('note','Assumptions','text',45)],
    'Payments': [('name','Cost / role','text',28),('rows','Source rows','text',14),('number','Payment row','number',14),
                 ('part','Payment / installment','text',30),('installment','Installment no.','number',16),
                 ('date','Payment date','date',17),('month','Payment month','text',18),('amount','Amount €','money',18),
                 ('precision','Date basis','text',54),('outside','Outside cashflow display','bool',25)]}


def spreadsheet(report):
    """Static, filterable snapshot. All imported text stays text, never a formula."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    wb = Workbook();wb.remove(wb.active)
    for title, rows in [('Summary',report['summary']), ('Work periods',report['work']), ('Payments',report['payments'])]:
        ws=wb.create_sheet(title);cols=COLUMNS[title];last=get_column_letter(len(cols))
        intro=[f"Cashflow Builder · Reports · {report['project']}",
               f"Saved revision {report['revision']} · Exported {report['generated'][:10]}", report['note']]
        for n, text in enumerate(intro, 1):
            ws.merge_cells(f'A{n}:{last}{n}');c=ws.cell(n,1,text);c.data_type='s'
            c.alignment=Alignment(wrap_text=True,vertical='center');c.font=Font(name='Calibri',size=15 if n==1 else 11,bold=n==1,color='233F4D')
        ws.row_dimensions[1].height=30;ws.row_dimensions[3].height=42
        for i,(_,label,_,width) in enumerate(cols,1):
            c=ws.cell(5,i,label);c.fill=PatternFill('solid',fgColor='233F4D');c.font=Font(name='Calibri',bold=True,color='FFFFFF')
            c.alignment=Alignment(wrap_text=True,vertical='center');ws.column_dimensions[get_column_letter(i)].width=width
        ws.row_dimensions[5].height=32
        for ri,row in enumerate(rows,6):
            for ci,(key,_,kind,_) in enumerate(cols,1):
                value=row.get(key)
                if kind=='money' and value is not None:value=value/100
                if kind=='date' and value:value=dt.date.fromisoformat(value)
                if kind=='bool':value='Yes' if value else ''
                c=ws.cell(ri,ci,value)
                if isinstance(value,str):c.data_type='s'
                c.font=Font(name='Calibri',size=11,color='202A30')
                c.alignment=Alignment(wrap_text=True,vertical='top')
                if ri%2==0:c.fill=PatternFill('solid',fgColor='EDF3F6')
                if kind=='money':c.number_format='#,##0.00;[Red](#,##0.00);"—"'
                elif kind=='date':c.number_format='dd"."mm"."yyyy'
                elif kind=='number':c.number_format='0' if isinstance(value,(int,float)) and float(value).is_integer() else '0.###'
            lines=max((sum(max(1,math.ceil(len(part)/max(1,width*.8))) for part in str(row.get(k) or '').split('\n')) for k,_,_,width in cols),default=1)
            ws.row_dimensions[ri].height=min(409,max(48,lines*16+8))
        if rows:ws.auto_filter.ref=f'A5:{last}{5+len(rows)}'
        else:ws.cell(6,1,'No work periods recorded.' if title=='Work periods' else 'No payments recorded.' if title=='Payments' else 'No active costs.')
        ws.freeze_panes='C6';ws.sheet_view.showGridLines=False
        ws.sheet_properties.pageSetUpPr.fitToPage=True
        ws.page_setup.orientation='landscape';ws.page_setup.paperSize=ws.PAPERSIZE_A3
        ws.page_setup.fitToWidth=1;ws.page_setup.fitToHeight=0
        ws.print_title_rows='1:5';ws.print_options.horizontalCentered=True
    stream=io.BytesIO();wb.save(stream);return stream.getvalue()
