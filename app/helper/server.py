from __future__ import annotations
import argparse, copy, datetime as dt, hashlib, json, secrets, threading, uuid, webbrowser, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from . import engine, workbooks, reusable_actions, display_range, source_details, salary_notes

class Project:
    def __init__(self):
        self.lock=threading.RLock();self.state=workbooks.read_state() or engine.initial_state()
        self.model=engine.evaluate(self.state)
    def changed(self):
        try:
            value=engine.budget_signature(self.state['config'])
            return value!=self.state['source']['signature']
        except Exception:return True
    def view(self):
        return {'capabilities':['source-details-v2','producer-fees-only','salary-title-notes','salary-note-payments'],'app':'erittely_cashflow_helper','state':self.state,'model':self.model,'sourceChanged':self.changed(),
                'actionLibrary':reusable_actions.read_library(), 'files':{'list':str(engine.LIST),'budget':self.state['config']['budget']}}
    def commit(self,candidate,render=False,allow_splits=False):
        if not allow_splits and (source_details.report(self.state,candidate) or salary_notes.report(self.state,candidate)):raise ValueError("Use Refresh budget to review the corrected source grouping before saving source changes.")
        candidate['revision']=self.state.get('revision',0)+1
        candidate['updated']=dt.datetime.now(dt.timezone.utc).isoformat()
        model=engine.evaluate(candidate)
        workbooks.save_project(candidate,model,render=render)
        self.state=candidate;self.model=model
        return self.view()
    def selected(self,state,ids):
        wanted=set(ids);costs=[c for c in state['costs'] if c['id'] in wanted and not c.get('removed')]
        if not costs or len(costs)!=len(wanted):raise ValueError('Select existing costs from the extracted list')
        return costs
    def clear_timing(self,state,body):
        if body.get('clearTiming') is not True or body.get('lines') != [] or any(body.get(k) for k in ('salaryOnly','linkOnly','updateShared','sharedId')):
            raise ValueError('Clear timing must be a separate action for the selected costs, without payment lines or shared-rule changes.')
        costs=self.selected(state,body['costs'])
        for cost in costs:
            cost['rule']=None
            if cost.get('review')=='New cost — choose payment timing':cost['review']=''
        return costs
    def arrange(self,state,body):
        costs=self.selected(state,body['costs'])
        if body.get('clearTiming'):
            return {c['id'] for c in self.clear_timing(state,body)}
        if body.get('salaryOnly'):
            for c in costs:c['salary']=bool(body.get('salary'))
            return {c['id'] for c in costs}
        if body.get('linkOnly'):
            rid=body.get('sharedId')
            if rid not in state['rules']:raise ValueError('Choose a saved arrangement to link')
        else:
            name=engine.text(body.get('name'))
            if not name:raise ValueError('Give the payment arrangement a name')
            lines=copy.deepcopy(body.get('lines',[]))
            if not lines or len(lines)>100:raise ValueError('Enter between 1 and 100 payment lines')
            for ln in lines:
                if ln.get('kind') not in ['percent','fixed','balance','units']:raise ValueError('Choose an amount type for every line')
                if ln.get('ref')!='hist' and ln.get('estimateNote') and not ln.get('estimateConfirmed'):raise ValueError('Confirm or replace the estimated work length before saving')
                for key in ['value','months','days']:
                    v=engine.number(ln.get(key,0));ln[key]=int(v) if v==v.to_integral_value() else float(v)
            if body.get('updateShared'):
                rid=body.get('sharedId')
                if rid not in state['rules']:raise ValueError('Choose the shared rule to update')
            else:
                rid=uuid.uuid4().hex;original=name;count=2
                while name in [r['name'] for r in state['rules'].values()]:name=f'{original} ({count})';count+=1
            state['rules'][rid]={'id':rid,'name':name,'lines':lines,'mode':body.get('mode'),'salary':bool(body.get('salary'))}
        for c in costs:
            c['rule']=rid
            if 'salary' in body:c['salary']=bool(body['salary'])
            if c.get('review')=='New cost — choose payment timing':c['review']=''
        return {c['id'] for c in costs}|({c['id'] for c in state['costs'] if not c.get('removed') and c.get('rule')==rid} if body.get('updateShared') else set())
    def check_dates(self,definitions):
        ids=set();names=set()
        for d in definitions:
            if d.get('inputError'):raise ValueError(d.get('name','Date')+': '+d['inputError'])
            if not d.get('id') or d['id'] in ids:raise ValueError('Every named date needs a unique reference')
            if d['id']=='shoot' and d.get('paidDaysTotal') not in ('',None):
                v=engine.number(d['paidDaysTotal'])
                if not 0<=v<=1200:raise ValueError('Paid shooting days must be between 0 and 1200')
                d['paidDaysTotal']=float(v)
            ids.add(d['id']);n=engine.normal(d.get('name'))
            if not n or n in names:raise ValueError('Give each date or period a distinct name')
            names.add(n)
            if d['id']=='hist':
                label=engine.text(d.get('label'))
                if label:
                    match=engine.re.fullmatch(r'(0[1-9]|1[0-2])/(\d{2})\s*[-–]\s*(0[1-9]|1[0-2])/(\d{2})',label)
                    if not match:raise ValueError('Historical range: use MM/YY-MM/YY, for example 03/23-02/25, or leave it blank')
                    a,y,b,z=match.groups()
                    if (int(z),int(b))<(int(y),int(a)):raise ValueError('Historical range ends before it starts')
                    d['label']=f'{a}/{y}-{b}/{z}'
                continue
            if d.get('kind') not in ['period','milestone']:raise ValueError('Choose period or milestone')
            if d.get('start'):engine.date(d['start'])
            if d.get('end'):engine.date(d['end'])
            if d.get('start') and d.get('end') and d['end']<d['start']:raise ValueError(d['name']+': end precedes start')
            for value in d.get('weights',{}).values():
                if engine.number(value)<0:raise ValueError('Paid days cannot be negative')
    def request(self,action,body):
        with self.lock:
            if body.get('revision')!=self.state.get('revision'):
                raise ValueError('The list changed in another window. Reload the helper before applying this edit.')
            s=copy.deepcopy(self.state)
            if action=='range-preview':
                model=self.preview(body)
                _,report=display_range.prepare(s,body.get('firstMonth',''),model)
                # Compare the same pending plan on both ranges.
                before=self.preview({k:v for k,v in body.items() if k!='firstMonth'})
                report['outsideBefore']=before['outside']
                return report
            if action=='range':
                s=display_range.save_candidate(s,body.get('firstMonth',''),body.get('confirmOpening') is True,body.get('openingAmount'))
            elif action in ('refresh','refresh-preview'):
                if action=='refresh' and body.get('refreshToken'):
                    proposal=getattr(self,'pending_refresh',None)
                    if not proposal or proposal['token']!=body['refreshToken'] or proposal['revision']!=s['revision']:
                        raise ValueError('Refresh preview changed. Preview the budget again.')
                    s=copy.deepcopy(proposal['state'])
                    if engine.budget_signature(s['config'])!=s['source']['signature'] or workbooks.digest(engine.LIST)!=proposal['listSignature']:
                        raise ValueError('The workbook changed since preview. Preview the budget again.')
                else:
                    on_disk=workbooks.read_state()
                    if on_disk:s['dates']=on_disk['dates']
                    engine.refresh(s)
                    if action=='refresh-preview':
                        token=uuid.uuid4().hex
                        self.pending_refresh={'token':token,'state':s,'revision':self.state['revision'],'listSignature':workbooks.digest(engine.LIST)}
                        return {'token':token,'splits':source_details.report(self.state,s),'merges':salary_notes.report(self.state,s),'before':self.model,'after':engine.evaluate(s)}
            elif action=='apply':
                costs=self.selected(s,body['costs']);rid=body['rule']
                if rid not in s['rules']:raise ValueError('Choose an existing payment rule')
                for c in costs:
                    c['rule']=rid
                    if c.get('review')=='New cost — choose payment timing':c['review']=''
            elif action=='rule':
                self.arrange(s,body)
            elif action=='rules':
                if body.get('dates') is not None:
                    self.check_dates(body['dates']);s['dates']=body['dates']
                arrangements=body.get('arrangements',[])
                if not arrangements or len(arrangements)>1000:raise ValueError('Choose costs to save')
                seen=set();timing_changed=set()
                for arrangement in arrangements:
                    ids={c['id'] for c in self.selected(s,arrangement['costs'])}
                    if arrangement.get('updateShared'):
                        ids|={c['id'] for c in s['costs'] if not c.get('removed') and c.get('rule')==arrangement.get('sharedId')}
                    if seen&ids:raise ValueError('Selected arrangements affect the same cost. Review their scope before saving.')
                    seen|=ids;self.arrange(s,arrangement)
                    if not arrangement.get('salaryOnly') and not arrangement.get('clearTiming'):timing_changed|=ids
                # Validate only the edited scope. Unscheduled costs elsewhere remain allowed.
                for c in s['costs']:
                    if c['id'] in timing_changed:
                        result=engine.payments_for(c,s['rules'].get(c.get('rule')),s['dates'])
                        if result['issues'] or result['unallocated']:
                            raise ValueError(c['name']+': '+('; '.join(result['issues']) or 'Amount remains unallocated'))
            elif action=='dates':
                self.check_dates(body['dates']);s['dates']=body['dates']
            elif action=='settings':
                config=body['config'];config['budget']=str(engine.safe_path(config['budget']))
                start=display_range.first_month(config['firstMonth']);config['firstMonth']=start
                if start!=s['config']['firstMonth']:
                    if {k:v for k,v in config.items() if k!='firstMonth'}!={k:v for k,v in s['config'].items() if k!='firstMonth'}:
                        raise ValueError('Apply the first month in Cashflow range separately, then save the source setup.')
                    s=display_range.save_candidate(s,start,body.get('confirmOpening') is True,body.get('openingAmount'))
                else:
                    s['config']=config;engine.refresh(s)
            elif action=='relink':
                new=next((c for c in s['costs'] if c['id']==body['new'] and not c.get('removed')),None)
                old=next((c for c in s['costs'] if c['id']==body['old'] and c.get('removed')),None)
                if not new or not old:raise ValueError('Select a new source cost and a retained missing cost')
                new.update(id=old['id'],rule=old.get('rule'),review='',archived=False)
                s['costs']=[c for c in s['costs'] if c is not old]
            elif action=='review':
                cost=next((c for c in s['costs'] if c['id']==body['cost']),None)
                if not cost:raise ValueError('Cost no longer exists')
                cost['review']=''
                if cost.get('removed'):cost['archived']=True
            else:raise ValueError('Unknown action')
            if action=='dates' or action=='rules' and body.get('dates') is not None:
                # A shared day-count change must not save a formerly valid salary
                # with negative remaining days; combined corrections are allowed.
                for c in s['costs']:
                    r=s['rules'].get(c.get('rule'),{})
                    if c.get('removed') or not any(l.get('basis') in ('day-split','prep-shoot','timing-action') for l in r.get('lines',[])):continue
                    previous=next((x for x in self.state['costs'] if x['id']==c['id']),None)
                    if previous and not engine.payments_for(previous,self.state['rules'].get(previous.get('rule')),self.state['dates'])['issues']:
                        outcome=engine.payments_for(c,r,s['dates'])
                        if outcome['issues']:raise ValueError(c['name']+': '+ '; '.join(outcome['issues']))
            return self.commit(s,allow_splits=action=='refresh' and bool(body.get('refreshToken')))
    def preview(self,body):
        s=copy.deepcopy(self.state)
        if 'firstMonth' in body:s['config']['firstMonth']=display_range.first_month(body['firstMonth'])
        if body.get('dates') is not None:s['dates']=body['dates']
        arrangements=body.get('arrangements',[])
        if body.get('lines') is not None:arrangements=[{'costs':body['costs'],'lines':body['lines']}]
        seen=set()
        for i,arrangement in enumerate(arrangements):
            costs=self.selected(s,arrangement['costs'])
            if arrangement.get('clearTiming'):
                costs=self.clear_timing(s,arrangement)
                for c in costs:c['timingCleared']=True
            if arrangement.get('updateShared'):
                shared=arrangement.get('sharedId')
                costs=list({c['id']:c for c in costs+[c for c in s['costs'] if not c.get('removed') and c.get('rule')==shared]}.values())
            ids={c['id'] for c in costs}
            if ids&seen:raise ValueError('Pending arrangements overlap. Revisit or discard one before previewing or saving.')
            seen.update(ids)
            for c in costs:
                if 'salary' in arrangement:c['salary']=bool(arrangement['salary'])
            if arrangement.get('salaryOnly') or arrangement.get('clearTiming'):continue
            rid=f'preview-{i}'
            lines=arrangement.get('lines',[])
            if arrangement.get('linkOnly'):
                linked=s['rules'].get(arrangement.get('sharedId'))
                if not linked:raise ValueError('Choose a saved arrangement to link')
                lines=linked['lines']
            s['rules'][rid]={'id':rid,'name':arrangement.get('name','Preview'),'lines':lines,'salary':bool(arrangement.get('salary'))}
            for c in costs:c['rule']=rid
        return engine.evaluate(s)
